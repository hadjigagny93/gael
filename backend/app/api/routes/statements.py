import os
import uuid
import shutil
import asyncio
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.core.config import settings
from app.models.bank import Bank
from app.models.statement import Statement
from app.models.transaction import Transaction, Solde, transaction_tags
from app.schemas.transaction import ImportConfirm, TransactionOut
from app.services.pdf_parser import parse_pdf
from app.services.parsers.registry import get_parser

# In-memory job store (single-user local app)
_jobs: dict[str, dict] = {}

router = APIRouter(prefix="/statements", tags=["statements"])


@router.get("/")
def list_statements(db: Session = Depends(get_db)):
    statements = db.query(Statement).order_by(Statement.imported_at.desc()).all()
    return [
        {
            "id": s.id,
            "filename": s.filename,
            "imported_at": s.imported_at,
            "bank_id": s.bank_id,
            "bank_name": s.bank.name,
            "bank_color": s.bank.color,
            "tx_count": len(s.transactions),
        }
        for s in statements
    ]


@router.delete("/{statement_id}")
def delete_statement(statement_id: int, db: Session = Depends(get_db)):
    statement = db.query(Statement).get(statement_id)
    if not statement:
        raise HTTPException(status_code=404, detail="Statement not found")
    tx_ids = [tx.id for tx in statement.transactions]
    if tx_ids:
        db.execute(
            transaction_tags.delete().where(transaction_tags.c.transaction_id.in_(tx_ids))
        )
    db.query(Transaction).filter(Transaction.statement_id == statement_id).delete()
    db.query(Solde).filter(Solde.statement_id == statement_id).delete()
    db.delete(statement)
    db.commit()
    return {"ok": True}


@router.post("/upload")
async def upload_statement(
    bank_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    bank = db.query(Bank).get(bank_id)
    if not bank:
        raise HTTPException(status_code=404, detail="Bank not found")

    existing = db.query(Statement).filter_by(bank_id=bank_id, filename=file.filename).first()
    if existing:
        return {"job_id": None, "statement_id": existing.id, "duplicate": True}

    os.makedirs(settings.UPLOADS_DIR, exist_ok=True)
    file_path = os.path.join(settings.UPLOADS_DIR, file.filename)
    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    statement = Statement(bank_id=bank_id, filename=file.filename, file_path=file_path)
    db.add(statement)
    db.commit()
    db.refresh(statement)

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "processing", "result": None, "error": None}

    asyncio.create_task(_run_parser(job_id, file_path, file.filename, bank.column_mapping))

    return {"job_id": job_id, "statement_id": statement.id}


async def _run_parser(job_id: str, file_path: str, filename: str, existing_mapping):
    try:
        csv_files = await asyncio.to_thread(parse_pdf, file_path, filename)
        _jobs[job_id] = {
            "status": "done",
            "result": {"csv_files": csv_files, "existing_mapping": existing_mapping},
            "error": None,
        }
    except Exception as e:
        _jobs[job_id] = {"status": "error", "result": None, "error": str(e)}


@router.get("/job/{job_id}")
def get_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        return {"status": "error", "result": None, "error": "Job perdu suite à un redémarrage du serveur. Relancez l'import."}
    return job


@router.get("/{statement_id}/pdf")
def serve_pdf(statement_id: int, db: Session = Depends(get_db)):
    statement = db.query(Statement).get(statement_id)
    if not statement or not os.path.exists(statement.file_path):
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(statement.file_path, media_type="application/pdf")


@router.post("/confirm", response_model=list[TransactionOut])
def confirm_import(payload: ImportConfirm, db: Session = Depends(get_db)):
    statement = db.query(Statement).get(payload.statement_id)
    if not statement:
        raise HTTPException(status_code=404, detail="Statement not found")

    bank = db.query(Bank).get(payload.bank_id)
    if not bank:
        raise HTTPException(status_code=404, detail="Bank not found")

    try:
        parser = get_parser(bank.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    result = parser.parse(
        csv_data=payload.csv_data,
        column_mapping=payload.column_mapping.model_dump(),
        year=payload.year,
    )

    transactions = []
    for tx in result.transactions:
        obj = Transaction(
            statement_id=statement.id,
            date=tx.date,
            label=tx.label,
            debit=tx.debit,
            credit=tx.credit,
            currency=tx.currency,
            verified=True,
        )
        db.add(obj)
        transactions.append(obj)

    for sol in result.soldes:
        exists = db.query(Solde).filter_by(statement_id=statement.id, kind=sol.kind).first()
        if not exists:
            db.add(Solde(
                statement_id=statement.id,
                date=sol.date,
                value=sol.value,
                type=sol.type,
                kind=sol.kind,
            ))

    if payload.save_mapping:
        bank.column_mapping = payload.column_mapping.model_dump()

    db.commit()
    for tx in transactions:
        db.refresh(tx)

    return transactions

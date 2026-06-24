import os
import csv
import uuid
import shutil
import re
import asyncio
from datetime import date, datetime
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

# In-memory job store (single-user local app)
_jobs: dict[str, dict] = {}


_SOLDE_DATE_RE = re.compile(r"SOLDE\s+(?:CREDIT(?:EUR)?|DEBIT(?:EUR)?)\s+(?:AU\s+)?(\d{2})[./](\d{2})[./](\d{4})", re.IGNORECASE)


def _infer_year_and_month(csv_data_list: list[list[dict]]) -> tuple[int, int | None]:
    """Scan tables once, return (year, opening_month) from the first SOLDE ... AU DD.MM.YYYY found."""
    for csv_data in csv_data_list:
        for row in csv_data:
            for val in row.values():
                m = _SOLDE_DATE_RE.search(str(val or ""))
                if m:
                    return int(m.group(3)), int(m.group(2))
    return date.today().year, None


def _parse_date(raw: str, year: int, ref_month: int | None = None) -> date | None:
    """Parse a date string. For DD.MM formats, infer year handling Dec→Jan rollover."""
    raw = raw.strip()
    for fmt, needs_year in [
        ("%d.%m.%Y", False), ("%d/%m/%Y", False), ("%Y-%m-%d", False),
        ("%d.%m", True), ("%d/%m", True),
    ]:
        try:
            if needs_year:
                d = datetime.strptime(f"{raw}.{year}", f"{fmt}.%Y").date()
                # If we have a reference month (from the opening SOLDE) and the
                # parsed month is earlier, the statement crossed a year boundary
                # e.g. SOLDE in December (ref_month=12), row month=1 → next year
                if ref_month is not None and d.month < ref_month:
                    d = d.replace(year=year + 1)
                return d
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


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
    # delete transaction_tags links first, then transactions and soldes
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

    # skip duplicate: same filename + same bank
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

    return {
        "job_id": job_id,
        "statement_id": statement.id,
    }


async def _run_parser(job_id: str, file_path: str, filename: str, existing_mapping):
    try:
        csv_files = await asyncio.to_thread(parse_pdf, file_path, filename)
        _jobs[job_id] = {"status": "done", "result": {"csv_files": csv_files, "existing_mapping": existing_mapping}, "error": None}
    except Exception as e:
        _jobs[job_id] = {"status": "error", "result": None, "error": str(e)}


@router.get("/job/{job_id}")
def get_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        # API restarted — return error so front can stop polling
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

    mapping = payload.column_mapping
    inferred_year, ref_month = _infer_year_and_month(payload.csv_data)
    year = payload.year or inferred_year

    transactions = []

    for csv_data in payload.csv_data:
        for row in csv_data:
            try:
                raw_date = str(row.get(mapping.date, "")).strip()
                label = str(row.get(mapping.label, "")).strip()

                if not raw_date or not label:
                    continue

                parsed_date = _parse_date(raw_date, year, ref_month)
                if parsed_date is None:
                    continue

                def parse_amount(val: str) -> float | None:
                    val = val.replace(" ", "").replace("\xa0", "").replace(",", ".")
                    val = re.sub(r"[^\d.\-]", "", val)
                    return float(val) if val else None

                debit = parse_amount(str(row.get(mapping.debit, "") or ""))
                credit = parse_amount(str(row.get(mapping.credit, "") or ""))

                if debit is None and credit is None:
                    continue

                tx = Transaction(
                    statement_id=statement.id,
                    date=parsed_date,
                    label=label,
                    debit=debit,
                    credit=credit,
                    currency="EUR",
                    verified=True,
                )
                db.add(tx)
                transactions.append(tx)
            except Exception:
                continue

    _extract_soldes(db, payload, statement, year, ref_month)

    if payload.save_mapping:
        bank = db.query(Bank).get(payload.bank_id)
        if bank:
            bank.column_mapping = payload.column_mapping.model_dump()

    db.commit()
    for tx in transactions:
        db.refresh(tx)

    return transactions


_SOLDE_RE = re.compile(r"SOLDE\s+(CREDIT(?:EUR)?|DEBIT(?:EUR)?)", re.IGNORECASE)
_DATE_IN_LABEL_RE = re.compile(r"(\d{2})[./](\d{2})[./](\d{4})")


def _extract_soldes(db: Session, payload: ImportConfirm, statement: Statement, year: int, ref_month: int | None):
    mapping = payload.column_mapping
    last_tx_date: date | None = None
    for csv_data in payload.csv_data:
        for row in csv_data:
            raw = str(row.get(mapping.date, "") or "").strip()
            d = _parse_date(raw, year, ref_month)
            if d and (last_tx_date is None or d > last_tx_date):
                last_tx_date = d

    for csv_data in payload.csv_data:
        for row in csv_data:
            # check mapped label column first, then scan all values as fallback
            mapped = str(row.get(mapping.label, "") or "").strip().upper()
            if not _SOLDE_RE.search(mapped):
                mapped = next((str(v).strip().upper() for v in row.values() if _SOLDE_RE.search(str(v or ""))), "")
            label = mapped
            m = _SOLDE_RE.search(label)
            if not m:
                continue

            raw_type = m.group(1).upper()
            sol_type = "crediteur" if raw_type.startswith("CREDIT") else "debiteur"

            # amount: prefer credit col for crediteur, debit col for debiteur
            def _amt(col: str) -> float | None:
                v = str(row.get(col, "") or "").replace(" ", "").replace("\xa0", "").replace(",", ".")
                v = re.sub(r"[^\d.\-]", "", v)
                return float(v) if v else None

            amount = _amt(mapping.credit if sol_type == "crediteur" else mapping.debit)
            if amount is None:
                amount = _amt(mapping.debit) or _amt(mapping.credit)
            if amount is None:
                continue

            # date: try to find it in the label, else use last tx date
            dm = _DATE_IN_LABEL_RE.search(label)
            if dm:
                sol_date = date(int(dm.group(3)), int(dm.group(2)), int(dm.group(1)))
                kind = "ouverture"
            else:
                sol_date = last_tx_date or date(year, 12, 31)
                kind = "cloture"

            # avoid duplicates for this statement
            exists = db.query(Solde).filter_by(
                statement_id=statement.id, kind=kind
            ).first()
            if not exists:
                db.add(Solde(
                    statement_id=statement.id,
                    date=sol_date,
                    value=amount,
                    type=sol_type,
                    kind=kind,
                ))

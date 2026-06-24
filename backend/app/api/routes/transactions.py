from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from decimal import Decimal
from app.db.database import get_db
from app.models.transaction import Transaction, Tag
from app.models.statement import Statement
from app.schemas.transaction import TransactionOut


class TransactionUpdate(BaseModel):
    debit: Optional[Decimal] = None
    credit: Optional[Decimal] = None
    label: Optional[str] = None

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("/", response_model=list[TransactionOut])
def list_transactions(
    verified: bool | None = None,
    statement_id: int | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(Transaction)
    if verified is not None:
        q = q.filter(Transaction.verified == verified)
    if statement_id is not None:
        q = q.filter(Transaction.statement_id == statement_id)
    return q.order_by(Transaction.date.desc()).all()


@router.get("/{tx_id}/statement")
def get_transaction_statement(tx_id: int, db: Session = Depends(get_db)):
    tx = db.query(Transaction).get(tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    stmt = db.query(Statement).get(tx.statement_id)
    return {"statement_id": stmt.id, "filename": stmt.filename}


@router.patch("/{tx_id}/verify", response_model=TransactionOut)
def verify_transaction(tx_id: int, db: Session = Depends(get_db)):
    tx = db.query(Transaction).get(tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    tx.verified = True
    db.commit()
    db.refresh(tx)
    return tx


@router.patch("/{tx_id}", response_model=TransactionOut)
def update_transaction(tx_id: int, payload: TransactionUpdate, db: Session = Depends(get_db)):
    tx = db.query(Transaction).get(tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(tx, field, value)
    db.commit()
    db.refresh(tx)
    return tx


def _ancestors(tag_id: int, db: Session) -> list[int]:
    tag = db.query(Tag).get(tag_id)
    if not tag or not tag.parent_id:
        return []
    return [tag.parent_id] + _ancestors(tag.parent_id, db)


@router.patch("/{tx_id}/tags", response_model=TransactionOut)
def set_tags(tx_id: int, tag_ids: list[int], db: Session = Depends(get_db)):
    tx = db.query(Transaction).get(tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    all_ids = set(tag_ids)
    for tid in tag_ids:
        all_ids.update(_ancestors(tid, db))
    tags = db.query(Tag).filter(Tag.id.in_(all_ids)).all()
    tx.tags = tags
    db.commit()
    db.refresh(tx)
    return tx

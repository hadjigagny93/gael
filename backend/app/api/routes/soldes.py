from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import date
from decimal import Decimal
from app.db.database import get_db
from app.models.transaction import Solde

router = APIRouter(prefix="/soldes", tags=["soldes"])


class SoldeOut(BaseModel):
    id: int
    statement_id: int
    date: date
    value: Decimal
    type: str
    kind: str
    bank_name: str
    bank_color: str

    class Config:
        from_attributes = True


@router.get("/")
def get_soldes(db: Session = Depends(get_db)):
    soldes = db.query(Solde).order_by(Solde.date).all()
    return [
        {
            "id": s.id,
            "statement_id": s.statement_id,
            "date": s.date,
            "value": s.value,
            "type": s.type,
            "kind": s.kind,
            "bank_name": s.statement.bank.name,
            "bank_color": s.statement.bank.color,
        }
        for s in soldes
    ]

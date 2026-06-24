from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.bank import Bank
from app.schemas.bank import BankCreate, BankUpdate, BankOut

router = APIRouter(prefix="/banks", tags=["banks"])


@router.get("/", response_model=list[BankOut])
def list_banks(db: Session = Depends(get_db)):
    return db.query(Bank).all()


@router.post("/", response_model=BankOut, status_code=201)
def create_bank(payload: BankCreate, db: Session = Depends(get_db)):
    if db.query(Bank).filter(Bank.name == payload.name).first():
        raise HTTPException(status_code=409, detail="Bank already exists")
    bank = Bank(**payload.model_dump())
    db.add(bank)
    db.commit()
    db.refresh(bank)
    return bank


@router.patch("/{bank_id}", response_model=BankOut)
def update_bank(bank_id: int, payload: BankUpdate, db: Session = Depends(get_db)):
    bank = db.query(Bank).get(bank_id)
    if not bank:
        raise HTTPException(status_code=404, detail="Bank not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(bank, field, value)
    db.commit()
    db.refresh(bank)
    return bank


@router.delete("/{bank_id}", status_code=204)
def delete_bank(bank_id: int, db: Session = Depends(get_db)):
    bank = db.query(Bank).get(bank_id)
    if not bank:
        raise HTTPException(status_code=404, detail="Bank not found")
    db.delete(bank)
    db.commit()

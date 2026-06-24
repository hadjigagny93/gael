from pydantic import BaseModel
from typing import Optional
from datetime import date
from decimal import Decimal


class TagOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    url: Optional[str] = None
    parent_id: Optional[int] = None
    x: float = 100
    y: float = 100
    radius: float = 80
    color: str = "#6366f1"

    class Config:
        from_attributes = True


class TransactionOut(BaseModel):
    id: int
    statement_id: int
    date: date
    label: str
    debit: Optional[Decimal] = None
    credit: Optional[Decimal] = None
    currency: str
    verified: bool
    tags: list[TagOut] = []

    class Config:
        from_attributes = True


class TransactionRaw(BaseModel):
    """Raw transaction before saving, returned after Docling parsing."""
    date: Optional[str] = None
    label: Optional[str] = None
    amount: Optional[str] = None
    currency: str = "EUR"
    raw: dict  # full row as extracted


class ColumnMapping(BaseModel):
    date: str
    label: str
    debit: str
    credit: str
    currency: Optional[str] = None


class ImportConfirm(BaseModel):
    bank_id: int
    statement_id: int
    csv_data: list[list[dict]]  # list of tables, each table is list of rows
    column_mapping: ColumnMapping
    year: int | None = None
    save_mapping: bool = True

from pydantic import BaseModel
from typing import Optional


class BankCreate(BaseModel):
    name: str
    color: str = "#6366f1"


class BankUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    column_mapping: Optional[dict] = None


class BankOut(BaseModel):
    id: int
    name: str
    color: str
    column_mapping: Optional[dict] = None

    class Config:
        from_attributes = True

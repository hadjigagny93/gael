from sqlalchemy import Column, Integer, String, JSON
from app.db.database import Base


class Bank(Base):
    __tablename__ = "banks"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    color = Column(String, default="#6366f1")
    # column mapping saved after first import validation
    # e.g. {"date": "Date opération", "label": "Libellé", "amount": "Montant"}
    column_mapping = Column(JSON, nullable=True)

from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base


class Statement(Base):
    __tablename__ = "statements"

    id = Column(Integer, primary_key=True)
    bank_id = Column(Integer, ForeignKey("banks.id"), nullable=False)
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    imported_at = Column(DateTime(timezone=True), server_default=func.now())

    bank = relationship("Bank")
    transactions = relationship("Transaction", back_populates="statement")
    soldes = relationship("Solde", back_populates="statement")

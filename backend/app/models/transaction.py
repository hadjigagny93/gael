from sqlalchemy import Column, Integer, String, Numeric, Boolean, Date, ForeignKey, Table
from sqlalchemy.orm import relationship
from app.db.database import Base

transaction_tags = Table(
    "transaction_tags",
    Base.metadata,
    Column("transaction_id", Integer, ForeignKey("transactions.id"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id"), primary_key=True),
)


class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    description = Column(String, nullable=True)
    url = Column(String, nullable=True)
    parent_id = Column(Integer, ForeignKey("tags.id"), nullable=True)
    x = Column(Numeric(10, 2), default=100)
    y = Column(Numeric(10, 2), default=100)
    radius = Column(Numeric(10, 2), default=80)
    color = Column(String, default="#6366f1")

    parent = relationship("Tag", remote_side=[id], back_populates="children")
    children = relationship("Tag", back_populates="parent")


class Solde(Base):
    __tablename__ = "soldes"

    id = Column(Integer, primary_key=True)
    statement_id = Column(Integer, ForeignKey("statements.id"), nullable=False)
    date = Column(Date, nullable=False)
    value = Column(Numeric(12, 2), nullable=False)
    type = Column(String, nullable=False)  # crediteur / debiteur
    kind = Column(String, nullable=False)  # ouverture / cloture

    statement = relationship("Statement", back_populates="soldes")


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True)
    statement_id = Column(Integer, ForeignKey("statements.id"), nullable=False)
    date = Column(Date, nullable=False)
    label = Column(String, nullable=False)
    debit = Column(Numeric(12, 2), nullable=True)
    credit = Column(Numeric(12, 2), nullable=True)
    currency = Column(String(3), default="EUR")
    verified = Column(Boolean, default=False)

    statement = relationship("Statement", back_populates="transactions")
    tags = relationship("Tag", secondary=transaction_tags)

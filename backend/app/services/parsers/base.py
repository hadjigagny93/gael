from abc import ABC, abstractmethod
from datetime import date
from dataclasses import dataclass


@dataclass
class ParsedTransaction:
    date: date
    label: str
    debit: float | None
    credit: float | None
    currency: str = "EUR"


@dataclass
class ParsedSolde:
    date: date
    value: float
    type: str   # "crediteur" | "debiteur"
    kind: str   # "ouverture" | "cloture"


@dataclass
class ParseResult:
    transactions: list[ParsedTransaction]
    soldes: list[ParsedSolde]


class BankParser(ABC):
    """Base class for all bank-specific parsers."""

    @abstractmethod
    def parse(self, csv_data: list[list[dict]], column_mapping: dict, year: int | None = None) -> ParseResult:
        """Parse raw CSV rows extracted from PDF into transactions and soldes."""
        ...

    @abstractmethod
    def infer_year(self, csv_data: list[list[dict]]) -> tuple[int, int | None]:
        """Return (year, reference_month) inferred from the document content."""
        ...

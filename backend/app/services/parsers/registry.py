from .base import BankParser
from .bnp import BNPParser

_REGISTRY: dict[str, BankParser] = {
    "bnp paribas": BNPParser(),
}


def get_parser(bank_name: str) -> BankParser:
    key = bank_name.strip().lower()
    parser = _REGISTRY.get(key)
    if parser is None:
        raise ValueError(f"No parser registered for bank '{bank_name}'. Available: {list(_REGISTRY.keys())}")
    return parser


def list_supported_banks() -> list[str]:
    return list(_REGISTRY.keys())

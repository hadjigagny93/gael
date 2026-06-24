import re
from datetime import date, datetime
from .base import BankParser, ParseResult, ParsedTransaction, ParsedSolde


_SOLDE_DATE_RE = re.compile(
    r"SOLDE\s+(?:CREDIT(?:EUR)?|DEBIT(?:EUR)?)\s+(?:AU\s+)?(\d{2})[./](\d{2})[./](\d{4})",
    re.IGNORECASE,
)
_SOLDE_RE = re.compile(r"SOLDE\s+(CREDIT(?:EUR)?|DEBIT(?:EUR)?)", re.IGNORECASE)
_DATE_IN_LABEL_RE = re.compile(r"(\d{2})[./](\d{2})[./](\d{4})")


def _parse_date(raw: str, year: int, ref_month: int | None = None) -> date | None:
    raw = raw.strip()
    for fmt, needs_year in [
        ("%d.%m.%Y", False), ("%d/%m/%Y", False), ("%Y-%m-%d", False),
        ("%d.%m", True), ("%d/%m", True),
    ]:
        try:
            if needs_year:
                d = datetime.strptime(f"{raw}.{year}", f"{fmt}.%Y").date()
                if ref_month is not None and d.month < ref_month:
                    d = d.replace(year=year + 1)
                return d
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _parse_amount(val: str) -> float | None:
    val = val.replace(" ", "").replace("\xa0", "").replace(",", ".")
    val = re.sub(r"[^\d.\-]", "", val)
    return float(val) if val else None


class BNPParser(BankParser):

    def infer_year(self, csv_data: list[list[dict]]) -> tuple[int, int | None]:
        for rows in csv_data:
            for row in rows:
                for val in row.values():
                    m = _SOLDE_DATE_RE.search(str(val or ""))
                    if m:
                        return int(m.group(3)), int(m.group(2))
        return date.today().year, None

    def parse(self, csv_data: list[list[dict]], column_mapping: dict, year: int | None = None) -> ParseResult:
        inferred_year, ref_month = self.infer_year(csv_data)
        year = year or inferred_year

        mapping = column_mapping
        transactions: list[ParsedTransaction] = []
        last_tx_date: date | None = None

        for rows in csv_data:
            for row in rows:
                try:
                    raw_date = str(row.get(mapping["date"], "")).strip()
                    label = str(row.get(mapping["label"], "")).strip()

                    if not raw_date or not label:
                        continue

                    parsed_date = _parse_date(raw_date, year, ref_month)
                    if parsed_date is None:
                        continue

                    debit = _parse_amount(str(row.get(mapping["debit"], "") or ""))
                    credit = _parse_amount(str(row.get(mapping["credit"], "") or ""))

                    if debit is None and credit is None:
                        continue

                    if last_tx_date is None or parsed_date > last_tx_date:
                        last_tx_date = parsed_date

                    transactions.append(ParsedTransaction(
                        date=parsed_date,
                        label=label,
                        debit=debit,
                        credit=credit,
                    ))
                except Exception:
                    continue

        soldes = self._extract_soldes(csv_data, mapping, year, ref_month, last_tx_date)
        return ParseResult(transactions=transactions, soldes=soldes)

    def _extract_soldes(
        self,
        csv_data: list[list[dict]],
        mapping: dict,
        year: int,
        ref_month: int | None,
        last_tx_date: date | None,
    ) -> list[ParsedSolde]:
        soldes: list[ParsedSolde] = []
        seen_kinds: set[str] = set()

        for rows in csv_data:
            for row in rows:
                mapped = str(row.get(mapping["label"], "") or "").strip().upper()
                if not _SOLDE_RE.search(mapped):
                    mapped = next(
                        (str(v).strip().upper() for v in row.values() if _SOLDE_RE.search(str(v or ""))),
                        "",
                    )

                m = _SOLDE_RE.search(mapped)
                if not m:
                    continue

                raw_type = m.group(1).upper()
                sol_type = "crediteur" if raw_type.startswith("CREDIT") else "debiteur"

                def _amt(col: str) -> float | None:
                    v = str(row.get(col, "") or "").replace(" ", "").replace("\xa0", "").replace(",", ".")
                    v = re.sub(r"[^\d.\-]", "", v)
                    return float(v) if v else None

                amount = _amt(mapping["credit"] if sol_type == "crediteur" else mapping["debit"])
                if amount is None:
                    amount = _amt(mapping["debit"]) or _amt(mapping["credit"])
                if amount is None:
                    continue

                dm = _DATE_IN_LABEL_RE.search(mapped)
                if dm:
                    sol_date = date(int(dm.group(3)), int(dm.group(2)), int(dm.group(1)))
                    kind = "ouverture"
                else:
                    sol_date = last_tx_date or date(year, 12, 31)
                    kind = "cloture"

                if kind not in seen_kinds:
                    seen_kinds.add(kind)
                    soldes.append(ParsedSolde(date=sol_date, value=amount, type=sol_type, kind=kind))

        return soldes

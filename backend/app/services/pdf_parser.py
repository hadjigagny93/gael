import httpx
import os

PARSER_URL = os.getenv("PARSER_URL", "http://parser:8001")


def parse_pdf(file_path: str, filename: str) -> list[dict]:
    """Send PDF to parser service, get back list of CSV metadata."""
    with open(file_path, "rb") as f:
        response = httpx.post(
            f"{PARSER_URL}/parse",
            files={"file": (filename, f, "application/pdf")},
            timeout=180,
        )
    response.raise_for_status()
    return response.json()["csv_files"]

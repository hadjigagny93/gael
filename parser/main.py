import os
import tempfile
import csv
from pathlib import Path
from fastapi import FastAPI, UploadFile, File

app = FastAPI()

UPLOADS_DIR = os.getenv("UPLOADS_DIR", "/uploads")


@app.post("/parse")
async def parse(file: UploadFile = File(...), year: int = None):
    # Save uploaded PDF to a temp file
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        from docling.document_converter import DocumentConverter
        converter = DocumentConverter()
        result = converter.convert(tmp_path)

        stem = Path(file.filename).stem
        csv_files = []

        for i, table in enumerate(result.document.tables):
            df = table.export_to_dataframe()
            if df.empty:
                continue

            csv_name = f"{stem}_table_{i + 1}.csv"
            csv_path = os.path.join(UPLOADS_DIR, csv_name)
            df.to_csv(csv_path, index=False)

            csv_files.append({
                "filename": csv_name,
                "columns": list(df.columns),
                "rows": df.to_dict(orient="records"),
                "total_rows": len(df),
            })

        return {"csv_files": csv_files}
    finally:
        os.unlink(tmp_path)

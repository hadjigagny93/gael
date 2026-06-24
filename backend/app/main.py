from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db.database import Base, engine, SessionLocal
from app.models import Bank, Statement, Transaction, Tag, transaction_tags, Solde
from app.api.routes import banks, statements, transactions, tags, soldes
from app.services import tags_store

Base.metadata.create_all(bind=engine)

with engine.connect() as conn:
    for table, col, typedef in [
        ("tags", "description", "TEXT"),
        ("tags", "url", "TEXT"),
    ]:
        try:
            conn.execute(__import__("sqlalchemy").text(f"ALTER TABLE {table} ADD COLUMN {col} {typedef}"))
            conn.commit()
        except Exception:
            conn.rollback()

@asynccontextmanager
async def lifespan(app: FastAPI):
    db = SessionLocal()
    try:
        tags_store.seed(db)
    finally:
        db.close()
    yield

app = FastAPI(title="Gael API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(banks.router)
app.include_router(statements.router)
app.include_router(transactions.router)
app.include_router(tags.router)
app.include_router(soldes.router)


@app.get("/health")
def health():
    return {"status": "ok"}

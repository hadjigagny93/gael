"""
Persistent JSON store for tags — survives DB resets.
Stores: name, description, url, color. No parent/hierarchy.
"""
import json
from pathlib import Path
from sqlalchemy.orm import Session
from app.models.transaction import Tag

_STORE = Path(__file__).parent.parent.parent / "data" / "tags.json"


def _read() -> list[dict]:
    try:
        return json.loads(_STORE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _write(tags: list[Tag]) -> None:
    data = [
        {"name": t.name, "description": t.description, "url": t.url, "color": t.color}
        for t in tags
    ]
    _STORE.parent.mkdir(parents=True, exist_ok=True)
    _STORE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def seed(db: Session) -> None:
    """Insert tags from JSON that are missing in DB. Called at startup."""
    for entry in _read():
        name = entry.get("name", "").strip()
        if not name:
            continue
        if not db.query(Tag).filter_by(name=name).first():
            db.add(Tag(
                name=name,
                description=entry.get("description"),
                url=entry.get("url"),
                color=entry.get("color") or "#6366f1",
            ))
    db.commit()


def sync(db: Session) -> None:
    """Rewrite JSON from current DB state. Call after any tag mutation."""
    tags = db.query(Tag).order_by(Tag.name).all()
    _write(tags)

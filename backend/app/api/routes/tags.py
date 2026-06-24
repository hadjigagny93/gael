from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from app.db.database import get_db
from app.models.transaction import Tag, transaction_tags
from app.schemas.transaction import TagOut
from app.services import tags_store
from sqlalchemy import select, insert

router = APIRouter(prefix="/tags", tags=["tags"])


class TagCreate(BaseModel):
    name: str
    description: Optional[str] = None
    url: Optional[str] = None
    parent_id: Optional[int] = None
    x: float = 100
    y: float = 100
    radius: float = 80
    color: str = "#6366f1"


class TagUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    url: Optional[str] = None
    parent_id: Optional[int] = None
    x: Optional[float] = None
    y: Optional[float] = None
    radius: Optional[float] = None
    color: Optional[str] = None


@router.get("/", response_model=list[TagOut])
def list_tags(db: Session = Depends(get_db)):
    return db.query(Tag).all()


@router.post("/", response_model=TagOut, status_code=201)
def create_tag(payload: TagCreate, db: Session = Depends(get_db)):
    tag = Tag(**payload.model_dump())
    db.add(tag)
    db.commit()
    db.refresh(tag)
    tags_store.sync(db)
    return tag


def _ancestors(tag_id: int, db: Session) -> list[int]:
    tag = db.query(Tag).get(tag_id)
    if not tag or not tag.parent_id:
        return []
    return [tag.parent_id] + _ancestors(tag.parent_id, db)


@router.patch("/{tag_id}", response_model=TagOut)
def update_tag(tag_id: int, payload: TagUpdate, db: Session = Depends(get_db)):
    tag = db.query(Tag).get(tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    parent_changed = 'parent_id' in payload.model_dump(exclude_none=True) and payload.parent_id != tag.parent_id

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(tag, field, value)
    db.commit()

    # when parent changes, add ancestor tags to all transactions already tagged with this tag
    if parent_changed and tag.parent_id:
        ancestor_ids = _ancestors(tag_id, db)
        if ancestor_ids:
            # find all transactions tagged with this tag
            tx_ids = db.execute(
                select(transaction_tags.c.transaction_id).where(transaction_tags.c.tag_id == tag_id)
            ).scalars().all()
            for tx_id in tx_ids:
                for anc_id in ancestor_ids:
                    exists = db.execute(
                        select(transaction_tags).where(
                            transaction_tags.c.transaction_id == tx_id,
                            transaction_tags.c.tag_id == anc_id
                        )
                    ).first()
                    if not exists:
                        db.execute(transaction_tags.insert().values(transaction_id=tx_id, tag_id=anc_id))
            db.commit()

    db.refresh(tag)
    tags_store.sync(db)
    return tag


@router.delete("/{tag_id}", status_code=204)
def delete_tag(tag_id: int, db: Session = Depends(get_db)):
    tag = db.query(Tag).get(tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    db.execute(transaction_tags.delete().where(transaction_tags.c.tag_id == tag_id))
    db.delete(tag)
    db.commit()
    tags_store.sync(db)

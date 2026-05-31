"""Router API — notificaciones in-app."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from atlas_core.notifications import (
    dismiss_notification,
    list_notifications,
    mark_notifications_read,
)
from atlas_core.web_auth import current_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])
log = logging.getLogger(__name__)


class MarkReadBody(BaseModel):
    ids: list[str] = Field(default_factory=list)
    all: bool = False


class DismissBody(BaseModel):
    id: str


@router.get("")
def get_notifications(
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    try:
        return list_notifications(user)
    except Exception as e:
        log.exception("list notifications failed")
        raise HTTPException(status_code=500, detail="No se pudieron cargar las notificaciones.") from e


@router.post("/read")
def post_notifications_read(
    body: MarkReadBody,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    try:
        n = mark_notifications_read(user, item_ids=body.ids, all_items=body.all)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "marked": n}


@router.post("/dismiss")
def post_notifications_dismiss(
    body: DismissBody,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    if not body.id.startswith("live:"):
        raise HTTPException(400, "Solo se pueden descartar alertas en vivo.")
    try:
        dismiss_notification(user, body.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True}

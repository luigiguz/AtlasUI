"""Modelos ORM — esquema unificado Atlas."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from atlas_core.db.base import Base

# JSON portable (SQLite + PostgreSQL); en PG Alembic usa JSONB explícito.
JsonType = JSON().with_variant(JSONB(), "postgresql")

# SQLite solo autoincrementa PK INTEGER; en PG usamos BIGINT.
PkType = BigInteger().with_variant(Integer, "sqlite")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(PkType, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class AuditWeb(Base):
    __tablename__ = "audit_web"
    __table_args__ = (Index("idx_audit_web_ts", "ts"),)

    id: Mapped[int] = mapped_column(PkType, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    username: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    event: Mapped[str] = mapped_column(String(128), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False, default="")


class AppSetting(Base):
    """Configuración por módulo: cloudflare | rancher | stores."""

    __tablename__ = "app_settings"

    namespace: Mapped[str] = mapped_column(String(32), primary_key=True)
    data: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

"""Modelos ORM — esquema unificado Atlas."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from atlas_core.db.base import Base

# JSON portable (SQLite + PostgreSQL); en PG Alembic usa JSONB explícito.
JsonType = JSON().with_variant(JSONB(), "postgresql")

# SQLite solo autoincrementa PK INTEGER; en PG usamos BIGINT.
PkType = BigInteger().with_variant(Integer, "sqlite")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (Index("idx_users_email", "email", unique=True),)

    id: Mapped[int] = mapped_column(PkType, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    first_name: Mapped[str] = mapped_column(String(64), nullable=False, server_default="")
    last_name: Mapped[str] = mapped_column(String(64), nullable=False, server_default="")
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    sessions: Mapped[list["UserSession"]] = relationship(back_populates="user")


class UserSession(Base):
    """Sesión emitida (JWT jti + refresh). El secreto de firma sigue en env, no en BD."""

    __tablename__ = "user_sessions"
    __table_args__ = (
        Index("idx_user_sessions_user_id", "user_id"),
        Index("idx_user_sessions_refresh_hash", "refresh_token_hash"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        PkType, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    refresh_token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    access_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    refresh_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ip_address: Mapped[str] = mapped_column(String(64), nullable=False, server_default="")
    user_agent: Mapped[str] = mapped_column(String(512), nullable=False, server_default="")

    user: Mapped["User"] = relationship(back_populates="sessions")


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

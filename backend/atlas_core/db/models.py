"""Modelos ORM — esquema unificado Atlas."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func
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
    role_assignments: Mapped[list["UserRole"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Role(Base):
    """Rol con conjunto de permisos (RBAC). Los de sistema no se eliminan."""

    __tablename__ = "roles"
    __table_args__ = (Index("idx_roles_slug", "slug", unique=True),)

    id: Mapped[int] = mapped_column(PkType, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str] = mapped_column(String(256), nullable=False, server_default="")
    is_system: Mapped[bool] = mapped_column(Boolean(), nullable=False, server_default="false")
    permissions: Mapped[list] = mapped_column(JsonType, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    user_assignments: Mapped[list["UserRole"]] = relationship(
        back_populates="role", cascade="all, delete-orphan"
    )


class UserRole(Base):
    __tablename__ = "user_roles"
    __table_args__ = (Index("idx_user_roles_role_id", "role_id"),)

    user_id: Mapped[int] = mapped_column(
        PkType, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role_id: Mapped[int] = mapped_column(
        PkType, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )

    user: Mapped["User"] = relationship(back_populates="role_assignments")
    role: Mapped["Role"] = relationship(back_populates="user_assignments")


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


class StoreChangeRequest(Base):
    """Propuesta de cambio en tiendas Git — flujo de aprobación nativo Atlas."""

    __tablename__ = "store_change_requests"
    __table_args__ = (
        Index("idx_store_change_requests_status", "status"),
        Index("idx_store_change_requests_folder", "folder_name"),
        Index("idx_store_change_requests_created_by", "created_by_user_id"),
    )

    id: Mapped[int] = mapped_column(PkType, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    folder_name: Mapped[str] = mapped_column(String(128), nullable=False)
    store_id: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="pending")
    payload: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    commit_message: Mapped[str] = mapped_column(String(256), nullable=False, server_default="")
    summary: Mapped[str] = mapped_column(String(512), nullable=False, server_default="")
    created_by_user_id: Mapped[int] = mapped_column(
        PkType, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_by_username: Mapped[str] = mapped_column(String(32), nullable=False, server_default="")
    reviewed_by_user_id: Mapped[int | None] = mapped_column(
        PkType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_by_username: Mapped[str | None] = mapped_column(String(32), nullable=True)
    review_note: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

"""Solicitudes de cambio en tiendas (cola de aprobación).

Revision ID: 20260531_0005
Revises: 20260526_0004
Create Date: 2026-05-31

"""

from __future__ import annotations

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260531_0005"
down_revision: Union[str, None] = "20260526_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_APPROVE_PERM = "atlas:stores:Approve"


def upgrade() -> None:
    bind = op.get_bind()
    json_type = (
        postgresql.JSONB(astext_type=sa.Text()) if bind.dialect.name == "postgresql" else sa.JSON()
    )

    op.create_table(
        "store_change_requests",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("folder_name", sa.String(length=128), nullable=False),
        sa.Column("store_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("payload", json_type, nullable=False),
        sa.Column("commit_message", sa.String(length=256), server_default="", nullable=False),
        sa.Column("summary", sa.String(length=512), server_default="", nullable=False),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=False),
        sa.Column("created_by_username", sa.String(length=32), server_default="", nullable=False),
        sa.Column("reviewed_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("reviewed_by_username", sa.String(length=32), nullable=True),
        sa.Column("review_note", sa.String(length=512), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_store_change_requests_status", "store_change_requests", ["status"])
    op.create_index("idx_store_change_requests_folder", "store_change_requests", ["folder_name"])
    op.create_index(
        "idx_store_change_requests_created_by", "store_change_requests", ["created_by_user_id"]
    )

    row = bind.execute(sa.text("SELECT id, permissions FROM roles WHERE slug = 'admin'")).fetchone()
    if row:
        raw = row[1]
        if isinstance(raw, str):
            perms = json.loads(raw)
        elif isinstance(raw, list):
            perms = list(raw)
        else:
            perms = list(raw or [])
        if _APPROVE_PERM not in perms:
            perms.append(_APPROVE_PERM)
            perms.sort()
            bind.execute(
                sa.text("UPDATE roles SET permissions = :p WHERE id = :id"),
                {"p": json.dumps(perms), "id": row[0]},
            )


def downgrade() -> None:
    bind = op.get_bind()
    row = bind.execute(sa.text("SELECT id, permissions FROM roles WHERE slug = 'admin'")).fetchone()
    if row:
        raw = row[1]
        if isinstance(raw, str):
            perms = json.loads(raw)
        elif isinstance(raw, list):
            perms = list(raw)
        else:
            perms = list(raw or [])
        perms = [p for p in perms if p != _APPROVE_PERM]
        bind.execute(
            sa.text("UPDATE roles SET permissions = :p WHERE id = :id"),
            {"p": json.dumps(perms), "id": row[0]},
        )

    op.drop_index("idx_store_change_requests_created_by", table_name="store_change_requests")
    op.drop_index("idx_store_change_requests_folder", table_name="store_change_requests")
    op.drop_index("idx_store_change_requests_status", table_name="store_change_requests")
    op.drop_table("store_change_requests")

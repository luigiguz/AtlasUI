"""Publicaciones directas en tiendas (sin solicitud de aprobación).

Revision ID: 20260602_0008
Revises: 20260531_0007
Create Date: 2026-06-02

"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260602_0008"
down_revision: Union[str, None] = "20260531_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    json_type = (
        postgresql.JSONB(astext_type=sa.Text()) if bind.dialect.name == "postgresql" else sa.JSON()
    )

    op.create_table(
        "store_direct_publishes",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("folder_name", sa.String(length=128), nullable=False),
        sa.Column("store_id", sa.String(length=64), nullable=False),
        sa.Column("summary", sa.String(length=512), server_default="", nullable=False),
        sa.Column("commit_message", sa.String(length=256), server_default="", nullable=False),
        sa.Column("change_lines", json_type, nullable=False),
        sa.Column("published_by_user_id", sa.BigInteger(), nullable=False),
        sa.Column("published_by_username", sa.String(length=32), server_default="", nullable=False),
        sa.Column(
            "published_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["published_by_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_store_direct_publishes_folder", "store_direct_publishes", ["folder_name"]
    )
    op.create_index(
        "idx_store_direct_publishes_published_at", "store_direct_publishes", ["published_at"]
    )
    op.create_index(
        "idx_store_direct_publishes_user", "store_direct_publishes", ["published_by_user_id"]
    )


def downgrade() -> None:
    op.drop_index("idx_store_direct_publishes_user", table_name="store_direct_publishes")
    op.drop_index("idx_store_direct_publishes_published_at", table_name="store_direct_publishes")
    op.drop_index("idx_store_direct_publishes_folder", table_name="store_direct_publishes")
    op.drop_table("store_direct_publishes")

"""Sesiones de usuario (JWT jti + refresh en BD).

Revision ID: 20260526_0003
Revises: 20260526_0002
Create Date: 2026-05-26

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260526_0003"
down_revision: Union[str, None] = "20260526_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("refresh_token_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("access_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("refresh_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ip_address", sa.String(length=64), server_default="", nullable=False),
        sa.Column("user_agent", sa.String(length=512), server_default="", nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_user_sessions_user_id", "user_sessions", ["user_id"], unique=False)
    op.create_index(
        "idx_user_sessions_refresh_hash", "user_sessions", ["refresh_token_hash"], unique=False
    )


def downgrade() -> None:
    op.drop_index("idx_user_sessions_refresh_hash", table_name="user_sessions")
    op.drop_index("idx_user_sessions_user_id", table_name="user_sessions")
    op.drop_table("user_sessions")

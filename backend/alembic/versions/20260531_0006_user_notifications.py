"""Notificaciones in-app (user_notifications, notification_dismissals).

Revision ID: 20260531_0006
Revises: 20260531_0005
Create Date: 2026-05-31

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260531_0006"
down_revision: Union[str, None] = "20260531_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    json_type = (
        postgresql.JSONB(astext_type=sa.Text()) if bind.dialect.name == "postgresql" else sa.JSON()
    )

    op.create_table(
        "user_notifications",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("severity", sa.String(length=16), server_default="info", nullable=False),
        sa.Column("title", sa.String(length=256), nullable=False),
        sa.Column("body", sa.String(length=1024), server_default="", nullable=False),
        sa.Column("route", sa.String(length=32), server_default="home", nullable=False),
        sa.Column("payload", json_type, nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_user_notifications_user_id", "user_notifications", ["user_id"])
    op.create_index("idx_user_notifications_read_at", "user_notifications", ["read_at"])
    op.create_index("idx_user_notifications_created_at", "user_notifications", ["created_at"])

    op.create_table(
        "notification_dismissals",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("dismiss_key", sa.String(length=128), nullable=False),
        sa.Column(
            "dismissed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "dismiss_key"),
    )


def downgrade() -> None:
    op.drop_table("notification_dismissals")
    op.drop_index("idx_user_notifications_created_at", table_name="user_notifications")
    op.drop_index("idx_user_notifications_read_at", table_name="user_notifications")
    op.drop_index("idx_user_notifications_user_id", table_name="user_notifications")
    op.drop_table("user_notifications")

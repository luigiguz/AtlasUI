"""Preferencia de notificaciones por correo en users.

Revision ID: 20260531_0007
Revises: 20260531_0006
Create Date: 2026-05-31

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260531_0007"
down_revision: Union[str, None] = "20260531_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("email_notifications_enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("users", "email_notifications_enabled")

"""Roles RBAC y asignación user_roles.

Revision ID: 20260526_0004
Revises: 20260526_0003
Create Date: 2026-05-26

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260526_0004"
down_revision: Union[str, None] = "20260526_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ADMIN_PERMS = [
    "atlas:users:List",
    "atlas:users:Create",
    "atlas:users:Update",
    "atlas:users:Delete",
    "atlas:roles:List",
    "atlas:roles:Manage",
    "atlas:cf:ReadSettings",
    "atlas:cf:WriteSettings",
    "atlas:cf:Sync",
    "atlas:vpn:Read",
    "atlas:vpn:Operate",
    "atlas:vpn:InitTemplate",
    "atlas:rancher:Read",
    "atlas:rancher:Write",
    "atlas:rancher:Configure",
    "atlas:stores:Read",
    "atlas:stores:Write",
    "atlas:stores:Configure",
]

_OPERATOR_PERMS = [
    "atlas:vpn:Read",
    "atlas:vpn:Operate",
    "atlas:rancher:Read",
    "atlas:rancher:Write",
    "atlas:stores:Read",
    "atlas:stores:Write",
]

_VIEWER_PERMS = [
    "atlas:vpn:Read",
    "atlas:rancher:Read",
    "atlas:stores:Read",
]


def upgrade() -> None:
    bind = op.get_bind()
    json_type = (
        postgresql.JSONB(astext_type=sa.Text()) if bind.dialect.name == "postgresql" else sa.JSON()
    )

    op.create_table(
        "roles",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("slug", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("description", sa.String(length=256), server_default="", nullable=False),
        sa.Column("is_system", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("permissions", json_type, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("idx_roles_slug", "roles", ["slug"], unique=True)

    op.create_table(
        "user_roles",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("role_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "role_id"),
    )
    op.create_index("idx_user_roles_role_id", "user_roles", ["role_id"], unique=False)

    roles = sa.table(
        "roles",
        sa.column("slug", sa.String),
        sa.column("name", sa.String),
        sa.column("description", sa.String),
        sa.column("is_system", sa.Boolean),
        sa.column("permissions", json_type),
    )
    op.bulk_insert(
        roles,
        [
            {
                "slug": "admin",
                "name": "Administrador",
                "description": "Usuarios, credenciales Cloudflare y configuración global.",
                "is_system": True,
                "permissions": _ADMIN_PERMS,
            },
            {
                "slug": "operator",
                "name": "Operador",
                "description": "Túneles y operación; sin credenciales Cloudflare.",
                "is_system": True,
                "permissions": _OPERATOR_PERMS,
            },
            {
                "slug": "viewer",
                "name": "Solo lectura",
                "description": "Consulta de estado sin cambios.",
                "is_system": True,
                "permissions": _VIEWER_PERMS,
            },
        ],
    )

    # Asignar rol según users.role legacy
    if bind.dialect.name == "postgresql":
        op.execute(
            """
            INSERT INTO user_roles (user_id, role_id)
            SELECT u.id, r.id
            FROM users u
            JOIN roles r ON r.slug = u.role
            """
        )
    else:
        op.execute(
            """
            INSERT INTO user_roles (user_id, role_id)
            SELECT u.id, r.id
            FROM users u
            INNER JOIN roles r ON r.slug = u.role
            """
        )


def downgrade() -> None:
    op.drop_index("idx_user_roles_role_id", table_name="user_roles")
    op.drop_table("user_roles")
    op.drop_index("idx_roles_slug", table_name="roles")
    op.drop_table("roles")

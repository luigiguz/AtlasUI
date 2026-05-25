"""Plantillas fleet.yaml para nuevas tiendas PosLite."""

from __future__ import annotations

from typing import Any


def _base_labels(*, store_id: str, distro: str | None = None) -> dict[str, str]:
    labels: dict[str, str] = {
        "atlas": "true",
        "store": store_id,
        "application": "poslite",
    }
    if distro:
        labels["distro"] = distro
    return labels


def _db_fleet(store_id: str) -> dict[str, Any]:
    return {
        "defaultNamespace": "poslite",
        "targetCustomizations": [
            {
                "name": "db",
                "clusterSelector": {"matchLabels": _base_labels(store_id=store_id)},
                "helm": {
                    "chart": "oci://atlashelmrepo.azurecr.io/helm/poslite-db",
                    "version": "1.0.0",
                    "values": {
                        "bundleVersion": "1.0.0",
                        "postgresql": {
                            "timezone": "America/Panama",
                            "database": "poslite",
                            "user": "poslite",
                        },
                        "persistence": {
                            "enabled": True,
                            "storageClass": "local-path",
                            "size": "10Gi",
                            "accessMode": "ReadWriteOnce",
                        },
                        "pgadmin": {"enabled": False},
                    },
                },
            }
        ],
    }


def _horustech_fleet(store_id: str, image_channel: str) -> dict[str, Any]:
    tag = image_channel or "stable"
    return {
        "defaultNamespace": "poslite",
        "targetCustomizations": [
            {
                "name": "horus",
                "clusterSelector": {
                    "matchLabels": _base_labels(store_id=store_id, distro="horustech")
                },
                "helm": {
                    "chart": "oci://atlashelmrepo.azurecr.io/helm/poslite-ht",
                    "version": "1.0.0",
                    "values": {
                        "bundleVersion": "1.0.0",
                        "config": {
                            "timezone": "America/Panama",
                            "companyId": "",
                            "ierpUrl": "",
                            "horustechIp": "",
                            "horustechPortWebapi": "8080",
                        },
                        "guardApi": {"enabled": True, "image": {"tag": tag}, "hostPort": 9015},
                        "portal": {"enabled": True, "image": {"tag": tag}, "hostPort": 9014},
                        "webapi": {"enabled": True, "image": {"tag": tag}, "hostPort": 9010},
                        "coreWebapi": {"enabled": True, "image": {"tag": tag}, "hostPort": 9012},
                        "workers": {
                            "price": {"enabled": True, "image": {"tag": tag}},
                            "shift": {"enabled": True, "image": {"tag": tag}},
                        },
                    },
                },
            }
        ],
    }


def _pam_fleet(store_id: str, image_channel: str) -> dict[str, Any]:
    tag = image_channel or "stable"
    return {
        "defaultNamespace": "poslite",
        "targetCustomizations": [
            {
                "name": "pam",
                "clusterSelector": {"matchLabels": _base_labels(store_id=store_id, distro="pam")},
                "helm": {
                    "chart": "oci://atlashelmrepo.azurecr.io/helm/poslite-pam",
                    "version": "1.0.1",
                    "values": {
                        "bundleVersion": "1.0.0",
                        "config": {
                            "timezone": "America/Panama",
                            "pamIp": "",
                            "ierpUrl": "",
                            "companyId": "",
                        },
                        "guardApi": {"enabled": True, "image": {"tag": tag}, "hostPort": 7015},
                        "portal": {"enabled": True, "image": {"tag": tag}, "hostPort": 7014},
                        "tcpconnector": {"enabled": True, "image": {"tag": tag}, "hostPort": 7010},
                        "coreWebapi": {"enabled": True, "image": {"tag": tag}, "hostPort": 7012},
                        "workers": {
                            "price": {"enabled": True, "image": {"tag": tag}},
                            "shift": {"enabled": True, "image": {"tag": tag}},
                        },
                    },
                },
            }
        ],
    }


def new_store_files(*, store_id: str, distro: str, image_channel: str) -> dict[str, Any]:
    files: dict[str, Any] = {"db/fleet.yaml": _db_fleet(store_id)}
    if distro == "horustech":
        files["horustech/fleet.yaml"] = _horustech_fleet(store_id, image_channel)
    else:
        files["pam/fleet.yaml"] = _pam_fleet(store_id, image_channel)
    return files

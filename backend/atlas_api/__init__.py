"""Atlas API — aplicación FastAPI."""

__version__ = "1.0.0"

from atlas_api.app import create_app, run_web_desktop, run_web_server

__all__ = ["__version__", "create_app", "run_web_server", "run_web_desktop"]

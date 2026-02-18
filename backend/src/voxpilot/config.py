"""Application configuration via environment variables."""

from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    app_name: str = "VoxPilot"
    debug: bool = False
    cors_origins: list[str] = ["http://localhost:3000"]

    github_client_id: str = ""
    github_client_secret: str = ""

    db_path: str = "voxpilot.db"

    # Working directory for agent tools (file reads, searches, etc.).
    # Defaults to the directory where the process was launched.
    work_dir: Path = Path.cwd()

    # Maximum number of agentic loop iterations before forcing a stop.
    max_agent_iterations: int = 25

    model_config = {"env_prefix": "VOXPILOT_"}

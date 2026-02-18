"""Application configuration via environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    app_name: str = "VoxPilot"
    debug: bool = False
    cors_origins: list[str] = ["http://localhost:3000"]

    model_config = {"env_prefix": "VOXPILOT_"}

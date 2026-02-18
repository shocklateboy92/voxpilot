"""Health check route."""

from typing import Annotated

from fastapi import APIRouter, Depends

from voxpilot.config import Settings
from voxpilot.dependencies import get_settings
from voxpilot.models.schemas import HealthResponse

router = APIRouter(prefix="/api", tags=["health"])

SettingsDep = Annotated[Settings, Depends(get_settings)]


@router.get("/health", response_model=HealthResponse)
def health_check(settings: SettingsDep) -> HealthResponse:
    """Return application health status."""
    return HealthResponse(status="ok", app_name=settings.app_name)

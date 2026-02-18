"""FastAPI application entry point."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from voxpilot.api.routes.auth import router as auth_router
from voxpilot.api.routes.chat import router as chat_router
from voxpilot.api.routes.health import router as health_router
from voxpilot.api.routes.sessions import router as sessions_router
from voxpilot.db import close_db, init_db
from voxpilot.dependencies import get_settings


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Manage application startup/shutdown: open and close the database."""
    settings = get_settings()
    await init_db(settings.db_path)
    yield
    await close_db()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()

    application = FastAPI(
        title=settings.app_name,
        debug=settings.debug,
        lifespan=lifespan,
    )

    # CORS middleware for development (frontend on separate port)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # API routes
    application.include_router(health_router)
    application.include_router(auth_router)
    application.include_router(chat_router)
    application.include_router(sessions_router)

    # Serve frontend static files in production
    frontend_dist = Path(__file__).resolve().parent.parent.parent.parent / "frontend" / "dist"
    if frontend_dist.is_dir():
        application.mount(
            "/",
            StaticFiles(directory=frontend_dist, html=True),
            name="frontend",
        )

    return application


app = create_app()

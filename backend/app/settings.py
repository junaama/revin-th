from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent

for env_file in (REPO_ROOT / ".env.local", REPO_ROOT / ".env", BACKEND_DIR / ".env"):
    load_dotenv(env_file)


class Settings(BaseSettings):
    anthropic_api_key: str | None = Field(default=None, validation_alias="ANTHROPIC_API_KEY")
    classifier_model: str = Field(
        default="claude-haiku-4-5-20251001",
        validation_alias="ANTHROPIC_CLASSIFIER_MODEL",
    )
    synthesizer_model: str = Field(
        default="claude-sonnet-4-6",
        validation_alias="ANTHROPIC_SYNTHESIZER_MODEL",
    )
    db_path: str = Field(
        default=str(BACKEND_DIR / "app.db"),
        validation_alias="REVIN_DB_PATH",
    )
    frontend_origin: str = Field(
        default="http://localhost:5173",
        validation_alias="FRONTEND_ORIGIN",
    )
    request_timeout_seconds: float = Field(
        default=30.0,
        validation_alias="ANTHROPIC_TIMEOUT_SECONDS",
    )

    model_config = SettingsConfigDict(extra="ignore", populate_by_name=True)


settings = Settings()

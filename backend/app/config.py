from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env", override=False)


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Settings:
    app_env: str = os.getenv("APP_ENV", "development")
    log_level: str = os.getenv("LOG_LEVEL", "INFO").upper()
    # An absent DATABASE_URL intentionally selects local SQLite. An explicit URL is
    # honored as-is; database errors are surfaced and never trigger a silent fallback.
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./qualitylens.db")
    cors_origins: tuple[str, ...] = tuple(
        s.strip() for s in os.getenv(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",") if s.strip()
    )
    upload_dir: Path = Path(os.getenv("UPLOAD_DIR", str(BACKEND_DIR / "data" / "uploads")))
    max_upload_mb: int = _int("MAX_UPLOAD_MB", 25)
    alert_quality_threshold: float = _float("ALERT_QUALITY_THRESHOLD", 80.0)
    numeric_drift_threshold: float = _float("NUMERIC_DRIFT_THRESHOLD", 0.20)
    categorical_drift_threshold: float = _float("CATEGORICAL_DRIFT_THRESHOLD", 0.10)
    missing_drift_threshold: float = _float("MISSING_DRIFT_THRESHOLD", 0.05)
    smtp_host: str | None = os.getenv("SMTP_HOST") or None
    smtp_port: int = _int("SMTP_PORT", 587)
    smtp_username: str | None = os.getenv("SMTP_USERNAME") or None
    smtp_password: str | None = os.getenv("SMTP_PASSWORD") or None
    smtp_from: str | None = os.getenv("SMTP_FROM") or None
    smtp_starttls: bool = _bool("SMTP_STARTTLS", True)
    alert_email_to: str | None = os.getenv("ALERT_EMAIL_TO") or None

    @property
    def max_upload_bytes(self) -> int:
        return max(1, self.max_upload_mb) * 1024 * 1024

    @property
    def database_kind(self) -> str:
        url = self.database_url.lower()
        if url.startswith("sqlite"):
            return "sqlite"
        if url.startswith("postgresql") or url.startswith("postgres"):
            return "postgresql"
        return "configured"


settings = Settings()

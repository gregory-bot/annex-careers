"""
Jobs Pipeline - Configuration
"""
import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")


class Settings:
    # ── Database (Aiven PostgreSQL) ──────────────────────────────────────────
    DB_HOST     = os.getenv("DB_HOST")
    DB_PORT     = os.getenv("DB_PORT", "13201")
    DB_NAME     = os.getenv("DB_NAME", "defaultdb")
    DB_USER     = os.getenv("DB_USER")
    DB_PASSWORD = os.getenv("DB_PASSWORD")
    DB_SSLMODE  = os.getenv("DB_SSLMODE", "require")
    DB_SCHEMA   = os.getenv("DB_SCHEMA", "jobs")

    @property
    def database_url(self) -> str:
        # SSL is handled via connect_args in connection.py — not in the URL
        return (
            f"postgresql+psycopg2://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    # ── Frontend / Site URLs ─────────────────────────────────────────────────
    FRONTEND_URL = os.getenv("FRONTEND_URL", "https://careers.annex-technologies.com")
    SITE_URL     = os.getenv("SITE_URL",     "https://careers.annex-technologies.com")
    BACKEND_URL  = os.getenv("BACKEND_URL",  "https://jobs-data-pipeline.onrender.com")

    # ── Email ────────────────────────────────────────────────────────────────
    SMTP_HOST          = os.getenv("SMTP_HOST",          "smtp.gmail.com")
    SMTP_PORT          = int(os.getenv("SMTP_PORT",      "587"))
    SMTP_USER          = os.getenv("SMTP_USER",          "noreply@careers.annex-technologies.com")
    SMTP_PASSWORD      = os.getenv("SMTP_PASSWORD",      "")
    EMAIL_FROM_NAME    = os.getenv("EMAIL_FROM_NAME",    "Annex Careers")
    EMAIL_FROM_ADDRESS = os.getenv("EMAIL_FROM_ADDRESS", "noreply@careers.annex-technologies.com")
    EMAIL_FROM         = os.getenv("EMAIL_FROM",         "Annex Careers <noreply@careers.annex-technologies.com>")
    RESEND_API_KEY     = os.getenv("RESEND_API_KEY",     "")
    BREVO_API_KEY      = os.getenv("BREVO_API_KEY",      "")

    # ── Scraper ──────────────────────────────────────────────────────────────
    USER_AGENT = os.getenv(
        "USER_AGENT",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    )
    SCRAPE_INTERVAL_HOURS = int(os.getenv("SCRAPE_INTERVAL_HOURS", "24"))

    # ── Automatic emails / integrations ─────────────────────────────────────
    JOB_ALERT_HOUR_UTC = int(os.getenv("JOB_ALERT_HOUR_UTC", "5"))  # 05:00 UTC = 08:00 EAT
    RELIEFWEB_APPNAME  = os.getenv("RELIEFWEB_APPNAME", "")  # free; request at https://apidoc.reliefweb.int/
    # Public base URL of this API, used when the API must write absolute links to its own
    # files (share-preview images, auto-filled TOR links). Falls back to the request's host.
    API_PUBLIC_URL     = os.getenv("API_PUBLIC_URL", "")
    # Only ONE running API instance should scrape and send alert emails. Set to "false" on
    # every extra instance (e.g. the old server while the new one is live) to avoid duplicates.
    SCHEDULER_ENABLED  = os.getenv("SCHEDULER_ENABLED", "true").strip().lower() not in ("0", "false", "no", "off")
    # Extra browser origins allowed to call the API (comma-separated), e.g. a staging front-end.
    CORS_ORIGINS       = os.getenv("CORS_ORIGINS", "")
    # Optional regex for allowed origins; defaults to any https://*.onrender.com.
    CORS_ORIGIN_REGEX  = os.getenv("CORS_ORIGIN_REGEX", "")

    # ── Admin auth ───────────────────────────────────────────────────────────
    ADMIN_USERNAME       = os.getenv("ADMIN_USERNAME", "")
    ADMIN_PASSWORD       = os.getenv("ADMIN_PASSWORD", "")
    ADMIN_SESSION_SECRET = os.getenv("ADMIN_SESSION_SECRET", "")


settings = Settings()

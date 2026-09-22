"""
Backend API - FastAPI application for serving job data.
Includes built-in cron scheduler that runs daily at 2PM EAT.
"""
import hmac
import math
import re
import secrets
import hashlib
import html as html_lib
import json
import logging
import smtplib
import threading
import httpx
import jwt
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Literal

from fastapi import FastAPI, Depends, Query, HTTPException, UploadFile, File, Form, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import Response, HTMLResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func, desc, text, nullslast, select, case
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from airflow_home.database.connection import get_db, init_db, SessionLocal
from airflow_home.database.models import (
    Job, ScrapeLog, User, UserJobNotification, CVSubmission, AnalyticsEvent, JobSource, EmployerInvite, Attachment, Ad,
)
from api import ocr
from api.listing_extract import detect_content_type, extract_text as extract_attachment_text, parse_listing_text
from airflow_home.config.settings import settings
from api.cv.extract import extract_text_from_upload, CvExtractionError
from api.cv.parser import parse_cv
from api.cv.matcher import analyze, extract_job_keywords
from api.cv.pdf_builder import build_ats_cv_pdf

app = FastAPI(
    title="Jobs Pipeline API",
    description="API for browsing aggregated job listings from multiple sources",
    version="1.0.0",
)

# ── CORS ─────────────────────────────────────────────────────────────────────
# The production site plus local dev origins are always allowed. Extra origins
# (a staging front-end, a preview URL) come from CORS_ORIGINS, comma-separated,
# and any *.onrender.com origin is allowed so a Render-hosted front-end works
# without a redeploy of the API. Admin routes stay protected by their tokens.
DEFAULT_ORIGINS = [
    "https://careers.annex-technologies.com",
    "https://www.careers.annex-technologies.com",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8080",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8080",
]
EXTRA_ORIGINS = [o.strip().rstrip("/") for o in settings.CORS_ORIGINS.split(",") if o.strip()]
ALLOWED_ORIGINS = DEFAULT_ORIGINS + [o for o in EXTRA_ORIGINS if o not in DEFAULT_ORIGINS]
ALLOWED_ORIGIN_REGEX = settings.CORS_ORIGIN_REGEX or r"^https://[a-z0-9-]+\.onrender\.com$"


def _origin_allowed(origin: str) -> bool:
    return bool(origin) and (origin in ALLOWED_ORIGINS or re.match(ALLOWED_ORIGIN_REGEX, origin) is not None)


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH", "HEAD"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=600,
)


# --- Pydantic Schemas ---

class AttachmentResponse(BaseModel):
    id: int
    url: str
    filename: str
    content_type: str
    size: int
    kind: str  # 'image' or 'document'

    class Config:
        orm_mode = True


class JobResponse(BaseModel):
    id: int
    title: str
    company: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    salary_min: Optional[float] = None
    salary_max: Optional[float] = None
    salary_currency: Optional[str] = None
    job_type: Optional[str] = None
    experience_level: Optional[str] = None
    remote: bool = False
    url: Optional[str] = None
    apply_url: Optional[str] = None
    source: str
    tags: Optional[str] = None
    requirements: Optional[str] = None
    posted_date: Optional[datetime] = None
    application_deadline: Optional[datetime] = None
    scraped_at: Optional[datetime] = None
    is_active: bool = True
    kind: str = "job"  # "job" or "contract"
    tor_url: Optional[str] = None
    duration: Optional[str] = None
    budget: Optional[str] = None
    attachments: List[AttachmentResponse] = []
    featured_until: Optional[datetime] = None
    is_featured: bool = False

    class Config:
        orm_mode = True


class PaginatedResponse(BaseModel):
    jobs: list[JobResponse]
    total: int
    page: int
    pages: int
    per_page: int


class StatsResponse(BaseModel):
    total_jobs: int
    active_jobs: int
    active_contracts: int = 0
    remote_jobs: int
    job_type_counts: dict
    companies: int
    sources: dict
    recent_scrapes: list[dict]


class CreateJobRequest(BaseModel):
    title: str
    company: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    requirements: Optional[str] = None
    job_type: Optional[str] = None
    experience_level: Optional[str] = None
    remote: bool = False
    apply_url: Optional[str] = None
    tags: Optional[str] = None
    application_deadline: Optional[str] = None
    kind: Literal["job", "contract"] = "job"
    tor_url: Optional[str] = None  # contracts: link to the Terms of Reference / tender document
    duration: Optional[str] = None  # contracts: e.g. "3 months"
    budget: Optional[str] = None  # contracts: e.g. "KES 800,000"
    attachment_ids: List[int] = []  # files uploaded via POST /api/uploads before saving


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class FeatureRequest(BaseModel):
    days: int = 7  # how long the listing stays pinned


AD_PLACEMENTS = ("home", "jobs_list", "contracts_list", "job_sidebar")


class AdRequest(BaseModel):
    name: str
    advertiser: Optional[str] = None
    placement: Literal["home", "jobs_list", "contracts_list", "job_sidebar"]
    headline: Optional[str] = None
    link_url: str
    image_url: Optional[str] = None
    image_attachment_id: Optional[int] = None
    starts_at: Optional[str] = None  # ISO date or datetime
    ends_at: Optional[str] = None
    is_active: bool = True
    weight: int = 1
    notes: Optional[str] = None


class EmployerInviteRequest(BaseModel):
    company_name: str
    email: EmailStr
    contact_name: Optional[str] = None
    note: Optional[str] = None
    expires_in_days: Optional[int] = None  # None = access never expires
    send_email: bool = True


class EmployerInviteUpdateRequest(BaseModel):
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    email: Optional[EmailStr] = None
    note: Optional[str] = None
    status: Optional[Literal["active", "revoked"]] = None
    expires_in_days: Optional[int] = None  # >0 sets a new expiry from now, 0 clears it


class EmployerLoginRequest(BaseModel):
    email: EmailStr
    access_code: str


class JobSourceRequest(BaseModel):
    name: str
    slug: Optional[str] = None  # derived from name when omitted
    urls: List[str]  # listing-page URLs
    link_pattern: Optional[str] = None
    link_selector: Optional[str] = None
    description_selector: Optional[str] = None
    default_company: Optional[str] = None
    default_location: Optional[str] = None
    max_jobs: int = 60
    enabled: bool = True
    kind: Literal["job", "contract"] = "job"  # what the source lists
    notes: Optional[str] = None


class AnalyticsEventRequest(BaseModel):
    event_type: str
    job_id: Optional[int] = None
    session_id: Optional[str] = None
    referrer: Optional[str] = None


# --- Admin auth ---
# A single shared admin account (env-configured), gated behind a
# server-issued JWT instead of the old client-side-only credential check.

ADMIN_TOKEN_TTL = timedelta(hours=12)
_admin_auth_scheme = HTTPBearer(auto_error=False)


def require_admin(creds: Optional[HTTPAuthorizationCredentials] = Depends(_admin_auth_scheme)):
    if creds is None:
        raise HTTPException(status_code=401, detail="Missing admin token")
    try:
        payload = jwt.decode(creds.credentials, settings.ADMIN_SESSION_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired admin token")
    # Employer-portal tokens are signed with the same secret; keep them out.
    if payload.get("sub") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")


# --- Employer portal auth ---
# Companies invited by the admin sign in with their email + a unique access
# code (only its hash is stored) and get a token scoped to posting jobs.

EMPLOYER_TOKEN_TTL = timedelta(hours=12)
ACCESS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I look-alikes


def _generate_access_code() -> str:
    raw = "".join(secrets.choice(ACCESS_CODE_ALPHABET) for _ in range(12))
    return f"{raw[:4]}-{raw[4:8]}-{raw[8:]}"


def _normalize_access_code(code: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (code or "").upper())


def _hash_access_code(code: str) -> str:
    return hashlib.sha256(_normalize_access_code(code).encode("utf-8")).hexdigest()


def _ensure_invite_usable(invite: EmployerInvite) -> None:
    if invite.status != "active":
        raise HTTPException(status_code=403, detail="This access has been revoked. Contact Annex Careers to restore it.")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if invite.expires_at and invite.expires_at < now:
        raise HTTPException(status_code=403, detail="This access has expired. Contact Annex Careers for a new code.")


def require_uploader(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_admin_auth_scheme),
    db: Session = Depends(get_db),
) -> str:
    """Whoever holds a valid admin or employer token may upload listing files.
    Returns 'admin' or 'employer:<invite id>', recorded on the attachment so a
    file can only be linked to a listing by the account that uploaded it."""
    if creds is None:
        raise HTTPException(status_code=401, detail="Sign in to upload files")
    try:
        payload = jwt.decode(creds.credentials, settings.ADMIN_SESSION_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    if payload.get("sub") == "admin":
        return "admin"
    if payload.get("sub") == "employer" and payload.get("inv"):
        invite = db.query(EmployerInvite).filter(EmployerInvite.id == payload["inv"]).first()
        if not invite:
            raise HTTPException(status_code=401, detail="This access no longer exists")
        _ensure_invite_usable(invite)
        return f"employer:{invite.id}"
    raise HTTPException(status_code=403, detail="Not allowed to upload files")


def require_employer(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_admin_auth_scheme),
    db: Session = Depends(get_db),
) -> EmployerInvite:
    if creds is None:
        raise HTTPException(status_code=401, detail="Missing employer token")
    try:
        payload = jwt.decode(creds.credentials, settings.ADMIN_SESSION_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired session; please sign in again")
    if payload.get("sub") != "employer" or not payload.get("inv"):
        raise HTTPException(status_code=403, detail="Employer access required")
    invite = db.query(EmployerInvite).filter(EmployerInvite.id == payload["inv"]).first()
    if not invite:
        raise HTTPException(status_code=401, detail="This access no longer exists")
    _ensure_invite_usable(invite)
    return invite


# --- Startup ---

logger = logging.getLogger("api")
scheduler = BackgroundScheduler()

# Manual full-scrape state: one run at a time per process, executed off the
# request thread so the HTTP call returns immediately instead of holding the
# connection open for the several minutes a full multi-source scrape takes.
_scrape_lock = threading.Lock()
_scrape_state = {"running": False, "started_at": None}
_running_single_sources: set = set()  # slugs with a manual single-source scrape in flight


def _iso_utc(dt: Optional[datetime]) -> Optional[str]:
    """Timestamps are stored naive-UTC (see runner.py / models.py). Emit them
    with an explicit +00:00 so browsers don't misread them as local time."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def scheduled_daily_scrape():
    """Run all scrapers daily at 2PM EAT."""
    from airflow_home.scrapers.runner import run_all_scrapers
    logger.info("=== SCHEDULED DAILY SCRAPE STARTED ===")
    try:
        results = run_all_scrapers(
            search_query="jobs",
            location=None,
            max_pages=3,
        )
        total = sum(r.get("jobs_found", 0) for r in results)
        logger.info(f"=== DAILY SCRAPE DONE: {total} jobs from {len(results)} sources ===")
    except Exception as e:
        logger.error(f"Scheduled scrape failed: {e}")

    # Job-alert emails are no longer sent here: they go out every morning on
    # their own schedule (see scheduled_job_alerts / JOB_ALERT_HOUR_UTC).
    try:
        _purge_orphan_attachments()
    except Exception as e:
        logger.error(f"Attachment cleanup failed: {e}")


def _purge_orphan_attachments(older_than_hours: int = 24) -> int:
    """Files uploaded to the form but never saved with a listing."""
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=older_than_hours)
    db = SessionLocal()
    try:
        creative_ids = select(Ad.image_attachment_id).where(Ad.image_attachment_id != None)
        removed = (
            db.query(Attachment)
            .filter(Attachment.job_id == None, Attachment.created_at < cutoff, ~Attachment.id.in_(creative_ids))
            .delete(synchronize_session=False)
        )
        db.commit()
        if removed:
            logger.info(f"Purged {removed} abandoned upload(s)")
        return removed
    finally:
        db.close()


# --- Automatic job-alert emails -----------------------------------------------
# Every stored user (subscribers and CV uploaders) is matched against jobs
# they have not been emailed about yet and gets one email a day at 8 AM EAT.

_alerts_lock = threading.Lock()
_alerts_state = {"running": False, "last_run_at": None, "last_summary": None, "last_error": None}


def scheduled_job_alerts():
    with _alerts_lock:
        if _alerts_state["running"]:
            logger.info("Job alerts already running; skipping this trigger")
            return
        _alerts_state["running"] = True
    try:
        summary = notify_users_of_new_jobs()
        with _alerts_lock:
            _alerts_state.update(last_run_at=datetime.now(timezone.utc), last_summary=summary, last_error=None)
    except Exception as e:
        logger.error(f"Job alerts failed: {e}")
        with _alerts_lock:
            _alerts_state.update(last_run_at=datetime.now(timezone.utc), last_error=str(e)[:300])
    finally:
        with _alerts_lock:
            _alerts_state["running"] = False


def keep_alive_ping():
    """Ping our own health endpoint to prevent Render from sleeping."""
    try:
        # ↓ Updated to production backend URL (set BACKEND_URL env var on Render)
        backend_url = settings.BACKEND_URL.rstrip("/")
        httpx.get(f"{backend_url}/api/health", timeout=10)
        logger.debug("Keep-alive ping sent")
    except Exception:
        pass


@app.on_event("startup")
def startup():
    init_db()
    from airflow_home.database.connection import engine
    with engine.connect() as conn:
        try:
            conn.execute(text(
                "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS application_deadline TIMESTAMP"
            ))
            conn.execute(text(
                "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS requirements TEXT"
            ))
            conn.execute(text(
                "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS employer_invite_id INTEGER"
            ))
            for ddl in (
                "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS kind VARCHAR(20) DEFAULT 'job'",
                "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tor_url VARCHAR(1000)",
                "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS duration VARCHAR(120)",
                "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS budget VARCHAR(120)",
                "CREATE INDEX IF NOT EXISTS ix_jobs_kind ON jobs (kind)",
                "ALTER TABLE job_sources ADD COLUMN IF NOT EXISTS kind VARCHAR(20) DEFAULT 'job'",
                "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS featured_until TIMESTAMP",
                "CREATE INDEX IF NOT EXISTS ix_jobs_featured_until ON jobs (featured_until)",
            ):
                conn.execute(text(ddl))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    email VARCHAR(320) NOT NULL UNIQUE,
                    name VARCHAR(300),
                    source VARCHAR(50) NOT NULL DEFAULT 'subscribe',
                    job_interests TEXT,
                    subscribed_at TIMESTAMP DEFAULT NOW(),
                    last_emailed_at TIMESTAMP
                )
            """))
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS cv_text TEXT"
            ))
            conn.execute(text("COMMIT"))
            logger.info("DB migration: columns/tables ensured")
        except Exception as e:
            logger.warning(f"DB migration note: {e}")
    _backfill_job_kinds()

    if not settings.SCHEDULER_ENABLED:
        logger.warning("SCHEDULER_ENABLED=false: this instance will not scrape or send alert emails")
        ocr.warm_up_in_background()
        return

    scheduler.add_job(
        scheduled_daily_scrape,
        CronTrigger(hour=11, minute=0),  # 11 UTC = 2PM EAT
        id="daily_scrape",
        name="Daily Full Scrape (2PM EAT)",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        scheduled_job_alerts,
        CronTrigger(hour=settings.JOB_ALERT_HOUR_UTC, minute=0),
        id="daily_job_alerts",
        name="Daily Job Alert Emails",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        keep_alive_ping,
        IntervalTrigger(minutes=10),
        id="keep_alive",
        name="Keep-alive Ping (10min)",
        replace_existing=True,
    )
    scheduler.start()
    logger.info(
        f"Scheduler started: daily scrape at 11:00 UTC, job alert emails at "
        f"{settings.JOB_ALERT_HOUR_UTC:02d}:00 UTC, keep-alive every 10min"
    )
    ocr.warm_up_in_background()


def _reclassify_scraped_jobs(db: Session) -> dict:
    """Re-run the job/contract classifier over scraped rows still marked as
    jobs. Manual and employer listings keep whatever kind was chosen for them.
    Returns counts; caller commits."""
    from airflow_home.transformers.cleaner import classify_kind
    rows = (
        db.query(Job)
        .filter(Job.kind == "job", ~Job.source.in_(["manual", "employer"]))
        .all()
    )
    changed = 0
    for job in rows:
        if classify_kind(job.title, job.description, "job") == "contract":
            job.kind = "contract"
            changed += 1
    return {"scanned": len(rows), "reclassified_as_contract": changed}


def _backfill_job_kinds() -> None:
    """One-off: rows that predate the kind column (NULL) get classified from
    their text so existing consultancies surface under Contracts."""
    db = SessionLocal()
    try:
        if db.query(Job).filter(Job.kind == None).count() == 0:
            return
        db.query(Job).filter(Job.kind == None).update({"kind": "job"}, synchronize_session=False)
        result = _reclassify_scraped_jobs(db)
        db.commit()
        logger.info(f"Job kind backfill: {result}")
    except Exception as e:
        logger.warning(f"Job kind backfill skipped: {e}")
        db.rollback()
    finally:
        db.close()


@app.on_event("shutdown")
def shutdown():
    scheduler.shutdown(wait=False)


from fastapi import Request
from fastapi.responses import JSONResponse

@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    import traceback
    logger.error(f"Unhandled exception on {request.url}: {exc}\n{traceback.format_exc()}")
    origin = request.headers.get("origin", "")
    headers = {}
    if _origin_allowed(origin):
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
        headers["Vary"] = "Origin"
    return JSONResponse(status_code=500, content={"detail": str(exc)}, headers=headers)


# --- Shared job-visibility filter ---

AGGREGATOR_TITLE_PATTERNS = [
    "%Hiring For jobs%", "%Hiring Full Time jobs%",
    "%Job In Kenya Jobs%", "Jobs in Kenya%", "Jobs in Nairobi%",
    "%Trending%Jobs%", "%Latest%Jobs in Kenya%",
    "%Explore the Trending%", "%Check out the%Jobs%",
    "%Exciting Trending%", "%Latest In-Demand%",
    "%Your CV Format%", "Click here to%", "%post comments%",
    "CURRENT%JOBS IN KENYA%", "Current%Jobs in Kenya%",
    "All jobs |%", "%Jobs Archive%", "Jobweb Kenya:%",
    "%Jobs, Employment%", "%Now Hiring jobs%",
    "%Immediate jobs in%", "%We Are Hiring jobs%",
    "%Vacancies jobs in%", "%Companies Hiring jobs%",
    "%Hiring jobs in%", "%jobs in Kenya (%",
]


def _active_visible_jobs_query(db: Session):
    """Jobs that should actually be shown to users: active, not expired,
    with a real title/description, and not scraper/aggregator junk.
    Shared by /api/jobs, /api/categories, /api/locations, /api/companies
    so their counts stay consistent with each other."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    query = db.query(Job).filter(Job.is_active == True)
    query = query.filter(
        (Job.application_deadline == None) | (Job.application_deadline >= now)
    )
    query = query.filter(Job.description != None, Job.description != "", func.length(Job.description) > 30)
    query = query.filter(func.length(Job.title) > 5)
    for pattern in AGGREGATOR_TITLE_PATTERNS:
        query = query.filter(~Job.title.ilike(pattern))
    query = query.filter(~Job.source.ilike("google_%"))
    return query


# --- Endpoints ---

@app.get("/")
def root():
    return {"message": "Jobs Pipeline API", "docs": "/docs"}


@app.post("/api/admin/login")
def admin_login(req: AdminLoginRequest):
    if not settings.ADMIN_USERNAME or not settings.ADMIN_PASSWORD or not settings.ADMIN_SESSION_SECRET:
        raise HTTPException(status_code=503, detail="Admin login is not configured")
    valid_user = hmac.compare_digest(req.username, settings.ADMIN_USERNAME)
    valid_pass = hmac.compare_digest(req.password, settings.ADMIN_PASSWORD)
    if not (valid_user and valid_pass):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    expires_at = datetime.now(timezone.utc) + ADMIN_TOKEN_TTL
    token = jwt.encode(
        {"sub": "admin", "exp": expires_at},
        settings.ADMIN_SESSION_SECRET,
        algorithm="HS256",
    )
    return {"token": token, "expires_at": expires_at.isoformat()}


@app.get("/api/jobs", response_model=PaginatedResponse)
def list_jobs(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=1000),
    search: Optional[str] = None,
    source: Optional[str] = None,
    location: Optional[str] = None,
    job_type: Optional[str] = None,
    remote: Optional[bool] = None,
    kind: Literal["job", "contract", "all"] = Query("job"),
    featured: Optional[bool] = None,
    sort_by: str = Query("scraped_at", pattern="^(scraped_at|posted_date|title|company|salary_min)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    query = _active_visible_jobs_query(db)
    if kind != "all":
        query = query.filter(Job.kind == kind)
    if featured:
        query = query.filter(Job.featured_until != None, Job.featured_until > now)

    if search:
        sf = f"%{search}%"
        query = query.filter(
            Job.title.ilike(sf) | Job.company.ilike(sf) |
            Job.description.ilike(sf) | Job.tags.ilike(sf)
        )
    if source:
        query = query.filter(Job.source == source)
    if location:
        query = query.filter(Job.location.ilike(f"%{location}%"))
    if job_type:
        query = query.filter(Job.job_type.ilike(job_type))
    if remote is not None:
        query = query.filter(Job.remote == remote)

    sort_col = getattr(Job, sort_by, Job.scraped_at)
    ordering = desc(sort_col) if sort_order == "desc" else sort_col
    if sort_by == "salary_min":
        # Postgres defaults NULLs to sort FIRST on DESC — push unknown
        # salaries to the bottom regardless of direction instead.
        ordering = nullslast(ordering)
    # Paid featured listings stay on top whatever the sort.
    featured_rank = case((Job.featured_until > now, 1), else_=0)
    query = query.order_by(desc(featured_rank), ordering)

    total = query.count()
    pages = math.ceil(total / per_page) if total > 0 else 1
    jobs = query.options(selectinload(Job.attachments)).offset((page - 1) * per_page).limit(per_page).all()

    return PaginatedResponse(
        jobs=[JobResponse.from_orm(j) for j in jobs],
        total=total, page=page, pages=pages, per_page=per_page,
    )


def _public_api_base(request: Request) -> str:
    """Absolute base for links to this API's own files."""
    configured = (settings.API_PUBLIC_URL or "").strip().rstrip("/")
    return configured or str(request.base_url).rstrip("/")


@app.get("/api/jobs/{job_id}", response_model=JobResponse)
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(Job).options(selectinload(Job.attachments)).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobResponse.from_orm(job)


@app.post("/api/analytics/events", status_code=201)
def record_analytics_event(
    req: AnalyticsEventRequest,
    db: Session = Depends(get_db),
    user_agent: Optional[str] = Header(None),
):
    if req.event_type not in {"page_view", "apply_click"}:
        raise HTTPException(status_code=400, detail="Unsupported analytics event")
    if req.event_type == "apply_click" and req.job_id is None:
        raise HTTPException(status_code=400, detail="job_id is required for apply_click")
    if req.job_id is not None and not db.query(Job.id).filter(Job.id == req.job_id).first():
        raise HTTPException(status_code=404, detail="Job not found")

    db.add(AnalyticsEvent(
        event_type=req.event_type,
        job_id=req.job_id,
        session_id=req.session_id,
        referrer=req.referrer,
        user_agent=user_agent,
    ))
    db.commit()
    return {"recorded": True}


@app.get("/api/admin/analytics")
def get_admin_analytics(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=6)

    def count_events(event_type: str, start=None):
        query = db.query(func.count(AnalyticsEvent.id)).filter(AnalyticsEvent.event_type == event_type)
        if start:
            query = query.filter(AnalyticsEvent.created_at >= start)
        return query.scalar() or 0

    click_filter = AnalyticsEvent.event_type == "apply_click"
    job_type_rows = (
        db.query(Job.job_type, func.count(AnalyticsEvent.id))
        .join(AnalyticsEvent, AnalyticsEvent.job_id == Job.id)
        .filter(click_filter)
        .group_by(Job.job_type)
        .order_by(desc(func.count(AnalyticsEvent.id)))
        .all()
    )
    source_rows = (
        db.query(Job.source, func.count(AnalyticsEvent.id))
        .join(AnalyticsEvent, AnalyticsEvent.job_id == Job.id)
        .filter(click_filter)
        .group_by(Job.source)
        .order_by(desc(func.count(AnalyticsEvent.id)))
        .all()
    )
    top_job_rows = (
        db.query(Job.id, Job.title, Job.company, Job.job_type, func.count(AnalyticsEvent.id))
        .join(AnalyticsEvent, AnalyticsEvent.job_id == Job.id)
        .filter(click_filter)
        .group_by(Job.id, Job.title, Job.company, Job.job_type)
        .order_by(desc(func.count(AnalyticsEvent.id)))
        .limit(10)
        .all()
    )

    return {
        "page_views": {
            "total": count_events("page_view"),
            "today": count_events("page_view", today_start),
            "this_week": count_events("page_view", week_start),
        },
        "apply_clicks": {
            "total": count_events("apply_click"),
            "today": count_events("apply_click", today_start),
            "this_week": count_events("apply_click", week_start),
        },
        "job_types": [{"name": name or "Not specified", "count": count} for name, count in job_type_rows],
        "sources": [{"name": name or "Unknown", "count": count} for name, count in source_rows],
        "top_jobs": [
            {"id": job_id, "title": title, "company": company, "job_type": job_type, "count": count}
            for job_id, title, company, job_type, count in top_job_rows
        ],
    }


def _job_from_request(
    req: CreateJobRequest, source: str,
    company: Optional[str] = None, employer_invite_id: Optional[int] = None,
) -> Job:
    """Build (but don't persist) a Job from a manual/employer submission."""
    deadline = None
    if req.application_deadline:
        try:
            deadline = datetime.fromisoformat(req.application_deadline)
        except ValueError:
            pass
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return Job(
        title=req.title.strip(), company=(company or req.company or None), location=req.location,
        description=req.description, requirements=req.requirements,
        job_type=req.job_type,
        experience_level=req.experience_level, remote=req.remote,
        url=req.apply_url, apply_url=req.apply_url, source=source,
        tags=req.tags, application_deadline=deadline,
        posted_date=now, scraped_at=now, is_active=True,
        employer_invite_id=employer_invite_id,
        kind=req.kind or "job",
        tor_url=(req.tor_url or "").strip() or None,
        duration=(req.duration or "").strip() or None,
        budget=(req.budget or "").strip() or None,
    )


def _attach_uploads(db: Session, job: Job, attachment_ids: List[int], uploader: str, api_base: str) -> int:
    """Link files the same account uploaded (and hasn't used yet) to a saved
    listing. A contract without a TOR link gets the first document as its TOR.
    Caller commits."""
    if not attachment_ids:
        return 0
    rows = (
        db.query(Attachment)
        .filter(Attachment.id.in_(attachment_ids), Attachment.job_id == None, Attachment.uploaded_by == uploader)
        .order_by(Attachment.id).all()
    )
    for att in rows:
        att.job_id = job.id
    if job.kind == "contract" and not job.tor_url:
        document = next((a for a in rows if a.kind == "document"), None)
        if document:
            job.tor_url = f"{api_base}{document.url}"
    return len(rows)


@app.post("/api/jobs")
def create_job(req: CreateJobRequest, request: Request, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    if not req.title or not req.title.strip():
        raise HTTPException(status_code=400, detail="Job title is required")
    job = _job_from_request(req, source="manual")
    db.add(job)
    db.commit()
    db.refresh(job)
    attached = _attach_uploads(db, job, req.attachment_ids, "admin", _public_api_base(request))
    db.commit()
    logger.info(f"Manual {job.kind} created: {job.id} - {job.title} ({attached} attachment(s))")
    return {"message": "Job created", "job_id": job.id, "attachments": attached}


# --- Admin job management ---

@app.get("/api/admin/jobs", response_model=PaginatedResponse)
def admin_list_jobs(
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=100),
    search: Optional[str] = None,
    status: Literal["all", "active", "inactive"] = Query("all"),
    kind: Literal["all", "job", "contract"] = Query("all"),
    featured: Optional[bool] = None,
    source: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    """Every job in the database, with no public-visibility filter, so the
    admin can find, repost or delete anything, including rows hidden from
    the public listing. Paginated and searched server-side so it scales far
    past what a browser can hold."""
    query = db.query(Job)
    if kind != "all":
        query = query.filter(Job.kind == kind)
    if featured:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        query = query.filter(Job.featured_until != None, Job.featured_until > now)
    if status == "active":
        query = query.filter(Job.is_active == True)
    elif status == "inactive":
        query = query.filter(Job.is_active == False)
    if source:
        query = query.filter(Job.source == source)
    if search and search.strip():
        # Every whitespace-separated term must match at least one field, so
        # "safaricom marketing" narrows rather than widens.
        for term in search.strip().split():
            sf = f"%{term}%"
            cond = (
                Job.title.ilike(sf) | Job.company.ilike(sf) | Job.location.ilike(sf)
                | Job.source.ilike(sf) | Job.tags.ilike(sf)
            )
            if term.isdigit():
                cond = cond | (Job.id == int(term))
            query = query.filter(cond)

    total = query.count()
    pages = math.ceil(total / per_page) if total > 0 else 1
    jobs = (
        query.options(selectinload(Job.attachments)).order_by(nullslast(desc(Job.scraped_at)), desc(Job.id))
        .offset((page - 1) * per_page).limit(per_page).all()
    )
    return PaginatedResponse(
        jobs=[JobResponse.from_orm(j) for j in jobs],
        total=total, page=page, pages=pages, per_page=per_page,
    )


def _delete_job_row(db: Session, job: Job) -> None:
    """Remove a job and detach its dependants explicitly rather than trusting
    every deployment's FK ON DELETE clauses to match models.py. Caller commits."""
    job_id = job.id
    db.query(Attachment).filter(Attachment.job_id == job_id).delete(synchronize_session=False)
    db.query(UserJobNotification).filter(UserJobNotification.job_id == job_id).delete(synchronize_session=False)
    db.query(CVSubmission).filter(CVSubmission.job_id == job_id).update({"job_id": None}, synchronize_session=False)
    db.query(AnalyticsEvent).filter(AnalyticsEvent.job_id == job_id).update({"job_id": None}, synchronize_session=False)
    db.delete(job)


def _repost_job_row(job: Job) -> bool:
    """Reactivate and bump a job to the top of the listing (which sorts by
    scraped_at); drop an already-passed deadline that would keep it hidden.
    Returns whether a deadline was cleared. Caller commits."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    deadline_cleared = False
    if job.application_deadline and job.application_deadline < now:
        job.application_deadline = None
        deadline_cleared = True
    job.is_active = True
    job.posted_date = now
    job.scraped_at = now
    return deadline_cleared


@app.delete("/api/admin/jobs/{job_id}")
def admin_delete_job(job_id: int, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    title, source = job.title, job.source
    _delete_job_row(db, job)
    db.commit()
    logger.info(f"Admin deleted job {job_id} - {title} ({source})")
    return {"message": "Job deleted", "job_id": job_id}


@app.post("/api/admin/jobs/{job_id}/repost")
def admin_repost_job(job_id: int, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """Re-share a job: bump it to the top of the public listing (which sorts
    by scraped_at), reactivate it, and drop an already-passed deadline that
    would otherwise keep it hidden. Users not yet emailed about it become
    eligible again on the next notification cycle."""
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    deadline_cleared = _repost_job_row(job)
    db.commit()
    db.refresh(job)
    logger.info(f"Admin reposted job {job_id} - {job.title}")
    return {
        "message": "Job reposted" + (" and its expired deadline cleared" if deadline_cleared else ""),
        "job": JobResponse.from_orm(job),
        "deadline_cleared": deadline_cleared,
    }


@app.post("/api/admin/jobs/{job_id}/feature")
def admin_feature_job(job_id: int, req: FeatureRequest, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """Paid placement: pin the listing to the top of its list for N days."""
    if not 1 <= req.days <= 365:
        raise HTTPException(status_code=400, detail="Days must be between 1 and 365")
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    base = job.featured_until if job.featured_until and job.featured_until > now else now
    job.featured_until = base + timedelta(days=req.days)
    job.is_active = True
    db.commit()
    db.refresh(job)
    logger.info(f"Admin featured job {job_id} until {job.featured_until}")
    return {"message": f"Featured until {job.featured_until.strftime('%d %b %Y')}", "job": JobResponse.from_orm(job)}


@app.delete("/api/admin/jobs/{job_id}/feature")
def admin_unfeature_job(job_id: int, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job.featured_until = None
    db.commit()
    return {"message": "Listing is no longer featured", "job_id": job_id}


@app.post("/api/admin/jobs/reclassify")
def admin_reclassify_jobs(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """Move scraped listings that read like consultancies / TORs / tenders
    under Contracts. Safe to run repeatedly; manual and employer postings are
    left alone."""
    result = _reclassify_scraped_jobs(db)
    db.commit()
    logger.info(f"Admin reclassify: {result}")
    return {"message": f"Scanned {result['scanned']} scraped jobs, moved {result['reclassified_as_contract']} to Contracts", **result}


@app.post("/api/jobs/cleanup")
def cleanup_junk_jobs(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    from sqlalchemy import or_
    all_junk_ids = set()
    no_desc = (
        db.query(Job.id).filter(
            Job.is_active == True,
            or_(Job.description == None, Job.description == "", func.length(Job.description) <= 30),
        ).all()
    )
    all_junk_ids.update(j.id for j in no_desc)
    for pattern in AGGREGATOR_TITLE_PATTERNS:
        matches = db.query(Job.id).filter(Job.is_active == True, Job.title.ilike(pattern)).all()
        all_junk_ids.update(j.id for j in matches)
    short = db.query(Job.id).filter(Job.is_active == True, func.length(Job.title) <= 5).all()
    all_junk_ids.update(j.id for j in short)
    generic_category = (
        db.query(Job.id).filter(
            Job.is_active == True, Job.title.ilike("% Jobs"),
            or_(Job.company == None, Job.company == ""),
        ).all()
    )
    all_junk_ids.update(j.id for j in generic_category)
    google_junk = db.query(Job.id).filter(Job.is_active == True, Job.source.ilike("google_%")).all()
    all_junk_ids.update(j.id for j in google_junk)
    if all_junk_ids:
        db.query(Job).filter(Job.id.in_(all_junk_ids)).update({"is_active": False}, synchronize_session=False)
        db.commit()
    logger.info(f"Cleaned up {len(all_junk_ids)} junk jobs")
    return {"message": f"Deactivated {len(all_junk_ids)} junk jobs", "count": len(all_junk_ids)}


@app.get("/api/sources")
def list_sources(db: Session = Depends(get_db)):
    results = (
        db.query(Job.source, func.count(Job.id))
        .filter(Job.is_active == True).group_by(Job.source).all()
    )
    return {"sources": {source: count for source, count in results}}


def _visible_of_kind(db: Session, kind: str):
    query = _active_visible_jobs_query(db)
    return query if kind == "all" else query.filter(Job.kind == kind)


@app.get("/api/categories")
def list_categories(
    limit: Optional[int] = Query(None, ge=1, le=100),
    kind: Literal["job", "contract", "all"] = Query("job"),
    db: Session = Depends(get_db),
):
    """Category facet counts, derived from Job.tags (comma-separated).
    Aggregated server-side so the homepage/Categories page don't need to
    download every job row just to compute this."""
    rows = _visible_of_kind(db, kind).with_entities(Job.tags).all()
    counts: dict = {}
    labels: dict = {}
    for (tags,) in rows:
        if not tags:
            continue
        for raw in tags.split(","):
            name = raw.strip()
            if not name:
                continue
            key = name.lower()
            counts[key] = counts.get(key, 0) + 1
            labels.setdefault(key, name)
    categories = [
        {"name": labels[key], "count": count}
        for key, count in sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    ]
    if limit:
        categories = categories[:limit]
    return {"categories": categories}


@app.get("/api/locations")
def list_locations(
    limit: Optional[int] = Query(None, ge=1, le=200),
    kind: Literal["job", "contract", "all"] = Query("job"),
    db: Session = Depends(get_db),
):
    rows = (
        _visible_of_kind(db, kind)
        .with_entities(Job.location, func.count(Job.id))
        .group_by(Job.location)
        .order_by(desc(func.count(Job.id)))
        .all()
    )
    locations = [{"name": loc, "count": count} for loc, count in rows if loc]
    if limit:
        locations = locations[:limit]
    return {"locations": locations}


@app.get("/api/companies")
def list_companies(
    limit: Optional[int] = Query(None, ge=1, le=200),
    kind: Literal["job", "contract", "all"] = Query("job"),
    db: Session = Depends(get_db),
):
    rows = (
        _visible_of_kind(db, kind)
        .with_entities(Job.company, func.count(Job.id))
        .group_by(Job.company)
        .order_by(desc(func.count(Job.id)))
        .all()
    )
    companies = [{"name": c, "count": count} for c, count in rows if c]
    if limit:
        companies = companies[:limit]
    return {"companies": companies}


@app.get("/api/stats", response_model=StatsResponse)
def get_stats(db: Session = Depends(get_db)):
    total_jobs = db.query(func.count(Job.id)).scalar()
    active_jobs = db.query(func.count(Job.id)).filter(Job.is_active == True).scalar()
    source_counts = db.query(Job.source, func.count(Job.id)).group_by(Job.source).all()
    recent_logs = db.query(ScrapeLog).order_by(desc(ScrapeLog.started_at)).limit(20).all()

    visible = _active_visible_jobs_query(db)
    remote_jobs = visible.filter(Job.remote == True).count()
    active_contracts = visible.filter(Job.kind == "contract").count()
    job_type_rows = (
        visible.with_entities(Job.job_type, func.count(Job.id))
        .group_by(Job.job_type).all()
    )
    # Merge case-variant job_type values (e.g. "Full-time" / "full-time")
    # into one bucket, keeping the first-seen casing for display.
    job_type_counts: dict = {}
    job_type_labels: dict = {}
    for jt, c in job_type_rows:
        if not jt:
            continue
        key = jt.lower()
        job_type_counts[key] = job_type_counts.get(key, 0) + c
        job_type_labels.setdefault(key, jt)
    job_type_counts = {job_type_labels[k]: v for k, v in job_type_counts.items()}
    companies = (
        _active_visible_jobs_query(db).with_entities(Job.company)
        .filter(Job.company != None, Job.company != "")
        .distinct().count()
    )

    return StatsResponse(
        total_jobs=total_jobs, active_jobs=active_jobs, active_contracts=active_contracts,
        remote_jobs=remote_jobs, job_type_counts=job_type_counts,
        companies=companies,
        sources={s: c for s, c in source_counts},
        recent_scrapes=[
            {
                "source": log.source, "status": log.status,
                "jobs_found": log.jobs_found,
                "started_at": _iso_utc(log.started_at),
            }
            for log in recent_logs
        ],
    )


@app.post("/api/scrape/{source}")
def trigger_scrape(
    source: str,
    search_query: Optional[str] = None,
    location: Optional[str] = None,
    max_pages: int = Query(3, ge=1, le=10),
    _admin=Depends(require_admin),
):
    from airflow_home.scrapers.runner import run_scraper, is_known_source
    if not is_known_source(source):
        raise HTTPException(status_code=400, detail=f"Unknown source: {source}")
    return run_scraper(source, search_query=search_query, location=location, max_pages=max_pages)


@app.get("/api/health")
def health_check(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        return {"status": "unhealthy", "database": str(e)}


# --- Email helpers ---

# ↓ SITE_URL now always resolves to https://careers.annex-technologies.com
SITE_URL = settings.SITE_URL


def build_welcome_email_html(jobs: list, name: str = None) -> str:
    """Build a branded HTML welcome email with featured jobs."""
    greeting = f"Hello {name}," if name else "Hello,"
    job_cards = ""
    for job in jobs:
        location = job.location or "Remote"
        company  = job.company  or "—"
        job_type = job.job_type or ""
        # ↓ Link goes to careers.annex-technologies.com, NOT Netlify
        job_url  = f"{SITE_URL}/jobs/{job.id}"
        type_badge = (
            f'<span style="display:inline-block;background:#fef2f2;color:#dc2626;'
            f'font-size:11px;padding:2px 8px;border-radius:12px;margin-top:6px;">{job_type}</span>'
            if job_type else ""
        )
        job_cards += f"""
        <tr>
          <td style="padding:0 24px 12px;">
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
              <tr>
                <td style="padding:16px 20px;">
                  <a href="{job_url}" style="color:#dc2626;font-size:15px;font-weight:600;text-decoration:none;">{job.title}</a>
                  <div style="color:#6b7280;font-size:13px;margin-top:4px;">{company}</div>
                  <div style="color:#6b7280;font-size:12px;margin-top:4px;">📍 {location}</div>
                  {type_badge}
                  <div style="margin-top:12px;">
                    <a href="{job_url}"
                       style="display:inline-block;background:#dc2626;color:#ffffff;font-size:13px;
                              font-weight:500;padding:8px 20px;border-radius:6px;text-decoration:none;">
                      View &amp; Apply
                    </a>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>"""

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
        style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr>
          <td style="background:#dc2626;padding:28px 24px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">Annex Careers</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Your gateway to the best job opportunities</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 24px 12px;">
            <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">{greeting}</h2>
            <p style="margin:0 0 6px;color:#374151;font-size:14px;line-height:1.6;">
              Here are the latest job opportunities we think you'll love:
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 24px 12px;">
            <h3 style="margin:0;color:#dc2626;font-size:16px;font-weight:600;border-bottom:2px solid #dc2626;padding-bottom:8px;">
              Latest Opportunities
            </h3>
          </td>
        </tr>
        {job_cards}
        <tr>
          <td style="padding:20px 24px 8px;text-align:center;">
            <a href="{SITE_URL}/jobs"
               style="display:inline-block;background:#dc2626;color:#ffffff;font-size:15px;
                      font-weight:600;padding:12px 36px;border-radius:8px;text-decoration:none;">
              Browse All Jobs
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 24px;text-align:center;border-top:1px solid #e5e7eb;margin-top:16px;">
            <p style="margin:0 0 6px;color:#9ca3af;font-size:12px;">
              &copy; {datetime.now().year} Annex Careers &bull; Aggregating opportunities from 20+ sources
            </p>
            <p style="margin:0;color:#9ca3af;font-size:11px;">
              <a href="{SITE_URL}" style="color:#dc2626;text-decoration:none;">careers.annex-technologies.com</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def build_targeted_email_html(name: str, interest_label: str, jobs: list) -> str:
    """Build an email for targeted job recommendations based on user interests."""
    job_cards = ""
    for job in jobs:
        location = job.location or "Remote"
        company  = job.company  or "—"
        # ↓ Link goes to careers.annex-technologies.com, NOT Netlify
        job_url  = f"{SITE_URL}/jobs/{job.id}"
        job_cards += f"""
        <tr>
          <td style="padding:0 24px 12px;">
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
              <tr>
                <td style="padding:16px 20px;">
                  <a href="{job_url}" style="color:#dc2626;font-size:15px;font-weight:600;text-decoration:none;">{job.title}</a>
                  <div style="color:#6b7280;font-size:13px;margin-top:4px;">{company}</div>
                  <div style="color:#6b7280;font-size:12px;margin-top:4px;">📍 {location}</div>
                  <div style="margin-top:12px;">
                    <a href="{job_url}"
                       style="display:inline-block;background:#dc2626;color:#ffffff;font-size:13px;
                              font-weight:500;padding:8px 20px;border-radius:6px;text-decoration:none;">
                      View &amp; Apply
                    </a>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>"""

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
        style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr>
          <td style="background:#dc2626;padding:28px 24px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">Annex Careers</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Jobs matched to your interests</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 24px 12px;">
            <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Hello {name},</h2>
            <p style="margin:0 0 6px;color:#374151;font-size:14px;line-height:1.6;">
              Check out jobs for <strong>{interest_label}</strong> professionals like you:
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 24px 12px;">
            <h3 style="margin:0;color:#dc2626;font-size:16px;font-weight:600;border-bottom:2px solid #dc2626;padding-bottom:8px;">
              Jobs for {interest_label} Professionals
            </h3>
          </td>
        </tr>
        {job_cards}
        <tr>
          <td style="padding:20px 24px 8px;text-align:center;">
            <a href="{SITE_URL}/jobs"
               style="display:inline-block;background:#dc2626;color:#ffffff;font-size:15px;
                      font-weight:600;padding:12px 36px;border-radius:8px;text-decoration:none;">
              Browse All Jobs
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 24px;text-align:center;border-top:1px solid #e5e7eb;">
            <p style="margin:0 0 6px;color:#9ca3af;font-size:12px;">
              &copy; {datetime.now().year} Annex Careers &bull; Aggregating opportunities from 20+ sources
            </p>
            <p style="margin:0;color:#9ca3af;font-size:11px;">
              <a href="{SITE_URL}" style="color:#dc2626;text-decoration:none;">careers.annex-technologies.com</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def send_email(to_email: str, subject: str, html_body: str):
    """Send via Brevo (primary) → Resend (secondary) → SMTP (fallback)."""

    # ── Primary: Brevo ───────────────────────────────────────────────────────
    if settings.BREVO_API_KEY:
        resp = httpx.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={
                "api-key": settings.BREVO_API_KEY,
                "Content-Type": "application/json",
            },
            json={
                "sender": {
                    # ↓ Must match the verified domain in Brevo
                    "name":  settings.EMAIL_FROM_NAME,
                    "email": settings.EMAIL_FROM_ADDRESS,   # noreply@careers.annex-technologies.com
                },
                "to": [{"email": to_email}],
                "subject": subject,
                "htmlContent": html_body,
            },
            timeout=15,
        )
        if resp.status_code in (200, 201, 202):
            logger.info(f"Brevo: sent to {to_email}")
            return
        logger.warning(f"Brevo failed ({resp.status_code}): {resp.text}")

    # ── Secondary: Resend ────────────────────────────────────────────────────
    if settings.RESEND_API_KEY:
        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "from":    settings.EMAIL_FROM,   # "Annex Careers <noreply@careers.annex-technologies.com>"
                "to":      [to_email],
                "subject": subject,
                "html":    html_body,
            },
            timeout=15,
        )
        if resp.status_code in (200, 201):
            logger.info(f"Resend: sent to {to_email}")
            return
        logger.warning(f"Resend failed ({resp.status_code}): {resp.text}")

    # ── Fallback: SMTP ───────────────────────────────────────────────────────
    if settings.SMTP_USER and settings.SMTP_PASSWORD:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = f"{settings.EMAIL_FROM_NAME} <{settings.SMTP_USER}>"
        msg["To"]      = to_email
        msg.attach(MIMEText(html_body, "html"))
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            server.ehlo()
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_USER, [to_email], msg.as_string())
        logger.info(f"SMTP: sent to {to_email}")
        return

    raise RuntimeError("No email provider configured (BREVO_API_KEY, RESEND_API_KEY, or SMTP_PASSWORD)")


def send_email_background(to_email: str, subject: str, html_body: str):
    """Fire-and-forget email in a background thread."""
    def _send():
        try:
            send_email(to_email, subject, html_body)
        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {e}")
    threading.Thread(target=_send, daemon=True).start()


def _save_user(db: Session, email: str, name: str = None, source: str = "subscribe", job_interests: str = None):
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        if name:            existing.name = name
        if source == "cv_upload": existing.source = "cv_upload"
        if job_interests:   existing.job_interests = job_interests
        db.commit(); db.refresh(existing)
        return existing
    user = User(email=email, name=name, source=source, job_interests=job_interests)
    db.add(user); db.commit(); db.refresh(user)
    return user


def _match_jobs_for_interests(db: Session, job_interests: str, limit: int = 5, exclude_ids: Optional[set] = None):
    """Keyword-match active jobs against a free-text interests/skills string.
    Shared by register_user, send_bulk_alerts, and notify_users_of_new_jobs
    so the matching behavior stays identical everywhere it's used."""
    from sqlalchemy import or_
    keywords = [kw.strip().lower() for kw in job_interests.replace(",", " ").split() if len(kw.strip()) > 2]
    if not keywords:
        keywords = [job_interests.strip().lower()]
    filters = [Job.title.ilike(f"%{kw}%") for kw in keywords] + [Job.description.ilike(f"%{kw}%") for kw in keywords]
    query = db.query(Job).filter(Job.is_active == True).filter(or_(*filters))
    if exclude_ids:
        query = query.filter(~Job.id.in_(exclude_ids))
    return query.order_by(desc(Job.scraped_at)).limit(limit).all()


def notify_users_of_new_jobs() -> dict:
    """Match every stored user against currently-active listings and email
    them only the ones they haven't been notified about (tracked via
    UserJobNotification). Sends synchronously so the count is real; a failed
    send leaves no notification row, so that user is retried next time.
    Runs from the scheduler (no request context), so it owns its session."""
    if not _email_provider_configured():
        logger.info("notify_users_of_new_jobs: no email provider configured, skipping")
        return {"skipped": True, "reason": "No email provider configured", "users": 0, "emailed": 0, "failed": 0, "jobs_sent": 0}

    db = SessionLocal()
    try:
        users = db.query(User).all()
        featured = (
            db.query(Job).filter(Job.is_active == True)
            .order_by(desc(Job.scraped_at)).limit(5).all()
        )
        emailed = failed = jobs_sent = 0
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        for user in users:
            already_notified = {
                row.job_id for row in
                db.query(UserJobNotification.job_id).filter(UserJobNotification.user_id == user.id).all()
            }
            if user.job_interests:
                candidates = _match_jobs_for_interests(db, user.job_interests, limit=5, exclude_ids=already_notified)
            else:
                candidates = [j for j in featured if j.id not in already_notified]
            if not candidates:
                continue

            if user.job_interests:
                interest_label = user.job_interests.title()
                html = build_targeted_email_html(user.name or "there", interest_label, candidates)
                subject = f"New jobs for {interest_label} professionals - Annex Careers"
            else:
                html = build_welcome_email_html(candidates, name=user.name)
                subject = "New jobs matching your profile - Annex Careers"

            try:
                send_email(user.email, subject, html)
            except Exception as e:
                failed += 1
                logger.error(f"Job alert to {user.email} failed: {e}")
                continue

            user.last_emailed_at = now
            for job in candidates:
                db.add(UserJobNotification(user_id=user.id, job_id=job.id, sent_at=now))
            emailed += 1
            jobs_sent += len(candidates)

        db.commit()
        summary = {"skipped": False, "users": len(users), "emailed": emailed, "failed": failed, "jobs_sent": jobs_sent}
        logger.info(f"notify_users_of_new_jobs: {summary}")
        return summary
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

# --- CV Engine (rule-based, no external AI API) ---
#
# Replaces the old client-side flow that called Gemini directly from the
# browser with a public API key and burned through free-tier quota. This
# is fully deterministic: text extraction (api/cv/extract.py) -> structured
# parsing (api/cv/parser.py) -> keyword scoring (api/cv/matcher.py) ->
# optional PDF generation (api/cv/pdf_builder.py). No AI API calls, no
# quota risk, runs entirely on this server.

def _job_context_text(job: Job) -> str:
    return " ".join(filter(None, [job.description, job.requirements, job.tags]))


def _prepare_cv_analysis(content: bytes, filename: str, job_id: Optional[int], db: Session):
    """Shared pipeline for /api/cv/analyze and /api/cv/generate: extract,
    parse, score, and persist. Raises HTTPException on bad input."""
    try:
        raw_text = extract_text_from_upload(filename, content)
    except CvExtractionError as e:
        raise HTTPException(status_code=422, detail=str(e))

    parsed = parse_cv(raw_text)

    job = None
    job_keywords = None
    if job_id is not None:
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        job_keywords = extract_job_keywords(_job_context_text(job))

    result = analyze(
        parsed, job_keywords,
        job_title=job.title if job else "", company=job.company if job else "",
    )

    user_id = None
    if parsed.email:
        user = _save_user(
            db, email=parsed.email, name=parsed.name, source="cv_upload",
            # Real extracted skills (not just one job title) — this also
            # directly improves notify_users_of_new_jobs()'s match quality.
            job_interests=", ".join(parsed.skills) if parsed.skills else None,
        )
        user.cv_text = raw_text
        db.commit()
        user_id = user.id

    return parsed, job, result, user_id


def _record_cv_submission(db: Session, user_id: Optional[int], job_id: Optional[int], action: str, result, parsed):
    db.add(CVSubmission(
        user_id=user_id, job_id=job_id, action=action,
        score=result.score,
        matched_skills=",".join(result.matched_skills) or None,
        missing_skills=",".join(result.missing_skills) or None,
        parse_confidence=parsed.parse_confidence,
    ))
    db.commit()


@app.post("/api/cv/analyze")
async def analyze_cv(
    file: UploadFile = File(...),
    job_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
):
    content = await file.read()
    parsed, job, result, user_id = _prepare_cv_analysis(content, file.filename or "", job_id, db)
    _record_cv_submission(db, user_id, job_id, "analyze", result, parsed)

    return {
        "type": "analysis",
        "score": result.score,
        "summary": result.summary,
        "strengths": result.strengths,
        "gaps": result.gaps,
        "recommendations": result.recommendations,
        "matched_skills": result.matched_skills,
        "missing_skills": result.missing_skills,
        "candidate_name": result.candidate_name,
        "candidate_email": result.candidate_email,
        "parse_confidence": result.parse_confidence,
        "low_confidence": result.low_confidence,
    }


@app.post("/api/cv/generate")
async def generate_cv(
    file: UploadFile = File(...),
    job_id: Optional[int] = Form(None),
    confirmed_skills: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    content = await file.read()
    parsed, job, result, user_id = _prepare_cv_analysis(content, file.filename or "", job_id, db)

    if confirmed_skills:
        requested = {s.strip().lower() for s in confirmed_skills.split(",") if s.strip()}
        # A user-confirmed "I actually have this" checkbox, not a free-text
        # field: only skills the job itself asks for AND that were already
        # flagged as missing can be added, so this can never be used to
        # inject arbitrary claims into someone's CV.
        added_skills = sorted(requested & set(result.missing_skills))
        if added_skills:
            existing_lower = {s.lower() for s in parsed.skills}
            parsed.skills += [s for s in added_skills if s not in existing_lower]
            result.matched_skills = sorted(set(result.matched_skills) | set(added_skills))

    _record_cv_submission(db, user_id, job_id, "generate", result, parsed)

    pdf_bytes = build_ats_cv_pdf(
        parsed, matched_skills=result.matched_skills,
        job_title=job.title if job else "", company=job.company if job else "",
    )
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", parsed.name or "ATS_CV").strip("_") or "ATS_CV"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.pdf"'},
    )


# --- Subscription / User endpoints ---

class SubscribeRequest(BaseModel):
    email: EmailStr

class UserRegisterRequest(BaseModel):
    email: EmailStr
    name: Optional[str] = None
    job_interests: Optional[str] = None

class BulkEmailRequest(BaseModel):
    user_ids: List[int]


@app.post("/api/subscribe")
def subscribe(req: SubscribeRequest, db: Session = Depends(get_db)):
    if not settings.BREVO_API_KEY and not settings.RESEND_API_KEY and not settings.SMTP_PASSWORD:
        raise HTTPException(status_code=503, detail="Email service not configured")

    _save_user(db, email=req.email, source="subscribe")

    featured_jobs = (
        db.query(Job).filter(Job.is_active == True)
        .order_by(desc(Job.scraped_at)).limit(5).all()
    )
    html = build_welcome_email_html(featured_jobs)
    send_email_background(
        req.email,
        "Welcome to Annex Careers — Here are today's top opportunities",
        html,
    )
    return {"message": "Subscribed! Welcome email is on its way."}


@app.post("/api/users/register")
def register_user(req: UserRegisterRequest, db: Session = Depends(get_db)):
    user = _save_user(db, email=req.email, name=req.name, source="cv_upload", job_interests=req.job_interests)

    if req.job_interests and (settings.BREVO_API_KEY or settings.RESEND_API_KEY or settings.SMTP_PASSWORD):
        matched = _match_jobs_for_interests(db, req.job_interests)
        if not matched:
            matched = db.query(Job).filter(Job.is_active == True).order_by(desc(Job.scraped_at)).limit(5).all()

        interest_label = req.job_interests.title()
        html = build_targeted_email_html(req.name or "there", interest_label, matched)
        send_email_background(
            req.email,
            f"Hey {req.name or 'there'} — jobs for {interest_label} professionals · Annex Careers",
            html,
        )
        user.last_emailed_at = datetime.now(timezone.utc)
        db.commit()

    return {"message": "User registered", "user_id": user.id}


@app.get("/api/users")
def list_users(
    source: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    query = db.query(User).order_by(desc(User.subscribed_at))
    if source:
        query = query.filter(User.source == source)
    total = query.count()
    pages = math.ceil(total / per_page) if total > 0 else 1
    users = query.offset((page - 1) * per_page).limit(per_page).all()
    return {
        "users": [
            {
                "id": u.id, "email": u.email, "name": u.name,
                "source": u.source, "job_interests": u.job_interests,
                "subscribed_at": u.subscribed_at.isoformat() if u.subscribed_at else None,
                "last_emailed_at": u.last_emailed_at.isoformat() if u.last_emailed_at else None,
            }
            for u in users
        ],
        "total": total, "page": page, "pages": pages, "per_page": per_page,
    }


@app.post("/api/users/send-alerts")
def send_bulk_alerts(req: BulkEmailRequest, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    if not settings.BREVO_API_KEY and not settings.RESEND_API_KEY and not settings.SMTP_PASSWORD:
        raise HTTPException(status_code=503, detail="Email service not configured")

    users = db.query(User).filter(User.id.in_(req.user_ids)).all()
    if not users:
        raise HTTPException(status_code=404, detail="No users found")

    featured = (
        db.query(Job).filter(Job.is_active == True)
        .order_by(desc(Job.scraped_at)).limit(5).all()
    )
    sent = 0
    for user in users:
        if user.job_interests:
            matched = _match_jobs_for_interests(db, user.job_interests)
            jobs_to_send   = matched if matched else featured
            interest_label = user.job_interests.title()
            html    = build_targeted_email_html(user.name or "there", interest_label, jobs_to_send)
            subject = f"Jobs for {interest_label} professionals — Annex Careers"
        else:
            html    = build_welcome_email_html(featured, name=user.name)
            subject = "Your Daily Job Alerts — Annex Careers"

        send_email_background(user.email, subject, html)
        user.last_emailed_at = datetime.now(timezone.utc)
        sent += 1

    db.commit()
    return {"message": f"Sending emails to {sent} users", "sent": sent}


@app.get("/api/scrape-logs")
def get_scrape_logs(
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=100),
    source: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    query = db.query(ScrapeLog)
    if source:
        query = query.filter(ScrapeLog.source == source)
    total = query.count()
    pages = math.ceil(total / per_page) if total > 0 else 1
    logs = (
        query.order_by(nullslast(desc(ScrapeLog.started_at)), desc(ScrapeLog.id))
        .offset((page - 1) * per_page).limit(per_page).all()
    )
    with _scrape_lock:
        in_progress = _scrape_state["running"] or bool(_running_single_sources)
        running_sources = sorted(_running_single_sources)
    return {
        "logs": [
            {
                "id": log.id, "source": log.source, "status": log.status,
                "jobs_found": log.jobs_found, "jobs_new": log.jobs_new,
                "jobs_updated": log.jobs_updated, "error_message": log.error_message,
                "started_at": _iso_utc(log.started_at),
                "finished_at": _iso_utc(log.finished_at),
            }
            for log in logs
        ],
        "total": total,
        "page": page,
        "pages": pages,
        "per_page": per_page,
        "in_progress": in_progress,
        "running_sources": running_sources,
    }


@app.get("/api/scheduler")
def scheduler_status(_admin=Depends(require_admin)):
    jobs = scheduler.get_jobs()
    return {
        "running": scheduler.running,
        "jobs": [
            {"id": j.id, "name": j.name, "next_run": str(j.next_run_time) if j.next_run_time else None}
            for j in jobs
        ],
    }


def _run_full_scrape_in_background(search_query: Optional[str], location: Optional[str], max_pages: int):
    from airflow_home.scrapers.runner import run_all_scrapers
    try:
        results = run_all_scrapers(search_query=search_query, location=location, max_pages=max_pages)
        total = sum(r.get("jobs_found", 0) for r in results)
        logger.info(f"Manual scrape-all done: {total} jobs found across {len(results)} sources")
    except Exception as e:
        logger.error(f"Manual scrape-all failed: {e}")
    finally:
        with _scrape_lock:
            _scrape_state["running"] = False
            _scrape_state["started_at"] = None


@app.post("/api/scrape-all", status_code=202)
def trigger_full_scrape(
    search_query: Optional[str] = None,
    location: Optional[str] = Query("Kenya"),
    max_pages: int = Query(3, ge=1, le=10),
    _admin=Depends(require_admin),
):
    """Kick off a full scrape in the background. Each source writes its own
    ScrapeLog row as it finishes, so progress is visible via /api/scrape-logs
    without holding this request open for the whole run."""
    from airflow_home.scrapers.runner import SCRAPER_REGISTRY
    with _scrape_lock:
        if _scrape_state["running"]:
            raise HTTPException(status_code=409, detail="A scrape is already running")
        _scrape_state["running"] = True
        _scrape_state["started_at"] = datetime.now(timezone.utc)
    threading.Thread(
        target=_run_full_scrape_in_background,
        args=(search_query, location, max_pages),
        name="manual-scrape-all",
        daemon=True,
    ).start()
    return {"message": "Scrape started", "started": True, "sources": len(SCRAPER_REGISTRY)}


# --- Admin job sources -------------------------------------------------------
# Built-in scrapers live in SCRAPER_REGISTRY (code). Custom sources live in the
# job_sources table and are scraped by GenericSiteScraper; run_all_scrapers()
# includes every enabled one, so the daily schedule picks them up automatically.

def _slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (value or "").lower()).strip("_")[:100]


def _clean_optional(value: Optional[str]) -> Optional[str]:
    value = (value or "").strip()
    return value or None


def _validate_source_request(req: JobSourceRequest) -> tuple[str, list[str]]:
    name = (req.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Source name is required")
    urls = [u.strip() for u in req.urls if u and u.strip()]
    if not urls:
        raise HTTPException(status_code=400, detail="At least one listing URL is required")
    for url in urls:
        if not re.match(r"^https?://[^\s/$.?#].[^\s]*$", url, re.I):
            raise HTTPException(status_code=400, detail=f"Invalid URL: {url}")
    if req.link_pattern and req.link_pattern.strip():
        try:
            re.compile(req.link_pattern)
        except re.error as e:
            raise HTTPException(status_code=400, detail=f"Invalid link pattern (regex): {e}")
    if not 1 <= req.max_jobs <= 500:
        raise HTTPException(status_code=400, detail="Max jobs per run must be between 1 and 500")
    return name, urls


def _apply_source_request(src: JobSource, req: JobSourceRequest, name: str, urls: list[str]) -> None:
    src.name = name
    src.urls = "\n".join(urls)
    src.link_pattern = _clean_optional(req.link_pattern)
    src.link_selector = _clean_optional(req.link_selector)
    src.description_selector = _clean_optional(req.description_selector)
    src.default_company = _clean_optional(req.default_company)
    src.default_location = _clean_optional(req.default_location)
    src.max_jobs = req.max_jobs
    src.enabled = req.enabled
    src.kind = req.kind
    src.notes = _clean_optional(req.notes)


def _log_summary(log: Optional[ScrapeLog]) -> Optional[dict]:
    if log is None:
        return None
    return {
        "status": log.status, "jobs_found": log.jobs_found, "jobs_new": log.jobs_new,
        "jobs_updated": log.jobs_updated, "error_message": log.error_message,
        "started_at": _iso_utc(log.started_at), "finished_at": _iso_utc(log.finished_at),
    }


def _latest_logs_by_source(db: Session) -> dict:
    latest_ids = select(func.max(ScrapeLog.id)).group_by(ScrapeLog.source)
    return {log.source: log for log in db.query(ScrapeLog).filter(ScrapeLog.id.in_(latest_ids)).all()}


def _source_to_dict(src: JobSource, last_run: Optional[ScrapeLog] = None) -> dict:
    return {
        "id": src.id, "name": src.name, "slug": src.slug, "type": "custom",
        "urls": [u for u in (src.urls or "").splitlines() if u.strip()],
        "link_pattern": src.link_pattern, "link_selector": src.link_selector,
        "description_selector": src.description_selector,
        "default_company": src.default_company, "default_location": src.default_location,
        "max_jobs": src.max_jobs, "enabled": bool(src.enabled), "kind": src.kind or "job", "notes": src.notes,
        "created_at": _iso_utc(src.created_at), "updated_at": _iso_utc(src.updated_at),
        "last_run": _log_summary(last_run),
    }


def _ensure_slug_free(db: Session, slug: str, exclude_id: Optional[int] = None) -> None:
    from airflow_home.scrapers.runner import SCRAPER_REGISTRY
    if slug in SCRAPER_REGISTRY:
        raise HTTPException(status_code=409, detail=f"'{slug}' is already a built-in source")
    query = db.query(JobSource).filter(JobSource.slug == slug)
    if exclude_id is not None:
        query = query.filter(JobSource.id != exclude_id)
    if query.first():
        raise HTTPException(status_code=409, detail=f"A source with slug '{slug}' already exists")


@app.get("/api/admin/sources")
def admin_list_sources(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    from airflow_home.scrapers.runner import SCRAPER_REGISTRY
    latest = _latest_logs_by_source(db)
    with _scrape_lock:
        running = sorted(_running_single_sources)
        full_running = _scrape_state["running"]
    builtin = [
        {"slug": slug, "name": slug.replace("_", " ").title(), "type": "builtin", "last_run": _log_summary(latest.get(slug))}
        for slug in sorted(SCRAPER_REGISTRY)
    ]
    custom = [
        _source_to_dict(src, latest.get(src.slug))
        for src in db.query(JobSource).order_by(desc(JobSource.created_at), desc(JobSource.id)).all()
    ]
    return {"builtin": builtin, "custom": custom, "running_sources": running, "full_scrape_running": full_running}


@app.post("/api/admin/sources", status_code=201)
def admin_create_source(req: JobSourceRequest, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    name, urls = _validate_source_request(req)
    slug = _slugify(req.slug or name)
    if not slug:
        raise HTTPException(status_code=400, detail="Could not derive a slug from that name; set one explicitly")
    _ensure_slug_free(db, slug)
    src = JobSource(slug=slug)
    _apply_source_request(src, req, name, urls)
    db.add(src)
    db.commit()
    db.refresh(src)
    logger.info(f"Admin added job source {slug} ({len(urls)} URL(s))")
    return _source_to_dict(src)


@app.put("/api/admin/sources/{source_id}")
def admin_update_source(source_id: int, req: JobSourceRequest, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    src = db.query(JobSource).filter(JobSource.id == source_id).first()
    if not src:
        raise HTTPException(status_code=404, detail="Source not found")
    name, urls = _validate_source_request(req)
    if req.slug and _slugify(req.slug) != src.slug:
        new_slug = _slugify(req.slug)
        if not new_slug:
            raise HTTPException(status_code=400, detail="Invalid slug")
        _ensure_slug_free(db, new_slug, exclude_id=src.id)
        src.slug = new_slug
    _apply_source_request(src, req, name, urls)
    db.commit()
    db.refresh(src)
    return _source_to_dict(src, _latest_logs_by_source(db).get(src.slug))


@app.delete("/api/admin/sources/{source_id}")
def admin_delete_source(source_id: int, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    src = db.query(JobSource).filter(JobSource.id == source_id).first()
    if not src:
        raise HTTPException(status_code=404, detail="Source not found")
    slug = src.slug
    db.delete(src)
    db.commit()
    logger.info(f"Admin removed job source {slug}")
    return {"message": "Source deleted. Jobs already collected from it were kept.", "slug": slug}


def _run_single_scrape_in_background(source: str) -> None:
    from airflow_home.scrapers.runner import run_scraper
    try:
        run_scraper(source, max_pages=3)
    except Exception as e:
        logger.error(f"Manual scrape of {source} failed: {e}")
    finally:
        with _scrape_lock:
            _running_single_sources.discard(source)


@app.post("/api/admin/scrape/{source}", status_code=202)
def trigger_source_scrape(source: str, _admin=Depends(require_admin)):
    """Scrape one source (built-in or custom) in the background. Its result
    lands in the scrape logs like any other run."""
    from airflow_home.scrapers.runner import is_known_source
    if not is_known_source(source):
        raise HTTPException(status_code=404, detail=f"Unknown source: {source}")
    with _scrape_lock:
        if source in _running_single_sources:
            raise HTTPException(status_code=409, detail=f"A scrape of {source} is already running")
        _running_single_sources.add(source)
    threading.Thread(
        target=_run_single_scrape_in_background, args=(source,),
        name=f"scrape-{source}", daemon=True,
    ).start()
    return {"message": f"Scrape started for {source}", "started": True, "source": source}


# --- Employer portal -----------------------------------------------------------
# Marketing flow: the admin invites a company; the company gets an email with
# the portal link and a unique access code; the code unlocks only the
# job-posting page. Jobs they post go live immediately with source "employer".

def _portal_url() -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/employer"


def _expiry_from_days(days: Optional[int]) -> Optional[datetime]:
    if days is None or days <= 0:
        return None
    return datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=days)


def _invite_to_dict(invite: EmployerInvite, jobs_posted: int = 0) -> dict:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return {
        "id": invite.id,
        "company_name": invite.company_name,
        "contact_name": invite.contact_name,
        "email": invite.email,
        "status": invite.status,
        "expired": bool(invite.expires_at and invite.expires_at < now),
        "note": invite.note,
        "created_at": _iso_utc(invite.created_at),
        "expires_at": _iso_utc(invite.expires_at),
        "email_sent_at": _iso_utc(invite.email_sent_at),
        "last_login_at": _iso_utc(invite.last_login_at),
        "jobs_posted": jobs_posted,
    }


def build_employer_invite_email_html(invite: EmployerInvite, access_code: str, portal_url: str) -> str:
    greeting = f"Hello {invite.contact_name}," if invite.contact_name else f"Hello {invite.company_name} team,"
    expiry_note = (
        f'<p style="margin:12px 0 0;color:#6b7280;font-size:12px;">This access is valid until {invite.expires_at.strftime("%d %B %Y")}.</p>'
        if invite.expires_at else ""
    )
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
        style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr>
          <td style="background:#dc2626;padding:28px 24px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">Annex Careers</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Employer job posting</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 24px 8px;">
            <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">{greeting}</h2>
            <p style="margin:0 0 6px;color:#374151;font-size:14px;line-height:1.6;">
              <strong>{invite.company_name}</strong> has been given access to post vacancies directly on Annex Careers,
              where thousands of job seekers in Kenya browse every day. Use the link and access code below.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;">
              <tr>
                <td style="padding:18px 20px;">
                  <div style="color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.06em;">Your access code</div>
                  <div style="color:#111827;font-size:26px;font-weight:700;letter-spacing:.12em;font-family:Menlo,Consolas,monospace;margin-top:6px;">{access_code}</div>
                  <div style="color:#6b7280;font-size:12px;margin-top:6px;">Sign in with this code and the email address this message was sent to: <strong>{invite.email}</strong></div>
                  {expiry_note}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px 8px;">
            <ol style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.8;">
              <li>Open the employer page: <a href="{portal_url}" style="color:#dc2626;">{portal_url}</a></li>
              <li>Enter your email address and the access code above.</li>
              <li>Fill in the job form. Your vacancy goes live on the site immediately.</li>
            </ol>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 24px 8px;text-align:center;">
            <a href="{portal_url}"
               style="display:inline-block;background:#dc2626;color:#ffffff;font-size:15px;
                      font-weight:600;padding:12px 36px;border-radius:8px;text-decoration:none;">
              Post a Job
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px 28px;">
            <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.6;">
              Keep this code private; it is unique to {invite.company_name}. If you did not expect this email or need a new code,
              reply to this message and we will help.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 24px;text-align:center;border-top:1px solid #e5e7eb;">
            <p style="margin:0 0 6px;color:#9ca3af;font-size:12px;">&copy; {datetime.now().year} Annex Careers</p>
            <p style="margin:0;color:#9ca3af;font-size:11px;">
              <a href="{SITE_URL}" style="color:#dc2626;text-decoration:none;">careers.annex-technologies.com</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _email_provider_configured() -> bool:
    return bool(settings.BREVO_API_KEY or settings.RESEND_API_KEY or settings.SMTP_PASSWORD)


def _send_employer_invite_email(invite: EmployerInvite, access_code: str) -> tuple[bool, Optional[str]]:
    """Send the invite email synchronously and report what actually happened,
    so the admin sees a real failure (bad SMTP password, rejected sender...)
    instead of a hopeful "emailed". Returns (emailed, error_message)."""
    if not _email_provider_configured():
        logger.info(f"Employer invite for {invite.email} not emailed: no email provider configured")
        return False, "No email provider is configured on the server (BREVO_API_KEY, RESEND_API_KEY or SMTP_PASSWORD)."
    html = build_employer_invite_email_html(invite, access_code, _portal_url())
    subject = f"Post your jobs on Annex Careers - access for {invite.company_name}"
    try:
        send_email(invite.email, subject, html)
    except Exception as e:
        logger.error(f"Employer invite email to {invite.email} failed: {e}")
        return False, f"{type(e).__name__}: {str(e)[:300]}"
    invite.email_sent_at = datetime.now(timezone.utc).replace(tzinfo=None)
    return True, None


def _employer_job_counts(db: Session) -> dict:
    rows = (
        db.query(Job.employer_invite_id, func.count(Job.id))
        .filter(Job.employer_invite_id != None)
        .group_by(Job.employer_invite_id).all()
    )
    return {invite_id: count for invite_id, count in rows}


# -- admin side --

@app.get("/api/admin/employers")
def admin_list_employers(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    counts = _employer_job_counts(db)
    invites = db.query(EmployerInvite).order_by(desc(EmployerInvite.created_at), desc(EmployerInvite.id)).all()
    return {
        "employers": [_invite_to_dict(inv, counts.get(inv.id, 0)) for inv in invites],
        "portal_url": _portal_url(),
        "email_configured": _email_provider_configured(),
    }


@app.post("/api/admin/employers", status_code=201)
def admin_create_employer(req: EmployerInviteRequest, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    company = (req.company_name or "").strip()
    if not company:
        raise HTTPException(status_code=400, detail="Company name is required")
    email = req.email.lower().strip()
    existing = db.query(EmployerInvite).filter(
        func.lower(EmployerInvite.email) == email, EmployerInvite.status == "active",
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"{email} already has active access ({existing.company_name}). Resend or revoke that invite instead.")

    code = _generate_access_code()
    invite = EmployerInvite(
        company_name=company,
        contact_name=(req.contact_name or "").strip() or None,
        email=email,
        access_code_hash=_hash_access_code(code),
        status="active",
        note=(req.note or "").strip() or None,
        expires_at=_expiry_from_days(req.expires_in_days),
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    emailed, email_error = _send_employer_invite_email(invite, code) if req.send_email else (False, None)
    db.commit()
    logger.info(f"Employer invite created for {company} <{email}> (emailed={emailed})")
    # The plain code is returned exactly once so the admin can pass it on if
    # the email does not arrive; only its hash is stored.
    return {
        **_invite_to_dict(invite, 0), "access_code": code, "emailed": emailed,
        "email_error": email_error, "portal_url": _portal_url(),
    }


@app.post("/api/admin/employers/{invite_id}/resend")
def admin_resend_employer(
    invite_id: int, send_email: bool = Query(True),
    db: Session = Depends(get_db), _admin=Depends(require_admin),
):
    """Issue a fresh access code (the old one stops working) and email it."""
    invite = db.query(EmployerInvite).filter(EmployerInvite.id == invite_id).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if invite.status != "active":
        raise HTTPException(status_code=409, detail="This invite is revoked; reactivate it first")
    code = _generate_access_code()
    invite.access_code_hash = _hash_access_code(code)
    emailed, email_error = _send_employer_invite_email(invite, code) if send_email else (False, None)
    db.commit()
    db.refresh(invite)
    counts = _employer_job_counts(db)
    return {
        **_invite_to_dict(invite, counts.get(invite.id, 0)), "access_code": code, "emailed": emailed,
        "email_error": email_error, "portal_url": _portal_url(),
    }


@app.patch("/api/admin/employers/{invite_id}")
def admin_update_employer(invite_id: int, req: EmployerInviteUpdateRequest, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    invite = db.query(EmployerInvite).filter(EmployerInvite.id == invite_id).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if req.company_name is not None:
        if not req.company_name.strip():
            raise HTTPException(status_code=400, detail="Company name cannot be empty")
        invite.company_name = req.company_name.strip()
    if req.contact_name is not None:
        invite.contact_name = req.contact_name.strip() or None
    if req.email is not None:
        invite.email = req.email.lower().strip()
    if req.note is not None:
        invite.note = req.note.strip() or None
    if req.status is not None:
        invite.status = req.status
    if req.expires_in_days is not None:
        invite.expires_at = _expiry_from_days(req.expires_in_days)
    db.commit()
    db.refresh(invite)
    return _invite_to_dict(invite, _employer_job_counts(db).get(invite.id, 0))


@app.delete("/api/admin/employers/{invite_id}")
def admin_delete_employer(invite_id: int, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    invite = db.query(EmployerInvite).filter(EmployerInvite.id == invite_id).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    # Their jobs stay live; they just lose the link back to this invite.
    db.query(Job).filter(Job.employer_invite_id == invite_id).update({"employer_invite_id": None}, synchronize_session=False)
    db.delete(invite)
    db.commit()
    return {"message": "Invite deleted. Jobs already posted were kept.", "id": invite_id}


# -- company side --

@app.post("/api/employer/login")
def employer_login(req: EmployerLoginRequest, db: Session = Depends(get_db)):
    if not settings.ADMIN_SESSION_SECRET:
        raise HTTPException(status_code=503, detail="Employer login is not configured")
    email = req.email.lower().strip()
    code_hash = _hash_access_code(req.access_code)
    candidates = db.query(EmployerInvite).filter(func.lower(EmployerInvite.email) == email).all()
    invite = next((inv for inv in candidates if hmac.compare_digest(inv.access_code_hash, code_hash)), None)
    if invite is None:
        raise HTTPException(status_code=401, detail="Invalid email or access code")
    _ensure_invite_usable(invite)
    now = datetime.now(timezone.utc)
    invite.last_login_at = now.replace(tzinfo=None)
    db.commit()
    expires_at = now + EMPLOYER_TOKEN_TTL
    token = jwt.encode({"sub": "employer", "inv": invite.id, "exp": expires_at}, settings.ADMIN_SESSION_SECRET, algorithm="HS256")
    return {
        "token": token,
        "expires_at": expires_at.isoformat(),
        "company_name": invite.company_name,
        "contact_name": invite.contact_name,
    }


@app.get("/api/employer/me")
def employer_me(invite: EmployerInvite = Depends(require_employer), db: Session = Depends(get_db)):
    jobs = (
        db.query(Job).options(selectinload(Job.attachments)).filter(Job.employer_invite_id == invite.id)
        .order_by(desc(Job.scraped_at), desc(Job.id)).all()
    )
    # Engagement per job: page_view = someone opened the job page,
    # apply_click = someone pressed Apply Now on it.
    stats: dict = {}
    if jobs:
        rows = (
            db.query(AnalyticsEvent.job_id, AnalyticsEvent.event_type, func.count(AnalyticsEvent.id))
            .filter(AnalyticsEvent.job_id.in_([j.id for j in jobs]))
            .group_by(AnalyticsEvent.job_id, AnalyticsEvent.event_type).all()
        )
        for job_id, event_type, count in rows:
            stats.setdefault(job_id, {})[event_type] = count
    return {
        "company_name": invite.company_name,
        "contact_name": invite.contact_name,
        "email": invite.email,
        "expires_at": _iso_utc(invite.expires_at),
        "jobs": [
            {
                **JobResponse.from_orm(j).dict(),
                "views": stats.get(j.id, {}).get("page_view", 0),
                "apply_clicks": stats.get(j.id, {}).get("apply_click", 0),
            }
            for j in jobs
        ],
    }


@app.post("/api/employer/jobs", status_code=201)
def employer_create_job(
    req: CreateJobRequest, request: Request,
    invite: EmployerInvite = Depends(require_employer), db: Session = Depends(get_db),
):
    if not req.title or not req.title.strip():
        raise HTTPException(status_code=400, detail="Job title is required")
    # Company is always the invited company: the form can't post on behalf of someone else.
    job = _job_from_request(req, source="employer", company=invite.company_name, employer_invite_id=invite.id)
    db.add(job)
    db.commit()
    db.refresh(job)
    _attach_uploads(db, job, req.attachment_ids, f"employer:{invite.id}", _public_api_base(request))
    db.commit()
    db.refresh(job)
    logger.info(f"Employer {job.kind} posted by {invite.company_name}: {job.id} - {job.title}")
    return {"message": "Job published", "job": JobResponse.from_orm(job)}


def _own_job_or_404(db: Session, invite: EmployerInvite, job_id: int) -> Job:
    job = db.query(Job).filter(Job.id == job_id, Job.employer_invite_id == invite.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.post("/api/employer/jobs/{job_id}/close")
def employer_close_job(job_id: int, invite: EmployerInvite = Depends(require_employer), db: Session = Depends(get_db)):
    job = _own_job_or_404(db, invite, job_id)
    job.is_active = False
    db.commit()
    return {"message": "Job closed", "job_id": job_id}


@app.post("/api/employer/jobs/{job_id}/repost")
def employer_repost_job(job_id: int, invite: EmployerInvite = Depends(require_employer), db: Session = Depends(get_db)):
    job = _own_job_or_404(db, invite, job_id)
    deadline_cleared = _repost_job_row(job)
    db.commit()
    logger.info(f"Employer {invite.company_name} reposted job {job_id} - {job.title}")
    return {
        "message": "Job reposted to the top of the listing" + (" and its expired deadline cleared" if deadline_cleared else ""),
        "job_id": job_id,
        "deadline_cleared": deadline_cleared,
    }


@app.delete("/api/employer/jobs/{job_id}")
def employer_delete_job(job_id: int, invite: EmployerInvite = Depends(require_employer), db: Session = Depends(get_db)):
    job = _own_job_or_404(db, invite, job_id)
    title = job.title
    _delete_job_row(db, job)
    db.commit()
    logger.info(f"Employer {invite.company_name} deleted job {job_id} - {title}")
    return {"message": "Job deleted", "job_id": job_id}


# --- Link previews for shared jobs -------------------------------------------
# The site is a single-page app, and the crawlers behind WhatsApp, Facebook,
# LinkedIn, X and Slack do not run JavaScript, so a shared /jobs/<id> link
# would only ever show the generic site card. This endpoint renders the job's
# own Open Graph / Twitter tags (plus schema.org JobPosting) as plain HTML.
# The web server routes crawler requests for /jobs/<id> here (see deploy/),
# and a human who lands here is bounced straight to the real page.

OG_IMAGE_PATH = "/og-image.jpg"
SHARE_DESCRIPTION_CHARS = 200
SITE_TAGLINE = "Find the latest jobs in Kenya. Verified opportunities from top companies with direct apply links."


def _plain_text(value: Optional[str]) -> str:
    text = html_lib.unescape(re.sub(r"<[^>]+>", " ", value or ""))
    return re.sub(r"\s+", " ", text).strip()


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return (cut or text[:limit]).rstrip(",.;:") + "\u2026"


def _share_summary(job: Job) -> str:
    """One-line context then the description, sized for preview cards."""
    bits = [b for b in (job.location, job.job_type) if b]
    if job.application_deadline:
        bits.append(f"Deadline {job.application_deadline.strftime('%d %b %Y')}")
    lead = " \u00b7 ".join(bits)
    body = _plain_text(job.description) or "View the full job details and apply directly on Annex Careers."
    text = f"{lead}. {body}" if lead else body
    return _truncate(text, SHARE_DESCRIPTION_CHARS)


def _job_posting_jsonld(job: Job, job_url: str) -> dict:
    data = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": job.title,
        "description": _plain_text(job.description) or job.title,
        "url": job_url,
        "identifier": {"@type": "PropertyValue", "name": "Annex Careers", "value": str(job.id)},
        "hiringOrganization": {"@type": "Organization", "name": job.company or "Company not listed"},
        "directApply": False,
    }
    if job.posted_date:
        data["datePosted"] = job.posted_date.date().isoformat()
    if job.application_deadline:
        data["validThrough"] = job.application_deadline.isoformat()
    if job.job_type:
        data["employmentType"] = job.job_type.upper().replace("-", "_").replace(" ", "_")
    if job.remote:
        data["jobLocationType"] = "TELECOMMUTE"
    if job.location:
        address = {"@type": "PostalAddress", "addressLocality": job.location}
        if re.search(r"kenya|nairobi|mombasa|kisumu|nakuru|eldoret", job.location, re.I):
            address["addressCountry"] = "KE"
        data["jobLocation"] = {"@type": "Place", "address": address}
    if job.salary_min or job.salary_max:
        data["baseSalary"] = {
            "@type": "MonetaryAmount",
            "currency": job.salary_currency or "KES",
            "value": {"@type": "QuantitativeValue", "minValue": job.salary_min, "maxValue": job.salary_max, "unitText": "MONTH"},
        }
    return data


def _render_share_page(title: str, description: str, page_url: str, image_url: str,
                       jsonld: Optional[dict] = None, og_type: str = "website",
                       image_dims: Optional[tuple] = (1200, 630)) -> str:
    e = html_lib.escape
    page_title = f"{title} | Annex Careers" if title != "Annex Careers" else "Annex Careers - Find Jobs in Kenya"
    # Escape "<" inside the JSON so no tag-like text (let alone "</script>")
    # can appear in the script block; JSON parsers read \u003c as "<".
    jsonld_tag = ""
    if jsonld:
        # Python 3.11 forbids backslashes inside f-string expressions, so build the value first.
        safe_json = json.dumps(jsonld, ensure_ascii=False).replace("<", "\\u003c")
        jsonld_tag = f'<script type="application/ld+json">{safe_json}</script>'
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(page_title)}</title>
<meta name="description" content="{e(description)}">
<link rel="canonical" href="{e(page_url)}">
<link rel="icon" href="{e(SITE_URL)}/favicon.ico">
<meta property="og:type" content="{e(og_type)}">
<meta property="og:site_name" content="Annex Careers">
<meta property="og:locale" content="en_KE">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(description)}">
<meta property="og:url" content="{e(page_url)}">
<meta property="og:image" content="{e(image_url)}">
<meta property="og:image:secure_url" content="{e(image_url)}">
{f'<meta property="og:image:width" content="{image_dims[0]}"><meta property="og:image:height" content="{image_dims[1]}">' if image_dims else ""}
<meta property="og:image:alt" content="{e(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@gregorytechKE">
<meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(description)}">
<meta name="twitter:image" content="{e(image_url)}">
{jsonld_tag}
<meta http-equiv="refresh" content="0; url={e(page_url)}">
<script>window.location.replace({json.dumps(page_url)});</script>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:32px;color:#111827">
<h1 style="font-size:20px;margin:0 0 8px">{e(title)}</h1>
<p style="color:#6b7280;margin:0 0 16px">{e(description)}</p>
<p><a href="{e(page_url)}" style="color:#dc2626">Continue to Annex Careers</a></p>
</body>
</html>"""


@app.get("/share/jobs/{job_id}", response_class=HTMLResponse)
def share_job_page(job_id: int, request: Request, db: Session = Depends(get_db)):
    site = SITE_URL.rstrip("/")
    image_url = f"{site}{OG_IMAGE_PATH}"
    image_dims = (1200, 630)
    job = db.query(Job).options(selectinload(Job.attachments)).filter(Job.id == job_id).first()
    if not job:
        html = _render_share_page("Annex Careers", SITE_TAGLINE, f"{site}/jobs", image_url)
        return HTMLResponse(html, status_code=404, headers={"Cache-Control": "public, max-age=300"})

    # A listing with its own poster shares that poster instead of the site card.
    poster = next((a for a in job.attachments if a.kind == "image"), None)
    if poster:
        image_url = f"{_public_api_base(request)}{poster.url}"
        image_dims = None

    job_url = f"{site}/jobs/{job.id}"
    title = f"{job.title} at {job.company}" if job.company else job.title
    html = _render_share_page(
        title, _share_summary(job), job_url, image_url,
        jsonld=_job_posting_jsonld(job, job_url), og_type="article", image_dims=image_dims,
    )
    return HTMLResponse(html, headers={"Cache-Control": "public, max-age=600"})


# --- Admin: automatic job-alert emails ---------------------------------------

@app.get("/api/admin/alerts/status")
def admin_alerts_status(_admin=Depends(require_admin)):
    job = scheduler.get_job("daily_job_alerts") if scheduler.running else None
    with _alerts_lock:
        state = dict(_alerts_state)
    return {
        "hour_utc": settings.JOB_ALERT_HOUR_UTC,
        "next_run": str(job.next_run_time) if job and job.next_run_time else None,
        "running": state["running"],
        "last_run_at": _iso_utc(state["last_run_at"]),
        "last_summary": state["last_summary"],
        "last_error": state["last_error"],
        "email_configured": _email_provider_configured(),
    }


@app.post("/api/admin/alerts/run", status_code=202)
def admin_alerts_run_now(_admin=Depends(require_admin)):
    """Run the automatic alert pipeline immediately, in the background."""
    with _alerts_lock:
        if _alerts_state["running"]:
            raise HTTPException(status_code=409, detail="Job alerts are already being sent")
    threading.Thread(target=scheduled_job_alerts, name="job-alerts", daemon=True).start()
    return {"message": "Job alert emails started", "started": True}


# --- Listing attachments (poster images, TOR / contract documents) -----------
# Files are uploaded first (so the form can be pre-filled from their text),
# then linked to the listing when it is saved. Stored in the database and
# served from /api/files/{id}.

MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
MAX_EXTRACTED_TEXT = 50_000


@app.post("/api/uploads", status_code=201)
async def upload_listing_file(
    file: UploadFile = File(...),
    extract: bool = Query(True),
    uploader: str = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    filename = re.sub(r"[\r\n\"\\]", "", (file.filename or "upload").strip())[:300] or "upload"
    content_type = detect_content_type(filename, file.content_type)
    if not content_type:
        raise HTTPException(status_code=400, detail="Unsupported file type. Upload a JPG, PNG, WEBP, PDF, Word (.docx) or text file.")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The file is empty")
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail=f"File is too large (max {MAX_ATTACHMENT_BYTES // (1024 * 1024)} MB)")

    if extract:
        text, kind = extract_attachment_text(filename, content_type, content)
    else:
        text, kind = "", ("image" if content_type.startswith("image/") else "document")
    attachment = Attachment(
        filename=filename, content_type=content_type, size=len(content), kind=kind,
        uploaded_by=uploader, extracted_text=(text or "")[:MAX_EXTRACTED_TEXT] or None, data=content,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    suggested = parse_listing_text(text) if text else {}
    logger.info(f"Upload {attachment.id} ({kind}, {len(content)} bytes) by {uploader}; text read: {bool(text)}")
    return {
        "id": attachment.id, "url": attachment.url, "filename": filename, "content_type": content_type,
        "size": len(content), "kind": kind,
        "read": bool(text), "ocr_available": ocr.ocr_available(),
        "extracted_text": (text or "")[:20_000],
        "suggested": suggested,
    }


@app.get("/api/files/{attachment_id}")
def get_listing_file(attachment_id: int, download: bool = False, db: Session = Depends(get_db)):
    attachment = db.query(Attachment).filter(Attachment.id == attachment_id).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="File not found")
    safe_name = attachment.filename.encode("ascii", "ignore").decode() or "file"
    disposition = "attachment" if download else "inline"
    return Response(
        content=attachment.data,
        media_type=attachment.content_type,
        headers={
            "Content-Disposition": f'{disposition}; filename="{safe_name}"',
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )


# --- Banner ads (sold directly, managed from the admin) -----------------------

AD_PLACEMENT_HINTS = {
    "home": "Homepage, below the hero. Wide banner, about 1200 x 300 px.",
    "jobs_list": "Jobs page, inside the results grid. Wide banner, about 1200 x 300 px.",
    "contracts_list": "Contracts page, inside the results grid. Wide banner, about 1200 x 300 px.",
    "job_sidebar": "Job and contract detail pages, under the Apply box. Tall or square, about 300 x 250 or 300 x 600 px.",
}


def _parse_schedule(value: Optional[str], end_of_day: bool = False) -> Optional[datetime]:
    if not value or not value.strip():
        return None
    text_value = value.strip()
    try:
        parsed = datetime.fromisoformat(text_value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date: {text_value}")
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    if end_of_day and len(text_value) == 10:
        parsed = parsed.replace(hour=23, minute=59, second=59)
    return parsed


def _ad_status(ad: Ad, now: datetime) -> str:
    if not ad.is_active:
        return "paused"
    if ad.starts_at and ad.starts_at > now:
        return "scheduled"
    if ad.ends_at and ad.ends_at < now:
        return "expired"
    return "active"


def _ad_image(ad: Ad) -> Optional[str]:
    if ad.image_attachment_id:
        return f"/api/files/{ad.image_attachment_id}"
    return ad.image_url or None


def _ad_to_dict(ad: Ad) -> dict:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return {
        "id": ad.id, "name": ad.name, "advertiser": ad.advertiser, "placement": ad.placement,
        "headline": ad.headline, "link_url": ad.link_url, "image_url": ad.image_url,
        "image_attachment_id": ad.image_attachment_id, "image": _ad_image(ad),
        "starts_at": _iso_utc(ad.starts_at), "ends_at": _iso_utc(ad.ends_at),
        "is_active": bool(ad.is_active), "weight": ad.weight, "status": _ad_status(ad, now),
        "impressions": ad.impressions or 0, "clicks": ad.clicks or 0,
        "ctr": round((ad.clicks or 0) / ad.impressions * 100, 2) if ad.impressions else 0.0,
        "notes": ad.notes, "created_at": _iso_utc(ad.created_at), "updated_at": _iso_utc(ad.updated_at),
    }


def _apply_ad_request(db: Session, ad: Ad, req: AdRequest) -> None:
    name = (req.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Give the ad a name")
    link = (req.link_url or "").strip()
    if not re.match(r"^https?://[^\s]+$", link, re.I):
        raise HTTPException(status_code=400, detail="The link must start with http:// or https://")
    image_url = (req.image_url or "").strip() or None
    if image_url and not re.match(r"^https?://[^\s]+$", image_url, re.I):
        raise HTTPException(status_code=400, detail="The image URL must start with http:// or https://")
    attachment_id = req.image_attachment_id
    if attachment_id:
        attachment = db.query(Attachment).filter(Attachment.id == attachment_id).first()
        if not attachment or attachment.kind != "image":
            raise HTTPException(status_code=400, detail="Uploaded creative not found or not an image")
    if not image_url and not attachment_id:
        raise HTTPException(status_code=400, detail="Upload a banner image or give an image URL")
    if not 1 <= req.weight <= 10:
        raise HTTPException(status_code=400, detail="Weight must be between 1 and 10")
    starts_at = _parse_schedule(req.starts_at)
    ends_at = _parse_schedule(req.ends_at, end_of_day=True)
    if starts_at and ends_at and ends_at < starts_at:
        raise HTTPException(status_code=400, detail="The end date is before the start date")

    ad.name = name
    ad.advertiser = (req.advertiser or "").strip() or None
    ad.placement = req.placement
    ad.headline = (req.headline or "").strip() or None
    ad.link_url = link
    ad.image_url = image_url
    ad.image_attachment_id = attachment_id
    ad.starts_at = starts_at
    ad.ends_at = ends_at
    ad.is_active = req.is_active
    ad.weight = req.weight
    ad.notes = (req.notes or "").strip() or None


@app.get("/api/admin/ads")
def admin_list_ads(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    ads = db.query(Ad).order_by(desc(Ad.created_at), desc(Ad.id)).all()
    return {"ads": [_ad_to_dict(a) for a in ads], "placements": AD_PLACEMENT_HINTS}


@app.post("/api/admin/ads", status_code=201)
def admin_create_ad(req: AdRequest, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    ad = Ad()
    _apply_ad_request(db, ad, req)
    db.add(ad)
    db.commit()
    db.refresh(ad)
    logger.info(f"Ad created: {ad.id} {ad.name} ({ad.placement})")
    return _ad_to_dict(ad)


@app.put("/api/admin/ads/{ad_id}")
def admin_update_ad(ad_id: int, req: AdRequest, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    ad = db.query(Ad).filter(Ad.id == ad_id).first()
    if not ad:
        raise HTTPException(status_code=404, detail="Ad not found")
    old_attachment = ad.image_attachment_id
    _apply_ad_request(db, ad, req)
    if old_attachment and old_attachment != ad.image_attachment_id:
        db.query(Attachment).filter(Attachment.id == old_attachment, Attachment.job_id == None).delete(synchronize_session=False)
    db.commit()
    db.refresh(ad)
    return _ad_to_dict(ad)


@app.delete("/api/admin/ads/{ad_id}")
def admin_delete_ad(ad_id: int, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    ad = db.query(Ad).filter(Ad.id == ad_id).first()
    if not ad:
        raise HTTPException(status_code=404, detail="Ad not found")
    creative = ad.image_attachment_id
    db.delete(ad)
    if creative:
        db.query(Attachment).filter(Attachment.id == creative, Attachment.job_id == None).delete(synchronize_session=False)
    db.commit()
    return {"message": "Ad deleted", "id": ad_id}


@app.get("/api/ads")
def public_ads(placement: Literal["home", "jobs_list", "contracts_list", "job_sidebar"], db: Session = Depends(get_db)):
    """Ads currently live in one placement. The client picks one by weight."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    ads = (
        db.query(Ad)
        .filter(Ad.placement == placement, Ad.is_active == True)
        .filter((Ad.starts_at == None) | (Ad.starts_at <= now))
        .filter((Ad.ends_at == None) | (Ad.ends_at >= now))
        .order_by(desc(Ad.weight), Ad.id).all()
    )
    payload = {
        "ads": [
            {"id": a.id, "image": _ad_image(a), "link_url": a.link_url, "headline": a.headline,
             "advertiser": a.advertiser, "weight": a.weight}
            for a in ads if _ad_image(a)
        ]
    }
    return Response(content=json.dumps(payload), media_type="application/json", headers={"Cache-Control": "public, max-age=60"})


@app.post("/api/ads/{ad_id}/impression", status_code=204)
def ad_impression(ad_id: int, db: Session = Depends(get_db)):
    db.query(Ad).filter(Ad.id == ad_id).update({Ad.impressions: Ad.impressions + 1}, synchronize_session=False)
    db.commit()
    return Response(status_code=204)


@app.post("/api/ads/{ad_id}/click", status_code=204)
def ad_click(ad_id: int, db: Session = Depends(get_db)):
    db.query(Ad).filter(Ad.id == ad_id).update({Ad.clicks: Ad.clicks + 1}, synchronize_session=False)
    db.commit()
    return Response(status_code=204)

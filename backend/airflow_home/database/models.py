"""
Database models for the jobs pipeline.
"""
import datetime
from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
    Boolean,
    Float,
    ForeignKey,
    Index,
    UniqueConstraint,
    LargeBinary,
)
from sqlalchemy.orm import relationship, deferred
from airflow_home.database.connection import Base


class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    external_id = Column(String(255), nullable=True)
    title = Column(String(500), nullable=False)
    company = Column(String(300), nullable=True)
    location = Column(String(300), nullable=True)
    description = Column(Text, nullable=True)
    salary_min = Column(Float, nullable=True)
    salary_max = Column(Float, nullable=True)
    salary_currency = Column(String(10), nullable=True)
    job_type = Column(String(50), nullable=True)
    experience_level = Column(String(50), nullable=True)
    remote = Column(Boolean, default=False)
    url = Column(String(1000), nullable=True)
    apply_url = Column(String(1000), nullable=True)
    source = Column(String(100), nullable=False)
    tags = Column(Text, nullable=True)
    requirements = Column(Text, nullable=True)
    posted_date = Column(DateTime, nullable=True)
    application_deadline = Column(DateTime, nullable=True)
    scraped_at = Column(DateTime, default=datetime.datetime.utcnow)
    is_active = Column(Boolean, default=True)
    # Set when a company posted the job through the employer portal.
    employer_invite_id = Column(Integer, nullable=True)
    # "job" (default) or "contract": consultancies, TOR-based assignments, tenders.
    kind = Column(String(20), nullable=False, default="job", server_default="job")
    tor_url = Column(String(1000), nullable=True)  # Terms of Reference / tender document
    duration = Column(String(120), nullable=True)  # e.g. "3 months", "20 working days"
    budget = Column(String(120), nullable=True)  # e.g. "KES 800,000", "USD 15,000 fixed fee"

    # Poster images and TOR / contract documents uploaded with the listing.
    attachments = relationship("Attachment", order_by="Attachment.id", lazy="select",
                               cascade="all, delete-orphan", passive_deletes=True)

    __table_args__ = (
        Index("ix_jobs_source", "source"),
        Index("ix_jobs_kind", "kind"),
        Index("ix_jobs_title", "title"),
        Index("ix_jobs_company", "company"),
        Index("ix_jobs_location", "location"),
        Index("ix_jobs_scraped_at", "scraped_at"),
        Index("ix_jobs_source_external_id", "source", "external_id", unique=True),
    )

    def __repr__(self):
        return f"<Job(id={self.id}, title='{self.title}', company='{self.company}', source='{self.source}')>"


class ScrapeLog(Base):
    __tablename__ = "scrape_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    source = Column(String(100), nullable=False)
    status = Column(String(20), nullable=False)
    jobs_found = Column(Integer, default=0)
    jobs_new = Column(Integer, default=0)
    jobs_updated = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, default=datetime.datetime.utcnow)
    finished_at = Column(DateTime, nullable=True)

    def __repr__(self):
        return f"<ScrapeLog(source='{self.source}', status='{self.status}', jobs_found={self.jobs_found})>"


class User(Base):
    """Subscribers and CV-uploaded users for email campaigns."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(320), nullable=False, unique=True)
    name = Column(String(300), nullable=True)
    source = Column(String(50), nullable=False, default="subscribe")  # 'subscribe' or 'cv_upload'
    job_interests = Column(Text, nullable=True)  # comma-separated interest tags
    cv_text = Column(Text, nullable=True)  # extracted text from their last uploaded CV
    subscribed_at = Column(DateTime, default=datetime.datetime.utcnow)
    last_emailed_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_users_email", "email", unique=True),
    )

    def __repr__(self):
        return f"<User(id={self.id}, email='{self.email}', source='{self.source}')>"


class UserJobNotification(Base):
    """Tracks which jobs a user has already been emailed about, so the
    automatic new-job-match pipeline never re-sends the same job twice."""
    __tablename__ = "user_job_notifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    job_id = Column(Integer, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    sent_at = Column(DateTime, default=datetime.datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "job_id", name="uq_user_job_notifications_user_job"),
    )

    def __repr__(self):
        return f"<UserJobNotification(user_id={self.user_id}, job_id={self.job_id})>"


class CVSubmission(Base):
    """A record of each CV analyze/generate action, for the 'ensure we
    utilise the db' requirement and for future analytics."""
    __tablename__ = "cv_submissions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    job_id = Column(Integer, ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(20), nullable=False)  # 'analyze' or 'generate'
    score = Column(Integer, nullable=True)
    matched_skills = Column(Text, nullable=True)  # comma-separated
    missing_skills = Column(Text, nullable=True)  # comma-separated
    parse_confidence = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    def __repr__(self):
        return f"<CVSubmission(user_id={self.user_id}, job_id={self.job_id}, action='{self.action}')>"


class AnalyticsEvent(Base):
    """Immutable product events used for traffic and application analytics."""
    __tablename__ = "analytics_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    event_type = Column(String(40), nullable=False)  # 'page_view' or 'apply_click'
    job_id = Column(Integer, ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True)
    session_id = Column(String(120), nullable=True)
    referrer = Column(String(1000), nullable=True)
    user_agent = Column(String(1000), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("ix_analytics_events_type_created", "event_type", "created_at"),
        Index("ix_analytics_events_job_type", "job_id", "event_type"),
    )


class JobSource(Base):
    """An admin-added job board or careers page. Scraped by the generic
    site scraper alongside the hard-coded scrapers in SCRAPER_REGISTRY, so
    new sources can be added from the admin UI without a code change."""
    __tablename__ = "job_sources"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    slug = Column(String(100), nullable=False, unique=True)  # becomes Job.source
    urls = Column(Text, nullable=False)  # one listing-page URL per line
    link_pattern = Column(String(500), nullable=True)  # regex a job link must match
    link_selector = Column(String(500), nullable=True)  # CSS selector for job links
    description_selector = Column(String(500), nullable=True)  # CSS selector on job pages
    default_company = Column(String(300), nullable=True)  # for single-company careers pages
    default_location = Column(String(300), nullable=True)
    max_jobs = Column(Integer, default=60)
    enabled = Column(Boolean, default=True)
    # What this source lists: "job" or "contract" (consultancies, TORs, tenders).
    kind = Column(String(20), nullable=False, default="job", server_default="job")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    def __repr__(self):
        return f"<JobSource(slug='{self.slug}', kind='{self.kind}', enabled={self.enabled})>"


class EmployerInvite(Base):
    """A company invited to post jobs through the employer portal. The admin
    creates the invite; the company receives the portal link and a unique
    access code by email. Only the code's hash is stored."""
    __tablename__ = "employer_invites"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_name = Column(String(300), nullable=False)
    contact_name = Column(String(200), nullable=True)
    email = Column(String(320), nullable=False)
    access_code_hash = Column(String(64), nullable=False)
    status = Column(String(20), nullable=False, default="active")  # 'active' or 'revoked'
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)  # NULL = no expiry
    email_sent_at = Column(DateTime, nullable=True)
    last_login_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_employer_invites_email", "email"),
    )

    def __repr__(self):
        return f"<EmployerInvite(company='{self.company_name}', email='{self.email}', status='{self.status}')>"


class Attachment(Base):
    """A file attached to a listing: a poster image or a TOR / contract
    document. Stored in the database (not on disk) so it survives redeploys
    without a mounted volume; served by GET /api/files/{id}. Uploaded before
    the listing exists, then linked when the listing is saved."""
    __tablename__ = "attachments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(Integer, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=True)
    filename = Column(String(300), nullable=False)
    content_type = Column(String(120), nullable=False)
    size = Column(Integer, nullable=False)
    kind = Column(String(20), nullable=False)  # 'image' or 'document'
    uploaded_by = Column(String(60), nullable=False)  # 'admin' or 'employer:<invite_id>'
    extracted_text = Column(Text, nullable=True)  # OCR / document text, for pre-filling the form
    data = deferred(Column(LargeBinary, nullable=False))  # loaded only when the file is served
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    __table_args__ = (
        Index("ix_attachments_job_id", "job_id"),
    )

    @property
    def url(self) -> str:
        return f"/api/files/{self.id}"

    def __repr__(self):
        return f"<Attachment(id={self.id}, job_id={self.job_id}, kind='{self.kind}', filename='{self.filename}')>"

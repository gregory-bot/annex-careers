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
)
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

    __table_args__ = (
        Index("ix_jobs_source", "source"),
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

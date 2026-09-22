"""
Scraper Runner - Orchestrates all scrapers, cleans data, and stores in DB.
This is the main entry point for DAGs and manual runs.
"""
import logging
import datetime
from typing import Optional

from sqlalchemy.dialects.postgresql import insert as pg_insert

from airflow_home.database.connection import SessionLocal, init_db
from airflow_home.database.models import Job, ScrapeLog, JobSource

# ----- Existing scrapers -----
from airflow_home.scrapers.linkedin_scraper import LinkedInScraper
from airflow_home.scrapers.myjobsinkenya_scraper import MyJobsInKenyaScraper
from airflow_home.scrapers.brightermonday_scraper import BrighterMondayScraper
from airflow_home.scrapers.indeed_scraper import IndeedScraper
from airflow_home.scrapers.glassdoor_scraper import GlassdoorScraper
from airflow_home.scrapers.fuzu_scraper import FuzuScraper
from airflow_home.scrapers.google_search_scraper import GoogleJobsSearchScraper
from airflow_home.scrapers.adzuna_api_scraper import AdzunaAPIScraper
from airflow_home.scrapers.jobwebkenya_scraper import JobWebKenyaScraper
from airflow_home.scrapers.corporatestaffing_scraper import CorporateStaffingScraper
from airflow_home.scrapers.kenyajob_scraper import KenyaJobScraper
from airflow_home.scrapers.summitrecruitment_scraper import SummitRecruitmentScraper

# ----- NEW Kenya sources -----
from airflow_home.scrapers.myjobmag_scraper import MyJobMagScraper
from airflow_home.scrapers.jobsinkenya_scraper import JobsInKenyaScraper
from airflow_home.scrapers.pigiame_scraper import PigiameScraper
from airflow_home.scrapers.careerpointkenya_scraper import CareerPointKenyaScraper
from airflow_home.scrapers.advanceafrica_scraper import AdvanceAfricaScraper

# ----- NEW Global / Remote sources -----
from airflow_home.scrapers.remoteok_scraper import RemoteOKScraper
from airflow_home.scrapers.weworkremotely_scraper import WeWorkRemotelyScraper
from airflow_home.scrapers.remotive_scraper import RemotiveScraper
from airflow_home.scrapers.wellfound_scraper import WellfoundScraper
from airflow_home.scrapers.talent_scraper import TalentScraper
from airflow_home.scrapers.aijobs_scraper import AIJobsScraper
from airflow_home.scrapers.indeed_uk_scraper import IndeedUKScraper
from airflow_home.scrapers.workatastartup_scraper import WorkAtAStartupScraper

# ----- Company Careers Crawler -----
from airflow_home.scrapers.company_careers_scraper import CompanyCareersScraper

# ----- BambooHR -----
from airflow_home.scrapers.bamboohr_scraper import BambooHRScraper

# ----- OpenedCareer -----
from airflow_home.scrapers.openedcareer_scraper import OpenedCareerScraper

# ----- KEMRI e-recruitment -----
from airflow_home.scrapers.kemri_scraper import KEMRIScraper

# ----- Contracts / consultancies -----
from airflow_home.scrapers.reliefweb_scraper import ReliefWebScraper

# ----- Admin-configured sources (generic scraper) -----
from airflow_home.scrapers.generic_site_scraper import GenericSiteScraper

from airflow_home.transformers.cleaner import clean_jobs

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Registry of all available scrapers (25+ sources)
SCRAPER_REGISTRY = {
    # --- Kenya job boards ---
    "linkedin": LinkedInScraper,
    "myjobsinkenya": MyJobsInKenyaScraper,
    "brightermonday": BrighterMondayScraper,
    "indeed": IndeedScraper,
    "glassdoor": GlassdoorScraper,
    "fuzu": FuzuScraper,
    "google_search": GoogleJobsSearchScraper,
    "adzuna": AdzunaAPIScraper,
    "jobwebkenya": JobWebKenyaScraper,
    "corporatestaffing": CorporateStaffingScraper,
    "kenyajob": KenyaJobScraper,
    "summitrecruitment": SummitRecruitmentScraper,
    "myjobmag": MyJobMagScraper,
    "jobsinkenya": JobsInKenyaScraper,
    "pigiame": PigiameScraper,
    "careerpointkenya": CareerPointKenyaScraper,
    "advanceafrica": AdvanceAfricaScraper,
    "talent": TalentScraper,
    # --- Global / Remote boards ---
    "remoteok": RemoteOKScraper,
    "weworkremotely": WeWorkRemotelyScraper,
    "remotive": RemotiveScraper,
    "wellfound": WellfoundScraper,
    "aijobs": AIJobsScraper,
    "indeed_uk": IndeedUKScraper,
    "workatastartup": WorkAtAStartupScraper,
    # --- Company career pages (UN, NGOs, banks, tech) ---
    "company_careers": CompanyCareersScraper,
    # --- BambooHR company pages ---
    "bamboohr": BambooHRScraper,
    # --- OpenedCareer (Kenya jobs with direct apply links) ---
    "openedcareer": OpenedCareerScraper,
    # --- KEMRI e-recruitment portal ---
    "kemri": KEMRIScraper,
    # --- Contracts / consultancies (UN agencies, INGOs, NGOs) ---
    "reliefweb": ReliefWebScraper,
}


# --- Admin-configured sources -------------------------------------------------
# Rows in job_sources are scraped by GenericSiteScraper and take part in
# run_all_scrapers() automatically, so a source added from the admin UI is
# picked up by the next scheduled scrape without a deploy.

def load_custom_sources(enabled_only: bool = True) -> list[dict]:
    db = SessionLocal()
    try:
        query = db.query(JobSource)
        if enabled_only:
            query = query.filter(JobSource.enabled == True)
        return [GenericSiteScraper.config_from_row(row) for row in query.order_by(JobSource.id).all()]
    except Exception as e:
        logger.warning(f"Could not load custom job sources: {e}")
        return []
    finally:
        db.close()


def get_custom_source(slug: str) -> Optional[dict]:
    db = SessionLocal()
    try:
        row = db.query(JobSource).filter(JobSource.slug == slug).first()
        return GenericSiteScraper.config_from_row(row) if row else None
    except Exception as e:
        logger.warning(f"Could not look up custom job source {slug!r}: {e}")
        return None
    finally:
        db.close()


def is_known_source(source: str) -> bool:
    return source in SCRAPER_REGISTRY or get_custom_source(source) is not None


def build_scraper(source: str):
    """Instantiate the scraper for a built-in registry key or a custom slug."""
    if source in SCRAPER_REGISTRY:
        return SCRAPER_REGISTRY[source]()
    config = get_custom_source(source)
    if config is None:
        raise ValueError(f"Unknown source: {source}. Available: {list(SCRAPER_REGISTRY.keys())} plus custom sources")
    return GenericSiteScraper(config)


def run_scraper(
    source: str,
    search_query: str = None,
    location: str = None,
    max_pages: int = 5,
) -> dict:
    """
    Run a single scraper, clean data, and store in DB.
    Returns a summary dict.
    """
    scraper = build_scraper(source)

    db = SessionLocal()
    log = ScrapeLog(source=source, status="running", started_at=datetime.datetime.now(datetime.UTC))
    db.add(log)
    db.commit()

    try:
        # 1. Scrape
        logger.info(f"Starting scrape: {source}")
        raw_jobs = scraper.scrape(search_query=search_query, location=location, max_pages=max_pages)

        # 2. Clean
        cleaned_jobs = clean_jobs(raw_jobs)

        # 3. Store in DB with upsert (insert or update on conflict)
        job_dicts = [job_data.to_dict() for job_data in cleaned_jobs]

        # Work out which (source, external_id) pairs already exist BEFORE
        # upserting. The upsert alone can't tell us: rowcount is 1 whether
        # the row was inserted or updated, which is why "New" always read 0.
        incoming_ids = {jd["external_id"] for jd in job_dicts if jd.get("external_id") and jd.get("source")}
        known_keys = set()
        if incoming_ids:
            rows = (
                db.query(Job.source, Job.external_id)
                .filter(Job.external_id.in_(incoming_ids))
                .all()
            )
            known_keys = {(src, ext) for src, ext in rows}

        new_count = 0
        updated_count = 0
        for job_dict in job_dicts:
            job_dict["scraped_at"] = datetime.datetime.now(datetime.UTC)
            job_dict["is_active"] = True

            if job_dict.get("external_id") and job_dict.get("source"):
                key = (job_dict["source"], job_dict["external_id"])
                if key in known_keys:
                    updated_count += 1
                else:
                    new_count += 1
                    known_keys.add(key)  # a duplicate later in this batch is an update

                # Upsert based on source + external_id
                stmt = pg_insert(Job).values(**job_dict)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["source", "external_id"],
                    set_={
                        "title": stmt.excluded.title,
                        "company": stmt.excluded.company,
                        "location": stmt.excluded.location,
                        "description": stmt.excluded.description,
                        "requirements": stmt.excluded.requirements,
                        "salary_min": stmt.excluded.salary_min,
                        "salary_max": stmt.excluded.salary_max,
                        "url": stmt.excluded.url,
                        "apply_url": stmt.excluded.apply_url,
                        "tags": stmt.excluded.tags,
                        "application_deadline": stmt.excluded.application_deadline,
                        "kind": stmt.excluded.kind,
                        "tor_url": stmt.excluded.tor_url,
                        "duration": stmt.excluded.duration,
                        "budget": stmt.excluded.budget,
                        "scraped_at": stmt.excluded.scraped_at,
                        "is_active": True,
                    },
                )
                db.execute(stmt)
            else:
                # No external_id - just insert
                db.add(Job(**job_dict))
                new_count += 1

        db.commit()

        # 4. Update log
        log.status = "success"
        log.jobs_found = len(raw_jobs)
        log.jobs_new = new_count
        log.jobs_updated = updated_count
        log.finished_at = datetime.datetime.now(datetime.UTC)
        db.commit()

        summary = {
            "source": source,
            "status": "success",
            "jobs_found": len(raw_jobs),
            "jobs_cleaned": len(cleaned_jobs),
            "jobs_new": new_count,
            "jobs_updated": updated_count,
        }
        logger.info(f"Scrape complete: {summary}")
        return summary

    except Exception as e:
        logger.error(f"Scrape failed for {source}: {e}")
        log.status = "failed"
        log.error_message = str(e)[:2000]
        log.finished_at = datetime.datetime.now(datetime.UTC)
        db.commit()
        return {"source": source, "status": "failed", "error": str(e)}
    finally:
        db.close()


def run_all_scrapers(
    search_query: str = None,
    location: str = None,
    max_pages: int = 5,
    sources: Optional[list[str]] = None,
) -> list[dict]:
    """Run all scrapers (or specified ones) and return summaries.
    With no explicit list this covers every built-in scraper plus every
    enabled admin-configured source."""
    init_db()

    target_sources = sources or (
        list(SCRAPER_REGISTRY.keys()) + [cfg["slug"] for cfg in load_custom_sources()]
    )
    results = []
    for source in target_sources:
        try:
            result = run_scraper(source, search_query, location, max_pages)
            results.append(result)
        except Exception as e:
            logger.error(f"Error running {source}: {e}")
            results.append({"source": source, "status": "error", "error": str(e)})

    # After scraping, deactivate expired jobs
    deactivate_expired_jobs()

    total_found = sum(r.get("jobs_found", 0) for r in results)
    logger.info(f"All scrapers complete. Total jobs found: {total_found}")
    return results


def deactivate_expired_jobs():
    """Mark jobs as inactive if their application deadline has passed or they are stale (>30 days)."""
    db = SessionLocal()
    try:
        now = datetime.datetime.now(datetime.UTC)

        # Deactivate jobs past their application deadline
        deadline_expired = (
            db.query(Job)
            .filter(Job.application_deadline != None, Job.application_deadline < now, Job.is_active == True)
            .update({"is_active": False})
        )

        # Deactivate jobs not seen in 30 days (stale)
        cutoff = now - datetime.timedelta(days=30)
        stale = (
            db.query(Job)
            .filter(Job.scraped_at < cutoff, Job.is_active == True)
            .update({"is_active": False})
        )

        db.commit()
        logger.info(f"Deactivated {deadline_expired} deadline-expired jobs, {stale} stale jobs")
    except Exception as e:
        logger.error(f"Error deactivating jobs: {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    # Manual run for testing
    results = run_all_scrapers(
        search_query="software developer",
        location="Kenya",
        max_pages=2,
    )
    for r in results:
        print(r)

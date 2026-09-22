"""
ReliefWeb consultancies: UN agencies, INGOs and NGOs post consultancy /
TOR-based assignments on ReliefWeb (OCHA). Its public JSON API needs a free
registered "appname" (https://apidoc.reliefweb.int/), set as RELIEFWEB_APPNAME.
Everything it returns is filed under kind="contract".
"""
import logging
import datetime
from typing import Optional

from airflow_home.config.settings import settings
from airflow_home.scrapers.base_scraper import BaseScraper, JobData

logger = logging.getLogger(__name__)

API_URL = "https://api.reliefweb.int/v2/jobs"
PAGE_SIZE = 100
FIELDS = [
    "title", "body", "source.name", "source.shortname", "country.name", "city.name",
    "date.created", "date.closing", "url", "type.name", "career_categories.name",
    "experience.name", "how_to_apply", "theme.name",
]


def _parse_date(value: Optional[str]) -> Optional[datetime.datetime]:
    if not value:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return parsed


def _names(items) -> list[str]:
    return [i.get("name") for i in (items or []) if isinstance(i, dict) and i.get("name")]


class ReliefWebScraper(BaseScraper):
    SOURCE_NAME = "reliefweb"
    COUNTRY = "Kenya"

    def scrape(self, search_query: str = None, location: str = None, max_pages: int = 5) -> list[JobData]:
        appname = (settings.RELIEFWEB_APPNAME or "").strip()
        if not appname:
            raise RuntimeError(
                "ReliefWeb needs a free API appname: request one at https://apidoc.reliefweb.int/ "
                "and set RELIEFWEB_APPNAME in .env"
            )
        jobs: list[JobData] = []
        offset = 0
        for _ in range(max(1, max_pages)):
            body = {
                "filter": {"operator": "AND", "conditions": [
                    {"field": "country.name", "value": self.COUNTRY},
                    {"field": "type.name", "value": "Consultancy"},
                ]},
                "fields": {"include": FIELDS},
                "limit": PAGE_SIZE,
                "offset": offset,
                "sort": ["date.created:desc"],
            }
            self._rotate_ua()
            resp = self.session.post(f"{API_URL}?appname={appname}", json=body, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            items = data.get("data", [])
            for item in items:
                job = self.to_job(item)
                if job:
                    jobs.append(job)
            offset += len(items)
            if not items or offset >= int(data.get("totalCount") or 0):
                break
        logger.info(f"[{self.SOURCE_NAME}] {len(jobs)} consultancies in {self.COUNTRY}")
        return jobs

    def to_job(self, item: dict) -> Optional[JobData]:
        fields = item.get("fields") or {}
        title = (fields.get("title") or "").strip()
        if not title:
            return None
        sources = _names(fields.get("source"))
        cities = _names(fields.get("city"))
        countries = _names(fields.get("country"))
        location = ", ".join(dict.fromkeys(cities + countries)) or self.COUNTRY
        description = fields.get("body") or ""
        how_to_apply = fields.get("how_to_apply")
        if how_to_apply:
            description = f"{description}\n\nHow to apply: {how_to_apply}"
        dates = fields.get("date") or {}
        tags = ", ".join(dict.fromkeys(_names(fields.get("career_categories")) + _names(fields.get("theme"))))
        url = fields.get("url")
        return JobData(
            title=title,
            source=self.SOURCE_NAME,
            company=sources[0] if sources else None,
            location=location,
            description=description,
            job_type="Consultancy",
            experience_level=(_names(fields.get("experience")) or [None])[0],
            url=url,
            apply_url=url,
            tags=tags or None,
            posted_date=_parse_date(dates.get("created")),
            application_deadline=_parse_date(dates.get("closing")),
            external_id=str(item.get("id") or url),
            kind="contract",
        )

"""
Generic site scraper: turns an admin-configured JobSource (one or more
listing-page URLs plus optional hints) into JobData without a bespoke scraper.

Per listing URL:
  1. schema.org JobPosting JSON-LD embedded in the listing page (many boards
     and ATS-hosted careers pages include it)
  2. collect candidate job links, via the configured CSS selector / regex
     hint, or path heuristics when neither is set
  3. fetch each job page and parse it: JSON-LD first, HTML fallbacks second

The pure helpers (extract_job_links, parse_job_page, job_from_jsonld,
parse_iso_date) take parsed HTML so they can be unit-tested offline.
"""
import re
import json
import time
import hashlib
import logging
import datetime
from typing import Optional, Iterable
from urllib.parse import urljoin, urlparse, urldefrag

import requests
from bs4 import BeautifulSoup

from airflow_home.scrapers.base_scraper import BaseScraper, JobData

logger = logging.getLogger(__name__)

# Paths that look like a single job or contract page. Contract vocabulary
# (TORs, tenders, RFPs, EOIs) is matched on segment boundaries so "tor" does
# not fire inside "monitor" or "directory".
JOB_PATH_HINT = re.compile(
    r"(job|vacanc|career|position|opening|recruit|opportunit|posting|listing|tender|consultan|procurement|proposal"
    r"|(?:^|[/._-])(?:tors?|rfps?|rfqs?|eois?)(?=[/._-]|$))",
    re.I,
)
PAGINATION_HINT = re.compile(r"([?&](page|p|pg|start|offset)=\d|/page/\d+)", re.I)
# Taxonomy, account and content sections that job boards link everywhere but
# that are never a single posting (/job-tag/x, /jobs-by-field, /category/...).
NON_JOB_PATH = re.compile(
    r"/(job[-_]?(tag|categor(y|ies)|location|type|seeker|alert|search|board)s?|"
    r"jobs[-_](by|at|in|for|near|location|type|category)[-_a-z0-9]*|"
    r"tags?|categor(y|ies)|locations?|industr(y|ies)|compan(y|ies)|employers?|"
    r"account|login|register|signup|profile|blog|news|advice|discover|feed|rss|search|"
    r"about|contact|privacy|terms|sitemap|salary|cv)(/|$|\?)"
    r"|[-_]jobs?[-_](in|by|at|for|near)[-_]|post_type=|/wp-|\.(pdf|jpg|jpeg|png|gif|svg|css|js|xml)$",
    re.I,
)
# A lone section root such as /jobs or /careers is a listing, not a posting.
SECTION_ROOTS = {"job", "jobs", "career", "careers", "vacancy", "vacancies", "listing", "listings",
                 "opening", "openings", "opportunity", "opportunities", "position", "positions"}
JOB_CONTAINER_HINT = re.compile(r"job|vacanc|listing|card|posting|result|opening", re.I)
# Boilerplate some boards wrap around the real title.
TITLE_NOISE_PREFIX = re.compile(r"^(job application for|apply (now )?for|apply now[:\-]?|job[:\-]|vacancy[:\-]|position[:\-])\s+", re.I)
TITLE_NOISE_SUFFIX = re.compile(
    r"\s+(january|february|march|april|may|june|july|august|september|october|november|december),?\s+\d{4}\s*$", re.I,
)
# Titles that mean "this is a listing/category page, not a single job".
JUNK_TITLE = re.compile(
    r"\bjobs?\s+(in|at|for|by|near|from)\b|\bvacancies\b\s*$|search results|^all jobs\b|"
    r"^jobs$|^careers?$|^vacancies$|page not found|^404\b|^home$|log ?in|sign ?up",
    re.I,
)
TITLE_SEPARATORS = re.compile(r"\s+[|\-–—·»]\s+")
SKIP_SCHEMES = ("mailto:", "tel:", "javascript:", "#", "data:")
KENYA_PLACES = ["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret", "Thika", "Kenya"]
MIN_DESCRIPTION_CHARS = 80
MAX_DESCRIPTION_CHARS = 20000


# --- small pure helpers ------------------------------------------------------

def stable_id(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:20]


def url_key(url: str) -> str:
    """Comparison key: no fragment, no trailing slash."""
    return urldefrag(url.strip())[0].rstrip("/")


def site_key(netloc: str) -> str:
    """Registrable domain, so boards.example.com and jobs.example.com count as
    one site (handles .co.ke style two-level public suffixes)."""
    host = netloc.lower().split(":")[0]
    labels = host.split(".")
    if len(labels) >= 3 and labels[-2] in {"co", "com", "org", "net", "ac", "go", "or", "ne", "edu", "gov"} and len(labels[-1]) == 2:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def _posting_score(url: str, anchor) -> int:
    """How much a URL looks like one specific posting (used to order fetches
    so the per-run cap is spent on real jobs first)."""
    path = urlparse(url).path.rstrip("/")
    segments = [seg for seg in path.split("/") if seg]
    last = segments[-1] if segments else ""
    score = 0
    if re.search(r"\d{2,}", last) or re.search(r"[?&](id|jobid|job_id|jid|ref)=", url, re.I):
        score += 3
    if len(re.findall(r"[a-z]+", last, re.I)) >= 3:
        score += 2
    if len(segments) >= 2:
        score += 1
    if anchor is not None and anchor.find_parent(class_=JOB_CONTAINER_HINT) is not None:
        score += 2
    return score


def parse_iso_date(value) -> Optional[datetime.datetime]:
    """Parse ISO-8601 (and a few common human formats) into naive UTC."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    parsed = None
    try:
        parsed = datetime.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%B %d, %Y", "%d %B %Y", "%b %d, %Y", "%d %b %Y"):
            try:
                parsed = datetime.datetime.strptime(text[:len(text)], fmt)
                break
            except ValueError:
                continue
        if parsed is None:
            try:
                parsed = datetime.datetime.strptime(text[:10], "%Y-%m-%d")
            except ValueError:
                return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return parsed


def _num(value) -> Optional[float]:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _text(node) -> str:
    if node is None:
        return ""
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip()


def _meta(soup: BeautifulSoup, *names) -> Optional[str]:
    for name in names:
        tag = soup.find("meta", attrs={"property": name}) or soup.find("meta", attrs={"name": name})
        if tag and tag.get("content"):
            return tag["content"].strip()
    return None


def _iter_jsonld_objects(soup: BeautifulSoup) -> Iterable[dict]:
    for script in soup.find_all("script", type=re.compile(r"ld\+json", re.I)):
        raw = script.string or script.get_text()
        if not raw:
            continue
        try:
            data = json.loads(raw.strip())
        except (json.JSONDecodeError, TypeError):
            continue
        stack = [data]
        while stack:
            item = stack.pop()
            if isinstance(item, list):
                stack.extend(item)
            elif isinstance(item, dict):
                yield item
                for key in ("@graph", "itemListElement", "mainEntity", "item"):
                    if key in item:
                        stack.append(item[key])


def find_jobpostings(soup: BeautifulSoup) -> list[dict]:
    """Every schema.org JobPosting object in the page's JSON-LD, in order."""
    out = []
    for obj in _iter_jsonld_objects(soup):
        types = obj.get("@type")
        types = types if isinstance(types, list) else [types]
        if any(isinstance(t, str) and t.lower() == "jobposting" for t in types):
            out.append(obj)
    return out


def _location_from_jsonld(job_loc) -> Optional[str]:
    locs = job_loc if isinstance(job_loc, list) else [job_loc]
    found = []
    for loc in locs:
        if isinstance(loc, str) and loc.strip():
            found.append(loc.strip())
            continue
        if not isinstance(loc, dict):
            continue
        addr = loc.get("address", loc)
        if isinstance(addr, str) and addr.strip():
            found.append(addr.strip())
            continue
        if not isinstance(addr, dict):
            continue
        parts = []
        for key in ("addressLocality", "addressRegion", "addressCountry"):
            part = addr.get(key)
            if isinstance(part, dict):
                part = part.get("name")
            if isinstance(part, str) and part.strip():
                parts.append(part.strip())
        if parts:
            found.append(", ".join(dict.fromkeys(parts)))
    return "; ".join(dict.fromkeys(found)) or None


def job_from_jsonld(
    data: dict, page_url: str, source: str,
    default_company: Optional[str] = None, default_location: Optional[str] = None,
) -> Optional[JobData]:
    title = data.get("title") or data.get("name")
    if not isinstance(title, str) or not title.strip():
        return None

    org = data.get("hiringOrganization")
    company = org.get("name") if isinstance(org, dict) else org if isinstance(org, str) else None
    company = (company or "").strip() or default_company

    remote = str(data.get("jobLocationType") or "").upper() == "TELECOMMUTE"
    location = _location_from_jsonld(data.get("jobLocation")) or default_location
    if remote and not location:
        location = "Remote"

    employment = data.get("employmentType")
    job_type = ", ".join(e for e in employment if isinstance(e, str)) if isinstance(employment, list) else (
        employment if isinstance(employment, str) else None
    )

    own_url = data.get("url") if isinstance(data.get("url"), str) and data.get("url").strip() else None
    url = own_url or page_url

    salary_min = salary_max = None
    currency = None
    base = data.get("baseSalary")
    if isinstance(base, dict):
        currency = base.get("currency") if isinstance(base.get("currency"), str) else None
        value = base.get("value")
        if isinstance(value, dict):
            salary_min = _num(value.get("minValue", value.get("value")))
            salary_max = _num(value.get("maxValue", value.get("value")))
            currency = currency or (value.get("currency") if isinstance(value.get("currency"), str) else None)
        else:
            salary_min = salary_max = _num(value)

    identifier = data.get("identifier")
    if isinstance(identifier, dict):
        identifier = identifier.get("value")
    if isinstance(identifier, (str, int)) and str(identifier).strip():
        external_id = str(identifier).strip()[:255]
    else:
        # Postings inlined on a listing page may all share the page URL, so
        # fold the title in to keep them distinct.
        external_id = stable_id(url if own_url else f"{page_url}|{title.strip()}")

    description = data.get("description") if isinstance(data.get("description"), str) else None

    return JobData(
        title=title.strip(),
        source=source,
        company=company,
        location=location,
        description=description,
        salary_min=salary_min,
        salary_max=salary_max,
        salary_currency=currency,
        job_type=job_type,
        remote=remote,
        url=url,
        apply_url=url,
        posted_date=parse_iso_date(data.get("datePosted")),
        application_deadline=parse_iso_date(data.get("validThrough")),
        external_id=external_id,
    )


def extract_job_links(
    soup: BeautifulSoup, base_url: str,
    link_pattern: Optional[str] = None, link_selector: Optional[str] = None,
    listing_urls: Iterable[str] = (),
) -> list[str]:
    """Candidate job-page URLs from a listing page.

    With a selector/pattern the admin has told us what a job link looks like
    (off-site links allowed, document order kept). Without either we stay on
    the same site, keep links whose path looks like a single posting, drop
    taxonomy/utility pages and pagination, and order by how posting-like the
    URL is so the per-run cap is spent on real jobs first."""
    base = urlparse(base_url)
    base_site = site_key(base.netloc)
    pattern = re.compile(link_pattern, re.I) if link_pattern else None

    if link_selector:
        anchors = []
        for node in soup.select(link_selector):
            if node.name == "a" and node.get("href"):
                anchors.append(node)
            else:
                anchor = node.find("a", href=True) or node.find_parent("a", href=True)
                if anchor is not None:
                    anchors.append(anchor)
    else:
        anchors = soup.find_all("a", href=True)

    skip = {url_key(u) for u in listing_urls} | {url_key(base_url)}
    seen, out, scored = set(), [], []
    for anchor in anchors:
        href = (anchor.get("href") or "").strip()
        if not href or href.lower().startswith(SKIP_SCHEMES):
            continue
        url = urldefrag(urljoin(base_url, href))[0].strip()
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            continue
        key = url_key(url)
        if key in seen or key in skip:
            continue
        if pattern or link_selector:
            if pattern and not pattern.search(url):
                continue
            seen.add(key)
            out.append(url)
            continue

        # Heuristic mode.
        if site_key(parsed.netloc) != base_site:
            continue
        if PAGINATION_HINT.search(url) or NON_JOB_PATH.search(url):
            continue
        path_and_query = f"{parsed.path}?{parsed.query}"
        if not JOB_PATH_HINT.search(path_and_query):
            continue
        segments = [seg for seg in parsed.path.split("/") if seg]
        if not parsed.query and (not segments or (len(segments) == 1 and segments[0].lower() in SECTION_ROOTS)):
            continue
        if parsed.path.rstrip("/") == base.path.rstrip("/") and not parsed.query:
            continue
        seen.add(key)
        scored.append((_posting_score(url, anchor), len(scored), url))

    if scored:
        scored.sort(key=lambda item: (-item[0], item[1]))
        out.extend(url for _, _, url in scored)
    return out


def _fallback_description(soup: BeautifulSoup, selector: Optional[str]) -> str:
    if selector:
        node = soup.select_one(selector)
        if node is not None:
            return _text(node)[:MAX_DESCRIPTION_CHARS]
    for tag in soup(["script", "style", "noscript", "nav", "header", "footer", "aside", "form", "iframe"]):
        tag.decompose()
    for sel in ("[class*=description]", "[id*=description]", "[class*=job-detail]", "[class*=jobdetail]",
                "article", "main", "[role=main]", "[class*=content]"):
        node = soup.select_one(sel)
        if node is not None:
            text = _text(node)
            if len(text) >= MIN_DESCRIPTION_CHARS:
                return text[:MAX_DESCRIPTION_CHARS]
    return _text(soup.body or soup)[:MAX_DESCRIPTION_CHARS]


def _strip_site_suffix(raw: str, site_name: Optional[str]) -> str:
    """Drop a trailing ' | Site Name' / ' - Board' segment from a page title,
    but never cut into the job title itself (e.g. 'Manager (Remote - Kenya)')."""
    parts = TITLE_SEPARATORS.split(raw.strip())
    if len(parts) < 2:
        return raw.strip()
    head, tail = " - ".join(parts[:-1]).strip(), parts[-1].strip()
    balanced = head.count("(") == head.count(")")
    if site_name and (tail.lower() in site_name.lower() or site_name.lower() in tail.lower()):
        return head if balanced else raw.strip()
    if len(tail) <= 25 and balanced and head:
        return head
    return raw.strip()


def _best_title(soup: BeautifulSoup) -> str:
    """The most complete of og:title, <title> and <h1>, minus the site name.
    Boards often put a generic word in <h1> ('Lecturer') while <title> carries
    the full posting name."""
    site_name = _meta(soup, "og:site_name")
    candidates = []
    for raw in (_meta(soup, "og:title"), soup.title.string if soup.title and soup.title.string else None, _text(soup.find("h1"))):
        if not raw or not raw.strip():
            continue
        cleaned = re.sub(r"\s+", " ", _strip_site_suffix(raw, site_name)).strip()
        cleaned = TITLE_NOISE_SUFFIX.sub("", TITLE_NOISE_PREFIX.sub("", cleaned)).strip()
        if 4 <= len(cleaned) <= 200 and not JUNK_TITLE.search(cleaned):
            candidates.append(cleaned)
    if not candidates:
        return ""
    return max(candidates, key=len)


def _guess_location(text: str) -> Optional[str]:
    for place in KENYA_PLACES:
        if re.search(rf"\b{re.escape(place)}\b", text, re.I):
            return "Kenya" if place == "Kenya" else f"{place}, Kenya"
    return None


def parse_job_page(
    soup: BeautifulSoup, url: str, source: str,
    default_company: Optional[str] = None, default_location: Optional[str] = None,
    description_selector: Optional[str] = None,
) -> Optional[JobData]:
    """One job page -> JobData, or None when the page doesn't look like a job."""
    postings = find_jobpostings(soup)
    if postings:
        job = job_from_jsonld(postings[0], url, source, default_company, default_location)
        if job:
            if not job.description or len(job.description) < MIN_DESCRIPTION_CHARS:
                job.description = _fallback_description(soup, description_selector) or job.description
            return job

    title = _best_title(soup)
    if not title:
        return None

    posted = parse_iso_date(_meta(soup, "article:published_time", "datePublished", "date"))
    description = _fallback_description(soup, description_selector)
    if len(description) < MIN_DESCRIPTION_CHARS:
        return None

    location = default_location or _guess_location(f"{title} {description[:1500]}")
    return JobData(
        title=title,
        source=source,
        company=default_company,
        location=location,
        description=description,
        url=url,
        apply_url=url,
        posted_date=posted,
        external_id=stable_id(url_key(url)),
    )


# --- the scraper -------------------------------------------------------------

class GenericSiteScraper(BaseScraper):
    """Scrapes one admin-configured source (see JobSource in models.py)."""

    def __init__(self, config: dict):
        super().__init__()
        self.SOURCE_NAME = config["slug"]
        self.name = config.get("name") or config["slug"]
        raw_urls = config.get("urls") or []
        if isinstance(raw_urls, str):
            raw_urls = raw_urls.splitlines()
        self.urls = [u.strip() for u in raw_urls if u and u.strip()]
        self.link_pattern = (config.get("link_pattern") or "").strip() or None
        self.link_selector = (config.get("link_selector") or "").strip() or None
        self.description_selector = (config.get("description_selector") or "").strip() or None
        self.default_company = (config.get("default_company") or "").strip() or None
        self.default_location = (config.get("default_location") or "").strip() or None
        self.max_jobs = max(1, int(config.get("max_jobs") or 60))
        self.delay = float(config.get("delay", 0.5))
        self.kind = "contract" if (config.get("kind") or "job") == "contract" else "job"
        self.last_fetch_error: Optional[str] = None

    def fetch_page(self, url: str, params: dict = None) -> Optional[BeautifulSoup]:
        """Like BaseScraper.fetch_page, but keeps the failure reason."""
        try:
            self._rotate_ua()
            response = self.session.get(url, params=params, timeout=30)
            response.raise_for_status()
            return BeautifulSoup(response.text, "lxml")
        except requests.RequestException as e:
            self.last_fetch_error = f"{url}: {e}"
            logger.error(f"[{self.SOURCE_NAME}] Failed to fetch {url}: {e}")
            return None

    @staticmethod
    def config_from_row(row) -> dict:
        """JobSource ORM row -> plain config dict (detached from any session)."""
        return {
            "slug": row.slug,
            "name": row.name,
            "urls": row.urls,
            "link_pattern": row.link_pattern,
            "link_selector": row.link_selector,
            "description_selector": row.description_selector,
            "default_company": row.default_company,
            "default_location": row.default_location,
            "max_jobs": row.max_jobs,
            "kind": getattr(row, "kind", None) or "job",
        }

    def scrape(self, search_query: str = None, location: str = None, max_pages: int = 5) -> list[JobData]:
        jobs: list[JobData] = []
        seen: set[str] = set()
        listings_fetched = 0

        for listing_url in self.urls:
            if len(jobs) >= self.max_jobs:
                break
            soup = self.fetch_page(listing_url)
            if soup is None:
                continue
            listings_fetched += 1

            # 1. Structured data on the listing page itself.
            inline = 0
            for posting in find_jobpostings(soup):
                job = job_from_jsonld(posting, listing_url, self.SOURCE_NAME, self.default_company, self.default_location)
                if not job:
                    continue
                key = url_key(job.url) if job.url and url_key(job.url) != url_key(listing_url) else f"inline:{job.external_id}"
                if key in seen:
                    continue
                seen.add(key)
                jobs.append(job)
                inline += 1

            # 2. Job links -> job pages.
            links = extract_job_links(soup, listing_url, self.link_pattern, self.link_selector, self.urls)
            logger.info(f"[{self.SOURCE_NAME}] {listing_url}: {inline} inline postings, {len(links)} candidate links")
            for link in links:
                if len(jobs) >= self.max_jobs:
                    break
                key = url_key(link)
                if key in seen:
                    continue
                seen.add(key)
                detail = self.fetch_page(link)
                if detail is None:
                    continue
                try:
                    job = parse_job_page(
                        detail, link, self.SOURCE_NAME,
                        self.default_company, self.default_location, self.description_selector,
                    )
                except Exception as e:  # one bad page must not sink the source
                    logger.debug(f"[{self.SOURCE_NAME}] parse error for {link}: {e}")
                    job = None
                if job:
                    jobs.append(job)
                time.sleep(self.delay)

        if self.urls and listings_fetched == 0:
            # Surface the reason in the scrape log rather than a misleading
            # "success, 0 found".
            raise RuntimeError(f"Could not fetch any listing page. Last error: {self.last_fetch_error or 'unknown'}")

        unique, ids = [], set()
        for job in jobs:
            if job.external_id in ids:
                continue
            ids.add(job.external_id)
            job.kind = self.kind  # the cleaner may still upgrade "job" to "contract" from the text
            unique.append(job)
        logger.info(f"[{self.SOURCE_NAME}] Total: {len(unique)} unique jobs from {listings_fetched}/{len(self.urls)} listing URL(s)")
        return unique

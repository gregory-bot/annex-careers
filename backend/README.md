# Jobs Pipeline

A data pipeline that aggregates job listings from multiple sources across Kenya and beyond.

## Architecture

```
[Data Sources: LinkedIn, MyJobsInKenya, BrighterMonday, Indeed, Glassdoor, Fuzu, Adzuna API, Google Search]
   ↓
[Scrapers + APIs] (scrapers/)
   ↓
[Airflow DAGs - scheduled at 2 PM EAT daily] (dags/)
   ↓
[Data Cleaning & Transformation] (transformers/)
   ↓
[PostgreSQL Database - Aiven Cloud] (database/)
   ↓
[Grafana Monitoring Dashboard] (grafana/)
   ↓
[FastAPI Backend] (api/)
   ↓
[Frontend Web App] (coming soon)
   ↓
[Users browse & apply]
```

## Project Structure

```
jobs-pipeline/
├── api/                    # FastAPI backend
│   └── main.py
├── config/                 # Configuration
│   └── settings.py
├── dags/                   # Airflow DAGs
│   ├── daily_scrape_dag.py    # Full scrape at 2 PM EAT
│   └── quick_scrape_dag.py    # Quick scrape every 6 hours
├── database/               # DB models & connection
│   ├── connection.py
│   └── models.py
├── grafana/                # Grafana dashboards & provisioning
│   ├── dashboards/
│   └── provisioning/
├── scrapers/               # Job scrapers
│   ├── base_scraper.py
│   ├── linkedin_scraper.py
│   ├── myjobsinkenya_scraper.py
│   ├── brightermonday_scraper.py
│   ├── indeed_scraper.py
│   ├── glassdoor_scraper.py
│   ├── fuzu_scraper.py
│   ├── google_search_scraper.py
│   ├── adzuna_api_scraper.py
│   └── runner.py
├── transformers/           # Data cleaning
│   └── cleaner.py
├── .env                    # Credentials (not committed)
├── docker-compose.yml      # All services
├── Dockerfile
├── requirements.txt
└── test_connection.py      # DB connection test
```

## Quick Start


### 1. Install dependencies
```bash
pip install -r requirements.txt
```

### 1b. Initialize Airflow Database (required for first-time setup or after config changes)
**Local:**
```bash
airflow db init
```
**Render:**
Add a one-time Render shell command or deploy hook:
```bash
airflow db init
```
This must be run with Airflow version 2.8.2.

### 2. Test database connection
```bash
python test_connection.py
```

### 3. Run scrapers manually
```bash
python -m scrapers.runner
```

### 4. Start the API server
```bash
uvicorn api.main:app --reload --port 8000
```

### 5. Start everything with Docker
```bash
docker-compose up -d
```

## Services

| Service | Port | URL |
|---------|------|-----|
| Airflow UI | 8080 | http://localhost:8080 |
| Backend API | 8000 | http://localhost:8000/docs |
| Grafana | 3000 | http://localhost:3000 |

## API Endpoints

- `GET /api/jobs` - List jobs (with search, filter, pagination)
- `GET /api/jobs/{id}` - Get single job
- `GET /api/sources` - List data sources
- `GET /api/stats` - Pipeline statistics
- `POST /api/scrape/{source}` - Trigger manual scrape

## DAG Schedule

- **Daily Full Scrape**: Runs at 2:00 PM EAT (11:00 AM UTC) - scrapes all 8 sources
- **Quick Scrape**: Every 6 hours - scrapes LinkedIn, BrighterMonday, Indeed

## Adding a Job Source Without Code

Built-in scrapers live in `airflow_home/scrapers/` and are registered in
`SCRAPER_REGISTRY` (`scrapers/runner.py`). Sources that don't need bespoke
parsing can be added from the admin UI (**Job Sources** tab) or the API and
are stored in the `job_sources` table. They are scraped by
`scrapers/generic_site_scraper.py`, which:

1. reads schema.org `JobPosting` JSON-LD from the listing page when present,
2. collects job links (CSS selector or regex hint if given, otherwise links
   on the same site whose path looks like a single posting), and
3. opens each job page and parses JSON-LD first, HTML (`og:title`, `<h1>`,
   description containers) second.

Every enabled custom source is included in `run_all_scrapers()`, so the
daily schedule picks it up with no deploy. Endpoints (admin token required):

```
GET    /api/admin/sources              built-in + custom sources with last run
POST   /api/admin/sources              {"name", "urls": [...], "link_pattern"?, "link_selector"?,
                                        "description_selector"?, "default_company"?,
                                        "default_location"?, "max_jobs"?, "enabled"?}
PUT    /api/admin/sources/{id}
DELETE /api/admin/sources/{id}
POST   /api/admin/scrape/{slug}        scrape one source now (background)
```

Tests: `.venv312/bin/python -m unittest tests.test_generic_site_scraper tests.test_sources_api tests.test_admin_jobs`

## Employer Portal (companies post their own jobs)

Marketing flow: the admin invites a company from the **Employers** tab (or
`POST /api/admin/employers`). The company receives an email with the employer
page link (`<FRONTEND_URL>/employer`) and a unique 12-character access code.
Only the code's SHA-256 hash is stored; the plain code is returned to the
admin exactly once (create / "New code") in case the email does not arrive.

Email + code -> a token scoped to `/api/employer/*` (`sub: "employer"`), which
cannot call admin endpoints. Jobs posted through the portal go live at once
with `source = "employer"`, the company name forced to the invited company,
and `jobs.employer_invite_id` pointing back at the invite.

```
POST   /api/admin/employers                 invite (returns access_code once, emails it)
POST   /api/admin/employers/{id}/resend     new code (old one stops working)
PATCH  /api/admin/employers/{id}            status active|revoked, expiry, contact details
DELETE /api/admin/employers/{id}            jobs already posted are kept
POST   /api/employer/login                  {email, access_code}
GET    /api/employer/me                     company + its jobs, each with views / apply_clicks
                                            (from analytics_events page_view / apply_click)
POST   /api/employer/jobs                   CreateJobRequest (company is ignored)
POST   /api/employer/jobs/{id}/close        hide one of its own jobs (keeps it listed for them)
POST   /api/employer/jobs/{id}/repost       reactivate + bump to the top of the listing
DELETE /api/employer/jobs/{id}              remove one of its own jobs permanently
```

## Contracts & Consultancies

Listings have a `kind`: `job` (default) or `contract` (consultancies, TOR-based
assignments, tenders). Contracts share the whole pipeline with jobs and carry
three extra fields: `tor_url`, `duration`, `budget`.

- Public: `/contracts` page; API `GET /api/jobs?kind=contract` (default is
  `kind=job`; `kind=all` for both). Facets and stats take the same parameter.
- Scraped listings are classified by `transformers/cleaner.py::classify_kind`
  (consultant, terms of reference, tender, RFP, EOI...). Existing rows were
  classified once at startup (`_backfill_job_kinds`).
- Admin sources have a `kind`; a source marked `contract` files everything it
  collects under Contracts. The built-in `reliefweb` scraper pulls UN/NGO
  consultancies in Kenya and needs a free `RELIEFWEB_APPNAME`.
- The employer portal and the admin "Add Job" form have a Job / Contract switch.

## Automatic Job-Alert Emails

`notify_users_of_new_jobs()` matches every stored user (subscribers and CV
uploaders) against listings they have not been emailed about yet and sends one
email per user, recording each job in `user_job_notifications` so nothing is
sent twice. It runs daily at `JOB_ALERT_HOUR_UTC` (default 5 = 08:00 EAT) via
the API's scheduler (`daily_job_alerts`), separately from the 11:00 UTC scrape.
Sends are synchronous so the summary is real; a failed send is retried next day.

```
GET  /api/admin/alerts/status   schedule, next run, last run summary
POST /api/admin/alerts/run      run the pipeline now (background)
```

## Monetisation: Featured Listings and Banner Ads

Sold directly, paid outside the site (invoice / M-Pesa), switched on by the admin.

- **Featured listings**: `POST /api/admin/jobs/{id}/feature` `{"days": 7}` sets
  `jobs.featured_until`; `DELETE .../feature` clears it. Featured listings sort
  first in every public list (whatever the sort) and carry `is_featured` /
  `featured_until` in `JobResponse`; `GET /api/jobs?featured=true` filters.
  Managed from the Dashboard table ("Feature..." / "Unfeature").
- **Banner ads** (`ads` table, admin **Ads** tab): name, advertiser, placement
  (`home`, `jobs_list`, `contracts_list`, `job_sidebar`), link, creative
  (uploaded via `POST /api/uploads?extract=false` or an image URL), start /
  end dates, active flag, weight. Public `GET /api/ads?placement=...` returns
  the live ads; the `AdBanner` component picks one by weight, posts an
  impression on mount and a click on the way out (`POST /api/ads/{id}/impression|click`).
  Admin CRUD under `/api/admin/ads`, with status (active / scheduled / expired /
  paused), impressions, clicks and CTR per ad.

## Listing Attachments (posters, TORs, contract documents)

Admins and signed-in employers can attach files to a listing: poster images
(JPG/PNG/WEBP) and documents (PDF, .docx, .txt), up to 8 MB each. Files are
stored in the `attachments` table (not on disk, so redeploys keep them) and
served from `GET /api/files/{id}`.

Upload happens before the listing is saved so the form can be pre-filled:
`POST /api/uploads` stores the file, reads its text (OCR for images via
RapidOCR in `api/ocr.py`; pdfplumber / python-docx for documents), and
returns `suggested` fields from `api/listing_extract.py` (title, organisation,
deadline, apply link, location, type, job/contract). The listing is then
created with `attachment_ids`; a file can only be linked by the account that
uploaded it. Contracts without a TOR link get their first document as the TOR.
Posters are shown on the listing page and used as the share-preview image.
Uploads never linked to a listing are purged after 24 hours.

OCR needs `rapidocr-onnxruntime` (in requirements) and, in Docker, `libgl1`
plus `libglib2.0-0` (in the Dockerfile). The engine is loaded in the
background at startup. Set `API_PUBLIC_URL` in production so absolute file
links use the public API host.

## Link Previews for Shared Jobs (SEO)

The site is a single-page app; WhatsApp, Facebook, LinkedIn, X and Slack
crawlers do not run JavaScript, so a shared `/jobs/<id>` link would only ever
show the generic site card. `GET /share/jobs/{id}` renders that job's own
Open Graph / Twitter tags plus schema.org `JobPosting` JSON-LD as plain HTML,
and bounces humans to the real page.

For address-bar links to preview correctly, the front-end web server must
send crawler requests for `/jobs/<id>` to that endpoint. Ready-made configs:
`deploy/Caddyfile.example` and `deploy/nginx.conf.example`. The default share
image is `front-end/public/og-image.jpg` (1200x630), served by the site.

In the browser, `front-end/src/lib/seo.ts` sets each page's title, tags and
JSON-LD at runtime, which is what Google (a JavaScript-rendering crawler) and
bookmarks see.

Test locally:
```
curl -s http://localhost:8000/share/jobs/<id> | grep -E 'og:(title|description|image)'
```

## Data Sources

| Source | Method | Notes |
|--------|--------|-------|
| LinkedIn | Web scraping | Public job search pages |
| MyJobsInKenya | Web scraping | Kenya-focused job board |
| BrighterMonday | Web scraping | East Africa's largest job board |
| Indeed Kenya | Web scraping | Global job aggregator |
| Glassdoor | Web scraping | Jobs + company reviews |
| Fuzu | Web scraping | East Africa career platform |
| Google Search | Web scraping | Agentic search across many sites |
| Adzuna | REST API | Free tier: 250 req/month |

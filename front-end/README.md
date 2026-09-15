# Annex Jobs

A full-stack job aggregation platform that scrapes listings from 12+ Kenyan job boards, deduplicates them, and serves them through a modern React frontend and RESTful API.

---

## Table of Contents

- [Overview](#overview)
- [Frontend](#frontend)
- [Backend](#backend)
- [API Endpoints](#api-endpoints)
- [Testing the API](#testing-the-api)
- [Getting Started](#getting-started)

---

## Overview

**Annex Jobs** automatically scrapes job listings from multiple sources daily at **2:00 PM EAT**, stores them in a PostgreSQL database, removes duplicates, tracks application deadlines, and auto-expires stale listings.

**Live API:** `https://jobs-data-pipeline.onrender.com`

---

## Frontend

Built with modern web technologies for a fast, accessible user experience.

| Technology | Purpose |
|---|---|
| React 18 | UI framework |
| TypeScript | Type safety |
| Vite | Build tool & dev server |
| Tailwind CSS | Utility-first styling |
| shadcn/ui + Radix UI | Accessible component library |
| Framer Motion | Animations |
| TanStack React Query | Data fetching & caching |
| React Router DOM | Client-side routing |
| Recharts | Data visualization |
| Lucide React | Icons |

### Frontend Pages

| Route | Description |
|---|---|
| `/` | Homepage with featured jobs |
| `/jobs` | Browse & filter all jobs |
| `/jobs/:id` | Job detail page |
| `/categories` | Browse by category |
| `/companies` | Browse by company |
| `/locations` | Browse by location |
| `/about` | About page |
| `/chat` | AI chat assistant |

---

## Backend

The backend is a **FastAPI** application with a built-in scheduler.

| Component | Technology |
|---|---|
| Framework | FastAPI 0.95.2 |
| ORM | SQLAlchemy 1.4.49 |
| Validation | Pydantic 1.10.13 |
| Scheduler | APScheduler 3.10.4 |
| Scraping | BeautifulSoup4 + lxml + Requests |
| Database | PostgreSQL (SSL) |
| Deployment | Docker on Render |

### Job Sources (12 Scrapers)

| Source | Website |
|---|---|
| LinkedIn | linkedin.com |
| MyJobsInKenya | myjobsinkenya.com |
| BrighterMonday | brightermonday.co.ke |
| Indeed | indeed.com |
| Glassdoor | glassdoor.com |
| Fuzu | fuzu.com |
| Google Search | google.com |
| Adzuna (API) | adzuna.co.ke |
| JobWebKenya | jobwebkenya.com |
| Corporate Staffing | corporatestaffing.co.ke |
| KenyaJob | kenyajob.com |
| Summit Recruitment | summitrecruitment-search.com |

### Automated Pipeline

- **Daily scrape** runs at 2:00 PM EAT (11:00 UTC) via APScheduler
- **Deduplication** by `(source, external_id)` unique constraint — upserts on conflict
- **Deadline tracking** — jobs with expired `application_deadline` are auto-filtered
- **Auto-expire** — jobs older than 30 days without a recent scrape are deactivated

---

## API Endpoints

Base URL: `https://jobs-data-pipeline.onrender.com`

Interactive docs: [Swagger UI](https://jobs-data-pipeline.onrender.com/docs) | [ReDoc](https://jobs-data-pipeline.onrender.com/redoc)

### `GET /`

Root endpoint. Returns API info.

```bash
curl https://jobs-data-pipeline.onrender.com/
```

**Response:**
```json
{
  "message": "Jobs Pipeline API",
  "docs": "/docs"
}
```

---

### `GET /api/jobs`

List jobs with filtering, search, and pagination.

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | int | 1 | Page number (≥ 1) |
| `per_page` | int | 20 | Results per page (1–100) |
| `search` | string | — | Search in title, company, description, tags |
| `source` | string | — | Filter by source (e.g., `linkedin`) |
| `location` | string | — | Filter by location (partial match) |
| `job_type` | string | — | Filter by job type |
| `remote` | bool | — | Filter remote jobs |
| `sort_by` | string | `scraped_at` | Sort field: `scraped_at`, `posted_date`, `title`, `company` |
| `sort_order` | string | `desc` | Sort direction: `asc` or `desc` |

```bash
# Get first page of jobs
curl "https://jobs-data-pipeline.onrender.com/api/jobs"

# Search for "developer" jobs in Nairobi
curl "https://jobs-data-pipeline.onrender.com/api/jobs?search=developer&location=Nairobi&per_page=10"

# Filter by source
curl "https://jobs-data-pipeline.onrender.com/api/jobs?source=brightermonday&sort_by=posted_date"
```

**Response:**
```json
{
  "jobs": [
    {
      "id": 1,
      "title": "Software Engineer",
      "company": "Safaricom",
      "location": "Nairobi, Kenya",
      "description": "...",
      "salary_min": 100000,
      "salary_max": 200000,
      "salary_currency": "KES",
      "job_type": "Full-time",
      "experience_level": "Mid-level",
      "remote": false,
      "url": "https://...",
      "apply_url": "https://...",
      "source": "brightermonday",
      "tags": "engineering,software",
      "posted_date": "2025-01-15T00:00:00",
      "application_deadline": "2025-02-15T00:00:00",
      "scraped_at": "2025-01-16T11:00:00",
      "is_active": true
    }
  ],
  "total": 150,
  "page": 1,
  "pages": 8,
  "per_page": 20
}
```

---

### `GET /api/jobs/{job_id}`

Get a single job by ID.

```bash
curl https://jobs-data-pipeline.onrender.com/api/jobs/1
```

**Response:** Single `JobResponse` object (same shape as items in the list above).

Returns `404` if the job does not exist.

---

### `GET /api/sources`

List all active job sources with their job counts.

```bash
curl https://jobs-data-pipeline.onrender.com/api/sources
```

**Response:**
```json
{
  "sources": {
    "brightermonday": 45,
    "linkedin": 32,
    "indeed": 28,
    "myjobsinkenya": 15
  }
}
```

---

### `GET /api/stats`

Get pipeline statistics including totals, per-source counts, and recent scrape logs.

```bash
curl https://jobs-data-pipeline.onrender.com/api/stats
```

**Response:**
```json
{
  "total_jobs": 320,
  "active_jobs": 280,
  "sources": {
    "brightermonday": 45,
    "linkedin": 32
  },
  "recent_scrapes": [
    {
      "source": "brightermonday",
      "status": "success",
      "jobs_found": 45,
      "started_at": "2025-01-16T11:00:00"
    }
  ]
}
```

---

### `GET /api/health`

Health check — verifies the database connection.

```bash
curl https://jobs-data-pipeline.onrender.com/api/health
```

**Response:**
```json
{
  "status": "healthy",
  "database": "connected"
}
```

---

### `GET /api/scheduler`

Check the scheduler status and next scheduled run time.

```bash
curl https://jobs-data-pipeline.onrender.com/api/scheduler
```

**Response:**
```json
{
  "running": true,
  "jobs": [
    {
      "id": "daily_scrape",
      "name": "Daily Full Scrape (2PM EAT)",
      "next_run": "2025-01-17 11:00:00+00:00"
    }
  ]
}
```

---

### `POST /api/scrape/{source}`

Manually trigger a scrape for a specific source.

**Path Parameter:** `source` — one of the 12 registered scraper names (e.g., `brightermonday`, `linkedin`, `indeed`)

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `search_query` | string | — | Search query for the scraper |
| `location` | string | — | Location filter |
| `max_pages` | int | 3 | Max pages to scrape (1–10) |

```bash
# Scrape BrighterMonday
curl -X POST "https://jobs-data-pipeline.onrender.com/api/scrape/brightermonday?location=Kenya&max_pages=2"

# Scrape LinkedIn for "data analyst" roles
curl -X POST "https://jobs-data-pipeline.onrender.com/api/scrape/linkedin?search_query=data%20analyst&location=Nairobi"
```

**Response:**
```json
{
  "source": "brightermonday",
  "status": "success",
  "jobs_found": 25,
  "jobs_saved": 20,
  "duration_seconds": 12.5
}
```

Returns `400` if the source name is invalid.

---

### `POST /api/scrape-all`

Trigger a full scrape across all 12 sources. This runs synchronously and may take several minutes.

```bash
curl -X POST "https://jobs-data-pipeline.onrender.com/api/scrape-all"
```

**Response:** Array of results, one per source.

---

## Testing the API

### Using curl

All `GET` endpoints can be tested directly in your browser or with `curl`:

```bash
# Health check
curl https://jobs-data-pipeline.onrender.com/api/health

# List jobs
curl "https://jobs-data-pipeline.onrender.com/api/jobs?per_page=5"

# Search
curl "https://jobs-data-pipeline.onrender.com/api/jobs?search=python&location=Nairobi"

# Trigger a scrape (POST)
curl -X POST "https://jobs-data-pipeline.onrender.com/api/scrape/brightermonday"
```

### Using Swagger UI

Visit [https://jobs-data-pipeline.onrender.com/docs](https://jobs-data-pipeline.onrender.com/docs) to explore and test all endpoints interactively with the built-in Swagger UI.

### Using Python

```python
import requests

# Get jobs
response = requests.get(
    "https://jobs-data-pipeline.onrender.com/api/jobs",
    params={"search": "engineer", "per_page": 5}
)
data = response.json()
for job in data["jobs"]:
    print(f"{job['title']} at {job['company']} — {job['location']}")
```

### Using JavaScript (fetch)

```javascript
const res = await fetch(
  "https://jobs-data-pipeline.onrender.com/api/jobs?search=developer&per_page=5"
);
const data = await res.json();
data.jobs.forEach(job => {
  console.log(`${job.title} at ${job.company}`);
});
```

---

## Getting Started

### Frontend

```bash
# Install dependencies
npm install

# Start dev server (runs on port 8080)
npm run dev

# Build for production
npm run build
```

The dev server proxies `/api` requests to the live backend automatically.

### Backend

```bash
cd backend

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export DB_HOST=your_host
export DB_PORT=5432
export DB_NAME=your_db
export DB_USER=your_user
export DB_PASSWORD=your_password

# Run the API server
uvicorn api.main:app --host 0.0.0.0 --port 10000
```

### Docker (Backend)

```bash
cd backend
docker build -t jobs-pipeline .
docker run -p 10000:10000 --env-file .env jobs-pipeline
```

---

## License

This project is proprietary. All rights reserved.

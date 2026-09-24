"""
/sitemap.xml: static pages plus every live listing, nothing expired or inactive.

    cd backend && .venv312/bin/python -m unittest tests.test_sitemap
"""
import datetime as dt
import unittest
import xml.etree.ElementTree as ET

from airflow_home.database.models import Job
import api.main as main
from tests.support import TestingSession, client, install_overrides, reset_schema

NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}


class SitemapTests(unittest.TestCase):
    def setUp(self):
        install_overrides()
        reset_schema()
        self.db = TestingSession()

    def tearDown(self):
        self.db.close()

    def make_job(self, **overrides):
        defaults = dict(
            title="Data Scientist", company="goCode Softwares", location="Nairobi",
            description="A real description that is comfortably longer than thirty characters.",
            source="employer", is_active=True, scraped_at=dt.datetime(2026, 9, 20, 8, 30),
        )
        defaults.update(overrides)
        job = Job(**defaults)
        self.db.add(job)
        self.db.commit()
        self.db.refresh(job)
        return job

    def test_lists_static_pages_and_only_live_jobs(self):
        live = self.make_job()
        inactive = self.make_job(is_active=False)
        expired = self.make_job(application_deadline=dt.datetime(2020, 1, 1))

        res = client.get("/sitemap.xml")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.headers["content-type"].startswith("application/xml"))

        root = ET.fromstring(res.content)
        locs = [el.text for el in root.findall("sm:url/sm:loc", NS)]
        site = main.SITE_URL.rstrip("/")
        for path in ("/", "/jobs", "/about", "/contact", "/privacy", "/terms"):
            self.assertIn(f"{site}{path}", locs)
        self.assertIn(f"{site}/jobs/{live.id}", locs)
        self.assertNotIn(f"{site}/jobs/{inactive.id}", locs)
        self.assertNotIn(f"{site}/jobs/{expired.id}", locs)

        job_url = next(u for u in root.findall("sm:url", NS) if u.find("sm:loc", NS).text.endswith(f"/jobs/{live.id}"))
        self.assertEqual(job_url.find("sm:lastmod", NS).text, "2026-09-20")


if __name__ == "__main__":
    unittest.main()

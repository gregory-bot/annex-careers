"""
Admin job-source endpoints, paginated scrape logs and the runner's custom
source lookup, against in-memory SQLite (no network, no credentials).

    cd backend && .venv312/bin/python -m unittest tests.test_sources_api
"""
import datetime as dt
import time
import unittest

from airflow_home.database.models import ScrapeLog
from airflow_home.scrapers import runner
from airflow_home.scrapers.generic_site_scraper import GenericSiteScraper
import api.main as main
from tests.support import TestingSession, client, install_overrides, reset_schema

VALID = {"name": "Naukri Gulf", "urls": ["https://www.naukrigulf.com/jobs-in-kenya"], "default_location": "Kenya"}


class SourcesApiTests(unittest.TestCase):
    def setUp(self):
        install_overrides()
        reset_schema()
        self.db = TestingSession()
        # The runner opens its own sessions; point them at the test DB.
        self._runner_session = runner.SessionLocal
        runner.SessionLocal = TestingSession

    def tearDown(self):
        runner.SessionLocal = self._runner_session
        self.db.close()

    def test_create_list_update_delete(self):
        created = client.post("/api/admin/sources", json=VALID)
        self.assertEqual(created.status_code, 201, created.text)
        body = created.json()
        self.assertEqual(body["slug"], "naukri_gulf")
        self.assertEqual(body["urls"], VALID["urls"])
        self.assertTrue(body["enabled"])
        self.assertIsNone(body["last_run"])

        listing = client.get("/api/admin/sources").json()
        self.assertEqual([s["slug"] for s in listing["custom"]], ["naukri_gulf"])
        self.assertIn("kemri", [s["slug"] for s in listing["builtin"]])
        self.assertEqual(listing["running_sources"], [])

        updated = client.put(f"/api/admin/sources/{body['id']}", json={**VALID, "name": "NaukriGulf Kenya", "enabled": False,
                                                                        "urls": VALID["urls"] + ["https://www.naukrigulf.com/it-jobs"]})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["name"], "NaukriGulf Kenya")
        self.assertFalse(updated.json()["enabled"])
        self.assertEqual(len(updated.json()["urls"]), 2)
        self.assertEqual(updated.json()["slug"], "naukri_gulf")  # slug is stable across renames

        deleted = client.delete(f"/api/admin/sources/{body['id']}")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(client.delete(f"/api/admin/sources/{body['id']}").status_code, 404)
        self.assertEqual(client.get("/api/admin/sources").json()["custom"], [])

    def test_last_run_comes_from_latest_log(self):
        client.post("/api/admin/sources", json=VALID)
        self.db.add_all([
            ScrapeLog(source="naukri_gulf", status="failed", jobs_found=0, started_at=dt.datetime(2026, 9, 20, 8)),
            ScrapeLog(source="naukri_gulf", status="success", jobs_found=12, jobs_new=4, started_at=dt.datetime(2026, 9, 21, 8)),
            ScrapeLog(source="kemri", status="success", jobs_found=2, started_at=dt.datetime(2026, 9, 22, 8)),
        ])
        self.db.commit()
        listing = client.get("/api/admin/sources").json()
        custom = listing["custom"][0]["last_run"]
        self.assertEqual((custom["status"], custom["jobs_found"], custom["jobs_new"]), ("success", 12, 4))
        self.assertEqual(custom["started_at"], "2026-09-21T08:00:00+00:00")
        kemri = next(s for s in listing["builtin"] if s["slug"] == "kemri")
        self.assertEqual(kemri["last_run"]["jobs_found"], 2)

    def test_validation_and_conflicts(self):
        self.assertEqual(client.post("/api/admin/sources", json={**VALID, "urls": []}).status_code, 400)
        self.assertEqual(client.post("/api/admin/sources", json={**VALID, "urls": ["ftp://nope"]}).status_code, 400)
        self.assertEqual(client.post("/api/admin/sources", json={**VALID, "link_pattern": "(unclosed"}).status_code, 400)
        self.assertEqual(client.post("/api/admin/sources", json={**VALID, "max_jobs": 0}).status_code, 400)
        self.assertEqual(client.post("/api/admin/sources", json={**VALID, "name": "   "}).status_code, 400)
        self.assertEqual(client.post("/api/admin/sources", json={**VALID, "name": "KEMRI"}).status_code, 409)  # built-in
        self.assertEqual(client.post("/api/admin/sources", json=VALID).status_code, 201)
        self.assertEqual(client.post("/api/admin/sources", json=VALID).status_code, 409)  # duplicate slug
        self.assertEqual(client.put("/api/admin/sources/999", json=VALID).status_code, 404)

    def test_runner_sees_enabled_custom_sources(self):
        client.post("/api/admin/sources", json=VALID)
        client.post("/api/admin/sources", json={**VALID, "name": "Disabled One", "enabled": False})

        self.assertEqual([c["slug"] for c in runner.load_custom_sources()], ["naukri_gulf"])
        self.assertEqual(len(runner.load_custom_sources(enabled_only=False)), 2)
        self.assertTrue(runner.is_known_source("naukri_gulf"))
        self.assertTrue(runner.is_known_source("kemri"))
        self.assertFalse(runner.is_known_source("nope"))
        scraper = runner.build_scraper("naukri_gulf")
        self.assertIsInstance(scraper, GenericSiteScraper)
        self.assertEqual(scraper.SOURCE_NAME, "naukri_gulf")
        self.assertEqual(scraper.default_location, "Kenya")
        with self.assertRaises(ValueError):
            runner.build_scraper("nope")

    def test_single_source_scrape_runs_in_background(self):
        client.post("/api/admin/sources", json=VALID)
        calls = []

        def fake_run(source):
            calls.append(source)
            with main._scrape_lock:
                main._running_single_sources.discard(source)

        original = main._run_single_scrape_in_background
        main._run_single_scrape_in_background = fake_run
        try:
            self.assertEqual(client.post("/api/admin/scrape/nope").status_code, 404)
            res = client.post("/api/admin/scrape/naukri_gulf")
            self.assertEqual(res.status_code, 202, res.text)
            self.assertEqual(res.json()["source"], "naukri_gulf")
            deadline = time.time() + 2
            while not calls and time.time() < deadline:
                time.sleep(0.01)
            self.assertEqual(calls, ["naukri_gulf"])

            with main._scrape_lock:
                main._running_single_sources.add("kemri")
            self.assertEqual(client.post("/api/admin/scrape/kemri").status_code, 409)
            logs = client.get("/api/scrape-logs").json()
            self.assertTrue(logs["in_progress"])
            self.assertEqual(logs["running_sources"], ["kemri"])
        finally:
            main._run_single_scrape_in_background = original
            with main._scrape_lock:
                main._running_single_sources.clear()

    def test_scrape_logs_paginate_and_filter(self):
        for i in range(25):
            self.db.add(ScrapeLog(source="kemri" if i % 5 else "talent", status="success", jobs_found=i,
                                  started_at=dt.datetime(2026, 9, 1) + dt.timedelta(hours=i)))
        self.db.commit()

        first = client.get("/api/scrape-logs").json()
        self.assertEqual((first["total"], first["pages"], first["per_page"], first["page"]), (25, 3, 10, 1))
        self.assertEqual(len(first["logs"]), 10)
        self.assertEqual(first["logs"][0]["jobs_found"], 24)  # newest first

        last = client.get("/api/scrape-logs", params={"page": 3}).json()
        self.assertEqual(len(last["logs"]), 5)
        self.assertEqual(last["logs"][-1]["jobs_found"], 0)

        talent = client.get("/api/scrape-logs", params={"source": "talent", "per_page": 3}).json()
        self.assertEqual((talent["total"], talent["pages"]), (5, 2))
        self.assertTrue(all(l["source"] == "talent" for l in talent["logs"]))


if __name__ == "__main__":
    unittest.main()

"""
Admin job-management and scrape endpoints, exercised against an in-memory
SQLite database with the auth dependency overridden, so no network access
or credentials are needed.

    cd backend && .venv312/bin/python -m unittest tests.test_admin_jobs
"""
import datetime as dt
import unittest

from airflow_home.database.models import (
    Job, ScrapeLog, User, UserJobNotification, AnalyticsEvent, CVSubmission,
)
import api.main as main
from tests.support import TestingSession, client, install_overrides, reset_schema


def make_job(db, title, **overrides):
    defaults = dict(
        title=title, company="Acme", location="Nairobi, Kenya", source="manual",
        description="A perfectly ordinary job description that is long enough.",
        is_active=True, scraped_at=dt.datetime(2026, 1, 1),
    )
    defaults.update(overrides)
    job = Job(**defaults)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


class AdminEndpointTests(unittest.TestCase):
    def setUp(self):
        install_overrides()
        reset_schema()
        self.db = TestingSession()

    def tearDown(self):
        self.db.close()

    # --- listing ---

    def test_list_paginates_newest_first(self):
        for i in range(25):
            make_job(self.db, f"Job {i:02d}", scraped_at=dt.datetime(2026, 1, 1) + dt.timedelta(days=i))

        first = client.get("/api/admin/jobs", params={"page": 1, "per_page": 10}).json()
        self.assertEqual(first["total"], 25)
        self.assertEqual(first["pages"], 3)
        self.assertEqual(first["per_page"], 10)
        self.assertEqual(len(first["jobs"]), 10)
        self.assertEqual(first["jobs"][0]["title"], "Job 24")

        last = client.get("/api/admin/jobs", params={"page": 3, "per_page": 10}).json()
        self.assertEqual(len(last["jobs"]), 5)
        self.assertEqual(last["jobs"][-1]["title"], "Job 00")

    def test_list_shows_hidden_and_inactive_jobs_with_status_filter(self):
        make_job(self.db, "Visible job")
        make_job(self.db, "Hidden: tiny description", description="short")
        make_job(self.db, "Deactivated job", is_active=False)

        everything = client.get("/api/admin/jobs").json()
        self.assertEqual(everything["total"], 3)

        active = client.get("/api/admin/jobs", params={"status": "active"}).json()
        self.assertEqual({j["title"] for j in active["jobs"]}, {"Visible job", "Hidden: tiny description"})

        inactive = client.get("/api/admin/jobs", params={"status": "inactive"}).json()
        self.assertEqual([j["title"] for j in inactive["jobs"]], ["Deactivated job"])

        self.assertEqual(client.get("/api/admin/jobs", params={"status": "bogus"}).status_code, 422)

    def test_search_matches_any_field_and_requires_every_term(self):
        make_job(self.db, "Customer Marketing Lead", company="Safaricom PLC")
        make_job(self.db, "Brand Manager", company="PZ Cussons", tags="marketing, fmcg")
        make_job(self.db, "Accountant", company="Scope Markets", location="Kisumu, Kenya", source="openedcareer")
        target = make_job(self.db, "Fraud Analyst", company="Sportserve")

        def titles(**params):
            return sorted(j["title"] for j in client.get("/api/admin/jobs", params=params).json()["jobs"])

        self.assertEqual(titles(search="marketing"), ["Brand Manager", "Customer Marketing Lead"])
        self.assertEqual(titles(search="SAFARICOM marketing"), ["Customer Marketing Lead"])
        self.assertEqual(titles(search="kisumu"), ["Accountant"])
        self.assertEqual(titles(search="openedcareer"), ["Accountant"])
        self.assertEqual(titles(search=str(target.id)), ["Fraud Analyst"])
        self.assertEqual(titles(search="jky"), [])
        self.assertEqual(client.get("/api/admin/jobs", params={"search": "jky"}).json()["total"], 0)

    # --- delete ---

    def test_delete_removes_job_and_detaches_dependants(self):
        job = make_job(self.db, "Doomed job")
        keeper = make_job(self.db, "Kept job")
        user = User(email="a@example.com")
        self.db.add(user)
        self.db.commit()
        self.db.add_all([
            UserJobNotification(user_id=user.id, job_id=job.id),
            AnalyticsEvent(event_type="apply_click", job_id=job.id),
            CVSubmission(job_id=job.id, action="analyze"),
        ])
        self.db.commit()

        job_id = job.id
        res = client.delete(f"/api/admin/jobs/{job_id}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["job_id"], job_id)

        self.db.expire_all()
        self.assertIsNone(self.db.query(Job).get(job_id))
        self.assertIsNotNone(self.db.query(Job).get(keeper.id))
        self.assertEqual(self.db.query(UserJobNotification).count(), 0)
        self.assertIsNone(self.db.query(AnalyticsEvent).one().job_id)
        self.assertIsNone(self.db.query(CVSubmission).one().job_id)

    def test_delete_unknown_job_is_404(self):
        self.assertEqual(client.delete("/api/admin/jobs/9999").status_code, 404)

    # --- repost ---

    def test_repost_reactivates_bumps_and_clears_expired_deadline(self):
        job = make_job(
            self.db, "Old job", is_active=False,
            scraped_at=dt.datetime(2025, 1, 1), posted_date=dt.datetime(2025, 1, 1),
            application_deadline=dt.datetime(2025, 2, 1),
        )
        before = dt.datetime.utcnow() - dt.timedelta(seconds=5)

        res = client.post(f"/api/admin/jobs/{job.id}/repost")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body["deadline_cleared"])
        self.assertIn("deadline cleared", body["message"])

        self.db.expire_all()
        fresh = self.db.query(Job).get(job.id)
        self.assertTrue(fresh.is_active)
        self.assertIsNone(fresh.application_deadline)
        self.assertGreater(fresh.scraped_at, before)
        self.assertGreater(fresh.posted_date, before)

    def test_repost_keeps_a_future_deadline(self):
        future = dt.datetime.utcnow() + dt.timedelta(days=30)
        job = make_job(self.db, "Fresh job", application_deadline=future)

        body = client.post(f"/api/admin/jobs/{job.id}/repost").json()
        self.assertFalse(body["deadline_cleared"])
        self.db.expire_all()
        self.assertEqual(self.db.query(Job).get(job.id).application_deadline, future)

    def test_repost_unknown_job_is_404(self):
        self.assertEqual(client.post("/api/admin/jobs/9999/repost").status_code, 404)

    # --- scrape logs / scrape-all ---

    def test_scrape_logs_are_utc_tagged_and_report_progress_flag(self):
        self.db.add(ScrapeLog(
            source="openedcareer", status="success", jobs_found=3, jobs_new=1, jobs_updated=2,
            started_at=dt.datetime(2026, 9, 18, 8, 4, 20), finished_at=dt.datetime(2026, 9, 18, 8, 4, 50),
        ))
        self.db.commit()

        body = client.get("/api/scrape-logs").json()
        self.assertFalse(body["in_progress"])
        log = body["logs"][0]
        self.assertEqual(log["started_at"], "2026-09-18T08:04:20+00:00")
        self.assertEqual(log["finished_at"], "2026-09-18T08:04:50+00:00")
        self.assertEqual((log["jobs_new"], log["jobs_updated"]), (1, 2))

    def test_scrape_all_returns_immediately_and_rejects_concurrent_runs(self):
        calls = []

        def fake_run(search_query, location, max_pages):
            calls.append((search_query, location, max_pages))
            with main._scrape_lock:
                main._scrape_state["running"] = False

        original = main._run_full_scrape_in_background
        main._run_full_scrape_in_background = fake_run
        try:
            res = client.post("/api/scrape-all")
            self.assertEqual(res.status_code, 202)
            body = res.json()
            self.assertTrue(body["started"])
            self.assertGreater(body["sources"], 20)

            import time
            deadline = time.time() + 2
            while calls == [] and time.time() < deadline:
                time.sleep(0.01)
            self.assertEqual(calls, [(None, "Kenya", 3)])

            with main._scrape_lock:
                main._scrape_state["running"] = True
            self.assertEqual(client.post("/api/scrape-all").status_code, 409)
        finally:
            main._run_full_scrape_in_background = original
            with main._scrape_lock:
                main._scrape_state["running"] = False


if __name__ == "__main__":
    unittest.main()

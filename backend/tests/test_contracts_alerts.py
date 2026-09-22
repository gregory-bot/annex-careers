"""
Contracts (kind="contract") across the pipeline, the automatic job-alert
emails, and the subscribe / register capture paths. Offline: SQLite,
email sending captured.

    cd backend && .venv312/bin/python -m unittest tests.test_contracts_alerts
"""
import datetime as dt
import time
import unittest

from bs4 import BeautifulSoup

from airflow_home.database.models import Job, User, UserJobNotification
from airflow_home.scrapers import runner
from airflow_home.scrapers.base_scraper import JobData
from airflow_home.scrapers.generic_site_scraper import GenericSiteScraper
from airflow_home.scrapers.reliefweb_scraper import ReliefWebScraper
from airflow_home.transformers.cleaner import classify_kind, clean_jobs
import api.main as main
from tests.support import TestingSession, client, install_overrides, reset_schema

LONG = " Detailed description of the assignment and what success looks like." * 4


def make_job(db, title, kind="job", **overrides):
    defaults = dict(title=title, company="Acme", location="Nairobi, Kenya", source="manual", kind=kind,
                    description=f"{title}.{LONG}", is_active=True, scraped_at=dt.datetime(2026, 9, 1))
    defaults.update(overrides)
    job = Job(**defaults)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


class ClassifierTests(unittest.TestCase):
    def test_titles(self):
        for title in ["Consultancy - Website Development", "National Consultant - Gender Analysis", "Terms of Reference: Baseline Survey",
                      "Request for Proposals: Audit Services", "Individual Contractor, Data Analysis", "Call for Consultants",
                      "EOI - M&E Specialist", "Tender for ICT Equipment", "Short-term Expert, Public Finance"]:
            self.assertEqual(classify_kind(title), "contract", title)
        # "Consultant" as an ordinary job title stays a job.
        for title in ["Accountant", "Software Engineer", "Monitoring Officer", "Sales Executive (Contract)",
                      "Consultant, Client Services", "Sales Consultant", "Recruitment Consultant", "SAP Consultant"]:
            self.assertEqual(classify_kind(title, "Great job at a growing company."), "job", title)

    def test_description_vocabulary_and_explicit_kind(self):
        self.assertEqual(classify_kind("Baseline Study", "These Terms of Reference describe the scope of work."), "contract")
        self.assertEqual(classify_kind("Driver", "Nice role", current="contract"), "contract")
        self.assertEqual(classify_kind("Driver", None), "job")

    def test_cleaner_applies_classification(self):
        jobs = clean_jobs([
            JobData(title="Consultancy: Gender Audit", source="x", description="x" * 50),
            JobData(title="Nurse", source="x", description="x" * 50),
            JobData(title="Nurse", source="x", description="x" * 50, kind="contract"),
        ])
        self.assertEqual([j.kind for j in jobs], ["contract", "job", "contract"])


class ContractApiTests(unittest.TestCase):
    def setUp(self):
        install_overrides()
        reset_schema()
        self.db = TestingSession()
        self._orig = (main.send_email, main._email_provider_configured, main.settings.ADMIN_SESSION_SECRET)
        self.sent = []
        main.send_email = lambda to, subject, html: self.sent.append((to, subject, html))
        main._email_provider_configured = lambda: True
        if not main.settings.ADMIN_SESSION_SECRET:
            main.settings.ADMIN_SESSION_SECRET = "test-secret"

    def tearDown(self):
        main.send_email, main._email_provider_configured, main.settings.ADMIN_SESSION_SECRET = self._orig
        self.db.close()

    def test_public_listing_separates_jobs_and_contracts(self):
        make_job(self.db, "Software Engineer")
        make_job(self.db, "Consultant - Website Development", kind="contract", company="UN Women",
                 tor_url="https://example.org/tor.pdf", duration="3 months", budget="KES 800,000")

        self.assertEqual([j["title"] for j in client.get("/api/jobs").json()["jobs"]], ["Software Engineer"])
        contracts = client.get("/api/jobs", params={"kind": "contract"}).json()["jobs"]
        self.assertEqual([j["title"] for j in contracts], ["Consultant - Website Development"])
        self.assertEqual((contracts[0]["kind"], contracts[0]["tor_url"], contracts[0]["duration"], contracts[0]["budget"]),
                         ("contract", "https://example.org/tor.pdf", "3 months", "KES 800,000"))
        self.assertEqual(client.get("/api/jobs", params={"kind": "all"}).json()["total"], 2)

        stats = client.get("/api/stats").json()
        self.assertEqual(stats["active_contracts"], 1)
        self.assertEqual([c["name"] for c in client.get("/api/companies").json()["companies"]], ["Acme"])
        self.assertEqual([c["name"] for c in client.get("/api/companies", params={"kind": "contract"}).json()["companies"]], ["UN Women"])

        admin = client.get("/api/admin/jobs", params={"kind": "contract"}).json()
        self.assertEqual(admin["total"], 1)
        self.assertEqual(client.get("/api/admin/jobs").json()["total"], 2)

    def test_admin_and_employer_can_post_contracts(self):
        created = client.post("/api/jobs", json={
            "title": "Baseline Survey Consultant", "company": "Amref", "kind": "contract",
            "description": "Scope of work" + LONG, "tor_url": "https://amref.org/tor.pdf", "duration": "6 weeks", "budget": "USD 12,000",
        })
        self.assertEqual(created.status_code, 200, created.text)
        row = self.db.query(Job).get(created.json()["job_id"])
        self.assertEqual((row.kind, row.duration, row.budget, row.tor_url), ("contract", "6 weeks", "USD 12,000", "https://amref.org/tor.pdf"))

        invite = client.post("/api/admin/employers", json={"company_name": "goCode Softwares", "email": "hr@gocode.co.ke"}).json()
        token = client.post("/api/employer/login", json={"email": invite["email"], "access_code": invite["access_code"]}).json()["token"]
        posted = client.post("/api/employer/jobs", headers={"Authorization": f"Bearer {token}"}, json={
            "title": "Website Development Contract", "kind": "contract", "job_type": "Short-term contract",
            "description": "Build and launch our new website." + LONG, "duration": "2 months", "budget": "KES 400,000",
        })
        self.assertEqual(posted.status_code, 201, posted.text)
        job = posted.json()["job"]
        self.assertEqual((job["kind"], job["company"], job["duration"]), ("contract", "goCode Softwares", "2 months"))
        me = client.get("/api/employer/me", headers={"Authorization": f"Bearer {token}"}).json()
        self.assertEqual(me["jobs"][0]["kind"], "contract")
        self.assertEqual(client.get("/api/jobs", params={"kind": "contract"}).json()["total"], 2)
        self.assertEqual(client.get("/api/jobs").json()["total"], 0)

    def test_reclassify_moves_scraped_consultancies_only(self):
        make_job(self.db, "National Consultant - Baseline Survey", source="linkedin")  # scraped, misfiled as job
        make_job(self.db, "National Consultant - Baseline Survey", source="manual")  # admin chose "job": untouched
        make_job(self.db, "Accountant", source="linkedin")
        res = client.post("/api/admin/jobs/reclassify")
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual((res.json()["scanned"], res.json()["reclassified_as_contract"]), (2, 1))
        self.db.expire_all()
        kinds = {(j.source, j.title): j.kind for j in self.db.query(Job).all()}
        self.assertEqual(kinds[("linkedin", "National Consultant - Baseline Survey")], "contract")
        self.assertEqual(kinds[("manual", "National Consultant - Baseline Survey")], "job")
        self.assertEqual(kinds[("linkedin", "Accountant")], "job")
        # Idempotent.
        self.assertEqual(client.post("/api/admin/jobs/reclassify").json()["reclassified_as_contract"], 0)

    def test_contract_source_marks_everything_it_collects(self):
        self._runner_session = runner.SessionLocal
        runner.SessionLocal = TestingSession
        try:
            created = client.post("/api/admin/sources", json={"name": "UN Women Kenya TORs", "urls": ["https://unwomen.example/tors"], "kind": "contract"})
            self.assertEqual(created.status_code, 201, created.text)
            self.assertEqual(created.json()["kind"], "contract")
            scraper = runner.build_scraper("un_women_kenya_tors")
            self.assertIsInstance(scraper, GenericSiteScraper)
            self.assertEqual(scraper.kind, "contract")

            pages = {
                "https://unwomen.example/tors": '<a href="/tors/gender-audit-2026">Gender audit</a>',
                "https://unwomen.example/tors/gender-audit-2026": "<html><head><title>Gender Audit | UN Women</title></head><body><h1>Gender Audit</h1><main>%s</main></body></html>" % ("Assess the programme. " * 10),
            }
            scraper.fetch_page = lambda url, params=None: BeautifulSoup(pages[url], "lxml") if url in pages else None
            scraper.delay = 0
            jobs = clean_jobs(scraper.scrape())
            self.assertEqual([(j.title, j.kind) for j in jobs], [("Gender Audit", "contract")])
        finally:
            runner.SessionLocal = self._runner_session

    def test_reliefweb_mapping_and_missing_appname(self):
        item = {"id": "4400001", "fields": {
            "title": "Consultant: Endline Evaluation", "body": "<p>Conduct the endline evaluation.</p>",
            "source": [{"name": "UN Women", "shortname": "UNW"}], "country": [{"name": "Kenya"}], "city": [{"name": "Nairobi"}],
            "date": {"created": "2026-09-20T10:00:00+00:00", "closing": "2026-10-05T23:59:59+00:00"},
            "url": "https://reliefweb.int/job/4400001", "type": [{"name": "Consultancy"}],
            "career_categories": [{"name": "Monitoring and Evaluation"}], "theme": [{"name": "Gender"}],
            "experience": [{"name": "5-9 years"}], "how_to_apply": "Send proposals to procurement@example.org",
        }}
        job = ReliefWebScraper().to_job(item)
        self.assertEqual((job.kind, job.company, job.location, job.job_type), ("contract", "UN Women", "Nairobi, Kenya", "Consultancy"))
        self.assertEqual(job.application_deadline, dt.datetime(2026, 10, 5, 23, 59, 59))
        self.assertIn("How to apply: Send proposals", job.description)
        self.assertEqual(job.tags, "Monitoring and Evaluation, Gender")
        self.assertEqual(job.external_id, "4400001")

        original = main.settings.RELIEFWEB_APPNAME
        main.settings.RELIEFWEB_APPNAME = ""
        try:
            with self.assertRaises(RuntimeError) as ctx:
                ReliefWebScraper().scrape()
            self.assertIn("RELIEFWEB_APPNAME", str(ctx.exception))
        finally:
            main.settings.RELIEFWEB_APPNAME = original
        self.assertIn("reliefweb", runner.SCRAPER_REGISTRY)


class AutomaticAlertTests(unittest.TestCase):
    def setUp(self):
        install_overrides()
        reset_schema()
        self.db = TestingSession()
        self.sent = []
        self._orig = (main.send_email, main._email_provider_configured, main.SessionLocal, dict(main._alerts_state))
        main.send_email = lambda to, subject, html: self.sent.append((to, subject, html))
        main._email_provider_configured = lambda: True
        main.SessionLocal = TestingSession

    def tearDown(self):
        main.send_email, main._email_provider_configured, main.SessionLocal, state = self._orig
        with main._alerts_lock:
            main._alerts_state.clear()
            main._alerts_state.update(state)
        self.db.close()

    def test_alerts_match_dedupe_and_count_failures(self):
        python_job = make_job(self.db, "Python Developer", description="Build APIs in Python and SQL." + LONG)
        make_job(self.db, "Accountant")
        make_job(self.db, "Consultant - Data Analysis", kind="contract")
        self.db.add_all([User(email="dev@example.com", name="Dev", source="cv_upload", job_interests="python, sql"),
                         User(email="sub@example.com", source="subscribe")])
        self.db.commit()

        summary = main.notify_users_of_new_jobs()
        self.assertEqual((summary["users"], summary["emailed"], summary["failed"]), (2, 2, 0))
        by_recipient = {to: html for to, _, html in self.sent}
        self.assertIn("Python Developer", by_recipient["dev@example.com"])
        self.assertNotIn("Accountant", by_recipient["dev@example.com"])
        self.assertIn("Accountant", by_recipient["sub@example.com"])  # no interests -> latest listings
        self.assertEqual(self.db.query(UserJobNotification).filter_by(job_id=python_job.id).count(), 2)
        self.db.expire_all()
        self.assertIsNotNone(self.db.query(User).filter_by(email="dev@example.com").one().last_emailed_at)

        # Second run: everyone has seen everything -> nothing sent.
        self.sent.clear()
        summary = main.notify_users_of_new_jobs()
        self.assertEqual((summary["emailed"], summary["jobs_sent"]), (0, 0))
        self.assertEqual(self.sent, [])

        # A new listing appears -> only that one goes out.
        make_job(self.db, "Senior Python Engineer", description="Python leadership role." + LONG)
        summary = main.notify_users_of_new_jobs()
        self.assertEqual(summary["emailed"], 2)
        self.assertNotIn("Accountant", dict((t, h) for t, _, h in self.sent)["sub@example.com"])

    def test_failed_send_is_counted_and_retried_next_time(self):
        make_job(self.db, "Nurse")
        self.db.add(User(email="flaky@example.com", source="subscribe"))
        self.db.commit()

        def failing(to, subject, html):
            raise RuntimeError("SMTP down")
        main.send_email = failing
        summary = main.notify_users_of_new_jobs()
        self.assertEqual((summary["emailed"], summary["failed"]), (0, 1))
        self.assertEqual(self.db.query(UserJobNotification).count(), 0)

        main.send_email = lambda to, subject, html: self.sent.append((to, subject, html))
        summary = main.notify_users_of_new_jobs()
        self.assertEqual(summary["emailed"], 1)

    def test_skips_cleanly_without_email_provider(self):
        main._email_provider_configured = lambda: False
        summary = main.notify_users_of_new_jobs()
        self.assertTrue(summary["skipped"])

    def test_admin_status_and_run_now(self):
        status = client.get("/api/admin/alerts/status").json()
        self.assertEqual(status["hour_utc"], main.settings.JOB_ALERT_HOUR_UTC)
        self.assertFalse(status["running"])
        self.assertTrue(status["email_configured"])

        res = client.post("/api/admin/alerts/run")
        self.assertEqual(res.status_code, 202, res.text)
        deadline = time.time() + 3
        while time.time() < deadline:
            with main._alerts_lock:
                done = not main._alerts_state["running"] and main._alerts_state["last_run_at"] is not None
            if done:
                break
            time.sleep(0.02)
        status = client.get("/api/admin/alerts/status").json()
        self.assertIsNotNone(status["last_run_at"])
        self.assertEqual(status["last_summary"]["users"], 0)

        with main._alerts_lock:
            main._alerts_state["running"] = True
        self.assertEqual(client.post("/api/admin/alerts/run").status_code, 409)
        with main._alerts_lock:
            main._alerts_state["running"] = False


class SubscribeAndRegisterTests(unittest.TestCase):
    def setUp(self):
        install_overrides()
        reset_schema()
        self.db = TestingSession()
        self.queued = []
        self._orig = (main.send_email_background, main.settings.SMTP_PASSWORD)
        main.send_email_background = lambda to, subject, html: self.queued.append((to, subject, html))
        if not main.settings.SMTP_PASSWORD:
            main.settings.SMTP_PASSWORD = "test"

    def tearDown(self):
        main.send_email_background, main.settings.SMTP_PASSWORD = self._orig
        self.db.close()

    def test_subscribe_saves_user_and_sends_welcome(self):
        make_job(self.db, "Data Analyst")
        res = client.post("/api/subscribe", json={"email": "new.reader@example.com"})
        self.assertEqual(res.status_code, 200, res.text)
        user = self.db.query(User).filter_by(email="new.reader@example.com").one()
        self.assertEqual(user.source, "subscribe")
        self.assertEqual(len(self.queued), 1)
        to, subject, html = self.queued[0]
        self.assertEqual(to, "new.reader@example.com")
        self.assertIn("Welcome", subject)
        self.assertIn("Data Analyst", html)

    def test_register_with_interests_sends_targeted_jobs(self):
        make_job(self.db, "Python Developer", description="Python and SQL." + LONG)
        res = client.post("/api/users/register", json={"email": "cv@example.com", "name": "Wanjiru", "job_interests": "python"})
        self.assertEqual(res.status_code, 200, res.text)
        user = self.db.query(User).filter_by(email="cv@example.com").one()
        self.assertEqual((user.source, user.job_interests), ("cv_upload", "python"))
        self.assertIsNotNone(user.last_emailed_at)
        self.assertEqual(len(self.queued), 1)
        self.assertIn("Python Developer", self.queued[0][2])


if __name__ == "__main__":
    unittest.main()

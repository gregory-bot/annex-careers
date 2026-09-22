"""
Employer portal: admin invites a company, the company signs in with email +
access code and can only post jobs for itself. Runs on the shared in-memory
SQLite database; email sending is captured, never sent.

    cd backend && .venv312/bin/python -m unittest tests.test_employer_portal
"""
import datetime as dt
import re
import unittest

import jwt
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from airflow_home.database.models import Job, EmployerInvite, AnalyticsEvent
import api.main as main
from tests.support import TestingSession, client, install_overrides, reset_schema

CODE_RE = re.compile(r"^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$")
INVITE = {"company_name": "Safaricom PLC", "email": "Talent@Safaricom.co.ke", "contact_name": "Amina"}
JOB = {
    "title": "Customer Marketing Lead",
    "company": "Evil Corp",  # must be ignored: employers post as themselves only
    "location": "Nairobi, Kenya",
    "description": "Lead customer marketing campaigns across our consumer segments and channels nationwide.",
    "requirements": "5+ years in marketing\nCIM qualification",
    "job_type": "Full-time",
    "apply_url": "https://safaricom.co.ke/careers/123",
}


class EmployerPortalTests(unittest.TestCase):
    def setUp(self):
        install_overrides()
        reset_schema()
        self.db = TestingSession()
        self.sent = []
        self._orig = (main.send_email, main._email_provider_configured, main.settings.ADMIN_SESSION_SECRET)
        main.send_email = lambda to, subject, html: self.sent.append((to, subject, html))
        main._email_provider_configured = lambda: True
        if not main.settings.ADMIN_SESSION_SECRET:
            main.settings.ADMIN_SESSION_SECRET = "test-secret"

    def tearDown(self):
        main.send_email, main._email_provider_configured, main.settings.ADMIN_SESSION_SECRET = self._orig
        self.db.close()

    # helpers
    def invite(self, **overrides):
        res = client.post("/api/admin/employers", json={**INVITE, **overrides})
        self.assertEqual(res.status_code, 201, res.text)
        return res.json()

    def login(self, email, code):
        return client.post("/api/employer/login", json={"email": email, "access_code": code})

    def auth(self, token):
        return {"Authorization": f"Bearer {token}"}

    # tests
    def test_invite_email_login_and_post_job_flow(self):
        created = self.invite()
        self.assertRegex(created["access_code"], CODE_RE)
        self.assertTrue(created["emailed"])
        self.assertEqual(created["email"], "talent@safaricom.co.ke")
        self.assertIsNone(created["expires_at"])

        to, subject, html = self.sent[0]
        self.assertEqual(to, "talent@safaricom.co.ke")
        self.assertIn("Safaricom PLC", subject)
        self.assertIn(created["access_code"], html)
        self.assertIn(created["portal_url"], html)
        self.assertTrue(created["portal_url"].endswith("/employer"))

        # Only the hash is stored.
        row = self.db.query(EmployerInvite).one()
        self.assertNotIn(created["access_code"].replace("-", ""), row.access_code_hash)
        self.assertEqual(len(row.access_code_hash), 64)

        listing = client.get("/api/admin/employers").json()
        self.assertEqual(listing["employers"][0]["jobs_posted"], 0)
        self.assertNotIn("access_code", listing["employers"][0])

        self.assertEqual(self.login("talent@safaricom.co.ke", "WRONG-CODE-HERE").status_code, 401)
        # Case and dashes don't matter, and email matching ignores case.
        loose = created["access_code"].lower().replace("-", " ")
        res = self.login("TALENT@safaricom.co.ke", loose)
        self.assertEqual(res.status_code, 200, res.text)
        token = res.json()["token"]
        self.assertEqual(res.json()["company_name"], "Safaricom PLC")

        me = client.get("/api/employer/me", headers=self.auth(token)).json()
        self.assertEqual((me["company_name"], me["jobs"]), ("Safaricom PLC", []))

        posted = client.post("/api/employer/jobs", json=JOB, headers=self.auth(token))
        self.assertEqual(posted.status_code, 201, posted.text)
        job = posted.json()["job"]
        self.assertEqual(job["company"], "Safaricom PLC")
        self.assertEqual(job["source"], "employer")
        self.assertTrue(job["is_active"])

        me = client.get("/api/employer/me", headers=self.auth(token)).json()
        self.assertEqual([j["title"] for j in me["jobs"]], ["Customer Marketing Lead"])
        self.assertEqual(client.get("/api/admin/employers").json()["employers"][0]["jobs_posted"], 1)
        # Live on the public site straight away.
        public = client.get("/api/jobs", params={"search": "Customer Marketing"}).json()
        self.assertEqual(public["total"], 1)

        closed = client.post(f"/api/employer/jobs/{job['id']}/close", headers=self.auth(token))
        self.assertEqual(closed.status_code, 200)
        self.db.expire_all()
        self.assertFalse(self.db.query(Job).get(job["id"]).is_active)
        self.assertEqual(client.post("/api/employer/jobs/9999/close", headers=self.auth(token)).status_code, 404)

    def test_stats_repost_and_delete_own_jobs_only(self):
        created = self.invite()
        token = self.login(created["email"], created["access_code"]).json()["token"]
        mine = client.post("/api/employer/jobs", json=JOB, headers=self.auth(token)).json()["job"]
        other = Job(title="Someone else's job", source="manual", description="x" * 40, is_active=True)
        self.db.add(other)
        self.db.commit()
        self.db.add_all([
            AnalyticsEvent(event_type="page_view", job_id=mine["id"]),
            AnalyticsEvent(event_type="page_view", job_id=mine["id"]),
            AnalyticsEvent(event_type="apply_click", job_id=mine["id"]),
            AnalyticsEvent(event_type="apply_click", job_id=other.id),
        ])
        self.db.commit()

        me = client.get("/api/employer/me", headers=self.auth(token)).json()
        self.assertEqual(len(me["jobs"]), 1)
        self.assertEqual((me["jobs"][0]["views"], me["jobs"][0]["apply_clicks"]), (2, 1))
        self.assertEqual(me["jobs"][0]["title"], "Customer Marketing Lead")

        # Close, then repost brings it back and bumps it.
        client.post(f"/api/employer/jobs/{mine['id']}/close", headers=self.auth(token))
        before = dt.datetime.utcnow() - dt.timedelta(seconds=5)
        reposted = client.post(f"/api/employer/jobs/{mine['id']}/repost", headers=self.auth(token))
        self.assertEqual(reposted.status_code, 200, reposted.text)
        self.db.expire_all()
        row = self.db.query(Job).get(mine["id"])
        self.assertTrue(row.is_active)
        self.assertGreater(row.scraped_at, before)

        # Cannot touch jobs that are not theirs.
        self.assertEqual(client.post(f"/api/employer/jobs/{other.id}/repost", headers=self.auth(token)).status_code, 404)
        self.assertEqual(client.delete(f"/api/employer/jobs/{other.id}", headers=self.auth(token)).status_code, 404)

        deleted = client.delete(f"/api/employer/jobs/{mine['id']}", headers=self.auth(token))
        self.assertEqual(deleted.status_code, 200)
        self.db.expire_all()
        self.assertIsNone(self.db.query(Job).get(mine["id"]))
        self.assertIsNotNone(self.db.query(Job).get(other.id))
        # Their analytics rows survive, detached from the deleted job.
        self.assertEqual(self.db.query(AnalyticsEvent).filter(AnalyticsEvent.job_id == None).count(), 3)
        self.assertEqual(client.get("/api/employer/me", headers=self.auth(token)).json()["jobs"], [])

    def test_tokens_are_scoped(self):
        created = self.invite()
        employer_token = self.login(created["email"], created["access_code"]).json()["token"]
        with self.assertRaises(HTTPException) as ctx:
            main.require_admin(HTTPAuthorizationCredentials(scheme="Bearer", credentials=employer_token))
        self.assertEqual(ctx.exception.status_code, 403)

        admin_token = jwt.encode(
            {"sub": "admin", "exp": dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)},
            main.settings.ADMIN_SESSION_SECRET, algorithm="HS256",
        )
        main.require_admin(HTTPAuthorizationCredentials(scheme="Bearer", credentials=admin_token))  # no raise
        self.assertEqual(client.get("/api/employer/me", headers=self.auth(admin_token)).status_code, 403)
        self.assertEqual(client.get("/api/employer/me").status_code, 401)
        self.assertEqual(client.get("/api/employer/me", headers=self.auth("garbage")).status_code, 401)

    def test_revoke_reactivate_and_resend(self):
        created = self.invite()
        first_code = created["access_code"]
        token = self.login(created["email"], first_code).json()["token"]

        revoked = client.patch(f"/api/admin/employers/{created['id']}", json={"status": "revoked"})
        self.assertEqual(revoked.json()["status"], "revoked")
        self.assertEqual(self.login(created["email"], first_code).status_code, 403)
        self.assertEqual(client.get("/api/employer/me", headers=self.auth(token)).status_code, 403)
        self.assertEqual(client.post(f"/api/admin/employers/{created['id']}/resend").status_code, 409)

        client.patch(f"/api/admin/employers/{created['id']}", json={"status": "active"})
        self.assertEqual(self.login(created["email"], first_code).status_code, 200)

        resent = client.post(f"/api/admin/employers/{created['id']}/resend")
        self.assertEqual(resent.status_code, 200, resent.text)
        new_code = resent.json()["access_code"]
        self.assertRegex(new_code, CODE_RE)
        self.assertNotEqual(new_code, first_code)
        self.assertEqual(len(self.sent), 2)
        self.assertIn(new_code, self.sent[1][2])
        self.assertEqual(self.login(created["email"], first_code).status_code, 401)
        self.assertEqual(self.login(created["email"], new_code).status_code, 200)

    def test_duplicate_active_email_rejected_and_delete_keeps_jobs(self):
        created = self.invite()
        self.assertEqual(client.post("/api/admin/employers", json={**INVITE, "company_name": "Other"}).status_code, 409)
        self.assertEqual(client.post("/api/admin/employers", json={**INVITE, "company_name": "  "}).status_code, 400)

        token = self.login(created["email"], created["access_code"]).json()["token"]
        job_id = client.post("/api/employer/jobs", json=JOB, headers=self.auth(token)).json()["job"]["id"]

        deleted = client.delete(f"/api/admin/employers/{created['id']}")
        self.assertEqual(deleted.status_code, 200)
        self.db.expire_all()
        kept = self.db.query(Job).get(job_id)
        self.assertIsNotNone(kept)
        self.assertIsNone(kept.employer_invite_id)
        self.assertEqual(client.get("/api/employer/me", headers=self.auth(token)).status_code, 401)
        # Email is free again once the old invite is gone.
        self.assertEqual(client.post("/api/admin/employers", json=INVITE).status_code, 201)

    def test_expiry(self):
        created = self.invite(expires_in_days=30)
        self.assertIsNotNone(created["expires_at"])
        self.assertEqual(self.login(created["email"], created["access_code"]).status_code, 200)

        row = self.db.query(EmployerInvite).get(created["id"])
        row.expires_at = dt.datetime.utcnow() - dt.timedelta(days=1)
        self.db.commit()
        self.assertEqual(self.login(created["email"], created["access_code"]).status_code, 403)
        self.assertTrue(client.get("/api/admin/employers").json()["employers"][0]["expired"])

        client.patch(f"/api/admin/employers/{created['id']}", json={"expires_in_days": 0})
        self.assertEqual(self.login(created["email"], created["access_code"]).status_code, 200)

    def test_without_email_provider_code_is_still_returned(self):
        main._email_provider_configured = lambda: False
        created = self.invite()
        self.assertFalse(created["emailed"])
        self.assertRegex(created["access_code"], CODE_RE)
        self.assertEqual(self.sent, [])
        self.assertFalse(client.get("/api/admin/employers").json()["email_configured"])

    def test_provider_failure_is_reported_not_hidden(self):
        def failing_send(to, subject, html):
            raise RuntimeError("(535, 'Username and Password not accepted')")
        main.send_email = failing_send

        created = self.invite()
        self.assertFalse(created["emailed"])
        self.assertIn("Username and Password not accepted", created["email_error"])
        self.assertRegex(created["access_code"], CODE_RE)  # admin can still pass the code on
        self.assertIsNone(created["email_sent_at"])
        listing = client.get("/api/admin/employers").json()["employers"][0]
        self.assertIsNone(listing["email_sent_at"])

        resent = client.post(f"/api/admin/employers/{created['id']}/resend").json()
        self.assertFalse(resent["emailed"])
        self.assertIn("535", resent["email_error"])

    def test_send_email_false_skips_email(self):
        created = self.invite(send_email=False)
        self.assertFalse(created["emailed"])
        self.assertEqual(self.sent, [])


if __name__ == "__main__":
    unittest.main()

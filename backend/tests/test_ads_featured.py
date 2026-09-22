"""
Direct monetisation: featured (pinned) listings and admin-managed banner ads.

    cd backend && .venv312/bin/python -m unittest tests.test_ads_featured
"""
import datetime as dt
import unittest

from airflow_home.database.models import Job, Ad, Attachment
import api.main as main
from tests.support import TestingSession, client, install_overrides, reset_schema

PNG_1X1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0300050001"
    "0a2db4b60000000049454e44ae426082"
)
LONG = " A long enough description for the public listing filter." * 3


def make_job(db, title, scraped_days_ago, **overrides):
    defaults = dict(title=title, company="Acme", location="Nairobi, Kenya", source="manual", kind="job",
                    description=title + LONG, is_active=True,
                    scraped_at=dt.datetime.utcnow() - dt.timedelta(days=scraped_days_ago))
    defaults.update(overrides)
    job = Job(**defaults)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


class FeaturedJobsTests(unittest.TestCase):
    def setUp(self):
        install_overrides()
        reset_schema()
        self.db = TestingSession()

    def tearDown(self):
        self.db.close()

    def test_feature_pins_old_listing_to_the_top(self):
        old = make_job(self.db, "Old but paid", 20)
        make_job(self.db, "Newest role", 0)
        make_job(self.db, "Middle role", 5)

        self.assertEqual([j["title"] for j in client.get("/api/jobs").json()["jobs"]], ["Newest role", "Middle role", "Old but paid"])

        res = client.post(f"/api/admin/jobs/{old.id}/feature", json={"days": 7})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertTrue(res.json()["job"]["is_featured"])
        self.assertIn("Featured until", res.json()["message"])

        titles = [j["title"] for j in client.get("/api/jobs").json()["jobs"]]
        self.assertEqual(titles[0], "Old but paid")
        self.assertEqual(titles[1:], ["Newest role", "Middle role"])
        first = client.get("/api/jobs").json()["jobs"][0]
        self.assertTrue(first["is_featured"])
        self.assertIsNotNone(first["featured_until"])
        # Also first when sorting by salary, and filterable.
        self.assertEqual(client.get("/api/jobs", params={"sort_by": "salary_min"}).json()["jobs"][0]["title"], "Old but paid")
        self.assertEqual([j["title"] for j in client.get("/api/jobs", params={"featured": "true"}).json()["jobs"]], ["Old but paid"])
        self.assertEqual(client.get("/api/admin/jobs", params={"featured": "true"}).json()["total"], 1)

        # Featuring again extends from the current end, not from today.
        self.db.expire_all()
        first_until = self.db.query(Job).get(old.id).featured_until
        client.post(f"/api/admin/jobs/{old.id}/feature", json={"days": 7})
        self.db.expire_all()
        self.assertEqual((self.db.query(Job).get(old.id).featured_until - first_until).days, 7)

        self.assertEqual(client.delete(f"/api/admin/jobs/{old.id}/feature").status_code, 200)
        self.assertEqual([j["title"] for j in client.get("/api/jobs").json()["jobs"]], ["Newest role", "Middle role", "Old but paid"])

    def test_expired_feature_is_not_featured(self):
        make_job(self.db, "Was featured", 1, featured_until=dt.datetime.utcnow() - dt.timedelta(days=1))
        make_job(self.db, "Newer role", 0)
        listed = client.get("/api/jobs").json()["jobs"]
        self.assertEqual(listed[0]["title"], "Newer role")
        self.assertFalse(listed[1]["is_featured"])
        self.assertEqual(client.get("/api/jobs", params={"featured": "true"}).json()["total"], 0)

    def test_validation(self):
        job = make_job(self.db, "Some role", 0)
        self.assertEqual(client.post(f"/api/admin/jobs/{job.id}/feature", json={"days": 0}).status_code, 400)
        self.assertEqual(client.post(f"/api/admin/jobs/{job.id}/feature", json={"days": 400}).status_code, 400)
        self.assertEqual(client.post("/api/admin/jobs/999/feature", json={"days": 7}).status_code, 404)


class AdsTests(unittest.TestCase):
    def setUp(self):
        install_overrides()
        reset_schema()
        self.db = TestingSession()
        main.app.dependency_overrides[main.require_uploader] = lambda: "admin"
        self._orig_extract = main.extract_attachment_text

    def tearDown(self):
        main.app.dependency_overrides.pop(main.require_uploader, None)
        main.extract_attachment_text = self._orig_extract
        self.db.close()

    def upload_creative(self):
        def must_not_run(*args):
            raise AssertionError("extraction must be skipped for banner creatives")
        main.extract_attachment_text = must_not_run
        res = client.post("/api/uploads?extract=false", files={"file": ("banner.png", PNG_1X1, "image/png")})
        self.assertEqual(res.status_code, 201, res.text)
        self.assertFalse(res.json()["read"])
        return res.json()["id"]

    def valid(self, **overrides):
        body = {"name": "Safaricom Sept", "advertiser": "Safaricom PLC", "placement": "jobs_list",
                "link_url": "https://safaricom.co.ke/careers", "headline": "Join Safaricom", "weight": 3}
        body.update(overrides)
        return body

    def test_create_serve_count_update_delete(self):
        creative = self.upload_creative()
        created = client.post("/api/admin/ads", json=self.valid(image_attachment_id=creative))
        self.assertEqual(created.status_code, 201, created.text)
        ad = created.json()
        self.assertEqual((ad["status"], ad["image"], ad["impressions"], ad["ctr"]), ("active", f"/api/files/{creative}", 0, 0.0))

        served = client.get("/api/ads", params={"placement": "jobs_list"})
        self.assertEqual(served.status_code, 200)
        self.assertIn("max-age=60", served.headers["cache-control"])
        self.assertEqual([a["id"] for a in served.json()["ads"]], [ad["id"]])
        self.assertEqual(served.json()["ads"][0]["image"], f"/api/files/{creative}")
        self.assertEqual(client.get("/api/ads", params={"placement": "home"}).json()["ads"], [])
        self.assertEqual(client.get("/api/ads", params={"placement": "nowhere"}).status_code, 422)

        for _ in range(4):
            self.assertEqual(client.post(f"/api/ads/{ad['id']}/impression").status_code, 204)
        self.assertEqual(client.post(f"/api/ads/{ad['id']}/click").status_code, 204)
        listed = client.get("/api/admin/ads").json()
        self.assertEqual((listed["ads"][0]["impressions"], listed["ads"][0]["clicks"], listed["ads"][0]["ctr"]), (4, 1, 25.0))
        self.assertIn("jobs_list", listed["placements"])

        # Pause it: no longer served, still listed for the admin.
        paused = client.put(f"/api/admin/ads/{ad['id']}", json=self.valid(image_attachment_id=creative, is_active=False))
        self.assertEqual(paused.json()["status"], "paused")
        self.assertEqual(client.get("/api/ads", params={"placement": "jobs_list"}).json()["ads"], [])

        # Delete removes the creative too.
        self.assertEqual(client.delete(f"/api/admin/ads/{ad['id']}").status_code, 200)
        self.assertEqual(client.get(f"/api/files/{creative}").status_code, 404)
        self.assertEqual(client.delete(f"/api/admin/ads/{ad['id']}").status_code, 404)

    def test_schedule_and_weight_ordering(self):
        today = dt.date.today()
        client.post("/api/admin/ads", json=self.valid(name="Future", image_url="https://cdn.example/a.png", starts_at=(today + dt.timedelta(days=3)).isoformat()))
        client.post("/api/admin/ads", json=self.valid(name="Past", image_url="https://cdn.example/b.png", ends_at=(today - dt.timedelta(days=1)).isoformat()))
        client.post("/api/admin/ads", json=self.valid(name="Light", image_url="https://cdn.example/c.png", weight=1))
        client.post("/api/admin/ads", json=self.valid(name="Heavy", image_url="https://cdn.example/d.png", weight=9, ends_at=today.isoformat()))  # ends tonight, still live

        live = client.get("/api/ads", params={"placement": "jobs_list"}).json()["ads"]
        self.assertEqual([a["headline"] for a in live], ["Join Safaricom", "Join Safaricom"])
        self.assertEqual([a["weight"] for a in live], [9, 1])
        statuses = {a["name"]: a["status"] for a in client.get("/api/admin/ads").json()["ads"]}
        self.assertEqual(statuses, {"Future": "scheduled", "Past": "expired", "Light": "active", "Heavy": "active"})

    def test_validation(self):
        self.assertEqual(client.post("/api/admin/ads", json=self.valid()).status_code, 400)  # no image at all
        self.assertEqual(client.post("/api/admin/ads", json=self.valid(image_url="ftp://x")).status_code, 400)
        self.assertEqual(client.post("/api/admin/ads", json=self.valid(image_url="https://cdn.example/a.png", link_url="safaricom.co.ke")).status_code, 400)
        self.assertEqual(client.post("/api/admin/ads", json=self.valid(image_url="https://cdn.example/a.png", placement="footer")).status_code, 422)
        self.assertEqual(client.post("/api/admin/ads", json=self.valid(image_url="https://cdn.example/a.png", weight=50)).status_code, 400)
        self.assertEqual(client.post("/api/admin/ads", json=self.valid(image_url="https://cdn.example/a.png", starts_at="2026-10-10", ends_at="2026-10-01")).status_code, 400)
        self.assertEqual(client.post("/api/admin/ads", json=self.valid(image_attachment_id=999)).status_code, 400)

    def test_orphan_purge_keeps_ad_creatives(self):
        creative = self.upload_creative()
        client.post("/api/admin/ads", json=self.valid(image_attachment_id=creative))
        main.extract_attachment_text = lambda *a: ("", "image")
        stray = client.post("/api/uploads", files={"file": ("stray.png", PNG_1X1, "image/png")}).json()["id"]
        old = dt.datetime.utcnow() - dt.timedelta(days=2)
        self.db.query(Attachment).filter(Attachment.id.in_([creative, stray])).update({"created_at": old}, synchronize_session=False)
        self.db.commit()
        orig = main.SessionLocal
        main.SessionLocal = TestingSession
        try:
            self.assertEqual(main._purge_orphan_attachments(), 1)
        finally:
            main.SessionLocal = orig
        self.db.expire_all()
        self.assertIsNotNone(self.db.query(Attachment).get(creative))
        self.assertIsNone(self.db.query(Attachment).get(stray))


if __name__ == "__main__":
    unittest.main()

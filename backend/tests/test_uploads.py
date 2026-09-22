"""
Listing attachments: upload (with text extraction and field suggestions),
serving, linking to listings, poster in share previews, and cleanup.
Image OCR is stubbed here; tests/test_ocr_engine.py exercises the real engine.

    cd backend && .venv312/bin/python -m unittest tests.test_uploads
"""
import datetime as dt
import io
import unittest

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from airflow_home.database.models import Attachment
import api.main as main
from api.listing_extract import parse_listing_text
from tests.support import TestingSession, client, install_overrides, reset_schema

POSTER_TEXT = """KENYATTA UNIVERSITY TEACHING, REFERRAL
& RESEARCH HOSPITAL (KUTRRH)
WE ARE HIRING
Available Positions
1. Credit Control Officers
2. Waiter
3. Laundry Porter
Deadline: 7th July 2023
For application please visit:
https://kutrrh.go.ke/careers/
Enquiries: 1558 or +254 800 721 038 P.O Box 7674 - 00100 Nairobi, Kenya"""

PNG_1X1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0300050001"
    "0a2db4b60000000049454e44ae426082"
)


def make_pdf(text_lines) -> bytes:
    buf = io.BytesIO()
    pdf = canvas.Canvas(buf, pagesize=A4)
    y = 800
    for line in text_lines:
        pdf.drawString(60, y, line)
        y -= 22
    pdf.save()
    return buf.getvalue()


class ParseListingTextTests(unittest.TestCase):
    def test_multi_position_poster(self):
        fields = parse_listing_text(POSTER_TEXT)
        self.assertEqual(fields["company"], "Kenyatta University Teaching, Referral & Research Hospital (KUTRRH)")
        self.assertEqual(fields["title"], "3 Open Positions at Kenyatta University Teaching, Referral & Research Hospital (KUTRRH)")
        self.assertEqual(fields["positions"], ["Credit Control Officers", "Waiter", "Laundry Porter"])
        self.assertEqual(fields["application_deadline"], "2023-07-07")
        self.assertEqual(fields["apply_url"], "https://kutrrh.go.ke/careers/")
        self.assertEqual(fields["location"], "Nairobi, Kenya")
        self.assertEqual(fields["kind"], "job")
        self.assertIn("Credit Control Officers", fields["description"])

    def test_single_role_poster_and_internship(self):
        fields = parse_listing_text("WE'RE HIRING!\nUniversity Research Director\nJeppiaar Engineering College\nApply: hr@jeppiaar.edu")
        self.assertEqual(fields["title"], "University Research Director")
        self.assertEqual(fields["company"], "Jeppiaar Engineering College")
        fields = parse_listing_text("Safaricom PLC\nGraduate Internship Programme 2026\nClosing date: 30 September 2026\nwww.safaricom.co.ke/careers")
        self.assertEqual(fields["job_type"], "Internship")
        self.assertEqual(fields["application_deadline"], "2026-09-30")
        self.assertEqual(fields["apply_url"], "https://www.safaricom.co.ke/careers")

    def test_tor_document_is_a_contract(self):
        fields = parse_listing_text("UN Women Kenya\nTerms of Reference\nNational Consultant - Gender Audit\nDuration: 3 months\nDeadline: 15/10/2026")
        self.assertEqual(fields["kind"], "contract")
        self.assertEqual(fields["job_type"], "Consultancy")
        self.assertEqual(fields["title"], "National Consultant - Gender Audit")
        self.assertEqual(fields["application_deadline"], "2026-10-15")

    def test_empty(self):
        self.assertEqual(parse_listing_text(""), {})


class UploadApiTests(unittest.TestCase):
    def setUp(self):
        install_overrides()
        reset_schema()
        self.db = TestingSession()
        self._orig_extract = main.extract_attachment_text
        self._orig_secret = main.settings.ADMIN_SESSION_SECRET
        if not main.settings.ADMIN_SESSION_SECRET:
            main.settings.ADMIN_SESSION_SECRET = "test-secret"
        main.app.dependency_overrides[main.require_uploader] = lambda: "admin"

    def tearDown(self):
        main.extract_attachment_text = self._orig_extract
        main.settings.ADMIN_SESSION_SECRET = self._orig_secret
        main.app.dependency_overrides.pop(main.require_uploader, None)
        self.db.close()

    def upload(self, name, content, content_type):
        return client.post("/api/uploads", files={"file": (name, content, content_type)})

    def test_poster_upload_reads_text_and_suggests_fields(self):
        main.extract_attachment_text = lambda filename, ctype, content: (POSTER_TEXT, "image")
        res = self.upload("poster.png", PNG_1X1, "image/png")
        self.assertEqual(res.status_code, 201, res.text)
        body = res.json()
        self.assertEqual((body["kind"], body["read"], body["content_type"]), ("image", True, "image/png"))
        self.assertEqual(body["url"], f"/api/files/{body['id']}")
        self.assertEqual(body["suggested"]["application_deadline"], "2023-07-07")
        self.assertEqual(body["suggested"]["apply_url"], "https://kutrrh.go.ke/careers/")
        self.assertIn("KUTRRH", body["suggested"]["company"])

        served = client.get(body["url"])
        self.assertEqual(served.status_code, 200)
        self.assertEqual(served.content, PNG_1X1)
        self.assertEqual(served.headers["content-type"], "image/png")
        self.assertTrue(served.headers["content-disposition"].startswith("inline"))
        self.assertIn("immutable", served.headers["cache-control"])
        self.assertTrue(client.get(f"{body['url']}?download=1").headers["content-disposition"].startswith("attachment"))
        self.assertEqual(client.get("/api/files/999").status_code, 404)

    def test_pdf_upload_uses_document_extractor(self):
        pdf = make_pdf(["UN Women Kenya", "Terms of Reference", "National Consultant - Gender Audit",
                        "The consultant will conduct a gender audit of the programme portfolio.", "Deadline: 15 October 2026"])
        res = self.upload("tor.pdf", pdf, "application/pdf")
        self.assertEqual(res.status_code, 201, res.text)
        body = res.json()
        self.assertEqual(body["kind"], "document")
        self.assertTrue(body["read"])
        self.assertIn("Terms of Reference", body["extracted_text"])
        self.assertEqual(body["suggested"]["kind"], "contract")
        self.assertEqual(body["suggested"]["application_deadline"], "2026-10-15")

    def test_rejections(self):
        self.assertEqual(self.upload("virus.exe", b"MZ....", "application/octet-stream").status_code, 400)
        self.assertEqual(self.upload("empty.png", b"", "image/png").status_code, 400)
        main.extract_attachment_text = lambda *a: ("", "image")
        self.assertEqual(self.upload("huge.png", b"x" * (main.MAX_ATTACHMENT_BYTES + 1), "image/png").status_code, 413)
        main.app.dependency_overrides.pop(main.require_uploader, None)
        self.assertEqual(self.upload("poster.png", PNG_1X1, "image/png").status_code, 401)
        self.assertEqual(client.post("/api/uploads", files={"file": ("p.png", PNG_1X1, "image/png")},
                                     headers={"Authorization": "Bearer nonsense"}).status_code, 401)

    def test_attachments_link_to_listing_and_die_with_it(self):
        main.extract_attachment_text = lambda filename, ctype, content: ("", "image") if ctype.startswith("image/") else ("Terms of reference text " * 5, "document")
        image_id = self.upload("poster.png", PNG_1X1, "image/png").json()["id"]
        doc_id = self.upload("tor.pdf", make_pdf(["TOR"]), "application/pdf").json()["id"]
        stray_id = self.upload("other.png", PNG_1X1, "image/png").json()["id"]

        created = client.post("/api/jobs", json={
            "title": "Gender Audit Consultancy", "company": "UN Women", "kind": "contract",
            "description": "Scope of work for the gender audit consultancy." * 3,
            "attachment_ids": [image_id, doc_id],
        })
        self.assertEqual(created.status_code, 200, created.text)
        self.assertEqual(created.json()["attachments"], 2)
        job_id = created.json()["job_id"]

        job = client.get(f"/api/jobs/{job_id}").json()
        self.assertEqual([a["kind"] for a in job["attachments"]], ["image", "document"])
        self.assertEqual(job["attachments"][0]["url"], f"/api/files/{image_id}")
        self.assertEqual(job["tor_url"], f"http://testserver/api/files/{doc_id}")  # first document became the TOR
        self.db.expire_all()
        self.assertIsNone(self.db.query(Attachment).get(stray_id).job_id)

        # The listing's poster is the share-preview image.
        share = client.get(f"/share/jobs/{job_id}").text
        self.assertIn(f'property="og:image" content="http://testserver/api/files/{image_id}"', share)
        self.assertNotIn("og:image:width", share)

        # Public listing carries attachments too.
        listed = client.get("/api/jobs", params={"kind": "contract"}).json()["jobs"][0]
        self.assertEqual(len(listed["attachments"]), 2)

        client.delete(f"/api/admin/jobs/{job_id}")
        self.assertEqual(client.get(f"/api/files/{image_id}").status_code, 404)
        self.assertEqual(client.get(f"/api/files/{doc_id}").status_code, 404)
        self.assertEqual(client.get(f"/api/files/{stray_id}").status_code, 200)

    def test_employer_cannot_use_someone_elses_upload(self):
        main.extract_attachment_text = lambda *a: ("", "image")
        admin_upload_id = self.upload("poster.png", PNG_1X1, "image/png").json()["id"]

        orig_send, orig_conf = main.send_email, main._email_provider_configured
        main.send_email = lambda *a: None
        main._email_provider_configured = lambda: False
        try:
            invite = client.post("/api/admin/employers", json={"company_name": "goCode", "email": "hr@gocode.co.ke"}).json()
            token = client.post("/api/employer/login", json={"email": invite["email"], "access_code": invite["access_code"]}).json()["token"]
        finally:
            main.send_email, main._email_provider_configured = orig_send, orig_conf

        main.app.dependency_overrides[main.require_uploader] = lambda: f"employer:{invite['id']}"
        own_id = self.upload("mine.png", PNG_1X1, "image/png").json()["id"]

        posted = client.post("/api/employer/jobs", headers={"Authorization": f"Bearer {token}"}, json={
            "title": "Data Scientist", "description": "Great role for a data scientist in Nairobi." * 3,
            "attachment_ids": [admin_upload_id, own_id],
        })
        self.assertEqual(posted.status_code, 201, posted.text)
        self.assertEqual([a["id"] for a in posted.json()["job"]["attachments"]], [own_id])
        self.db.expire_all()
        self.assertIsNone(self.db.query(Attachment).get(admin_upload_id).job_id)

    def test_orphan_uploads_are_purged_after_a_day(self):
        main.extract_attachment_text = lambda *a: ("", "image")
        old_id = self.upload("old.png", PNG_1X1, "image/png").json()["id"]
        fresh_id = self.upload("fresh.png", PNG_1X1, "image/png").json()["id"]
        linked_id = self.upload("linked.png", PNG_1X1, "image/png").json()["id"]
        job_id = client.post("/api/jobs", json={"title": "Nurse", "description": "Nursing role." * 5, "attachment_ids": [linked_id]}).json()["job_id"]
        old_time = dt.datetime.utcnow() - dt.timedelta(days=2)
        for aid in (old_id, linked_id):
            self.db.query(Attachment).filter(Attachment.id == aid).update({"created_at": old_time})
        self.db.commit()

        orig = main.SessionLocal
        main.SessionLocal = TestingSession
        try:
            self.assertEqual(main._purge_orphan_attachments(), 1)
        finally:
            main.SessionLocal = orig
        self.db.expire_all()
        self.assertIsNone(self.db.query(Attachment).get(old_id))
        self.assertIsNotNone(self.db.query(Attachment).get(fresh_id))
        self.assertEqual(self.db.query(Attachment).get(linked_id).job_id, job_id)


if __name__ == "__main__":
    unittest.main()

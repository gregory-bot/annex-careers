"""
Link-preview page for shared jobs (/share/jobs/{id}): crawlers must see the
job's own Open Graph tags, humans must be bounced to the real page.

    cd backend && .venv312/bin/python -m unittest tests.test_share_page
"""
import datetime as dt
import json
import re
import unittest

from airflow_home.database.models import Job
import api.main as main
from tests.support import TestingSession, client, install_overrides, reset_schema


class SharePageTests(unittest.TestCase):
    def setUp(self):
        install_overrides()
        reset_schema()
        self.db = TestingSession()

    def tearDown(self):
        self.db.close()

    def make_job(self, **overrides):
        defaults = dict(
            title="Data Scientist", company="goCode Softwares", location="Juja Kenya", job_type="Full-time",
            description="<p>Act as a technical authority for the enterprise data engineering function, "
                        "providing expert guidance on architecture &amp; governance.</p>" + " More text." * 40,
            source="employer", is_active=True, posted_date=dt.datetime(2026, 9, 22),
            application_deadline=dt.datetime(2026, 9, 23, 23, 59), salary_min=150000, salary_max=250000,
            salary_currency="KES",
        )
        defaults.update(overrides)
        job = Job(**defaults)
        self.db.add(job)
        self.db.commit()
        self.db.refresh(job)
        return job

    def test_job_share_page_carries_the_jobs_own_tags(self):
        job = self.make_job()
        res = client.get(f"/share/jobs/{job.id}")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.headers["content-type"].startswith("text/html"))
        self.assertIn("max-age=600", res.headers["cache-control"])
        html = res.text
        site = main.SITE_URL.rstrip("/")

        self.assertIn("<title>Data Scientist at goCode Softwares | Annex Careers</title>", html)
        self.assertIn('property="og:title" content="Data Scientist at goCode Softwares"', html)
        self.assertIn(f'property="og:url" content="{site}/jobs/{job.id}"', html)
        self.assertIn(f'property="og:image" content="{site}/og-image.jpg"', html)
        self.assertIn('name="twitter:card" content="summary_large_image"', html)
        # Description: context line, then the HTML-stripped text, truncated.
        desc = re.search(r'property="og:description" content="([^"]*)"', html).group(1)
        self.assertTrue(desc.startswith("Juja Kenya \u00b7 Full-time \u00b7 Deadline 23 Sep 2026. Act as a technical authority"), desc)
        self.assertNotIn("<p>", desc)
        self.assertIn("architecture &amp; governance", html)  # "&amp;" in the source is unescaped, then escaped once
        self.assertNotIn("&amp;amp;", html)
        self.assertLessEqual(len(desc), main.SHARE_DESCRIPTION_CHARS + 10)
        self.assertTrue(desc.endswith("\u2026"))
        # Humans get sent to the real page.
        self.assertIn(f'http-equiv="refresh" content="0; url={site}/jobs/{job.id}"', html)
        self.assertIn(f'<link rel="canonical" href="{site}/jobs/{job.id}">', html)

        jsonld = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S).group(1))
        self.assertEqual(jsonld["@type"], "JobPosting")
        self.assertEqual(jsonld["hiringOrganization"]["name"], "goCode Softwares")
        self.assertEqual(jsonld["datePosted"], "2026-09-22")
        self.assertEqual(jsonld["employmentType"], "FULL_TIME")
        self.assertEqual(jsonld["jobLocation"]["address"]["addressCountry"], "KE")
        self.assertEqual(jsonld["baseSalary"]["value"]["maxValue"], 250000)
        self.assertNotIn("<p>", jsonld["description"])

    def test_html_in_job_fields_is_escaped(self):
        job = self.make_job(title='Dev <script>alert("x")</script>', company='A&B "Ltd"', description="Safe description text here that is long enough.")
        html = client.get(f"/share/jobs/{job.id}").text
        self.assertNotIn("<script>alert", html)
        self.assertIn("Dev &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; at A&amp;B &quot;Ltd&quot;", html)
        jsonld_block = html.split('application/ld+json">')[1].split("</script>")[0]
        self.assertNotIn("<", jsonld_block)  # every "<" is \u003c-escaped
        self.assertEqual(json.loads(jsonld_block)["title"], 'Dev <script>alert("x")</script>')

    def test_missing_job_falls_back_to_site_card_with_404(self):
        res = client.get("/share/jobs/999999")
        self.assertEqual(res.status_code, 404)
        self.assertIn('property="og:title" content="Annex Careers"', res.text)
        self.assertIn("/og-image.jpg", res.text)

    def test_job_without_company_or_description(self):
        job = self.make_job(company=None, description=None, application_deadline=None, location=None, job_type=None)
        html = client.get(f"/share/jobs/{job.id}").text
        self.assertIn('property="og:title" content="Data Scientist"', html)
        self.assertIn("View the full job details and apply directly on Annex Careers.", html)


if __name__ == "__main__":
    unittest.main()

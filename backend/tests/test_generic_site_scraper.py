"""
Offline tests for the generic site scraper: link discovery, JSON-LD and
HTML parsing, and an end-to-end scrape against canned pages (no network).

    cd backend && .venv312/bin/python -m unittest tests.test_generic_site_scraper
"""
import datetime as dt
import unittest

from bs4 import BeautifulSoup

from airflow_home.scrapers.generic_site_scraper import (
    GenericSiteScraper, extract_job_links, parse_job_page, job_from_jsonld,
    parse_iso_date, find_jobpostings,
)

LISTING = "https://jobs.example.co.ke/jobs"

LISTING_HTML = """
<html><head><title>Jobs in Kenya | Example Board</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"ItemList","itemListElement":[
  {"@type":"ListItem","position":1,"item":{"@type":"JobPosting","title":"Inline Data Analyst",
     "hiringOrganization":{"@type":"Organization","name":"Inline Corp"},
     "jobLocation":{"@type":"Place","address":{"addressLocality":"Nairobi","addressCountry":"KE"}},
     "datePosted":"2026-09-20","url":"https://jobs.example.co.ke/job/inline-analyst-77",
     "description":"Analyse data all day long, build dashboards and reports for the executive team every week."}}
]}
</script></head>
<body>
<nav><a href="/jobs">All jobs</a><a href="/jobs?page=2">Next</a><a href="/about">About</a></nav>
<ul class="listing">
  <li class="job-card"><a href="/job/software-engineer-101">Software Engineer</a></li>
  <li class="job-card"><a href="https://jobs.example.co.ke/job/accountant-102/#apply">Accountant</a></li>
  <li class="job-card"><a href="/job/software-engineer-101">Software Engineer (dup)</a></li>
  <li><a href="mailto:hr@example.co.ke">Email us</a></li>
  <li><a href="https://other-site.com/job/999">Off-site job</a></li>
  <li><a href="/it-jobs-in-nairobi">IT jobs in Nairobi</a></li>
</ul>
</body></html>
"""

JOB_JSONLD_HTML = """
<html><head><title>Software Engineer - Example Board</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"JobPosting","title":"Software Engineer",
 "hiringOrganization":{"@type":"Organization","name":"Acme Ltd"},
 "jobLocation":[{"@type":"Place","address":{"addressLocality":"Nairobi","addressRegion":"Nairobi County","addressCountry":"Kenya"}}],
 "employmentType":["FULL_TIME"],
 "datePosted":"2026-09-19T08:30:00Z","validThrough":"2026-10-19T23:59:00+03:00",
 "baseSalary":{"@type":"MonetaryAmount","currency":"KES","value":{"@type":"QuantitativeValue","minValue":150000,"maxValue":250000,"unitText":"MONTH"}},
 "identifier":{"@type":"PropertyValue","name":"ref","value":"SE-101"},
 "description":"<p>Build and ship backend services in Python.</p><p>You will own the API layer and mentor juniors.</p>"}
</script></head><body><h1>ignored</h1></body></html>
"""

JOB_PLAIN_HTML = """
<html><head><title>Accountant | Example Board</title>
<meta property="og:title" content="Accountant - Example Board">
<meta property="article:published_time" content="2026-09-18T10:00:00+03:00"></head>
<body><header><nav>Home | Jobs | Contact</nav></header>
<main><h1>Accountant</h1>
<div class="job-description">We are hiring an Accountant to join our Mombasa office. You will prepare monthly management
accounts, reconcile bank statements, and support the annual audit. CPA(K) required, 3+ years experience.</div>
</main><footer>Copyright Example Board. Terms. Privacy.</footer></body></html>
"""

CATEGORY_HTML = """
<html><head><title>IT Jobs in Nairobi | Example Board</title></head>
<body><h1>IT Jobs in Nairobi</h1><main>Browse the latest information technology jobs in Nairobi, updated daily with
hundreds of listings from top employers across Kenya and the region.</main></body></html>
"""


def soup(html):
    return BeautifulSoup(html, "lxml")


class LinkExtractionTests(unittest.TestCase):
    def test_heuristic_mode_keeps_same_site_posting_links_only(self):
        links = extract_job_links(soup(LISTING_HTML), LISTING)
        self.assertEqual(links, [
            "https://jobs.example.co.ke/job/software-engineer-101",
            "https://jobs.example.co.ke/job/accountant-102/",
        ])

    def test_heuristic_mode_drops_taxonomy_pages_and_orders_postings_first(self):
        html = """
        <a href="/job-tag/finance">Finance</a>
        <a href="/job-category/it-jobs-in-kenya">IT</a>
        <a href="/jobs-by-field">By field</a>
        <a href="/jobs-at/safaricom">Safaricom jobs</a>
        <a href="/jobs">All jobs</a>
        <a href="/feed/?post_type=job_listing">RSS</a>
        <a href="/jobs/intern-membership-kenya-association-manufacturers/">Intern</a>
        <a href="/listings/data-analyst-nairobi-8f2a91">Data Analyst</a>
        <div class="job-card"><a href="/job/driver">Driver</a></div>
        <a href="https://careers.jobwebkenya.com/jobs/nurse-4412">Nurse (subdomain)</a>
        <a href="https://other.example.org/jobs/nurse-1">Nurse (other site)</a>
        """
        links = extract_job_links(soup(html), "https://jobwebkenya.com/")
        self.assertEqual(set(links), {
            "https://jobwebkenya.com/jobs/intern-membership-kenya-association-manufacturers/",
            "https://jobwebkenya.com/listings/data-analyst-nairobi-8f2a91",
            "https://jobwebkenya.com/job/driver",
            "https://careers.jobwebkenya.com/jobs/nurse-4412",
        })
        # Id-bearing, multi-word URLs come before the bare one-word slug.
        self.assertEqual(links[-1], "https://jobwebkenya.com/job/driver")

    def test_contract_vocabulary_in_paths(self):
        html = """
        <a href="/tors/gender-audit-2026">TOR</a>
        <a href="/tenders/ict-equipment-2026">Tender</a>
        <a href="/procurement/rfp-website-redesign">RFP</a>
        <a href="/directory/">Directory</a>
        <a href="/monitoring-tools">Monitoring tools</a>
        """
        links = extract_job_links(soup(html), "https://unwomen.example/opportunities")
        self.assertEqual(set(links), {
            "https://unwomen.example/tors/gender-audit-2026",
            "https://unwomen.example/tenders/ict-equipment-2026",
            "https://unwomen.example/procurement/rfp-website-redesign",
        })

    def test_registrable_domain_matching(self):
        html = '<a href="https://job-boards.greenhouse.io/acme/jobs/4412">Engineer</a>'
        links = extract_job_links(soup(html), "https://boards.greenhouse.io/acme")
        self.assertEqual(links, ["https://job-boards.greenhouse.io/acme/jobs/4412"])

    def test_pattern_mode_filters_by_regex_and_allows_off_site(self):
        links = extract_job_links(soup(LISTING_HTML), LISTING, link_pattern=r"/job/\d+$|/job/[a-z-]+-\d+")
        self.assertIn("https://other-site.com/job/999", links)
        self.assertNotIn("https://jobs.example.co.ke/it-jobs-in-nairobi", links)

    def test_selector_mode_uses_only_matching_nodes(self):
        links = extract_job_links(soup(LISTING_HTML), LISTING, link_selector="li.job-card")
        self.assertEqual(len(links), 2)
        self.assertTrue(all("/job/" in link for link in links))


class ParsingTests(unittest.TestCase):
    def test_jsonld_job_page(self):
        job = parse_job_page(soup(JOB_JSONLD_HTML), "https://jobs.example.co.ke/job/software-engineer-101", "example")
        self.assertEqual(job.title, "Software Engineer")
        self.assertEqual(job.company, "Acme Ltd")
        self.assertEqual(job.location, "Nairobi, Nairobi County, Kenya")
        self.assertEqual(job.job_type, "FULL_TIME")
        self.assertEqual(job.external_id, "SE-101")
        self.assertEqual((job.salary_min, job.salary_max, job.salary_currency), (150000.0, 250000.0, "KES"))
        self.assertEqual(job.posted_date, dt.datetime(2026, 9, 19, 8, 30))
        self.assertEqual(job.application_deadline, dt.datetime(2026, 10, 19, 20, 59))  # +03:00 -> UTC
        self.assertIn("Build and ship backend services", job.description)
        self.assertEqual(job.source, "example")

    def test_plain_html_job_page_uses_defaults_and_guesses_location(self):
        job = parse_job_page(soup(JOB_PLAIN_HTML), "https://jobs.example.co.ke/job/accountant-102/", "example",
                             default_company="Example Board Client")
        self.assertEqual(job.title, "Accountant")
        self.assertEqual(job.company, "Example Board Client")
        self.assertEqual(job.location, "Mombasa, Kenya")
        self.assertIn("reconcile bank statements", job.description)
        self.assertNotIn("Copyright", job.description)
        self.assertEqual(job.posted_date, dt.datetime(2026, 9, 18, 7, 0))
        self.assertEqual(len(job.external_id), 20)

    def test_title_prefers_the_most_complete_candidate(self):
        html = """<html><head><title>Lecturer Grade Twelve (12) - Medical Virology at Maseno University - MyJobMag</title>
        <meta property="og:site_name" content="MyJobMag"><meta property="og:title" content="Lecturer"></head>
        <body><h1>Lecturer</h1><main class="job-description">%s</main></body></html>""" % ("Teach and research. " * 10)
        job = parse_job_page(soup(html), "https://www.myjobmag.co.ke/job/lecturer-12", "myjobmag")
        self.assertEqual(job.title, "Lecturer Grade Twelve (12) - Medical Virology at Maseno University")

    def test_title_noise_is_trimmed(self):
        html = """<html><head><title>Job Application for Director, Revenue Operations at GiveDirectly</title></head>
        <body><h1>Director, Revenue Operations</h1><main>%s</main></body></html>""" % ("Own the revenue pipeline. " * 8)
        job = parse_job_page(soup(html), "https://job-boards.greenhouse.io/gd/jobs/2", "gd")
        self.assertEqual(job.title, "Director, Revenue Operations at GiveDirectly")

        html = """<html><head><title>Accountant at Scope Markets September, 2026 - MyJobMag</title>
        <meta property="og:site_name" content="MyJobMag"></head>
        <body><h1>Accountant</h1><main>%s</main></body></html>""" % ("Prepare monthly accounts. " * 8)
        job = parse_job_page(soup(html), "https://www.myjobmag.co.ke/job/accountant-9", "myjobmag")
        self.assertEqual(job.title, "Accountant at Scope Markets")

    def test_title_keeps_parenthesised_location(self):
        html = """<html><head><title>Senior Manager, Accounting (Remote - Kenya) | GiveDirectly</title></head>
        <body><h1>Senior Manager, Accounting (Remote - Kenya)</h1><main>%s</main></body></html>""" % ("Lead the accounting team. " * 8)
        job = parse_job_page(soup(html), "https://job-boards.greenhouse.io/givedirectly/jobs/1", "gd", default_company="GiveDirectly")
        self.assertEqual(job.title, "Senior Manager, Accounting (Remote - Kenya)")

    def test_category_page_is_rejected(self):
        self.assertIsNone(parse_job_page(soup(CATEGORY_HTML), "https://jobs.example.co.ke/it-jobs-in-nairobi", "example"))

    def test_listing_page_inline_postings(self):
        postings = find_jobpostings(soup(LISTING_HTML))
        self.assertEqual(len(postings), 1)
        job = job_from_jsonld(postings[0], LISTING, "example")
        self.assertEqual(job.title, "Inline Data Analyst")
        self.assertEqual(job.location, "Nairobi, KE")
        self.assertEqual(job.url, "https://jobs.example.co.ke/job/inline-analyst-77")

    def test_parse_iso_date_variants(self):
        self.assertEqual(parse_iso_date("2026-09-20"), dt.datetime(2026, 9, 20))
        self.assertEqual(parse_iso_date("2026-09-19T08:30:00Z"), dt.datetime(2026, 9, 19, 8, 30))
        self.assertEqual(parse_iso_date("20 September 2026"), dt.datetime(2026, 9, 20))
        self.assertIsNone(parse_iso_date("soon"))
        self.assertIsNone(parse_iso_date(None))


class EndToEndScrapeTests(unittest.TestCase):
    def test_scrape_walks_listing_then_job_pages_without_network(self):
        pages = {
            LISTING: LISTING_HTML,
            "https://jobs.example.co.ke/job/software-engineer-101": JOB_JSONLD_HTML,
            "https://jobs.example.co.ke/job/accountant-102/": JOB_PLAIN_HTML,
            "https://jobs.example.co.ke/it-jobs-in-nairobi": CATEGORY_HTML,
        }
        fetched = []
        scraper = GenericSiteScraper({"slug": "example_board", "name": "Example Board", "urls": LISTING, "delay": 0})
        scraper.fetch_page = lambda url, params=None: (fetched.append(url), soup(pages[url]))[1] if url in pages else None

        jobs = scraper.scrape()

        self.assertEqual([j.title for j in jobs], ["Inline Data Analyst", "Software Engineer", "Accountant"])
        self.assertTrue(all(j.source == "example_board" for j in jobs))
        self.assertEqual(len({j.external_id for j in jobs}), 3)
        # The inline posting's own URL is not re-fetched, and the category page is never fetched.
        self.assertNotIn("https://jobs.example.co.ke/job/inline-analyst-77", fetched)
        self.assertNotIn("https://jobs.example.co.ke/it-jobs-in-nairobi", fetched)

    def test_unreachable_listing_pages_raise_with_reason(self):
        scraper = GenericSiteScraper({"slug": "down", "urls": ["https://down.example.com/jobs"], "delay": 0})

        def failing_fetch(url, params=None):
            scraper.last_fetch_error = f"{url}: Read timed out"
            return None

        scraper.fetch_page = failing_fetch
        with self.assertRaises(RuntimeError) as ctx:
            scraper.scrape()
        self.assertIn("Read timed out", str(ctx.exception))

    def test_one_reachable_listing_is_enough(self):
        pages = {LISTING: LISTING_HTML, "https://jobs.example.co.ke/job/software-engineer-101": JOB_JSONLD_HTML}
        scraper = GenericSiteScraper({"slug": "partial", "urls": ["https://down.example.com/jobs", LISTING], "max_jobs": 1, "delay": 0})
        scraper.fetch_page = lambda url, params=None: soup(pages[url]) if url in pages else None
        self.assertEqual(len(scraper.scrape()), 1)

    def test_max_jobs_caps_the_run(self):
        pages = {LISTING: LISTING_HTML, "https://jobs.example.co.ke/job/software-engineer-101": JOB_JSONLD_HTML}
        scraper = GenericSiteScraper({"slug": "capped", "urls": [LISTING], "max_jobs": 1, "delay": 0})
        scraper.fetch_page = lambda url, params=None: soup(pages[url]) if url in pages else None
        self.assertEqual(len(scraper.scrape()), 1)


if __name__ == "__main__":
    unittest.main()

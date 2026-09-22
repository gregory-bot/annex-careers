"""
Browser access: the production site, local dev and Render-hosted front-ends
must pass CORS preflight (including the Authorization header the admin uses);
unknown origins must not.

    cd backend && .venv312/bin/python -m unittest tests.test_cors
"""
import unittest

from tests.support import client, install_overrides, reset_schema


def preflight(origin, path="/api/admin/jobs", method="GET"):
    return client.options(path, headers={
        "Origin": origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": "authorization,content-type",
    })


class CorsTests(unittest.TestCase):
    def setUp(self):
        install_overrides()
        reset_schema()

    def test_allowed_origins_pass_preflight_with_auth_header(self):
        for origin in ["https://careers.annex-technologies.com", "http://localhost:8080", "https://annex-careers-web.onrender.com"]:
            res = preflight(origin)
            self.assertEqual(res.status_code, 200, origin)
            self.assertEqual(res.headers.get("access-control-allow-origin"), origin)
            self.assertIn("authorization", res.headers.get("access-control-allow-headers", "").lower())
            self.assertEqual(res.headers.get("access-control-allow-credentials"), "true")

    def test_actual_request_carries_origin_header(self):
        res = client.get("/api/health", headers={"Origin": "https://careers.annex-technologies.com"})
        self.assertEqual(res.headers.get("access-control-allow-origin"), "https://careers.annex-technologies.com")

    def test_unknown_origin_is_not_allowed(self):
        res = preflight("https://evil.example.com")
        self.assertNotEqual(res.headers.get("access-control-allow-origin"), "https://evil.example.com")
        # A look-alike that merely contains onrender.com is rejected by the anchored regex.
        res = preflight("https://onrender.com.evil.example")
        self.assertIsNone(res.headers.get("access-control-allow-origin"))


if __name__ == "__main__":
    unittest.main()

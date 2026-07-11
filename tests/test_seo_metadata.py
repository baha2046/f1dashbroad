import re
import unittest

import app as dashboard_app


class SeoMetadataTests(unittest.IsolatedAsyncioTestCase):
    async def test_index_exposes_search_and_social_metadata(self):
        client = dashboard_app.app.test_client()
        response = await client.get("/")
        html = await response.get_data(as_text=True)

        self.assertIn("<title>F1 Data Dashboard | Live Timing, Telemetry &amp; Race Analysis</title>", html)
        self.assertIn('rel="canonical" href="https://f1.nagoya-jp.me/"', html)
        self.assertIn('property="og:image" content="https://f1.nagoya-jp.me/static/og-image.png"', html)
        self.assertIn('name="twitter:card" content="summary_large_image"', html)
        self.assertRegex(html, r'type="application/ld\+json" nonce="[^"]+"')
        self.assertIn('rel="manifest" href="/static/site.webmanifest"', html)

    async def test_crawler_endpoints_reference_canonical_site(self):
        client = dashboard_app.app.test_client()

        robots = await client.get("/robots.txt")
        self.assertEqual(robots.status_code, 200)
        self.assertIn("https://f1.nagoya-jp.me/sitemap.xml", await robots.get_data(as_text=True))

        sitemap = await client.get("/sitemap.xml")
        self.assertEqual(sitemap.status_code, 200)
        self.assertIn("<loc>https://f1.nagoya-jp.me/</loc>", await sitemap.get_data(as_text=True))
        self.assertTrue(sitemap.content_type.startswith("application/xml"))

    async def test_structured_data_nonce_is_allowed_by_csp(self):
        client = dashboard_app.app.test_client()
        response = await client.get("/")
        html = await response.get_data(as_text=True)
        nonce = re.search(r'<script type="application/ld\+json" nonce="([^"]+)">', html).group(1)
        self.assertIn(f"'nonce-{nonce}'", response.headers["Content-Security-Policy"])


if __name__ == "__main__":
    unittest.main()

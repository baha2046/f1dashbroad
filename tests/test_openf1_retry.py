import unittest
from unittest.mock import AsyncMock, patch

import httpx

import app as dashboard_app


class FetchUrlRetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_url_retries_openf1_429_before_returning_json(self):
        responses = [
            httpx.Response(429, request=httpx.Request("GET", "https://api.openf1.org/v1/laps")),
            httpx.Response(200, json=[{"driver_number": 16}], request=httpx.Request("GET", "https://api.openf1.org/v1/laps")),
        ]

        class FakeAsyncClient:
            def __init__(self):
                self.requests = []

            async def get(self, url, headers=None, timeout=None):
                self.requests.append((url, headers, timeout))
                return responses.pop(0)

        fake_client = FakeAsyncClient()

        with (
            patch.object(dashboard_app, "get_http_client", return_value=fake_client),
            patch("asyncio.sleep", new_callable=AsyncMock) as sleep_mock,
        ):
            data = await dashboard_app.fetch_url("https://api.openf1.org/v1/laps")

        self.assertEqual(data, [{"driver_number": 16}])
        self.assertEqual(len(fake_client.requests), 2)
        sleep_mock.assert_awaited_once_with(1.0)

    async def test_fetch_url_raises_auth_error_on_403_with_detail(self):
        responses = [
            httpx.Response(
                403,
                json={"detail": "Live data requires an API key"},
                request=httpx.Request("GET", "https://api.openf1.org/v1/laps"),
            ),
        ]

        class FakeAsyncClient:
            async def get(self, url, headers=None, timeout=None):
                return responses.pop(0)

        with patch.object(dashboard_app, "get_http_client", return_value=FakeAsyncClient()):
            with self.assertRaises(dashboard_app.OpenF1AuthError) as ctx:
                await dashboard_app.fetch_url("https://api.openf1.org/v1/laps")

        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.message, "Live data requires an API key")


if __name__ == "__main__":
    unittest.main()

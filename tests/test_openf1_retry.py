import unittest
from unittest.mock import AsyncMock, patch

import httpx

import app as dashboard_app


class FetchUrlRetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_url_retries_429_before_returning_json(self):
        responses = [
            httpx.Response(429, request=httpx.Request("GET", "https://api.example.test/data")),
            httpx.Response(200, json=[{"driver_number": 16}], request=httpx.Request("GET", "https://api.example.test/data")),
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
            data = await dashboard_app.fetch_url("https://api.example.test/data")

        self.assertEqual(data, [{"driver_number": 16}])
        self.assertEqual(len(fake_client.requests), 2)
        sleep_mock.assert_awaited_once_with(1.0)

    async def test_fetch_url_raises_http_status_error_on_403(self):
        responses = [
            httpx.Response(
                403,
                json={"detail": "Forbidden"},
                request=httpx.Request("GET", "https://api.example.test/data"),
            ),
        ]

        class FakeAsyncClient:
            async def get(self, url, headers=None, timeout=None):
                return responses.pop(0)

        with patch.object(dashboard_app, "get_http_client", return_value=FakeAsyncClient()):
            with self.assertRaises(httpx.HTTPStatusError) as ctx:
                await dashboard_app.fetch_url("https://api.example.test/data")

        self.assertEqual(ctx.exception.response.status_code, 403)


if __name__ == "__main__":
    unittest.main()

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

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def get(self, url, headers=None, timeout=None):
                self.requests.append((url, headers, timeout))
                return responses.pop(0)

        fake_client = FakeAsyncClient()

        with (
            patch.object(dashboard_app.httpx, "AsyncClient", return_value=fake_client),
            patch("asyncio.sleep", new_callable=AsyncMock) as sleep_mock,
        ):
            data = await dashboard_app.fetch_url("https://api.openf1.org/v1/laps")

        self.assertEqual(data, [{"driver_number": 16}])
        self.assertEqual(len(fake_client.requests), 2)
        sleep_mock.assert_awaited_once_with(1.0)


if __name__ == "__main__":
    unittest.main()

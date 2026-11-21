import json
import unittest
from unittest.mock import AsyncMock, Mock, patch

import httpx
from spatium import magic_hour as provider


class ProviderTests(unittest.IsolatedAsyncioTestCase):
    def transport(self, handler):
        factory = httpx.AsyncClient
        self.enterContext(patch.object(httpx, "AsyncClient", side_effect=lambda **kw: factory(
            transport=httpx.MockTransport(handler), **kw)))
        self.enterContext(patch("spatium.magic_hour.asyncio.sleep", new_callable=AsyncMock))

    async def test_sequence(self):
        paths, edits = [], []
        reads = iter([503, 200, 200])
        assets = iter([403, 200])
        def handle(req):
            paths.append(req.url.path)
            if req.url.host == "videos.magichour.ai":
                self.assertNotIn("Authorization", req.headers)
                if req.method == "PUT":
                    self.assertEqual(req.content, b"normalized")
                    return httpx.Response(200)
                return httpx.Response(next(assets), content=b"still")
            self.assertEqual(req.headers["Authorization"], "Bearer fixture")
            if req.url.path.endswith("upload-urls"):
                return httpx.Response(200, json={"items":[{"upload_url":"https://videos.magichour.ai/in","file_path":"in"}]})
            if req.method == "POST":
                edits.append(json.loads(req.content))
                return httpx.Response(200, json={"id":"one", "credits_charged":5})
            return httpx.Response(next(reads), json={"status":"complete","downloads":[{"url":"https://videos.magichour.ai/out"}]})
        self.transport(handle)
        accepted = Mock()
        self.assertEqual(await provider.stylize(b"normalized","fixture",Mock(),accepted,prompt="restyle"), b"still")
        accepted.assert_called_once_with("one",5)
        self.assertEqual([(e["model"], e["resolution"], e["image_count"]) for e in edits], [("gpt-image-2","1k",1)])
        self.assertEqual([(e["model"], e["resolution"], e["image_count"]) for e in edits], [(provider.MODEL,"1k",1)])
        self.assertEqual(paths.count("/v1/image-projects/one"), 3)

    async def test_ambiguous_creation(self):
        def handle(req):
            if req.url.path.endswith("upload-urls"):
                return httpx.Response(200, json={"items":[{"upload_url":"https://videos.magichour.ai/in","file_path":"in"}]})
            if req.method == "PUT":
                return httpx.Response(200)
            raise httpx.ReadTimeout("lost")
        self.transport(handle)
        marker = Mock()
        with self.assertRaisesRegex(provider.MagicHourError, "history"):
            await provider.stylize(b"x","fixture",marker,Mock(),prompt="restyle")
        marker.assert_called_once_with("stylizing")

    async def test_auth_and_credits(self):
        for status, reason in ((401, "key"), (402, "credits")):
            with self.assertRaisesRegex(provider.MagicHourError, reason):
                provider.check(httpx.Response(status))

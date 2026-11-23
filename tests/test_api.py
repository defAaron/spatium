import os
import tempfile
import unittest
from io import BytesIO
from unittest.mock import patch

import httpx
from PIL import Image

from spatium.main import app


def jpeg_fixture(size=(640, 480)):
    data = BytesIO()
    Image.new("RGB", size, "teal").save(data, "JPEG")
    return data.getvalue()


class ApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, SPATIUM_DATA_DIR=directory))
        await self.enterAsyncContext(app.router.lifespan_context(app))
        self.client = await self.enterAsyncContext(httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="https://test"))

    async def test_health_and_session(self):
        self.assertEqual((await self.client.get("/api/health")).json(), {"status": "ok"})
        config = await self.client.get("/api/config")
        self.assertEqual(config.json(), {})
        self.assertIn("spatium_session", config.headers["set-cookie"])

    async def test_session_secret_from_environment(self):
        cookie = (await self.client.get("/api/config")).cookies["spatium_session"]
        with patch.dict(os.environ, SPATIUM_SESSION_SECRET="s" * 32):
            async with app.router.lifespan_context(app):
                self.assertEqual(app.state.secret, b"s" * 32)
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test",
                                             cookies={"spatium_session": cookie}) as other:
                    rotated = (await other.get("/api/config")).cookies["spatium_session"]
                    self.assertNotEqual(rotated, cookie)
        with patch.dict(os.environ, SPATIUM_SESSION_SECRET="short"), self.assertRaises(RuntimeError):
            async with app.router.lifespan_context(app):
                pass

    async def submit(self, data, submission="one"):
        return await self.client.post("/api/walkthroughs", data={"key": "fixture", "submission": submission},
                                      files={"photo": ("source", data)})

    async def test_intake(self):
        from spatium.main import MAX_UPLOAD, normalize
        image = Image.new("RGB", (3, 5))
        exif = Image.Exif()
        exif[274] = 6
        exif[270] = "private description"
        for fmt in ("JPEG", "WEBP", "PNG"):
            stream = BytesIO()
            image.save(stream, fmt, exif=exif)
            cleaned = Image.open(BytesIO(normalize(stream.getvalue())))
            self.assertEqual(cleaned.size, (5, 3))
            self.assertFalse(cleaned.getexif())

        provider = self.enterContext(patch("spatium.magic_hour.stylize"))
        self.client.cookies.set("spatium_session", "forged")
        self.assertEqual((await self.submit(b"x")).status_code, 409)
        self.client.cookies.clear()
        cookie = (await self.client.get("/api/config")).headers["set-cookie"]
        self.assertIn("HttpOnly", cookie)
        self.assertIn("Secure", cookie)
        animated = BytesIO()
        image.save(animated, "PNG", save_all=True, append_images=[Image.new("RGB", image.size, "red")])
        for data, status in [(b"corrupt", 422), (animated.getvalue(), 422), (bytes(MAX_UPLOAD+1), 413)]:
            self.assertEqual((await self.submit(data)).status_code, status)
        with patch("spatium.main.PIXEL_LIMIT", 10):
            self.assertEqual((await self.submit(stream.getvalue())).status_code, 422)
        provider.assert_not_called()
        accepted = await self.submit(stream.getvalue())
        self.assertEqual(accepted.status_code, 202)
        self.client.cookies.clear()
        await self.client.get("/api/config")
        path = "/api/scenes/" + accepted.json()["id"]
        for suffix in ("", "/stop-0"):
            self.assertEqual((await self.client.get(path+suffix)).status_code, 404)
        self.assertEqual((await self.client.post("/api/scenes", data={})).status_code, 404)

    async def test_racing_submissions(self):
        import asyncio
        gate = asyncio.Event()
        async def delay(*args, **kwargs):
            await gate.wait()
            return jpeg_fixture((1024, 512))
        provider = self.enterContext(patch("spatium.magic_hour.stylize", side_effect=delay))
        await self.client.get("/api/config")
        source = jpeg_fixture()
        first, second = await asyncio.gather(self.submit(source), self.submit(source))
        self.assertEqual(first.json()["id"], second.json()["id"])
        self.assertEqual((await self.submit(source, "two")).status_code, 429)
        provider.assert_awaited_once()

    async def test_walkthrough_recovery_and_ownership(self):
        import asyncio
        from spatium import magic_hour
        calls = []
        async def edit(photo, key, dispatch, accept, *, prompt, references):
            i = len(calls)
            calls.append(prompt)
            self.assertEqual(bool(references), i > 0)
            dispatch("stylizing")
            accept(str(i), 5)
            if i == 1:
                raise magic_hour.MagicHourError("Provider delayed")
            return jpeg_fixture((1024, 512))
        self.enterContext(patch("spatium.magic_hour.stylize", side_effect=edit))
        fetch = self.enterContext(patch("spatium.magic_hour.retrieve", return_value=jpeg_fixture((1024, 512))))
        await self.client.get("/api/config")
        response = await self.client.post("/api/walkthroughs", data={"key":"fixture","submission":"tour"},
                                          files={"photo": ("original.jpg",jpeg_fixture())})
        self.assertEqual(response.status_code, 202)
        path = "/api/scenes/" + response.json()["id"]
        await asyncio.gather(*app.state.tasks)
        partial = (await self.client.get(path)).json()
        self.assertEqual((partial["stage"],partial["credits"]), ("needs_key",10))
        self.assertEqual(len(partial["walkthrough"]["stops"]),1)
        await self.client.post(path+"/resume",data={"key":"fixture"})
        await asyncio.gather(*app.state.tasks)
        scene = (await self.client.get(path)).json()
        self.assertEqual((scene["stage"], scene["credits"]), ("ready",15))
        self.assertEqual(len(set(calls)),3)
        fetch.assert_awaited_once()
        for stop in scene["walkthrough"]["stops"]:
            self.assertEqual((await self.client.get(stop["url"])).status_code,200)
        self.client.cookies.clear()
        self.assertEqual((await self.client.get(path+"/stop-1")).status_code,404)

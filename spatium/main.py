import asyncio
import hashlib
import hmac
import os
import secrets
from contextlib import asynccontextmanager, suppress
from io import BytesIO
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.datastructures import UploadFile

from . import magic_hour, walkthrough
from .store import R2Blobs, Scene, Store

DIST = Path(__file__).resolve().parent.parent / "dist"
MAX_UPLOAD = 10 * 1024 * 1024
PIXEL_LIMIT = 24_000_000
LIFETIME = 24 * 60 * 60
COOKIE = "spatium_session"
# Optional cap on new scenes per 24 hours across all sessions, which bounds storage writes.
DAILY_SCENES = int(os.environ.get("SPATIUM_DAILY_SCENES", "0")) or None


async def expire(store):
    while True:
        await asyncio.sleep(60)
        store.purge()


@asynccontextmanager
async def lifespan(app: FastAPI):
    directory = Path(os.environ.get("SPATIUM_DATA_DIR", ".spatium"))
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    configured = os.environ.get("SPATIUM_SESSION_SECRET")
    if configured:
        if len(configured) < 32:
            raise RuntimeError("SPATIUM_SESSION_SECRET must be at least 32 characters.")
        app.state.secret = configured.encode()
    else:
        secret = directory / "session-secret"
        if not secret.exists():
            with secret.open("xb") as file:
                file.write(secrets.token_bytes(32))
        app.state.secret = secret.read_bytes()
    blobs = R2Blobs.from_env(os.environ) if os.environ.get("SPATIUM_R2_BUCKET") else None
    app.state.store = Store(directory, database=os.environ.get("SPATIUM_DATABASE_URL"), blobs=blobs)
    app.state.tasks = set()
    cleanup = asyncio.create_task(expire(app.state.store))
    try:
        yield
    finally:
        cleanup.cancel()
        with suppress(asyncio.CancelledError):
            await cleanup
        tasks = list(app.state.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        app.state.store.db.close()


app = FastAPI(title="Spatium", lifespan=lifespan)


def decode(data: bytes) -> Image.Image:
    try:
        with Image.open(BytesIO(data)) as image:
            if image.format not in {"JPEG", "PNG", "WEBP"} or getattr(image, "is_animated", False):
                raise ValueError("Choose a still JPEG, PNG, or WebP image.")
            if image.width * image.height > PIXEL_LIMIT or min(image.size) < 2:
                raise ValueError("Use an image with at most 24 megapixels and at least two pixels on each side.")
            oriented = ImageOps.exif_transpose(image).convert("RGBA")
            return Image.alpha_composite(Image.new("RGBA", oriented.size, "white"), oriented).convert("RGB")
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise ValueError("The file could not be read as a still image.") from exc


def jpeg(image: Image.Image) -> bytes:
    data = BytesIO()
    image.save(data, "JPEG", quality=90)
    return data.getvalue()


def normalize(data: bytes) -> bytes:
    image = decode(data)
    image.thumbnail((2048, 2048))
    return jpeg(image)


def claim(coroutine):
    task = asyncio.create_task(coroutine)
    app.state.tasks.add(task)
    task.add_done_callback(app.state.tasks.discard)


def capacity():
    if app.state.tasks:
        raise HTTPException(429, "The worker is busy. Try again shortly.")


async def build_scene(scene, key, store):
    try:
        await walkthrough.generate(scene, key, store, decode, jpeg)
    except Exception as exc:
        can_resume = bool(scene.project) or (scene.stops and not scene.dispatched)
        scene.stage = "needs_key" if can_resume and not isinstance(exc, magic_hour.TerminalProjectError) else "failed"
        scene.error = str(exc) if isinstance(exc, magic_hour.MagicHourError) else (
            "Check your Magic Hour project history before submitting another edit."
            if scene.dispatched else "Upload failed. Check the photo and try again.")
        store.save(scene)


def sign(request: Request, token: str) -> str:
    return hmac.new(request.app.state.secret, token.encode(), hashlib.sha256).hexdigest()


def session_id(request: Request) -> str | None:
    token, _, signature = request.cookies.get(COOKIE, "").partition(".")
    if token.isascii() and signature.isascii() and hmac.compare_digest(sign(request, token), signature):
        return token
    return None


def own_scene(request: Request, scene_id: str) -> Scene:
    scene = request.app.state.store.get(scene_id)
    if not scene or scene.session != session_id(request):
        raise HTTPException(404, "Scene not found or expired.")
    return scene


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/config")
async def config(request: Request):
    response = JSONResponse({}, headers={"Cache-Control": "no-store"})
    token = session_id(request) or secrets.token_urlsafe(32)
    response.set_cookie(COOKIE, token + "." + sign(request, token), max_age=LIFETIME,
                            httponly=True, secure=request.url.scheme == "https", samesite="lax")
    return response


@app.post("/api/walkthroughs", status_code=202)
async def create_scene(request: Request):
    session = session_id(request)
    if not session:
        raise HTTPException(409, "Refresh to start a browser session.")
    length = request.headers.get("content-length", "")
    if not length.isdecimal() or len(length) > 10 or int(length) > MAX_UPLOAD + 65_536:
        raise HTTPException(413, "Choose an image up to 10 MB.")

    async with request.form(max_files=1, max_fields=2, max_part_size=4096) as form:
        key = form.get("key")
        submission = form.get("submission")
        upload = form.get("photo")
        if not isinstance(key, str) or not key.strip() or len(key) > 512 or not key.strip().isascii() or any(char.isspace() for char in key.strip()):
            raise HTTPException(400, "Enter a Magic Hour API key.")
        if not isinstance(submission, str) or not 1 <= len(submission) <= 64 or not isinstance(upload, UploadFile):
            raise HTTPException(400, "Choose a photo and submit it again.")

        store = request.app.state.store
        store.purge()
        existing = store.existing(session, submission)
        if existing:
            return existing.view()
        capacity()
        data = await upload.read(MAX_UPLOAD + 1)
        if len(data) > MAX_UPLOAD:
            raise HTTPException(413, "Choose an image up to 10 MB.")
        try:
            photo = await asyncio.to_thread(normalize, data)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        existing = store.existing(session, submission)
        if existing:
            return existing.view()
        capacity()
        if store.limited(session):
            raise HTTPException(429, "Six submissions per hour are allowed. Try again later.")
        if DAILY_SCENES and store.recent() >= DAILY_SCENES:
            raise HTTPException(429, "Spatium has reached today's walkthrough limit. Try again tomorrow.")
        scene = Scene(secrets.token_urlsafe(16), session, submission, store.clock())
        store.insert(scene)
        store.write(scene, "source", photo)
        claim(build_scene(scene, key.strip(), store))
        return scene.view()


@app.get("/api/scenes/{scene_id}")
async def get_scene(scene_id: str, request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return own_scene(request, scene_id).view()


@app.post("/api/scenes/{scene_id}/resume", status_code=202)
async def resume(scene_id: str, request: Request):
    scene = own_scene(request, scene_id)
    if scene.stage != "needs_key":
        raise HTTPException(409, "This project cannot be resumed.")
    if not request.headers.get("content-length", "").isdigit() or int(request.headers["content-length"]) > 4096:
        raise HTTPException(413, "Enter only your Magic Hour key.")
    async with request.form(max_files=0, max_fields=1, max_part_size=1024) as form:
        key = form.get("key")
        if not isinstance(key, str) or not key or len(key) > 512 or not key.isascii() or not key.isprintable() or any(c.isspace() for c in key):
            raise HTTPException(400, "Enter a Magic Hour API key.")
        scene = own_scene(request, scene_id)
        if scene.stage != "needs_key":
            raise HTTPException(409, "The project has already resumed.")
        capacity()
        scene.stage, scene.error = "stylizing", None
        request.app.state.store.save(scene)
        claim(build_scene(scene, key, request.app.state.store))
        return scene.view()


@app.post("/api/scenes/{scene_id}/events/{event}", status_code=204)
async def record_event(scene_id: str, event: str, request: Request):
    scene = own_scene(request, scene_id)
    if scene.stage != "ready":
        raise HTTPException(409, "This scene is not ready.")
    if event == "interactive":
        scene.interactive_at = scene.interactive_at or request.app.state.store.clock()
    elif event == "export":
        scene.exports += 1
    else:
        raise HTTPException(404)
    request.app.state.store.save(scene)
    return Response(status_code=204)


@app.get("/api/scenes/{scene_id}/{asset}")
async def get_asset(scene_id: str, asset: str, request: Request):
    scene = own_scene(request, scene_id)
    headers = {"Cache-Control": "private, no-store"}
    if asset in {f"stop-{i}" for i in range(len(scene.stops))}:
        data = await asyncio.to_thread(request.app.state.store.read, scene, asset)
        return Response(data, media_type="image/jpeg", headers=headers)
    raise HTTPException(404, "Asset not found.")


if (DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/")
async def index():
    if (DIST / "index.html").is_file():
        return FileResponse(DIST / "index.html")
    return JSONResponse({"message": "Run npm run dev or build the frontend with npm run build."})

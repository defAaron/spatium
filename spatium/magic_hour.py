import asyncio
from collections.abc import Callable
from urllib.parse import urlsplit

import httpx

API = "https://api.magichour.ai/v1"
MODEL = "flux-2-klein"
PROMPT = (
    "Restyle this exact photograph as a handcrafted tabletop miniature. Keep the "
    "original camera angle, framing, horizon, major objects, silhouettes, and "
    "foreground-to-background layout. Use painted clay and wood textures, fine "
    "model-scale details, soft studio lighting, and gentle shadows. Keep foreground "
    "and background edges legible. Avoid heavy blur, reframing, or adding objects."
)


class MagicHourError(Exception):
    pass


class TerminalProjectError(MagicHourError):
    pass


def asset_url(value: str) -> str:
    url = urlsplit(value)
    if url.scheme != "https" or url.netloc != "videos.magichour.ai":
        raise MagicHourError("Magic Hour returned an unrecognized asset URL.")
    return value


def check(response: httpx.Response) -> None:
    if response.status_code == 401:
        raise MagicHourError("Magic Hour rejected the API key.")
    if response.status_code == 402:
        raise MagicHourError("This Magic Hour key has insufficient credits.")
    if not response.is_success:
        raise MagicHourError("Magic Hour could not process this request.")


async def stylize(
    photo: bytes,
    key: str,
    on_stage: Callable[[str], None],
    on_accepted: Callable[[str, int], None],
    *, prompt: str = PROMPT, references: tuple[bytes, ...] = (),
) -> bytes:
    auth = {"Authorization": f"Bearer {key}"}
    async with httpx.AsyncClient(timeout=20) as client:
        images = (photo, *references)
        upload = await client.post(
            f"{API}/files/upload-urls", headers=auth,
            json={"items": [{"type": "image", "extension": "jpg"} for _ in images]},
        )
        check(upload)
        paths = []
        for item, data in zip(upload.json()["items"], images, strict=True):
            stored = await client.put(asset_url(item["upload_url"]), content=data,
                                      headers={"Content-Type": "image/jpeg"})
            check(stored)
            paths.append(item["file_path"])

        on_stage("stylizing")
        try:
            edit = await client.post(
                f"{API}/ai-image-editor",
                headers=auth,
                json={
                    "model": MODEL,
                    "resolution": "1k",
                    "image_count": 1,
                    "assets": {"image_file_paths": paths},
                    "style": {"prompt": prompt},
                },
            )
            if edit.is_server_error:
                raise MagicHourError("Magic Hour may have accepted the edit. Check your project history before retrying.")
            check(edit)
            project = edit.json()
            on_accepted(project["id"], project["credits_charged"])
        except (httpx.RequestError, ValueError, KeyError) as exc:
            raise MagicHourError("Magic Hour may have accepted the edit. Check your project history before retrying.") from exc

    return await retrieve(project["id"], key, on_accepted)


async def retrieve(project_id: str, key: str, on_accepted) -> bytes:
    auth = {"Authorization": f"Bearer {key}"}
    async with httpx.AsyncClient(timeout=20) as client:
        for attempt in range(45):
            await asyncio.sleep(min(2 + attempt, 8))
            try:
                details = await client.get(f"{API}/image-projects/{project_id}", headers=auth)
                if details.status_code == 429 or details.is_server_error:
                    continue
                check(details)
                result = details.json()
                if isinstance(result.get("credits_charged"), int):
                    on_accepted(project_id, result["credits_charged"])
                if result["status"] in {"error", "canceled"}:
                    raise TerminalProjectError(f"Magic Hour marked this edit {result['status']}. Check your project history.")
                if result["status"] != "complete":
                    continue
                downloads = result.get("downloads")
                if not downloads:
                    continue
                async with client.stream("GET", asset_url(downloads[0]["url"])) as download:
                    if download.status_code in {403, 404, 410, 429} or download.is_server_error:
                        continue
                    check(download)
                    output = bytearray()
                    async for chunk in download.aiter_bytes():
                        output.extend(chunk)
                        if len(output) > 16 * 1024 * 1024:
                            raise MagicHourError("Magic Hour returned an image that is too large.")
                    return bytes(output)
            except httpx.RequestError:
                continue

    raise MagicHourError("The existing edit is taking longer than expected. Resume to check again.")

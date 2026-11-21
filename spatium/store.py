"""Persistent scene metadata and private, atomically published assets (one server process)."""
import json
import os
import shutil
import sqlite3
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path


CAMERA = {"fov": 42, "nearDepth": 2.65, "farDepth": 3.85}


@dataclass
class Scene:
    id: str
    session: str
    submission: str
    created: float
    stage: str = "uploading"
    dispatched: bool = False
    project: str | None = None
    credits: int | None = None
    image: tuple[int, int] | None = None
    depth: tuple[int, int] | None = None
    error: str | None = None
    still_at: float | None = None
    ready_at: float | None = None
    interactive_at: float | None = None
    depth_failures: int = 0
    exports: int = 0
    render_failures: int = 0

    walkthrough: bool = False
    stops: list[dict] = field(default_factory=list)

    def view(self):
        result = {key: getattr(self, key) for key in ("id", "stage", "credits", "error")}
        for name, dimensions, asset in (("image", self.image, "still"), ("depth", self.depth, "depth")):
            if dimensions:
                result[name] = {"url": f"/api/scenes/{self.id}/{asset}", "width": dimensions[0], "height": dimensions[1]}
        if self.depth:
            result["depth"]["version"] = 1
            result["camera"] = CAMERA
        if self.walkthrough:
            result["walkthrough"] = {
                "count": 3,
                "stops": [{"url": f"/api/scenes/{self.id}/stop-{index}", "label": stop["label"]}
                          for index, stop in enumerate(self.stops)],
            }
        return result


class Store:
    def __init__(self, directory: Path, clock=time.time):
        self.directory = directory
        self.clock = clock
        self.db = sqlite3.connect(directory / "scenes.sqlite3", isolation_level=None)
        self.db.execute("""CREATE TABLE IF NOT EXISTS scenes (
            id TEXT PRIMARY KEY, session TEXT, submission TEXT, created REAL, metadata TEXT,
            UNIQUE(session, submission))""")
        self.assets = directory / "assets"
        self.assets.mkdir(exist_ok=True)
        self.purge()
        for folder in self.assets.iterdir():
            scene = self.get(folder.name)
            if scene is None:
                shutil.rmtree(folder)
            else:
                for asset in folder.iterdir():
                    valid = {"still"} if scene.image else set()
                    if scene.depth:
                        valid.add("depth")
                    if scene.walkthrough:
                        valid.add("source")
                        valid.update(f"stop-{i}" for i in range(len(scene.stops)))
                    if asset.name not in valid:
                        asset.unlink()
        for row, in self.db.execute("SELECT metadata FROM scenes").fetchall():
            scene = Scene(**json.loads(row))
            if scene.stage in {"uploading", "stylizing", "estimating_depth"}:
                if scene.walkthrough and (scene.project or not scene.dispatched) and (self.assets / scene.id / "source").exists():
                    scene.stage, scene.error = "needs_key", "Enter your key to finish the remaining walkthrough stops."
                elif scene.image and not scene.walkthrough:
                    scene.stage, scene.error = "still_ready", "Depth processing was interrupted. Retry depth."
                elif scene.project:
                    scene.stage, scene.error = "needs_key", "Enter your key to retrieve the existing edit."
                elif scene.dispatched:
                    scene.stage, scene.error = "failed", "The edit may have been accepted. Check your Magic Hour project history."
                else:
                    scene.stage, scene.error = "failed", "Upload interrupted before the edit. Submit your photo again."
                self.save(scene)

    def purge(self):
        for scene_id, in self.db.execute("SELECT id FROM scenes WHERE created <= ?", (self.clock()-86400,)).fetchall():
            self.db.execute("DELETE FROM scenes WHERE id=?", (scene_id,))
            folder = self.assets / scene_id
            if folder.exists():
                shutil.rmtree(folder)

    def get(self, scene_id):
        row = self.db.execute("SELECT metadata FROM scenes WHERE id=? AND created>?", (scene_id,self.clock()-86400)).fetchone()
        return Scene(**json.loads(row[0])) if row else None

    def existing(self, session, submission):
        row = self.db.execute("SELECT id FROM scenes WHERE session=? AND submission=?", (session, submission)).fetchone()
        return self.get(row[0]) if row else None

    def insert(self, scene):
        self.db.execute("INSERT INTO scenes VALUES (?,?,?,?,?)", (scene.id, scene.session, scene.submission, scene.created, json.dumps(asdict(scene))))

    def save(self, scene):
        self.db.execute("UPDATE scenes SET metadata=? WHERE id=?", (json.dumps(asdict(scene)), scene.id))

    def limited(self, session):
        return self.db.execute("SELECT count(*) FROM scenes WHERE session=? AND created>?", (session, self.clock()-3600)).fetchone()[0] >= 6

    def write(self, scene, asset, data):
        if not self.get(scene.id):
            raise ValueError("Scene expired")
        directory = self.assets / scene.id
        directory.mkdir(exist_ok=True)
        partial = directory / (asset + ".partial")
        with partial.open("wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        partial.replace(directory / asset)

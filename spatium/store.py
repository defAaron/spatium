"""Persistent scene metadata and private, atomically published assets (one server process).

Development uses SQLite and a local asset directory. A deployment can point metadata at
Postgres (SPATIUM_DATABASE_URL) and assets at a Cloudflare R2 bucket (SPATIUM_R2_*).
"""
import json
import os
import shutil
import sqlite3
import time
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path


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
    error: str | None = None
    first_stop_at: float | None = None
    ready_at: float | None = None
    interactive_at: float | None = None
    exports: int = 0
    stops: list[dict] = field(default_factory=list)

    @classmethod
    def load(cls, raw: str):
        record = json.loads(raw)
        # Rows written before the depth miniature was removed. Drop them on load.
        if record.get("walkthrough") is False:
            return None
        names = {f.name for f in fields(cls)}
        return cls(**{key: value for key, value in record.items() if key in names})

    def view(self):
        result = {key: getattr(self, key) for key in ("id", "stage", "credits", "error")}
        result["walkthrough"] = {
            "count": 3,
            "stops": [{"url": f"/api/scenes/{self.id}/stop-{index}", "label": stop["label"]}
                      for index, stop in enumerate(self.stops)],
        }
        return result


class Database:
    """An autocommit connection to SQLite (a path) or Postgres (a URL). Statements use ? placeholders."""

    def __init__(self, target):
        self.url = target if isinstance(target, str) else None
        if self.url:
            self.connect()
        else:
            self.connection = sqlite3.connect(target, isolation_level=None)

    def connect(self):
        import psycopg
        # Prepared statements are disabled so the Supabase pooler can be used in either mode.
        self.connection = psycopg.connect(self.url, autocommit=True, prepare_threshold=None)

    def execute(self, sql, params=()):
        if not self.url:
            return self.connection.execute(sql, params)
        import psycopg
        sql = sql.replace("?", "%s")
        try:
            return self.connection.execute(sql, params)
        except psycopg.OperationalError:
            # Hosted poolers drop idle connections. Reconnect once when the connection is gone.
            if not (self.connection.closed or self.connection.broken):
                raise
            self.connect()
            return self.connection.execute(sql, params)

    def close(self):
        self.connection.close()


class LocalBlobs:
    """Assets as files in one folder per scene, published by atomic rename."""

    def __init__(self, root: Path):
        self.root = root
        root.mkdir(exist_ok=True)

    def inventory(self):
        return {folder.name: {asset.name for asset in folder.iterdir()} for folder in self.root.iterdir()}

    def read(self, scene_id, asset):
        return (self.root / scene_id / asset).read_bytes()

    def write(self, scene_id, asset, data):
        directory = self.root / scene_id
        directory.mkdir(exist_ok=True)
        partial = directory / (asset + ".partial")
        with partial.open("wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        partial.replace(directory / asset)

    def remove(self, scene_id, asset=None):
        if asset is None:
            shutil.rmtree(self.root / scene_id, ignore_errors=True)
        else:
            (self.root / scene_id / asset).unlink(missing_ok=True)


class R2Blobs:
    """Assets as private objects keyed `<scene>/<asset>` in an S3-compatible bucket."""

    def __init__(self, bucket, client):
        self.bucket = bucket
        self.client = client

    @classmethod
    def from_env(cls, env):
        import boto3
        client = boto3.client(
            "s3", region_name="auto",
            endpoint_url=f"https://{env['SPATIUM_R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=env["SPATIUM_R2_ACCESS_KEY_ID"],
            aws_secret_access_key=env["SPATIUM_R2_SECRET_ACCESS_KEY"])
        return cls(env["SPATIUM_R2_BUCKET"], client)

    def keys(self, prefix=""):
        for page in self.client.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=prefix):
            for item in page.get("Contents", []):
                yield item["Key"]

    def inventory(self):
        found = {}
        for key in self.keys():
            scene_id, _, asset = key.partition("/")
            found.setdefault(scene_id, set()).add(asset)
        return found

    def read(self, scene_id, asset):
        return self.client.get_object(Bucket=self.bucket, Key=f"{scene_id}/{asset}")["Body"].read()

    def write(self, scene_id, asset, data):
        # A single PUT is atomic: readers see the previous object or the complete new one.
        self.client.put_object(Bucket=self.bucket, Key=f"{scene_id}/{asset}", Body=data,
                               ContentType="image/jpeg")

    def remove(self, scene_id, asset=None):
        keys = list(self.keys(scene_id + "/")) if asset is None else [f"{scene_id}/{asset}"]
        for key in keys:
            self.client.delete_object(Bucket=self.bucket, Key=key)


class Store:
    def __init__(self, directory: Path, clock=time.time, database: str | None = None, blobs=None):
        self.directory = directory
        self.clock = clock
        self.db = Database(database or directory / "scenes.sqlite3")
        self.db.execute("""CREATE TABLE IF NOT EXISTS scenes (
            id TEXT PRIMARY KEY, session TEXT, submission TEXT, created DOUBLE PRECISION, metadata TEXT,
            UNIQUE(session, submission))""")
        self.blobs = blobs or LocalBlobs(directory / "assets")
        for scene_id, raw in self.db.execute("SELECT id, metadata FROM scenes").fetchall():
            if Scene.load(raw) is None:
                self.db.execute("DELETE FROM scenes WHERE id=?", (scene_id,))
        self.purge()
        inventory = self.blobs.inventory()
        for scene_id, assets in inventory.items():
            scene = self.get(scene_id)
            if scene is None:
                self.blobs.remove(scene_id)
                continue
            valid = {"source", *(f"stop-{i}" for i in range(len(scene.stops)))}
            for asset in assets - valid:
                self.blobs.remove(scene_id, asset)
            inventory[scene_id] = assets & valid
        for row, in self.db.execute("SELECT metadata FROM scenes").fetchall():
            scene = Scene.load(row)
            if scene.stage in {"uploading", "stylizing"}:
                if (scene.project or not scene.dispatched) and "source" in inventory.get(scene.id, ()):
                    scene.stage, scene.error = "needs_key", "Enter your key to finish the remaining walkthrough stops."
                elif scene.dispatched:
                    scene.stage, scene.error = "failed", "The edit may have been accepted. Check your Magic Hour project history."
                else:
                    scene.stage, scene.error = "failed", "Upload interrupted before the edit. Submit your photo again."
                self.save(scene)

    @property
    def assets(self) -> Path:
        """The local asset directory (development storage only)."""
        return self.blobs.root

    def purge(self):
        for scene_id, in self.db.execute("SELECT id FROM scenes WHERE created <= ?", (self.clock()-86400,)).fetchall():
            self.db.execute("DELETE FROM scenes WHERE id=?", (scene_id,))
            self.blobs.remove(scene_id)

    def get(self, scene_id):
        row = self.db.execute("SELECT metadata FROM scenes WHERE id=? AND created>?", (scene_id,self.clock()-86400)).fetchone()
        return Scene.load(row[0]) if row else None

    def existing(self, session, submission):
        row = self.db.execute("SELECT id FROM scenes WHERE session=? AND submission=?", (session, submission)).fetchone()
        return self.get(row[0]) if row else None

    def insert(self, scene):
        self.db.execute("INSERT INTO scenes VALUES (?,?,?,?,?)", (scene.id, scene.session, scene.submission, scene.created, json.dumps(asdict(scene))))

    def save(self, scene):
        self.db.execute("UPDATE scenes SET metadata=? WHERE id=?", (json.dumps(asdict(scene)), scene.id))

    def recent(self):
        """Scenes created in the last 24 hours across every session."""
        return self.db.execute("SELECT count(*) FROM scenes WHERE created>?", (self.clock()-86400,)).fetchone()[0]

    def limited(self, session):
        return self.db.execute("SELECT count(*) FROM scenes WHERE session=? AND created>?", (session, self.clock()-3600)).fetchone()[0] >= 6

    def read(self, scene, asset):
        return self.blobs.read(scene.id, asset)

    def write(self, scene, asset, data):
        if not self.get(scene.id):
            raise ValueError("Scene expired")
        self.blobs.write(scene.id, asset, data)

    def remove(self, scene, asset):
        self.blobs.remove(scene.id, asset)

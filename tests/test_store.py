import asyncio
import os
from io import BytesIO
import tempfile
import unittest
from pathlib import Path

from spatium.store import BucketBusy, Database, R2Blobs, Store, Scene

# Set to a disposable Postgres URL to run these checks against Postgres instead of SQLite.
DATABASE = os.environ.get("SPATIUM_TEST_DATABASE_URL")


def open_store(directory, clock=None, **options):
    return Store(Path(directory), **({"clock": clock} if clock else {}), database=DATABASE, **options)


class FakeBucket:
    """The subset of the boto3 S3 client used by R2Blobs, held in memory."""

    def __init__(self):
        self.objects = {}
        self.reads = 0

    def get_paginator(self, name):
        bucket = self

        class Paginator:
            def paginate(self, Bucket, Prefix=""):
                yield {"Contents": [{"Key": key} for key in sorted(bucket.objects) if key.startswith(Prefix)]}
        return Paginator()

    def get_object(self, Bucket, Key):
        self.reads += 1
        return {"Body": BytesIO(self.objects[Key])}

    def put_object(self, Bucket, Key, Body, ContentType):
        self.objects[Key] = Body

    def delete_object(self, Bucket, Key):
        self.objects.pop(Key, None)


class StoreTests(unittest.TestCase):
    def setUp(self):
        if DATABASE:
            database = Database(DATABASE)
            database.execute("DROP TABLE IF EXISTS scenes")
            database.close()

    def test_restart_and_expiry(self):
        with tempfile.TemporaryDirectory() as directory:
            now = 1000
            def reopen():
                return open_store(directory, lambda: now)
            store = reopen()
            for state in ("upload", "sent"):
                scene = Scene(state, "owner", state, now)
                scene.dispatched = state != "upload"
                store.insert(scene)
            done = Scene("done", "owner", "done", now, stage="ready")
            done.stops = [{"label": "Arrival", "project": "first", "credits": 5}]
            store.insert(done)
            store.write(done, "stop-0", b"data")
            legacy = Scene("legacy", "owner", "legacy", now)
            store.insert(legacy)
            store.db.execute("UPDATE scenes SET metadata=? WHERE id='legacy'",
                             ('{"id": "legacy", "session": "owner", "submission": "legacy", "created": 1000, '
                              '"stage": "ready", "image": [2, 2], "walkthrough": false}',))
            (store.assets / "legacy").mkdir()
            (store.assets / "legacy" / "still").write_bytes(b"data")
            store.db.close()
            store = reopen()
            self.assertIn("before", store.get("upload").error)
            self.assertIn("history", store.get("sent").error)
            self.assertIsNone(store.get("legacy"))
            self.assertFalse((store.assets / "legacy").exists())
            now += 86400
            self.assertIsNone(store.get("done"))
            store.purge()
            self.assertFalse(list(store.assets.iterdir()))
            store.db.close()

    def test_interrupted_tour_preserves_completed_stops(self):
        with tempfile.TemporaryDirectory() as directory:
            store = open_store(directory)
            for state in ("between", "polling", "uncertain"):
                scene = Scene(state, "owner", state, store.clock(), stage="stylizing")
                scene.stops = [{"label":"Arrival", "project":"first", "credits":5}]
                scene.dispatched = state != "between"
                scene.project = "second" if state == "polling" else None
                store.insert(scene)
                for asset in ("source", "stop-0", "stop-1.partial"):
                    store.write(scene, asset, b"fixture")
            store.db.close()
            store = open_store(directory)
            try:
                for state in ("between", "polling", "uncertain"):
                    scene = store.get(state)
                    self.assertEqual(scene.stage, "failed" if state == "uncertain" else "needs_key")
                    self.assertEqual(len(scene.stops), 1)
                    self.assertEqual({f.name for f in (store.assets / state).iterdir()}, {"source","stop-0"})
            finally:
                store.db.close()

    def test_bucket_storage_restart_and_expiry(self):
        with tempfile.TemporaryDirectory() as directory:
            now = 1000
            bucket = FakeBucket()
            def reopen():
                return open_store(directory, lambda: now, blobs=R2Blobs("spatium", bucket))
            store = reopen()
            scene = Scene("polling", "owner", "polling", now, stage="stylizing", project="second")
            scene.stops = [{"label": "Arrival", "project": "first", "credits": 5}]
            scene.dispatched = True
            store.insert(scene)
            for asset in ("source", "stop-0", "stop-1"):
                store.write(scene, asset, asset.encode())
            bucket.objects["orphan/source"] = b"orphan"
            store.db.close()
            store = reopen()
            try:
                self.assertEqual(store.get("polling").stage, "needs_key")
                self.assertEqual(set(bucket.objects), {"polling/source", "polling/stop-0"})
                self.assertEqual(store.read(scene, "stop-0"), b"stop-0")
                store.remove(scene, "source")
                now += 86400
                store.purge()
                self.assertEqual(bucket.objects, {})
            finally:
                store.db.close()

    def test_bucket_reads_are_cached_and_budgeted(self):
        bucket = FakeBucket()
        now = [0.0]
        blobs = R2Blobs("spatium", bucket, cache_bytes=10, reads_per_second=1, read_burst=2, clock=lambda: now[0])
        blobs.write("scene", "stop-0", b"12345")
        for _ in range(100):
            self.assertEqual(blobs.read("scene", "stop-0"), b"12345")
        self.assertEqual(bucket.reads, 0)
        for name in ("a", "b", "c"):
            bucket.objects[f"scene/{name}"] = b"123456"
        blobs.read("scene", "a")
        blobs.read("scene", "b")
        self.assertLessEqual(blobs.cached, 10)
        with self.assertRaises(BucketBusy):
            blobs.read("scene", "c")
        now[0] += 1
        self.assertEqual(blobs.read("scene", "c"), b"123456")
        self.assertEqual(bucket.reads, 3)
        blobs.remove("scene")
        self.assertEqual((bucket.objects, blobs.cached), ({}, 0))

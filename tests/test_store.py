import asyncio
import tempfile
import unittest
from pathlib import Path

from spatium.store import Store, Scene


class StoreTests(unittest.TestCase):
    def test_restart_and_expiry(self):
        with tempfile.TemporaryDirectory() as directory:
            now = 1000
            def reopen():
                return Store(Path(directory), lambda: now)
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
            store = Store(Path(directory))
            for state in ("between", "polling", "uncertain"):
                scene = Scene(state, "owner", state, store.clock(), stage="stylizing")
                scene.stops = [{"label":"Arrival", "project":"first", "credits":5}]
                scene.dispatched = state != "between"
                scene.project = "second" if state == "polling" else None
                store.insert(scene)
                for asset in ("source", "stop-0", "stop-1.partial"):
                    store.write(scene, asset, b"fixture")
            store.db.close()
            store = Store(Path(directory))
            try:
                for state in ("between", "polling", "uncertain"):
                    scene = store.get(state)
                    self.assertEqual(scene.stage, "failed" if state == "uncertain" else "needs_key")
                    self.assertEqual(len(scene.stops), 1)
                    self.assertEqual({f.name for f in (store.assets / state).iterdir()}, {"source","stop-0"})
            finally:
                store.db.close()

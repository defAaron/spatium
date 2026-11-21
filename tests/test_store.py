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
            for state in ("upload", "sent", "known", "still"):
                scene = Scene(state, "owner", state, now)
                scene.dispatched = state != "upload"
                scene.project = "id" if state in {"known","still"} else None
                store.insert(scene)
                if state == "still":
                    store.write(scene, "still", b"data")
                    scene.image = (2, 2)
                store.save(scene)
            store.db.close()
            store = reopen()
            self.assertIn("before", store.get("upload").error)
            self.assertIn("history", store.get("sent").error)
            self.assertEqual(store.get("known").stage, "needs_key")
            self.assertEqual(store.get("still").stage, "still_ready")
            now += 86400
            self.assertIsNone(store.get("still"))
            store.purge()
            self.assertFalse(list(store.assets.iterdir()))
            store.db.close()

    def test_interrupted_tour_preserves_completed_stops(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory))
            for state in ("between", "polling", "uncertain"):
                scene = Scene(state, "owner", state, store.clock(), stage="stylizing", walkthrough=True)
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

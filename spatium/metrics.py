"""Report release measurements from the private volume while scenes are retained."""
import json
import sqlite3
import sys
from pathlib import Path


def report(directory):
    database = (Path(directory) / "scenes.sqlite3").resolve().as_uri()
    connection = sqlite3.connect(database + "?mode=ro", uri=True)
    try:
        scenes = []
        for raw, in connection.execute("SELECT metadata FROM scenes ORDER BY created"):
            record = json.loads(raw)
            row = {name: record.get(name) for name in (
                "id", "stage", "credits", "exports", "depth_failures", "render_failures")}
            for stage in ("still", "ready", "interactive"):
                at = record.get(stage + "_at")
                row[stage + "_seconds"] = round(at - record["created"], 2) if at else None
            scenes.append(row)
        return scenes
    finally:
        connection.close()


if __name__ == "__main__":
    print(json.dumps(report(sys.argv[1]), indent=2))

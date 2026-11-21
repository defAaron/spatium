"""Run the real application with a deterministic provider and depth fixture."""
import asyncio
import time
from io import BytesIO

from PIL import Image

from spatium import main
from spatium.demo import demo_assets

edits = 0
depth_attempts = 0


async def stylize(photo, key, on_stage, on_accepted, *, prompt=None, references=()):
    global edits
    if prompt is not None:
        from pathlib import Path
        from spatium.walkthrough import DIRECTIONS
        index = next(i for i, direction in enumerate(DIRECTIONS) if prompt.endswith(direction))
        on_stage("stylizing")
        on_accepted(f"tour-{index}", 5)
        await asyncio.sleep(0.65)
        return Path(f"public/assets/walkthrough/stop-{index}.jpg").read_bytes()
    edits += 1
    assert key == "fixture"
    on_stage("stylizing")
    on_accepted("test-project", 5)
    raise main.magic_hour.MagicHourError("Fixture provider paused. Resume the existing project.")


async def retrieve(project, key, on_accepted):
    assert project == "test-project" and key == "fixture" and edits == 1
    await asyncio.sleep(0.1)
    image = Image.open(BytesIO(demo_assets()[0])).crop((260, 0, 700, 640))
    return main.jpeg(image)


def estimate(image):
    global depth_attempts
    depth_attempts += 1
    time.sleep(1.8)
    if depth_attempts == 1:
        raise ValueError("Forced depth failure")
    grid = Image.frombytes("I;16", (240, 160), demo_assets()[1]).crop((65, 0, 175, 160))
    return *grid.size, grid.tobytes()


main.magic_hour.stylize = stylize
main.magic_hour.retrieve = retrieve
main.depth.estimate = estimate
main.depth.available = lambda: True
app = main.app

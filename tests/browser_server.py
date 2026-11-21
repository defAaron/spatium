"""Run the real application with a deterministic Magic Hour provider."""
import asyncio
from pathlib import Path

from spatium import main
from spatium.walkthrough import DIRECTIONS


async def stylize(photo, key, on_stage, on_accepted, *, prompt, references=()):
    assert key == "fixture"
    index = next(i for i, direction in enumerate(DIRECTIONS) if prompt.endswith(direction))
    on_stage("stylizing")
    on_accepted(f"tour-{index}", 5)
    await asyncio.sleep(0.65)
    return Path(f"public/assets/walkthrough/stop-{index}.jpg").read_bytes()


main.magic_hour.stylize = stylize
app = main.app

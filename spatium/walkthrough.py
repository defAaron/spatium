"""Generate linked spherical views from a single, normalized source photograph."""
from PIL import Image, ImageChops, ImageOps

from . import magic_hour

STOPS = ("Arrival", "Up close", "Beyond the landmark")
DIRECTIONS = (
    "Place the camera at the source photographer's position. The referenced main subject is directly "
    "ahead at the center, with a walkable route passing it on the right.",
    "Move the camera several strides FORWARD along the path to the RIGHT of the main subject. "
    "Stand directly beside it. Its identifiable side now fills the LEFT quarter. The route ahead "
    "occupies the center. The starting point is behind you at the wraparound seam.",
    "Move several more strides beyond the landmark and TURN BACK toward the starting point. "
    "Show the reverse side of that ONE landmark at the exact CENTER of the panorama. Keep it away "
    "from both wraparound edges. The surroundings beyond the landmark occupy the edges.",
)
FORMAT = (
    "Render one continuous, seamless 360 by 180 degree latitude-longitude equirectangular environment "
    "map, 2:1 ratio. Viewer is at human eye height INSIDE a handcrafted miniature of the supplied "
    "place. Extend the world in ALL directions including behind the photographer. The central "
    "horizontal scanline is the level horizon; zenith at top and ground at nadir, edges join at "
    "the rear meridian. Use model-scale wood and painted materials, consistent daylight and colors. "
    "Both reference images describe the SAME single location. Preserve the number, layout and identity of its landmarks. Fill the whole canvas; "
    "no labels, borders, collage, contact sheet, floating tabletop or text instructions. "
)


async def generate(scene, key, store, decode, jpeg):
    folder = store.assets / scene.id
    source = (folder / "source").read_bytes()
    while len(scene.stops) < len(STOPS):
        index = len(scene.stops)
        previous_credits = sum(stop["credits"] for stop in scene.stops)

        def dispatch(stage):
            scene.stage, scene.dispatched = stage, True
            store.save(scene)

        def accepted(project, credits):
            scene.project, scene.credits = project, previous_credits + credits
            store.save(scene)

        if scene.project:
            output = await magic_hour.retrieve(scene.project, key, accepted)
        else:
            if index:
                guide = (folder / f"stop-{index-1}").read_bytes()
                prompt = "The first image is the previous stop's spherical map; the second is the original photo. "
            else:
                image = decode(source)
                canvas = ImageOps.pad(image, (1536, 768), method=Image.Resampling.LANCZOS)
                guide = jpeg(canvas)
                prompt = "Use the reference for scene identity and replace the entire canvas with the environment map. "
            output = await magic_hour.stylize(guide, key, dispatch, accepted,
                                               prompt=FORMAT + prompt + DIRECTIONS[index],
                                               references=(source,) if index else ())
        image = decode(output)
        # Map the provider's rounded output dimensions to the exact spherical texture domain.
        width = min(3072, image.width)
        pano = image.resize((width, max(2, width // 2)), Image.Resampling.LANCZOS)
        if index == 2:
            # The generator faced backward to center the landmark away from the seam.
            # Register this map to the same forward heading as the first two stops.
            pano = ImageChops.offset(pano, pano.width // 2, 0)
        store.write(scene, f"stop-{index}", jpeg(pano))
        scene.stops.append({"label": STOPS[index], "project": scene.project,
                            "credits": (scene.credits or 0) - previous_credits})
        if index == 0:
            scene.still_at = store.clock()
        scene.project, scene.dispatched = None, False
        if len(scene.stops) == len(STOPS):
            scene.stage, scene.ready_at = "ready", store.clock()
        store.save(scene)
    (folder / "source").unlink(missing_ok=True)

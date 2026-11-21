from functools import lru_cache
from io import BytesIO
from random import Random
from struct import pack

from PIL import Image, ImageDraw

WIDTH, HEIGHT = 960, 640


@lru_cache(maxsize=1)
def demo_assets() -> tuple[bytes, bytes]:
    """Paint a sample scene and its matching depth layers for offline viewer development."""
    image = Image.new("RGB", (WIDTH, HEIGHT))
    depths = Image.new("I", (WIDTH, HEIGHT), 65535)
    art, plane = ImageDraw.Draw(image), ImageDraw.Draw(depths)
    rng = Random(241)

    def polygon(points, color, depth):
        art.polygon(points, fill=color)
        plane.polygon(points, fill=depth)

    for y in range(HEIGHT):
        art.line((0, y, WIDTH, y), fill=(114 + y // 7, 166 + y // 13, 170 + y // 16))
    art.ellipse((720, 58, 811, 149), fill="#fae4ab")

    polygon([(0, 290), (102, 178), (199, 277), (332, 117), (420, 207), (493, 152),
             (620, 285), (782, 171), (960, 294), (960, 640), (0, 640)], "#527974", 56000)
    polygon([(220, 250), (332, 117), (420, 207), (353, 178), (329, 200), (311, 173)], "#d7e3ce", 56000)
    polygon([(0, 350), (126, 292), (276, 334), (462, 273), (637, 337), (798, 272),
             (960, 315), (960, 640), (0, 640)], "#638b70", 44500)
    polygon([(0, 394), (220, 377), (425, 350), (660, 398), (960, 360), (960, 640), (0, 640)], "#8eab76", 36000)
    polygon([(0, 508), (191, 453), (447, 473), (645, 426), (960, 428), (960, 640), (0, 640)], "#718d56", 23500)
    polygon([(497, 382), (537, 389), (644, 439), (586, 502), (369, 640), (170, 640),
             (513, 492), (578, 444)], "#cbb98b", 19500)

    for _ in range(4200):
        x, y = rng.randrange(WIDTH), rng.randrange(HEIGHT)
        red, green, blue = image.getpixel((x, y))
        delta = rng.randint(-18, 18)
        color = tuple(max(0, min(255, channel + delta)) for channel in (red, green, blue))
        art.line((x, y, x + rng.randint(0, 3), y), fill=color)

    def cabin(x, y, scale, wall, roof, depth):
        def shape(points, color):
            polygon([(x + a * scale, y + b * scale) for a, b in points], color, depth)

        shape([(0, 5), (85, 5), (85, 68), (0, 68)], wall)
        shape([(85, 5), (118, -13), (118, 50), (85, 68)], "#9d6d48")
        shape([(0, 5), (43, -42), (85, 5)], wall)
        shape([(43, -42), (77, -59), (125, -12), (85, 8)], roof)
        shape([(-6, 6), (43, -45), (90, 6), (84, 10), (43, -34), (0, 10)], "#6a4036")
        shape([(35, 31), (52, 31), (52, 68), (35, 68)], "#4a5048")
        shape([(10, 25), (27, 25), (27, 42), (10, 42)], "#fbe3a3")
        shape([(62, 25), (78, 25), (78, 42), (62, 42)], "#fbe3a3")

    cabin(493, 333, 0.75, "#e0bb86", "#9a5845", 30000)
    cabin(660, 381, 1.18, "#e0ac74", "#b5674f", 23000)
    cabin(265, 399, 1.34, "#e6c99d", "#a65643", 18500)

    def tree(x, y, height, depth):
        polygon([(x - 5, y), (x + 5, y), (x + 4, y - height // 3), (x - 4, y - height // 3)], "#624c39", depth)
        for level, color in enumerate(("#254e43", "#346657", "#487d65")):
            base = y - (level + 1) * height // 5
            radius = height * (3 - level) // 11
            polygon([(x, base - height * 2 // 5), (x - radius, base), (x + radius, base)], color, depth)

    for x, y, size, depth in [(156, 458, 88, 21000), (191, 453, 75, 22000),
                              (775, 481, 101, 18000), (820, 493, 125, 16000),
                              (87, 600, 180, 3500), (886, 609, 165, 4000),
                              (938, 629, 136, 2400), (151, 602, 103, 5400)]:
        tree(x, y, size, depth)

    jpg = BytesIO()
    image.save(jpg, "JPEG", quality=89)
    depth = depths.resize((240, 160), Image.Resampling.NEAREST)
    return jpg.getvalue(), pack("<38400H", *depth.get_flattened_data())

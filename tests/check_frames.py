"""Compare decoded frames to Chromium screenshots of the corresponding playback poses."""
import subprocess
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

clip = Path(sys.argv[1])
for n in (0, 90, 179):
    encoded = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(clip),
                                       "-vf", f"select=eq(n\\,{n})", "-frames:v", "1",
                                       "-f", "image2pipe", "-vcodec", "png", "-"])
    reference = Image.open(clip.with_name(f"{clip.stem}{n}.png")).convert("RGB")
    frame = Image.open(BytesIO(encoded)).convert("RGB").resize(reference.size)
    # Compare normalized luminance to measure framing independently of the
    # browser encoder's RGB-to-YUV matrix and video-range conversion.
    def normalized(image):
        gray = image.convert("L")
        stats = ImageStat.Stat(gray)
        return gray.point(lambda value: 128 + (value - stats.mean[0]) * 45 / stats.stddev[0])
    diff = ImageChops.difference(normalized(frame), normalized(reference))
    mean = sum(ImageStat.Stat(diff).mean) / 3
    assert mean < 5, f"{clip.stem} frame {n} differs from preview by {mean:.2f} levels"

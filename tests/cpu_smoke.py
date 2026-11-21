from io import BytesIO
from struct import unpack

from PIL import Image

from spatium.demo import demo_assets
from spatium.depth import estimate

with Image.open(BytesIO(demo_assets()[0])) as image:
    width, height, data = estimate(image)
    values = unpack(f'<{width * height}H', data)
    assert max(values) - min(values) > 30000
    print(f'Depth Anything inferred a {width}×{height} relative-depth map on CPU.')

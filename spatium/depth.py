from functools import lru_cache
from importlib.util import find_spec

from PIL import Image

MODEL_ID = "depth-anything/Depth-Anything-V2-Small-hf"


def available() -> bool:
    return all(find_spec(module) is not None for module in ("torch", "torchvision", "transformers", "numpy"))


@lru_cache(maxsize=1)
def load_model():
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation

    return (
        AutoImageProcessor.from_pretrained(MODEL_ID, use_fast=False),
        AutoModelForDepthEstimation.from_pretrained(MODEL_ID).eval(),
    )


def estimate(image: Image.Image) -> tuple[int, int, bytes]:
    import torch

    processor, model = load_model()
    width, height = image.size
    scale = min(1, 256 / max(width, height))
    width, height = max(2, round(width * scale)), max(2, round(height * scale))

    with torch.inference_mode():
        result = model(**processor(images=image, return_tensors="pt"))
        prediction = torch.nn.functional.interpolate(
            result.predicted_depth[:, None], size=(height, width),
            mode="bicubic", align_corners=False,
        )[0, 0].numpy()

    return width, height, encode_depth(prediction)


def encode_depth(prediction) -> bytes:
    import numpy as np

    if not np.isfinite(prediction).all():
        raise ValueError("Non-finite depth prediction")
    low, high = np.percentile(prediction, [2, 98])
    if high - low < 1e-6:
        raise ValueError("No usable depth range")
    # Larger model predictions represent closer points. The scene buffer uses 0 for near.
    depth = 1 - np.clip((prediction - low) / (high - low), 0, 1)
    return np.rint(depth * 65535).astype("<u2").tobytes()

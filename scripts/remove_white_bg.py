#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def remove_white_background(image: Image.Image, threshold: int, soft_band: int) -> Image.Image:
    img = image.convert("RGBA")
    pixels = img.load()
    width, height = img.size

    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            whiteness = min(r, g, b)
            if whiteness >= threshold:
                pixels[x, y] = (r, g, b, 0)
                continue
            if soft_band > 0 and whiteness >= threshold - soft_band:
                fade = (threshold - whiteness) / soft_band
                alpha = max(0, min(255, int(a * fade)))
                pixels[x, y] = (r, g, b, alpha)

    return img


def main() -> None:
    parser = argparse.ArgumentParser(description="Remove near-white background from an image.")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--threshold", type=int, default=245, help="Pixels with all RGB channels >= threshold become transparent.")
    parser.add_argument("--soft-band", type=int, default=10, help="Feather alpha below threshold.")
    args = parser.parse_args()

    image = Image.open(args.input)
    cleaned = remove_white_background(image, threshold=args.threshold, soft_band=args.soft_band)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    cleaned.save(args.output)


if __name__ == "__main__":
    main()

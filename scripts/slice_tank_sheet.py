#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from PIL import Image


CELL_MAP = {
    "nw": (2, 0),
    "n": (1, 0),
    "ne": (0, 0),
    "w": (3, 0),
    "sw": (0, 1),
    "s": (1, 1),
    "se": (2, 1),
    "e": (3, 1),
}


def main() -> None:
    source = Path("lataukset/tankki1.png")
    full_out = Path("client/public/assets/tanks")
    low_out = Path("client/public/assets/low/tanks")

    img = Image.open(source).convert("RGBA")
    frame_w = img.width // 4
    frame_h = img.height // 2

    full_out.mkdir(parents=True, exist_ok=True)
    low_out.mkdir(parents=True, exist_ok=True)

    for direction, (col, row) in CELL_MAP.items():
      frame = img.crop((col * frame_w, row * frame_h, (col + 1) * frame_w, (row + 1) * frame_h))
      frame.save(full_out / f"tank_ready_{direction}.png")
      frame.resize((64, 64), Image.Resampling.LANCZOS).save(low_out / f"tank_ready_{direction}.png")


if __name__ == "__main__":
    main()

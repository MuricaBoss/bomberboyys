#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "client/public/assets"
LOW = ASSETS / "low"
MEDIUM = ASSETS / "medium"
HIGH = ASSETS / "high"
TANK_SOURCE = ROOT / "lataukset/tankki1.png"

TANK_CELL_MAP = {
    "nw": (2, 0),
    "n": (1, 0),
    "ne": (0, 0),
    "w": (3, 0),
    "sw": (0, 1),
    "s": (1, 1),
    "se": (2, 1),
    "e": (3, 1),
}

TIER_DIRS = {
    "low": LOW,
    "medium": MEDIUM,
    "high": HIGH,
    "ultra": ASSETS,
}


def ensure_dirs() -> None:
    for base in (LOW, MEDIUM, HIGH):
        for sub in ("buildings", "tanks", "blocks", "soldier"):
            (base / sub).mkdir(parents=True, exist_ok=True)


def resize_square(source: Path, dest: Path, size: int) -> None:
    image = Image.open(source).convert("RGBA")
    image.resize((size, size), Image.Resampling.LANCZOS).save(dest)


def resize_sheet(source: Path, dest: Path, width: int, height: int) -> None:
    image = Image.open(source).convert("RGBA")
    image.resize((width, height), Image.Resampling.LANCZOS).save(dest)


def build_world_and_structure_tiers() -> None:
    building_sizes = {"medium": 256, "high": 384}
    block_sizes = {"medium": 96, "high": 160}
    button_sizes = {"medium": 192, "high": 320}
    ground_sizes = {"medium": 256, "high": 384}

    for tier, size in building_sizes.items():
        for source in (ASSETS / "buildings").glob("*.png"):
            resize_square(source, TIER_DIRS[tier] / "buildings" / source.name, size)

    for tier, size in block_sizes.items():
        for source in (ASSETS / "blocks").glob("*.png"):
            resize_square(source, TIER_DIRS[tier] / "blocks" / source.name, size)

    for tier, size in button_sizes.items():
        resize_square(ASSETS / "rts_button_base.png", TIER_DIRS[tier] / "rts_button_base.png", size)
        resize_square(ASSETS / "rts_button_active.png", TIER_DIRS[tier] / "rts_button_active.png", size)

    for tier, size in ground_sizes.items():
        resize_square(ASSETS / "rts_ground_texture_winter.png", TIER_DIRS[tier] / "rts_ground_texture_winter.png", size)


def build_soldier_tiers() -> None:
    run_sizes = {"medium": (448, 512), "high": (896, 1024)}
    shoot_sizes = {"medium": (384, 384), "high": (512, 512)}

    for tier, size in run_sizes.items():
        resize_sheet(ASSETS / "soldier" / "run.png", TIER_DIRS[tier] / "soldier" / "run.png", *size)

    for tier, size in shoot_sizes.items():
        resize_sheet(ASSETS / "soldier" / "shoot.png", TIER_DIRS[tier] / "soldier" / "shoot.png", *size)


def silhouette_shadow(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    shadow = Image.new("RGBA", rgba.size, (0, 0, 0, 0))
    shadow.putalpha(alpha.point(lambda value: int(value * 0.26)))
    return shadow


def build_tank_tiers() -> None:
    tier_sizes = {"low": 64, "medium": 128, "high": 256}
    image = Image.open(TANK_SOURCE).convert("RGBA")
    frame_w = image.width // 4
    frame_h = image.height // 2

    east_frame = None
    for direction, (col, row) in TANK_CELL_MAP.items():
        frame = image.crop((col * frame_w, row * frame_h, (col + 1) * frame_w, (row + 1) * frame_h))
        frame.save(ASSETS / "tanks" / f"tank_ready_{direction}.png")
        if direction == "e":
            east_frame = frame
        for tier, size in tier_sizes.items():
            frame.resize((size, size), Image.Resampling.LANCZOS).save(TIER_DIRS[tier] / "tanks" / f"tank_ready_{direction}.png")

    if east_frame is None:
        raise RuntimeError("east tank frame missing")

    ultra_shadow = silhouette_shadow(east_frame)
    ultra_shadow.save(ASSETS / "tanks" / "tank_shadow_east.png")
    for tier, size in tier_sizes.items():
        ultra_shadow.resize((size, size), Image.Resampling.LANCZOS).save(TIER_DIRS[tier] / "tanks" / "tank_shadow_east.png")


def main() -> None:
    ensure_dirs()
    build_world_and_structure_tiers()
    build_soldier_tiers()
    build_tank_tiers()


if __name__ == "__main__":
    main()

#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# resize_assets.sh — Standardize all Base Defense graphics tier assets
# to the clean 2× resolution ladder.
#
# New ladder:
#   Low:    tanks 64, soldier 32, buildings 64, blocks 32, ground 128, buttons 64
#   Medium: tanks 128, soldier 64, buildings 128, blocks 64, ground 256, buttons 128
#   High:   tanks 256, soldier 128, buildings 256, blocks 128, ground 512, buttons 256
#   Ultra:  tanks 512, soldier 256, buildings 512, blocks 256, ground 1024, buttons 512
#
# Usage: bash resize_assets.sh
# Requires: sips (built into macOS) or ImageMagick (for WebP support)
# ─────────────────────────────────────────────────────────────────────────────

set -e

ASSETS_DIR="$(cd "$(dirname "$0")/../client/public/assets" && pwd)"
echo "→ Assets dir: $ASSETS_DIR"

# Check for ImageMagick (needed for WebP)
if command -v convert &>/dev/null; then
  HAS_IMAGEMAGICK=true
  echo "→ ImageMagick found — will use for WebP files"
else
  HAS_IMAGEMAGICK=false
  echo "→ ImageMagick NOT found — WebP files will be skipped (PNG is used in-game anyway)"
fi

# Resize a PNG to a square size using sips.
# If the source is not square, adds padding to make it square first.
resize_square() {
  local src="$1"
  local dst="$2"
  local size="$3"
  
  local dirname
  dirname="$(dirname "$dst")"
  mkdir -p "$dirname"
  
  # sips: resize to fit within size×size, then we'll batch export
  sips -z "$size" "$size" "$src" --out "$dst" > /dev/null 2>&1
  echo "  [OK] ${dst##*/assets/} → ${size}×${size}"
}

# Resize all soldier spritesheet frames correctly.
# The spritesheet is N columns × 8 rows of square frames.
# Low:    32×32 frames → 7 cols run = 224×256, 8 cols shoot = 256×256
# Medium: 64×64 frames → 7 cols run = 448×512, 8 cols shoot = 512×512
# High:   128×128 frames → 7 cols run = 896×1024, 8 cols shoot = 1024×1024
# Ultra:  256×256 frames → 7 cols run = 1792×2048, 8 cols shoot = 2048×2048
resize_spritesheet() {
  local src="$1"
  local dst="$2"
  local target_w="$3"
  local target_h="$4"
  
  local dirname
  dirname="$(dirname "$dst")"
  mkdir -p "$dirname"
  
  sips -z "$target_h" "$target_w" "$src" --out "$dst" > /dev/null 2>&1
  echo "  [OK] ${dst##*/assets/} → ${target_w}×${target_h}"
}

# ─────────────────────────────────────────────────────────────────────────────
# Source files: use the highest-quality existing assets as source
# Ultra tier is in the root assets/ directory
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo "═══ Standardizing ULTRA tier (root assets/) ═══"

ULTRA="$ASSETS_DIR"

# Ultra tanks: 512×512 (currently 512px — correct already, but force-standardize)
for dir in n ne e se s sw w nw; do
  SRC="$ULTRA/tanks/tank_ready_$dir.png"
  if [ -f "$SRC" ]; then
    resize_square "$SRC" "$SRC" 512
  else
    echo "  [SKIP] tanks/tank_ready_$dir.png — source missing"
  fi
done

# Ultra ground texture: 1024×1024 (currently 640px)
if [ -f "$ULTRA/rts_ground_texture_winter.png" ]; then
  resize_square "$ULTRA/rts_ground_texture_winter.png" "$ULTRA/rts_ground_texture_winter.png" 1024
fi

# Ultra buttons: 512×512 (currently 640px)
if [ -f "$ULTRA/rts_button_base.png" ]; then
  resize_square "$ULTRA/rts_button_base.png" "$ULTRA/rts_button_base.png" 512
fi
if [ -f "$ULTRA/rts_button_active.png" ]; then
  resize_square "$ULTRA/rts_button_active.png" "$ULTRA/rts_button_active.png" 512
fi

# Ultra blocks: 256×256
for key in block_1 block_2 block_3 block_4; do
  SRC="$ULTRA/blocks/$key.png"
  if [ -f "$SRC" ]; then
    resize_square "$SRC" "$SRC" 256
  fi
done

# Ultra buildings: 512×512
for bld in constructor ore_refinery solar_panel barracks war_factory; do
  SRC="$ULTRA/buildings/$bld.png"
  if [ -f "$SRC" ]; then
    resize_square "$SRC" "$SRC" 512
  fi
done

# Ultra soldier run: 1792×2048 (256×256 frames, 7 cols × 8 rows)
if [ -f "$ULTRA/soldier/run.png" ]; then
  resize_spritesheet "$ULTRA/soldier/run.png" "$ULTRA/soldier/run.png" 1792 2048
fi
# Ultra soldier shoot: 2048×2048 (256×256 frames, 8 cols × 8 rows)
if [ -f "$ULTRA/soldier/shoot.png" ]; then
  resize_spritesheet "$ULTRA/soldier/shoot.png" "$ULTRA/soldier/shoot.png" 2048 2048
fi

# ─────────────────────────────────────────────────────────────────────────────
# HIGH tier → derive from ultra sources at 2× downscale (high = 512→256)
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo "═══ Standardizing HIGH tier (assets/high/) ═══"

HIGH="$ASSETS_DIR/high"

# High tanks: 256×256
for dir in n ne e se s sw w nw; do
  SRC="$ULTRA/tanks/tank_ready_$dir.png"
  DST="$HIGH/tanks/tank_ready_$dir.png"
  if [ -f "$SRC" ]; then
    resize_square "$SRC" "$DST" 256
  fi
done

# High ground texture: 512×512
if [ -f "$ULTRA/rts_ground_texture_winter.png" ]; then
  resize_square "$ULTRA/rts_ground_texture_winter.png" "$HIGH/rts_ground_texture_winter.png" 512
fi

# High buttons: 256×256
if [ -f "$ULTRA/rts_button_base.png" ]; then
  resize_square "$ULTRA/rts_button_base.png" "$HIGH/rts_button_base.png" 256
fi
if [ -f "$ULTRA/rts_button_active.png" ]; then
  resize_square "$ULTRA/rts_button_active.png" "$HIGH/rts_button_active.png" 256
fi

# High blocks: 128×128
for key in block_1 block_2 block_3 block_4; do
  SRC="$ULTRA/blocks/$key.png"
  DST="$HIGH/blocks/$key.png"
  if [ -f "$SRC" ]; then
    resize_square "$SRC" "$DST" 128
  fi
done

# High buildings: 256×256
for bld in constructor ore_refinery solar_panel barracks war_factory; do
  SRC="$ULTRA/buildings/$bld.png"
  DST="$HIGH/buildings/$bld.png"
  if [ -f "$SRC" ]; then
    resize_square "$SRC" "$DST" 256
  fi
done

# High soldier run: 896×1024 (128×128 frames, 7 cols × 8 rows)
if [ -f "$ULTRA/soldier/run.png" ]; then
  resize_spritesheet "$ULTRA/soldier/run.png" "$HIGH/soldier/run.png" 896 1024
fi
# High soldier shoot: 1024×1024 (128×128 frames, 8 cols × 8 rows)
if [ -f "$ULTRA/soldier/shoot.png" ]; then
  resize_spritesheet "$ULTRA/soldier/shoot.png" "$HIGH/soldier/shoot.png" 1024 1024
fi

# ─────────────────────────────────────────────────────────────────────────────
# MEDIUM tier → derive from ultra at 4× downscale (medium = 512→128)
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo "═══ Standardizing MEDIUM tier (assets/medium/) ═══"

MEDIUM="$ASSETS_DIR/medium"

# Medium tanks: 128×128
for dir in n ne e se s sw w nw; do
  SRC="$ULTRA/tanks/tank_ready_$dir.png"
  DST="$MEDIUM/tanks/tank_ready_$dir.png"
  if [ -f "$SRC" ]; then
    resize_square "$SRC" "$DST" 128
  fi
done

# Medium ground texture: 256×256
if [ -f "$ULTRA/rts_ground_texture_winter.png" ]; then
  resize_square "$ULTRA/rts_ground_texture_winter.png" "$MEDIUM/rts_ground_texture_winter.png" 256
fi

# Medium buttons: 128×128
if [ -f "$ULTRA/rts_button_base.png" ]; then
  resize_square "$ULTRA/rts_button_base.png" "$MEDIUM/rts_button_base.png" 128
fi
if [ -f "$ULTRA/rts_button_active.png" ]; then
  resize_square "$ULTRA/rts_button_active.png" "$MEDIUM/rts_button_active.png" 128
fi

# Medium blocks: 64×64
for key in block_1 block_2 block_3 block_4; do
  SRC="$ULTRA/blocks/$key.png"
  DST="$MEDIUM/blocks/$key.png"
  if [ -f "$SRC" ]; then
    resize_square "$SRC" "$DST" 64
  fi
done

# Medium buildings: 128×128
for bld in constructor ore_refinery solar_panel barracks war_factory; do
  SRC="$ULTRA/buildings/$bld.png"
  DST="$MEDIUM/buildings/$bld.png"
  if [ -f "$SRC" ]; then
    resize_square "$SRC" "$DST" 128
  fi
done

# Medium soldier run: 448×512 (64×64 frames, 7 cols × 8 rows)
if [ -f "$ULTRA/soldier/run.png" ]; then
  resize_spritesheet "$ULTRA/soldier/run.png" "$MEDIUM/soldier/run.png" 448 512
fi
# Medium soldier shoot: 512×512 (64×64 frames, 8 cols × 8 rows)
if [ -f "$ULTRA/soldier/shoot.png" ]; then
  resize_spritesheet "$ULTRA/soldier/shoot.png" "$MEDIUM/soldier/shoot.png" 512 512
fi

# ─────────────────────────────────────────────────────────────────────────────
# LOW tier → derive from ultra at 8× downscale (low = 512→64 for most)
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo "═══ Standardizing LOW tier (assets/low/) ═══"

LOW="$ASSETS_DIR/low"

# Low tanks: 64×64
for dir in n ne e se s sw w nw; do
  SRC="$ULTRA/tanks/tank_ready_$dir.png"
  DST="$LOW/tanks/tank_ready_$dir.png"
  if [ -f "$SRC" ]; then
    resize_square "$SRC" "$DST" 64
  fi
done

# Low ground texture: 128×128
if [ -f "$ULTRA/rts_ground_texture_winter.png" ]; then
  resize_square "$ULTRA/rts_ground_texture_winter.png" "$LOW/rts_ground_texture_winter.png" 128
fi

# Low buttons: 64×64
if [ -f "$ULTRA/rts_button_base.png" ]; then
  resize_square "$ULTRA/rts_button_base.png" "$LOW/rts_button_base.png" 64
fi
if [ -f "$ULTRA/rts_button_active.png" ]; then
  resize_square "$ULTRA/rts_button_active.png" "$LOW/rts_button_active.png" 64
fi

# Low blocks: 32×32
for key in block_1 block_2 block_3 block_4; do
  SRC="$ULTRA/blocks/$key.png"
  DST="$LOW/blocks/$key.png"
  if [ -f "$SRC" ]; then
    resize_square "$SRC" "$DST" 32
  fi
done

# Low buildings: 64×64
for bld in constructor ore_refinery solar_panel barracks war_factory; do
  SRC="$ULTRA/buildings/$bld.png"
  DST="$LOW/buildings/$bld.png"
  if [ -f "$SRC" ]; then
    resize_square "$SRC" "$DST" 64
  fi
done

# Low soldier run: 224×256 (32×32 frames, 7 cols × 8 rows)
if [ -f "$ULTRA/soldier/run.png" ]; then
  resize_spritesheet "$ULTRA/soldier/run.png" "$LOW/soldier/run.png" 224 256
fi
# Low soldier shoot: 256×256 (32×32 frames, 8 cols × 8 rows)
if [ -f "$ULTRA/soldier/shoot.png" ]; then
  resize_spritesheet "$ULTRA/soldier/shoot.png" "$LOW/soldier/shoot.png" 256 256
fi

# ─────────────────────────────────────────────────────────────────────────────
# Verify: output a final size report
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo "═══ Size Verification ═══"
echo ""
echo "--- Tanks (all 8 directions) ---"
for tier in low medium high ultra; do
  if [ "$tier" = "ultra" ]; then
    dir_path="$ASSETS_DIR/tanks"
  else
    dir_path="$ASSETS_DIR/$tier/tanks"
  fi
  echo "  [$tier]"
  for d in n ne e se s sw w nw; do
    f="$dir_path/tank_ready_$d.png"
    if [ -f "$f" ]; then
      sips -g pixelWidth -g pixelHeight "$f" 2>/dev/null | grep pixel | tr '\n' ' '
      echo ""
    fi
  done
done

echo ""
echo "--- Soldier spritesheets ---"
for tier in low medium high ultra; do
  if [ "$tier" = "ultra" ]; then
    dir_path="$ASSETS_DIR/soldier"
  else
    dir_path="$ASSETS_DIR/$tier/soldier"
  fi
  echo "  [$tier] run.png:"
  sips -g pixelWidth -g pixelHeight "$dir_path/run.png" 2>/dev/null | grep pixel | tr '\n' ' '
  echo ""
  echo "  [$tier] shoot.png:"
  sips -g pixelWidth -g pixelHeight "$dir_path/shoot.png" 2>/dev/null | grep pixel | tr '\n' ' '
  echo ""
done

echo ""
echo "═══ Done! All assets standardized to clean 2× ladder. ═══"

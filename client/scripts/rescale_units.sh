#!/bin/bash

# Base directories
ASSETS_DIR="public/assets"
TIERS=("high" "medium" "low")

# New Ultra targets (Root): Tank=128, Soldier=64 (frame size)
# Current Ultra sizes (Root): Tank=256, Soldier=128 (frame size)

echo "Optimizing Tank assets..."
TANKS=("tank_ready_n.png" "tank_ready_ne.png" "tank_ready_e.png" "tank_ready_se.png" "tank_ready_s.png" "tank_ready_sw.png" "tank_ready_w.png" "tank_ready_nw.png")

# 1. Update Ultra (Root) - Scale 256 -> 128
for tank in "${TANKS[@]}"; do
    if [ -f "$ASSETS_DIR/tanks/$tank" ]; then
        ffmpeg -y -i "$ASSETS_DIR/tanks/$tank" -vf "scale=128:128" "$ASSETS_DIR/tanks/tmp_$tank" > /dev/null 2>&1
        mv "$ASSETS_DIR/tanks/tmp_$tank" "$ASSETS_DIR/tanks/$tank"
        echo "  Scaled Ultra $tank to 128px"
    fi
done

# 2. Update tiers (High, Medium, Low)
# Tank Sizes: High=64, Medium=48, Low=32
TIER_TANK_SIZES=("high:64" "medium:48" "low:32")
for entry in "${TIER_TANK_SIZES[@]}"; do
    tier="${entry%%:*}"
    size="${entry##*:}"
    echo "Processing Tank Tier: $tier ($size px)..."
    for tank in "${TANKS[@]}"; do
        if [ -f "$ASSETS_DIR/tanks/$tank" ]; then
            mkdir -p "$ASSETS_DIR/$tier/tanks"
            ffmpeg -y -i "$ASSETS_DIR/tanks/$tank" -vf "scale=$size:$size" "$ASSETS_DIR/$tier/tanks/$tank" > /dev/null 2>&1
        fi
    done
done

echo "Optimizing Soldier assets..."
SOLDIERS=("run.png" "shoot.png")
# Soldier sheet size depends on frame size. 7 columns, 8 rows.
# Ultra (64px frame)  -> 7*64=448 wide, 8*64=512 high.
# High (32px frame)   -> 7*32=224 wide, 8*32=256 high.
# Medium (24px frame) -> 7*24=168 wide, 8*24=192 high.
# Low (16px frame)    -> 7*16=112 wide, 8*16=128 high.

# 1. Update Ultra (Root) - Scale from current 896x1024 to 448x512
for s in "${SOLDIERS[@]}"; do
    if [ -f "$ASSETS_DIR/soldier/$s" ]; then
        ffmpeg -y -i "$ASSETS_DIR/soldier/$s" -vf "scale=448:512" "$ASSETS_DIR/soldier/tmp_$s" > /dev/null 2>&1
        mv "$ASSETS_DIR/soldier/tmp_$s" "$ASSETS_DIR/soldier/$s"
        echo "  Scaled Ultra $s to 448x512 (64px frames)"
    fi
done

# 2. Update tiers
TIER_SOLDIER_SIZES=("high:224:256" "medium:168:192" "low:112:128")
for entry in "${TIER_SOLDIER_SIZES[@]}"; do
    tier="${entry%%:*:*}"
    w=$(echo $entry | cut -d: -f2)
    h=$(echo $entry | cut -d: -f3)
    echo "Processing Soldier Tier: $tier (${w}x${h})..."
    for s in "${SOLDIERS[@]}"; do
        if [ -f "$ASSETS_DIR/soldier/$s" ]; then
            mkdir -p "$ASSETS_DIR/$tier/soldier"
            ffmpeg -y -i "$ASSETS_DIR/soldier/$s" -vf "scale=$w:$h" "$ASSETS_DIR/$tier/soldier/$s" > /dev/null 2>&1
        fi
    done
done

echo "Optimization complete."

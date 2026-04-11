#!/bin/bash
# Resize assets for ultra-low mobile performance (Build 96)
# Converts WebP to PNG and targets native 1:1 scaling (no supersampling)

ASSETS_DIR="client/public/assets"
LOW_DIR="$ASSETS_DIR/low"

mkdir -p "$LOW_DIR/buildings" "$LOW_DIR/tanks" "$LOW_DIR/blocks" "$LOW_DIR/soldier" "$LOW_DIR/ui"

echo "Resizing buildings to 96x96 (Native 3-tile)..."
for f in "$ASSETS_DIR/buildings"/*.webp; do
  sips -s format png -Z 96 "$f" --out "$LOW_DIR/buildings/$(basename "${f%.webp}.png")"
done

echo "Resizing tanks to 64x64 (Native unit size)..."
for f in "$ASSETS_DIR/tanks"/*.webp; do
  sips -s format png -Z 64 "$f" --out "$LOW_DIR/tanks/$(basename "${f%.webp}.png")"
done

echo "Resizing blocks to 32x32 (Native tile size)..."
for f in "$ASSETS_DIR/blocks"/*.png; do
  sips -Z 32 "$f" --out "$LOW_DIR/blocks/$(basename "$f")"
done

echo "Resizing ground to 128x128 (Native texture tile)..."
sips -s format png -Z 128 "$ASSETS_DIR/rts_ground_texture_winter.webp" --out "$LOW_DIR/rts_ground_texture_winter.png"

echo "Resizing UI buttons to 96x96..."
sips -s format png -Z 96 "$ASSETS_DIR/rts_button_base.webp" --out "$LOW_DIR/rts_button_base.png"
sips -s format png -Z 96 "$ASSETS_DIR/rts_button_active.webp" --out "$LOW_DIR/rts_button_active.png"

echo "Resizing soldier run sheet to 224x256 (32px frames across 7x8 directions)..."
sips -z 256 224 "$ASSETS_DIR/soldier/run.png" --out "$LOW_DIR/soldier/run.png"
echo "Resizing soldier shoot sheet to 256x256..."
sips -s format png -Z 256 "$ASSETS_DIR/soldier/shoot.webp" --out "$LOW_DIR/soldier/shoot.png"

echo "Ultra-low optimization complete."

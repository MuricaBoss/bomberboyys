export type GraphicsQuality = "low" | "medium" | "high" | "ultra";
export type GraphicsAssetTier = GraphicsQuality;

const STORAGE_KEY = "bomber_boys_graphics_quality";
const ORDER: GraphicsQuality[] = ["low", "medium", "high", "ultra"];

export function getGraphicsQuality(): GraphicsQuality {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "low" || value === "medium" || value === "high" || value === "ultra" ? value : "high";
  } catch {
    return "high";
  }
}

export function setGraphicsQuality(value: GraphicsQuality) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Ignore storage failures and keep runtime behavior.
  }
}

export function cycleGraphicsQuality(): GraphicsQuality {
  const current = getGraphicsQuality();
  const index = ORDER.indexOf(current);
  const next = ORDER[(index + 1) % ORDER.length] ?? "high";
  setGraphicsQuality(next);
  return next;
}

/**
 * Canvas render resolution multiplier per quality tier.
 *
 * Strategy:
 *   Low    → Always 1.0 — pixel-art mode, no retina upscaling needed.
 *   Medium → Up to 1.5× native DPR — looks good on most phones/laptops.
 *   High   → Up to native DPR (cap 2.0) — crisp on Retina without VRAM waste.
 *   Ultra  → Full native DPR — every physical pixel is used.
 */
export function getGraphicsResolution(quality: GraphicsQuality): number {
  const dpr = window.devicePixelRatio || 1;
  if (quality === "low") return 1.0;
  if (quality === "medium") return Math.min(dpr, 1.5);
  if (quality === "high") return Math.min(dpr, 2.0);
  return dpr; // ultra — full native
}

export function getGraphicsQualityLabel(quality: GraphicsQuality) {
  if (quality === "low") return "Low";
  if (quality === "medium") return "Medium";
  if (quality === "high") return "High";
  return "Ultra";
}

export function getGraphicsAssetTier(quality: GraphicsQuality) {
  return quality;
}

export function getGraphicsProfile(quality: GraphicsQuality) {
  if (quality === "low") {
    return {
      worldTier: "low" as GraphicsAssetTier,
      structureTier: "low" as GraphicsAssetTier,
      unitTier: "low" as GraphicsAssetTier,
    };
  }
  if (quality === "medium") {
    return {
      worldTier: "medium" as GraphicsAssetTier,
      structureTier: "medium" as GraphicsAssetTier,
      unitTier: "medium" as GraphicsAssetTier,
    };
  }
  if (quality === "high") {
    return {
      worldTier: "high" as GraphicsAssetTier,
      structureTier: "high" as GraphicsAssetTier,
      unitTier: "high" as GraphicsAssetTier,
    };
  }
  return {
    worldTier: "ultra" as GraphicsAssetTier,
    structureTier: "ultra" as GraphicsAssetTier,
    unitTier: "ultra" as GraphicsAssetTier,
  };
}

export function getTieredTextureKey(baseKey: string, tier: GraphicsAssetTier) {
  return `${baseKey}__${tier}`;
}

/**
 * Only Low uses pixel-art / nearest-neighbor mode.
 * Medium and above use bilinear filtering + antialiasing so photorealistic
 * assets don't look crunchy when downscaled.
 */
export function shouldRoundPixels(quality: GraphicsQuality) {
  return quality === "low";
}

/**
 * Whether to enable Phaser antialias for a given quality level.
 * Low: off (pixel art mode).
 * Medium+: on (smooth filtering for photorealistic assets).
 */
export function shouldAntialias(quality: GraphicsQuality) {
  return quality !== "low";
}

/**
 * Target FPS per quality tier.
 * Low → 30fps for weak/mobile devices.
 * Medium+ → 60fps for smooth gameplay on modern hardware.
 */
export function getTargetFps(quality: GraphicsQuality): number {
  return quality === "low" ? 30 : 60;
}

/**
 * Phaser WebGL batch size per quality tier.
 * Larger batches = fewer draw calls = better GPU throughput.
 */
export function getBatchSize(quality: GraphicsQuality): number {
  if (quality === "low") return 2048;
  if (quality === "medium") return 4096;
  if (quality === "high") return 4096;
  return 8192;
}

/**
 * Asset base path for a given tier.
 * Ultra → root assets/ (highest quality masters).
 * Others → assets/{tier}/
 */
export function getAssetBasePath(tier: GraphicsAssetTier) {
  return tier === "ultra" ? "assets" : `assets/${tier}`;
}

// ─── Clean 2× Resolution Ladder ───────────────────────────────────────────────
//
// Each tier is exactly 2× the previous tier. This ensures:
//   - No aliasing from massive downscaling (old Ultra was 512px displayed at 32px)
//   - Consistent memory budget per tier
//   - Clean bilinear filtering when scaled to display size
//
// Soldier is displayed at RTS_SOLDIER_DISPLAY_SIZE = 32px world units.
// At zoom=1: 32px. At zoom=2: 64px. We want at least 2× headroom per tier.
//
//   Low    →  32×32 frames  (displayed at 32px, 1:1 pixel-art)
//   Medium →  64×64 frames  (displayed at 32–64px, bilinear)
//   High   → 128×128 frames (displayed at 32–64px, high res detail)
//   Ultra  → 256×256 frames (maximum quality, full zoom range)

export function getSoldierRunFrameSize(tier: GraphicsAssetTier): number {
  if (tier === "low") return 16;
  if (tier === "medium") return 32;
  if (tier === "high") return 64;
  return 128; // ultra (Build 256: reduced from 256px to 128px)
}

export function getSoldierShootFrameSize(tier: GraphicsAssetTier): number {
  if (tier === "low") return 16;
  if (tier === "medium") return 32;
  if (tier === "high") return 64;
  return 128; // ultra (Build 256: reduced from 256px to 128px)
}

/**
 * Tank sprite size per tier (square, one image per direction).
 * Tanks are displayed at RTS_TANK_DISPLAY_SIZE = 64px.
 */
export function getTankTextureSize(tier: GraphicsAssetTier): number {
  if (tier === "low") return 32;
  if (tier === "medium") return 64;
  if (tier === "high") return 128;
  return 256; // ultra (Build 256: reduced from 512px to 256px)
}

/**
 * Building/structure texture size per tier.
 * Buildings are displayed at ~TILE_SIZE * 3.5–4.2 = ~112–134px.
 */
export function getBuildingTextureSize(tier: GraphicsAssetTier): number {
  if (tier === "low") return 64;
  if (tier === "medium") return 128;
  if (tier === "high") return 256;
  return 512; // ultra
}

/**
 * Wall block tile texture size per tier.
 * Blocks are displayed at TILE_SIZE = 32px.
 */
export function getBlockTextureSize(tier: GraphicsAssetTier): number {
  if (tier === "low") return 32;
  if (tier === "medium") return 64;
  if (tier === "high") return 128;
  return 256; // ultra
}

/**
 * Ground/terrain texture tile size per tier.
 * Used as a tiling texture — larger = more detail before tiling repeats.
 */
export function getGroundTextureSize(tier: GraphicsAssetTier): number {
  if (tier === "low") return 128;
  if (tier === "medium") return 256;
  if (tier === "high") return 512;
  return 1024; // ultra
}

/**
 * UI button texture size per tier.
 */
export function getButtonTextureSize(tier: GraphicsAssetTier): number {
  if (tier === "low") return 64;
  if (tier === "medium") return 128;
  if (tier === "high") return 256;
  return 512; // ultra
}

/**
 * Ground TileSprite tile scale per quality tier.
 *
 * The tileScale controls how many world-units one texture repetition covers:
 *   tileScale = 1.0 → texture repeats at its native pixel size (1 world unit = 1 texel)
 *   tileScale = 0.5 → texture is displayed at 50% of its pixel count per tile
 *
 * Target: one texture repetition = ~8 map tiles = 8 × TILE_SIZE = 256 world units.
 *
 *   Low    → 128px texture, want 256wu → scale = 256/128 = 2.0
 *   Medium → 256px texture, want 256wu → scale = 256/256 = 1.0
 *   High   → 512px texture, want 256wu → scale = 256/512 = 0.5
 *   Ultra  → 1024px texture, want 256wu → scale = 256/1024 = 0.25
 *
 * Higher tiers have more texel density per world unit = sharper detail.
 */
export function getGroundTileScale(tier: GraphicsAssetTier): number {
  if (tier === "low") return 2.0;
  if (tier === "medium") return 1.0;
  if (tier === "high") return 0.5;
  return 0.25; // ultra
}


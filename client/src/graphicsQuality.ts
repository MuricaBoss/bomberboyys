export type GraphicsQuality = "ultra";
export type GraphicsAssetTier = "ultra";

const STORAGE_KEY = "bomber_boys_graphics_quality";
const FIXED_QUALITY: GraphicsQuality = "ultra";

export function getGraphicsQuality(): GraphicsQuality {
  return FIXED_QUALITY;
}

export function setGraphicsQuality(_value: GraphicsQuality) {
}

export function cycleGraphicsQuality(): GraphicsQuality {
  return FIXED_QUALITY;
}

export function getGraphicsResolution(_quality: GraphicsQuality): number {
  return Math.min(window.devicePixelRatio || 1, 2);
}

export function getGraphicsQualityLabel(_quality: GraphicsQuality) {
  return "Ultra";
}

export function getGraphicsAssetTier(_quality: GraphicsQuality) {
  return FIXED_QUALITY;
}

export function getGraphicsProfile(_quality: GraphicsQuality) {
  return {
    worldTier: FIXED_QUALITY as GraphicsAssetTier,
    structureTier: FIXED_QUALITY as GraphicsAssetTier,
    unitTier: FIXED_QUALITY as GraphicsAssetTier,
  };
}

export function getTieredTextureKey(baseKey: string, tier: GraphicsAssetTier) {
  return `${baseKey}__${tier}`;
}

export function shouldRoundPixels(_quality: GraphicsQuality) {
  return true;
}

export function shouldAntialias(_quality: GraphicsQuality) {
  return false;
}

export function getTargetFps(_quality: GraphicsQuality): number {
  return 144; // Build 291 Hotfix: Safe high-performance limit
}

export function getBatchSize(_quality: GraphicsQuality): number {
  return 8192;
}

export function getAssetBasePath(_tier: GraphicsAssetTier) {
  return "assets";
}

export function getSoldierRunFrameSize(_tier: GraphicsAssetTier): number {
  return 128;
}

export function getSoldierShootFrameSize(_tier: GraphicsAssetTier): number {
  return 128;
}

export function getTankTextureSize(_tier: GraphicsAssetTier): number {
  return 128;
}

export function getBuildingTextureSize(_tier: GraphicsAssetTier): number {
  return 512;
}

export function getBlockTextureSize(_tier: GraphicsAssetTier): number {
  return 256;
}

export function getGroundTextureSize(_tier: GraphicsAssetTier): number {
  return 1024;
}

export function getButtonTextureSize(_tier: GraphicsAssetTier): number {
  return 512;
}

export function getGroundTileScale(_tier: GraphicsAssetTier): number {
  return 0.25;
}

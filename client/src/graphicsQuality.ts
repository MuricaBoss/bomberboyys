export type GraphicsQuality = "low" | "medium" | "high" | "ultra";
export type GraphicsAssetTier = "low" | "full";

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

export function getGraphicsResolution(quality: GraphicsQuality) {
  if (quality === "low") return 1;
  if (quality === "medium") return Math.min(window.devicePixelRatio || 1, 1.25);
  if (quality === "high") return Math.min(window.devicePixelRatio || 1, 1.75);
  return Math.min(window.devicePixelRatio || 1, 2.5);
}

export function getGraphicsQualityLabel(quality: GraphicsQuality) {
  if (quality === "low") return "Low";
  if (quality === "medium") return "Medium";
  if (quality === "high") return "High";
  return "Ultra";
}

export function getGraphicsAssetTier(quality: GraphicsQuality) {
  return quality === "low" ? "low" : "full";
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
      worldTier: "low" as GraphicsAssetTier,
      structureTier: "low" as GraphicsAssetTier,
      unitTier: "full" as GraphicsAssetTier,
    };
  }
  if (quality === "high") {
    return {
      worldTier: "low" as GraphicsAssetTier,
      structureTier: "full" as GraphicsAssetTier,
      unitTier: "full" as GraphicsAssetTier,
    };
  }
  return {
    worldTier: "full" as GraphicsAssetTier,
    structureTier: "full" as GraphicsAssetTier,
    unitTier: "full" as GraphicsAssetTier,
  };
}

export function getTieredTextureKey(baseKey: string, tier: GraphicsAssetTier) {
  return `${baseKey}__${tier}`;
}

export function shouldRoundPixels(quality: GraphicsQuality) {
  return quality === "low" || quality === "medium";
}

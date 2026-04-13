export const UNIT_VISUAL_MAX_BUCKETS = 5;

export type UnitAnimationLod = "full" | "reduced" | "static";

function isLikelyMobileDevice(scene: any) {
  if (scene?.isMobileInput) return true;

  const nav = typeof globalThis !== "undefined" ? (globalThis as any).navigator : null;
  if (Number(nav?.maxTouchPoints ?? 0) > 0) return true;

  const matchMediaFn = typeof globalThis !== "undefined" ? (globalThis as any).matchMedia : null;
  if (typeof matchMediaFn === "function") {
    try {
      return !!matchMediaFn("(pointer: coarse)").matches;
    } catch {
      return false;
    }
  }

  return false;
}

function getTotalUnits(scene: any) {
  return Number(scene?.room?.state?.units?.size ?? Object.keys(scene?.unitEntities ?? {}).length);
}

function getCurrentFps(scene: any) {
  return Number(scene?.game?.loop?.actualFps ?? 60);
}

export function getUnitVisualBucketIndex(id: string) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % UNIT_VISUAL_MAX_BUCKETS;
}

export function getUnitVisualFrameSlotNumber(id: string) {
  return getUnitVisualBucketIndex(id) + 1;
}

export function getActiveUnitVisualFrameSlotNumber(scene: any) {
  const frame = Number(scene?.game?.loop?.frame ?? 0);
  return (frame % UNIT_VISUAL_MAX_BUCKETS) + 1;
}

export function getUnitVisualBucketCount(scene: any) {
  const totalUnits = getTotalUnits(scene);
  const fps = getCurrentFps(scene);
  const mobile = isLikelyMobileDevice(scene);

  if (mobile || totalUnits >= 80 || fps < 58) return UNIT_VISUAL_MAX_BUCKETS;
  return 1;
}

export function shouldProcessUnitVisual(scene: any, id: string, forceFullRate = false) {
  if (forceFullRate) return true;

  const bucketCount = getUnitVisualBucketCount(scene);
  if (bucketCount <= 1) return true;

  const activeSlot = getActiveUnitVisualFrameSlotNumber(scene);
  const unitSlot = getUnitVisualFrameSlotNumber(id);
  return unitSlot === activeSlot;
}

export function getUnitAnimationLod(scene: any, x: number, y: number, forceFullRate = false): UnitAnimationLod {
  if (forceFullRate) return "full";

  const bucketCount = getUnitVisualBucketCount(scene);
  if (bucketCount <= 1) return "full";

  const camView = scene?.cameras?.main?.worldView;
  if (!camView) return "reduced";

  const totalUnits = getTotalUnits(scene);
  const fps = getCurrentFps(scene);
  const mobile = isLikelyMobileDevice(scene);
  const intenseLoad = mobile || totalUnits >= 150 || fps < 50;
  const mediumLoad = intenseLoad || totalUnits >= 110 || fps < 55;
  const viewScale = Math.min(Number(camView.width ?? 0), Number(camView.height ?? 0));
  const reducedDistance = Math.max(220, viewScale * (intenseLoad ? 0.28 : 0.38));
  const staticDistance = Math.max(380, viewScale * (intenseLoad ? 0.46 : 0.62));
  const centerX = camView.x + camView.width * 0.5;
  const centerY = camView.y + camView.height * 0.5;
  const distSq = (x - centerX) * (x - centerX) + (y - centerY) * (y - centerY);

  if (distSq >= staticDistance * staticDistance) return "static";
  if (mediumLoad && distSq >= reducedDistance * reducedDistance) return "reduced";
  return intenseLoad ? "reduced" : "full";
}

export function shouldRenderTankShadow(scene: any, x: number, y: number, forceFullRate = false) {
  return getUnitAnimationLod(scene, x, y, forceFullRate) !== "static";
}

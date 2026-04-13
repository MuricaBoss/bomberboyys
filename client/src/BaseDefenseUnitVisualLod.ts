const UNIT_VISUAL_MAX_BUCKETS = 5;

export function getUnitVisualBucketIndex(id: string) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % UNIT_VISUAL_MAX_BUCKETS;
}

export function getUnitVisualBucketCount(scene: any) {
  const totalUnits = Number(scene?.room?.state?.units?.size ?? Object.keys(scene?.unitEntities ?? {}).length);
  const fps = Number(scene?.game?.loop?.actualFps ?? 60);
  if (totalUnits < 80 && fps >= 58) return 1;
  if (totalUnits < 120 && fps >= 54) return 2;
  if (totalUnits < 160 && fps >= 50) return 3;
  if (totalUnits < 220 && fps >= 45) return 4;
  return UNIT_VISUAL_MAX_BUCKETS;
}

export function shouldProcessUnitVisual(scene: any, id: string, forceFullRate = false) {
  if (forceFullRate) return true;
  const bucketCount = getUnitVisualBucketCount(scene);
  if (bucketCount <= 1) return true;
  const frame = Number(scene?.game?.loop?.frame ?? 0);
  return (getUnitVisualBucketIndex(id) % bucketCount) === (frame % bucketCount);
}

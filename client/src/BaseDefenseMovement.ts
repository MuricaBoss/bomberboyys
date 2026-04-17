import Phaser from "phaser";
import {
  RTS_SOLDIER_PROJECTILE_RANGE,
  RTS_TANK_PROJECTILE_RANGE,
  TILE_SIZE,
} from "./constants";
import { BaseDefenseScene_Server } from "./BaseDefenseServer";

type LocalManualTarget = {
  currentX: number;
  currentY: number;
  finalX: number;
  finalY: number;
  setAt: number;
  isAuto: boolean;
  directSteer: boolean;
  kind: "override";
  leaderAlive: true;
  laneLateral: number;
  laneDepth: number;
};

type LocalUnitPathCache = {
  goalGX: number;
  goalGY: number;
  radiusBucket: number;
  cells: { x: number; y: number }[];
  idx: number;
  updatedAt: number;
};

export class BaseDefenseScene_Movement extends BaseDefenseScene_Server {
  pendingFinalPoses: any[] = [];

  stringHash(input: string) {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash) + input.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  getUnitPathRecalcIntervalMs(unitCount: number) {
    if (unitCount >= 120) return 520;
    if (unitCount >= 80) return 420;
    if (unitCount >= 40) return 320;
    return 260;
  }

  getUnitPathFrameStride(unitCount: number) {
    if (unitCount >= 120) return 4;
    if (unitCount >= 80) return 3;
    if (unitCount >= 40) return 2;
    return 1;
  }

  getCrowdRepulsionNeighborLimit(unitCount: number) {
    if (unitCount >= 120) return 10;
    if (unitCount >= 80) return 14;
    if (unitCount >= 40) return 18;
    return 24;
  }

  pruneSharedMovePathCache(now: number) {
    if (now - this.lastSharedMovePathPruneAt < 1500) return;
    this.lastSharedMovePathPruneAt = now;

    const maxAgeMs = 7000;
    const maxEntries = 96;
    for (const [key, entry] of this.sharedMovePathCache.entries()) {
      if ((now - entry.updatedAt) > maxAgeMs) this.sharedMovePathCache.delete(key);
    }

    if (this.sharedMovePathCache.size <= maxEntries) return;
    const entries = Array.from(this.sharedMovePathCache.entries())
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (let i = 0; i < entries.length - maxEntries; i++) {
      this.sharedMovePathCache.delete(entries[i][0]);
    }
  }

  getSharedMovePathKey(startGX: number, startGY: number, goalGX: number, goalGY: number, radiusBucket: number, unitCount: number) {
    if (unitCount < 24) return null;
    const sectorSize = unitCount >= 80 ? 8 : 6;
    const startSX = Math.floor(startGX / sectorSize);
    const startSY = Math.floor(startGY / sectorSize);
    const goalSX = Math.floor(goalGX / sectorSize);
    const goalSY = Math.floor(goalGY / sectorSize);
    return `sm:${startSX},${startSY}->${goalSX},${goalSY}:r${radiusBucket}`;
  }

  getLaneAdjustedWaypoint(
    baseWorld: { x: number; y: number },
    nextBaseWorld: { x: number; y: number },
    manualTarget: LocalManualTarget | null,
    distToGoal: number,
    useRadius: number
  ) {
    let worldX = baseWorld.x;
    let worldY = baseWorld.y;
    if (!manualTarget) return { x: worldX, y: worldY };

    const dirX = nextBaseWorld.x - baseWorld.x;
    const dirY = nextBaseWorld.y - baseWorld.y;
    const dirLen = Math.hypot(dirX, dirY);
    const forwardX = dirLen > 0.001 ? dirX / dirLen : Math.cos(this.lastCommandGroupAngle);
    const forwardY = dirLen > 0.001 ? dirY / dirLen : Math.sin(this.lastCommandGroupAngle);
    const perpX = -forwardY;
    const perpY = forwardX;
    const blend = Phaser.Math.Clamp((distToGoal - TILE_SIZE * 1.5) / Math.max(TILE_SIZE * 3, this.lastCommandGroupRadius), 0, 1);
    let laneOffsetX = (manualTarget.laneLateral * perpX) * blend;
    let laneOffsetY = (manualTarget.laneLateral * perpY) * blend;

    if (this.clearanceGrid && this.clearanceGrid.length > 0) {
      const gridIdx = Math.floor(baseWorld.y / TILE_SIZE) * this.gridW + Math.floor(baseWorld.x / TILE_SIZE);
      const clearanceTiles = this.clearanceGrid[gridIdx];
      if (clearanceTiles !== undefined) {
        const maxOffset = Math.max(TILE_SIZE * 0.1, clearanceTiles * TILE_SIZE - useRadius - 6);
        const offsetLen = Math.hypot(laneOffsetX, laneOffsetY);
        if (offsetLen > maxOffset && offsetLen > 0.001) {
          const scale = maxOffset / offsetLen;
          laneOffsetX *= scale;
          laneOffsetY *= scale;
        }
      }
    }

    let scale = 1;
    while (scale > 0.2) {
      const testX = baseWorld.x + laneOffsetX * scale;
      const testY = baseWorld.y + laneOffsetY * scale;
      if (this.canOccupyTerrainOnly(testX, testY, Math.max(TILE_SIZE * 0.18, useRadius * 0.9))) {
        worldX = testX;
        worldY = testY;
        break;
      }
      scale *= 0.7;
    }

    return { x: worldX, y: worldY };
  }

  shouldDeferPathRecalc(unitId: string, unitCount: number, cache: { updatedAt: number } | undefined, now: number, recalcIntervalMs: number) {
    if (!cache) return false;
    const stride = this.getUnitPathFrameStride(unitCount);
    if (stride <= 1) return false;
    if ((now - cache.updatedAt) > (recalcIntervalMs * 1.8)) return false;
    const frame = Number(this.game?.loop?.frame ?? 0);
    return ((frame + this.stringHash(unitId)) % stride) !== 0;
  }

  sendClientUnitPoses(now: number) {
    if (this.pendingFinalPoses.length > 0) {
      const maxBatchSize = 100;
      for (let i = 0; i < this.pendingFinalPoses.length; i += maxBatchSize) {
        const batch = this.pendingFinalPoses.slice(i, i + maxBatchSize);
        this.room.send("unit_client_pose_batch", { poses: batch });
      }
      this.pendingFinalPoses = [];
    }

    super.sendClientUnitPoses(now);
  }

  shouldKeepLocalUnitSimulationActive(id: string, u: any, ux: number, uy: number) {
    const rs = this.localUnitRenderState.get(id);
    return (String(u.ownerId || "") === this.currentPlayerId) && (u.hp ?? 0) > 0 && (
      this.hasLocalUnitManualCommand(id)
      || this.autoEngagedUnitIds.has(id)
      || this.unitSlotLocked.has(id)
      || String(u.aiState || "") === "walking"
      || Math.hypot(Number(rs?.vx ?? 0), Number(rs?.vy ?? 0)) > 4
      || Math.hypot(Number(u.targetX ?? ux) - ux, Number(u.targetY ?? uy) - uy) > TILE_SIZE * 0.2
    );
  }

  hasLocalUnitManualCommand(id: string) {
    return this.localUnitTargetOverride.has(id);
  }

  getLocalUnitManualTarget(id: string): LocalManualTarget | null {
    const override = this.localUnitTargetOverride.get(id);
    if (!override) return null;

    const unit = this.room?.state?.units?.get ? this.room.state.units.get(id) : this.room?.state?.units?.[id];
    const state = this.localUnitRenderState.get(id);
    const ux = Number(state?.x ?? unit?.x ?? override.x);
    const uy = Number(state?.y ?? unit?.y ?? override.y);
    const breakoutX = Number(override.breakoutX ?? Number.NaN);
    const breakoutY = Number(override.breakoutY ?? Number.NaN);
    const hasBreakout = Number.isFinite(breakoutX) && Number.isFinite(breakoutY);
    const breakoutThreshold = Math.max(TILE_SIZE * 0.32, this.localUnitBodyRadius(unit) * 0.9 + 4);
    const breakoutDist = hasBreakout ? Math.hypot(breakoutX - ux, breakoutY - uy) : 0;
    const useBreakout = hasBreakout && breakoutDist > breakoutThreshold;

    return {
      currentX: useBreakout ? breakoutX : override.x,
      currentY: useBreakout ? breakoutY : override.y,
      finalX: override.x,
      finalY: override.y,
      setAt: override.setAt,
      isAuto: !!override.isAuto,
      directSteer: useBreakout,
      kind: "override" as const,
      leaderAlive: true,
      laneLateral: useBreakout ? 0 : Number(override.laneLateral ?? 0),
      laneDepth: useBreakout ? 0 : Number(override.laneDepth ?? 0),
    };
  }

  localFormationRadiusForUnit(unit: any) {
    const t = String(unit?.type || "");
    if (t === "tank") return TILE_SIZE * 0.55;
    if (t === "harvester") return TILE_SIZE * 0.45;
    return TILE_SIZE * 0.35;
  }

  localFormationSpacingForIds(unitIds: string[]) {
    if (!this.room?.state?.units) return TILE_SIZE * 3.0;

    let maxRadius = TILE_SIZE * 0.42;
    for (const id of unitIds) {
      const unit = this.room.state.units.get ? this.room.state.units.get(id) : this.room.state.units?.[id];
      if (!unit || (unit.hp ?? 0) <= 0) continue;
      maxRadius = Math.max(maxRadius, this.localFormationRadiusForUnit(unit));
    }

    return Math.max(TILE_SIZE * 0.8, maxRadius * 2 + 2);
  }

  getUsableCachedWaypoint(
    cache: LocalUnitPathCache | undefined,
    ux: number,
    uy: number,
    unitRadius: number
  ) {
    if (!cache || cache.idx >= cache.cells.length) return null;
    const maxIdx = Math.min(cache.cells.length - 1, cache.idx + 3);
    for (let i = cache.idx; i <= maxIdx; i++) {
      const cell = cache.cells[i];
      if (!this.isPathWalkableForRadius(cell.x, cell.y, unitRadius)) continue;
      const world = this.gridToWorld(cell.x, cell.y);
      if (Math.hypot(world.x - ux, world.y - uy) <= TILE_SIZE * 3.0) {
        cache.idx = i;
        return cache;
      }
    }
    return null;
  }

  localFormationSlot(centerX: number, centerY: number, gridIndex: number, totalUnits: number, spacing: number, angle = 0) {
    const sp = Math.max(TILE_SIZE * 0.8, spacing);
    const cols = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(totalUnits))));
    const totalRows = Math.max(1, Math.ceil(totalUnits / cols));
    const row = Math.floor(gridIndex / cols);
    const col = gridIndex % cols;
    const unitsInRow = row === totalRows - 1 && totalUnits % cols !== 0 ? totalUnits % cols : cols;
    const lateralOffset = (col - (unitsInRow - 1) / 2) * sp;
    const depthOffset = (row - (totalRows - 1) / 2) * sp;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rx = lateralOffset * (-sin) + (-depthOffset) * cos;
    const ry = lateralOffset * cos + (-depthOffset) * sin;
    return { x: centerX + rx, y: centerY + ry };
  }

  getLocalBreakoutTarget(
    unitId: string,
    unitX: number,
    unitY: number,
    laneLateral: number,
    laneDepth: number,
    angle: number,
    spacing: number,
    radius: number,
    reserved: Array<{ x: number; y: number; radius: number }>,
    ignoreIds: Set<string>
  ) {
    const forwardX = Math.cos(angle);
    const forwardY = Math.sin(angle);
    const perpX = -forwardY;
    const perpY = forwardX;
    const breakoutForward = Phaser.Math.Clamp(
      spacing * 0.9 + Math.max(0, -laneDepth) * 0.22,
      TILE_SIZE * 0.8,
      TILE_SIZE * 2.4,
    );
    const breakoutLateral = Phaser.Math.Clamp(
      laneLateral,
      -Math.max(spacing * 1.75, TILE_SIZE * 1.2),
      Math.max(spacing * 1.75, TILE_SIZE * 1.2),
    );

    const desiredX = unitX + forwardX * breakoutForward + perpX * breakoutLateral;
    const desiredY = unitY + forwardY * breakoutForward + perpY * breakoutLateral;

    return this.resolveLocalFormationSlot(
      desiredX,
      desiredY,
      radius,
      unitId,
      reserved,
      ignoreIds,
      (sx, sy) => this.canOccupyTerrainOnly(sx, sy, Math.max(TILE_SIZE * 0.18, radius)),
    );
  }

  issueLocalUnitMoveCommand(targetX: number, targetY: number, isAutoSegment = false) {
    if (!this.room?.state || this.selectedUnitIds.size <= 0) return;

    const ids = Array.from(this.selectedUnitIds).filter((id) => {
      const unit = this.room.state.units.get ? this.room.state.units.get(id) : this.room.state.units?.[id];
      return !!unit && (unit.hp ?? 0) > 0 && String(unit.ownerId || "") === this.currentPlayerId;
    });
    if (ids.length === 0) return;

    this.lastCommandedUnitIds = new Set(ids);
    this.groupFinalTarget = { x: targetX, y: targetY };
    this.groupSegmentTarget = null;
    this.showMoveClickMarker(targetX, targetY);

    const unitPositions = ids.map((id) => {
      const state = this.localUnitRenderState.get(id);
      const unit = this.room.state.units.get ? this.room.state.units.get(id) : this.room.state.units?.[id];
      return {
        id,
        x: Number(state?.x ?? unit?.x ?? 0),
        y: Number(state?.y ?? unit?.y ?? 0),
      };
    });

    const groupCX = unitPositions.reduce((sum, unit) => sum + unit.x, 0) / Math.max(1, unitPositions.length);
    const groupCY = unitPositions.reduce((sum, unit) => sum + unit.y, 0) / Math.max(1, unitPositions.length);
    const angle = Math.atan2(targetY - groupCY, targetX - groupCX);
    this.lastCommandGroupAngle = angle;

    const spacing = this.localFormationSpacingForIds(ids);
    const slotRadiusBase = Math.max(TILE_SIZE * 0.22, spacing * 0.34);
    this.lastCommandGroupRadius = Math.max(spacing, slotRadiusBase * 2.5);

    const selectedSet = new Set(ids);
    const reserved: Array<{ x: number; y: number; radius: number }> = [];
    const slots: Array<{ x: number; y: number; r: number }> = [];
    let gridIndex = 0;
    const maxSlotIndex = Math.max(64, ids.length * 18);

    const slotCandidateIsFree = (x: number, y: number, radius: number) => {
      if (this.room?.state?.units) {
        for (const [otherId, otherUnit] of this.room.state.units.entries()) {
          if (selectedSet.has(otherId) || (otherUnit.hp ?? 0) <= 0) continue;
          const otherState = this.localUnitRenderState.get(otherId);
          const ox = Number(otherState?.x ?? otherUnit.x);
          const oy = Number(otherState?.y ?? otherUnit.y);
          const otherRadius = this.localUnitBodyRadius(otherUnit);
          if (Math.hypot(x - ox, y - oy) < radius + otherRadius + 2) return false;
        }
      }

      const recentNow = Date.now();
      for (const [recentId, recentSlot] of this.recentAssignedSlots.entries()) {
        if (recentNow - recentSlot.at > 15000) {
          this.recentAssignedSlots.delete(recentId);
          continue;
        }
        if (Math.hypot(x - recentSlot.x, y - recentSlot.y) < radius + recentSlot.r + 2) return false;
      }

      return true;
    };

    for (let i = 0; i < ids.length; i++) {
      const unit = this.room.state.units.get ? this.room.state.units.get(ids[i]) : this.room.state.units?.[ids[i]];
      const unitRadius = this.localUnitBodyRadius(unit);
      const slotRadius = Math.max(unitRadius + 4, slotRadiusBase);
      let slot: { x: number; y: number } | null = null;

      while (!slot && gridIndex < maxSlotIndex) {
        const base = this.localFormationSlot(targetX, targetY, gridIndex, ids.length, spacing, angle);
        slot = this.resolveLocalFormationSlot(base.x, base.y, slotRadius, ids[i], reserved, selectedSet, (sx, sy) => {
          return slotCandidateIsFree(sx, sy, slotRadius);
        });
        gridIndex++;
      }

      if (!slot) {
        const base = this.localFormationSlot(targetX, targetY, i, ids.length, spacing, angle);
        slot = {
          x: Phaser.Math.Clamp(base.x, slotRadius, this.room.state.mapWidth * TILE_SIZE - slotRadius),
          y: Phaser.Math.Clamp(base.y, slotRadius, this.room.state.mapHeight * TILE_SIZE - slotRadius),
        };
      }

      reserved.push({ x: slot.x, y: slot.y, radius: slotRadius });
      slots.push({ x: slot.x, y: slot.y, r: slotRadius });
    }

    const assignments = new Map<string, { x: number; y: number }>();
    const usedUnits = new Set<string>();
    for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
      let bestUnitId: string | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const unitPos of unitPositions) {
        if (usedUnits.has(unitPos.id)) continue;
        const d = Math.hypot(unitPos.x - slots[slotIdx].x, unitPos.y - slots[slotIdx].y);
        if (d < bestDistance) {
          bestDistance = d;
          bestUnitId = unitPos.id;
        }
      }

      if (!bestUnitId) continue;
      usedUnits.add(bestUnitId);
      assignments.set(bestUnitId, { x: slots[slotIdx].x, y: slots[slotIdx].y });
      this.recentAssignedSlots.set(bestUnitId, {
        x: slots[slotIdx].x,
        y: slots[slotIdx].y,
        r: slots[slotIdx].r,
        at: Date.now(),
      });
    }

    if (assignments.size === 0) return;

    let maxDist = 0;
    for (const unitPos of unitPositions) {
      const slot = assignments.get(unitPos.id);
      if (!slot) continue;
      maxDist = Math.max(maxDist, Math.hypot(unitPos.x - slot.x, unitPos.y - slot.y));
    }

    const previewMs = Math.max(5000, (maxDist / Math.max(60, spacing)) * 1000 + 2200);
    this.formationPreviewSlots = slots;
    this.formationPreviewAssignments = assignments;
    this.formationPreviewCenter = { x: targetX, y: targetY };
    this.formationPreviewUntil = Date.now() + previewMs;

    for (const id of ids) {
      this.localUnitTargetOverride.delete(id);
      this.localUnitFollowState.delete(id);
      this.localUnitMovePriority.delete(id);
      this.localUnitPathRadiusOverride.delete(id);
      this.autoEngagedUnitIds.delete(id);
      this.unitAttackTarget.delete(id);
      this.unitClientPathCache.delete(id);
      this.unitSlotLocked.delete(id);
      this.localUnitArrivalPos.delete(id);
      this.localUnitGhostMode.delete(id);
      this.localUnitJamTicks.delete(id);
    }

    const now = Date.now();
    const payload: Array<{ unitId: string; targetX: number; targetY: number }> = [];
    let priority = 0;
    const breakoutReserved: Array<{ x: number; y: number; radius: number }> = [];
    for (const id of ids) {
      const slot = assignments.get(id);
      if (!slot) continue;
      const unit = this.room.state.units.get ? this.room.state.units.get(id) : this.room.state.units?.[id];
      const renderState = this.localUnitRenderState.get(id);
      const unitX = Number(renderState?.x ?? unit?.x ?? slot.x);
      const unitY = Number(renderState?.y ?? unit?.y ?? slot.y);
      const offsetX = slot.x - targetX;
      const offsetY = slot.y - targetY;
      const laneLateral = offsetX * (-Math.sin(angle)) + offsetY * Math.cos(angle);
      const laneDepth = -(offsetX * Math.cos(angle) + offsetY * Math.sin(angle));
      const unitRadius = this.localUnitBodyRadius(unit);
      const breakoutRadius = Math.max(unitRadius + 4, slotRadiusBase);
      const breakout = this.getLocalBreakoutTarget(
        id,
        unitX,
        unitY,
        laneLateral,
        laneDepth,
        angle,
        spacing,
        breakoutRadius,
        breakoutReserved,
        selectedSet,
      );
      if (breakout) breakoutReserved.push({ x: breakout.x, y: breakout.y, radius: breakoutRadius });

      this.localUnitTargetOverride.set(id, {
        x: slot.x,
        y: slot.y,
        breakoutX: breakout?.x,
        breakoutY: breakout?.y,
        setAt: now,
        isAuto: isAutoSegment,
        laneLateral,
        laneDepth,
      });
      this.localUnitMovePriority.set(id, priority++);
      this.localUnitPathRadiusOverride.set(id, unitRadius);

      if (unit) {
        unit.targetX = slot.x;
        unit.targetY = slot.y;
        unit.aiState = "walking";
        unit.manualUntil = 0;
      }

      payload.push({ unitId: id, targetX: slot.x, targetY: slot.y });
    }

    this.lastMoveLeaderCount = slots.length;
    this.lastMoveFollowerCount = payload.length;
    this.lastMoveSubgroupSize = 1;

    if (payload.length > 0) {
      this.room.send("command_units", {
        commands: payload,
        targetX,
        targetY,
      });
    }
  }

  resolvePathGoal(goalGX: number, goalGY: number, unitRadius: number, preferredX: number, preferredY: number) {
    if (this.isPathWalkableForRadius(goalGX, goalGY, unitRadius)) {
      return { gx: goalGX, gy: goalGY };
    }

    let best: { gx: number; gy: number; score: number } | null = null;
    const maxRing = Math.max(4, Math.ceil(unitRadius / TILE_SIZE) + 4);
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let oy = -ring; oy <= ring; oy++) {
        for (let ox = -ring; ox <= ring; ox++) {
          if (Math.abs(ox) !== ring && Math.abs(oy) !== ring) continue;
          const gx = goalGX + ox;
          const gy = goalGY + oy;
          if (!this.isPathWalkableForRadius(gx, gy, unitRadius)) continue;
          const world = this.gridToWorld(gx, gy);
          const score = Math.hypot(world.x - preferredX, world.y - preferredY);
          if (!best || score < best.score) best = { gx, gy, score };
        }
      }
      const found = best;
      if (found) return { gx: found.gx, gy: found.gy };
    }

    return null;
  }

  getClientUnitWaypoint(unitId: string, unit: any, now: number, unitRadius = this.localUnitBodyRadius(unit)) {
    const ux = Number(unit?.x ?? 0);
    const uy = Number(unit?.y ?? 0);
    const tx = Number(unit?.targetX ?? ux);
    const ty = Number(unit?.targetY ?? uy);
    const startGX = Math.floor(ux / TILE_SIZE);
    const startGY = Math.floor(uy / TILE_SIZE);
    const rawGoalGX = Math.floor(tx / TILE_SIZE);
    const rawGoalGY = Math.floor(ty / TILE_SIZE);

    const radiusOverride = this.localUnitPathRadiusOverride.get(unitId);
    const useRadius = radiusOverride ?? unitRadius;
    const radiusBucket = Math.max(4, Math.round(useRadius / 4) * 4);
    const unitCount = Number((this.room?.state?.units as { size?: number } | undefined)?.size ?? 0);
    const recalcIntervalMs = this.getUnitPathRecalcIntervalMs(unitCount);
    this.pruneSharedMovePathCache(now);

    let cache = this.unitClientPathCache.get(unitId);
    const resolvedGoal = this.resolvePathGoal(rawGoalGX, rawGoalGY, useRadius, tx, ty);
    if (!resolvedGoal) {
      const fallbackCache = this.getUsableCachedWaypoint(cache, ux, uy, useRadius);
      if (fallbackCache) {
        fallbackCache.updatedAt = now;
        return this.gridToWorld(fallbackCache.cells[fallbackCache.idx].x, fallbackCache.cells[fallbackCache.idx].y);
      }
      this.unitClientPathCache.delete(unitId);
      return Math.hypot(tx - ux, ty - uy) <= TILE_SIZE * 0.9 ? { x: tx, y: ty } : null;
    }

    const goalGX = resolvedGoal.gx;
    const goalGY = resolvedGoal.gy;
    const manualTarget = this.getLocalUnitManualTarget(unitId);

    const nextCell = cache && cache.idx < cache.cells.length
      ? cache.cells[Math.max(0, Math.min(cache.idx, cache.cells.length - 1))]
      : null;
    const nextCellBlocked = !!nextCell && !this.isPathWalkableForRadius(nextCell.x, nextCell.y, useRadius);
    const cacheExpired = (now - Number(cache?.updatedAt ?? 0)) > recalcIntervalMs;

    const needRecalc = !cache
      || cache.goalGX !== goalGX
      || cache.goalGY !== goalGY
      || cache.radiusBucket !== radiusBucket
      || cache.idx >= cache.cells.length
      || nextCellBlocked
      || cacheExpired;

    if (needRecalc) {
      const existingCache = cache;
      if (!nextCellBlocked && existingCache && this.shouldDeferPathRecalc(unitId, unitCount, existingCache, now, recalcIntervalMs)) {
        existingCache.updatedAt = now;
        cache = existingCache;
      } else {
        const sharedPathKey = this.getSharedMovePathKey(startGX, startGY, goalGX, goalGY, radiusBucket, unitCount);
        const sharedEntry = sharedPathKey ? this.sharedMovePathCache.get(sharedPathKey) : null;
        let cells: { x: number; y: number }[] | null = sharedEntry?.cells ?? null;
        if (!cells || cells.length === 0) {
          cells = this.findPath(startGX, startGY, goalGX, goalGY, false, unitId, useRadius);
          if (sharedPathKey && cells && cells.length > 0) {
            this.sharedMovePathCache.set(sharedPathKey, { cells, updatedAt: now });
          }
        } else {
          sharedEntry!.updatedAt = now;
        }

        if (!cells || cells.length === 0) {
          const fallbackCache = this.getUsableCachedWaypoint(existingCache, ux, uy, useRadius);
          if (fallbackCache) {
            fallbackCache.updatedAt = now;
            cache = fallbackCache;
            this.unitClientPathCache.set(unitId, fallbackCache);
          } else {
            this.unitClientPathCache.delete(unitId);
            if (Math.hypot(tx - ux, ty - uy) <= TILE_SIZE * 0.9) {
              return { x: tx, y: ty };
            }
            return null;
          }
        } else {
          const resolvedCells = cells;

          const goalDirX = tx - ux;
          const goalDirY = ty - uy;
          const goalDirLen = Math.hypot(goalDirX, goalDirY);
          const dirNX = goalDirLen > 0.001 ? goalDirX / goalDirLen : 0;
          const dirNY = goalDirLen > 0.001 ? goalDirY / goalDirLen : 0;

          const startSearchIdx = (existingCache && existingCache.cells === resolvedCells) ? existingCache.idx : 0;
          let bestIdx = startSearchIdx;
          let bestDistance = Number.POSITIVE_INFINITY;
          let bestForwardIdx = -1;
          let bestForwardDistance = Number.POSITIVE_INFINITY;

          for (let i = startSearchIdx; i < resolvedCells.length; i++) {
            const world = this.gridToWorld(resolvedCells[i].x, resolvedCells[i].y);
            const dist = Math.hypot(world.x - ux, world.y - uy);
            const forwardDot = (world.x - ux) * dirNX + (world.y - uy) * dirNY;
            if (dist < bestDistance) {
              bestDistance = dist;
              bestIdx = i;
            }
            if (forwardDot >= -TILE_SIZE * 0.2 && dist < bestForwardDistance) {
              bestForwardDistance = dist;
              bestForwardIdx = i;
            }
          }

          cache = {
            goalGX,
            goalGY,
            radiusBucket,
            cells: resolvedCells,
            idx: bestForwardIdx >= 0 ? bestForwardIdx : bestIdx,
            updatedAt: now,
          };
          this.unitClientPathCache.set(unitId, cache);
        }
      }
    }

    if (!cache) return null;
    cache.updatedAt = now;

    while (cache.idx < cache.cells.length) {
      const cell = cache.cells[cache.idx];
      const baseWorld = this.gridToWorld(cell.x, cell.y);
      const nextCellForDir = cache.idx < cache.cells.length - 1
        ? cache.cells[cache.idx + 1]
        : { x: goalGX, y: goalGY };
      const nextBaseWorld = this.gridToWorld(nextCellForDir.x, nextCellForDir.y);
      const distToGoal = Math.hypot(tx - ux, ty - uy);
      const world = this.getLaneAdjustedWaypoint(baseWorld, nextBaseWorld, manualTarget, distToGoal, useRadius);
      const worldX = world.x;
      const worldY = world.y;

      const distToWaypoint = Math.hypot(worldX - ux, worldY - uy);

      const dirX = nextBaseWorld.x - baseWorld.x;
      const dirY = nextBaseWorld.y - baseWorld.y;
      const dirLen = Math.hypot(dirX, dirY);
      const forwardNX = dirLen > 0.001 ? dirX / dirLen : 0;
      const forwardNY = dirLen > 0.001 ? dirY / dirLen : 0;
      const forwardDot = (ux - baseWorld.x) * forwardNX + (uy - baseWorld.y) * forwardNY;
      const passedCurrentCell = forwardDot >= TILE_SIZE * 0.28;

      if (cache.idx < cache.cells.length - 1) {
        const nextNextCell = cache.idx + 2 < cache.cells.length
          ? cache.cells[cache.idx + 2]
          : { x: goalGX, y: goalGY };
        const nextWorld = this.getLaneAdjustedWaypoint(
          nextBaseWorld,
          this.gridToWorld(nextNextCell.x, nextNextCell.y),
          manualTarget,
          distToGoal,
          useRadius,
        );
        const distToNext = Math.hypot(nextWorld.x - ux, nextWorld.y - uy);
        if (distToWaypoint <= TILE_SIZE * 0.55 || distToNext + TILE_SIZE * 0.18 < distToWaypoint || passedCurrentCell) {
          cache.idx += 1;
          continue;
        }
      } else if (Math.hypot(tx - ux, ty - uy) <= TILE_SIZE * 2.5 && this.lineOfSightClear(ux, uy, tx, ty)) {
        return { x: tx, y: ty };
      }

      if (distToWaypoint <= TILE_SIZE * 0.55 || passedCurrentCell) {
        cache.idx += 1;
        continue;
      }

      return { x: worldX, y: worldY };
    }

    return Math.hypot(tx - ux, ty - uy) > TILE_SIZE * 0.18 ? { x: tx, y: ty } : null;
  }

  updateUnitRenderPos(
    id: string,
    e: Phaser.GameObjects.GameObject & { x: number; y: number },
    u: any,
    delta: number,
    isLocalOwned: boolean,
    isTank: boolean
  ) {
    if ((u.hp ?? 0) <= 0) return;

    if (delta > 500) {
      const sx = Number(u.x);
      const sy = Number(u.y);
      const rs = this.localUnitRenderState.get(id);
      if (rs) {
        rs.x = sx;
        rs.y = sy;
        rs.vx = 0;
        rs.vy = 0;
        rs.lastAt = performance.now();
      }
      e.x = sx;
      e.y = sy;
      this.localUnitTargetOverride.delete(id);
      this.localUnitFollowState.delete(id);
      this.localUnitMovePriority.delete(id);
      this.localUnitPathRadiusOverride.delete(id);
      this.unitClientPathCache.delete(id);
      this.autoEngagedUnitIds.delete(id);
      this.unitAttackTarget.delete(id);
      this.localUnitArrivalPos.delete(id);
      this.unitSlotLocked.delete(id);
      return;
    }

    const dt = Math.max(0.001, Math.min(0.05, delta / 1000));
    if (!isLocalOwned) {
      let rs = this.localUnitRenderState.get(id);
      if (!rs) {
        rs = { x: Number(u.x), y: Number(u.y), vx: 0, vy: 0, lastAt: performance.now() };
        this.localUnitRenderState.set(id, rs);
      }

      const serverX = Number(u.x);
      const serverY = Number(u.y);
      const distToServer = Math.hypot(serverX - rs.x, serverY - rs.y);

      if (distToServer > TILE_SIZE * 3) {
        rs.x = serverX;
        rs.y = serverY;
        rs.vx = 0;
        rs.vy = 0;
      } else if (distToServer < 1.0 && String(u.aiState || "") !== "walking") {
        rs.x = serverX;
        rs.y = serverY;
        rs.vx = 0;
        rs.vy = 0;
      } else {
        const wp = this.getClientUnitWaypoint(id, u, Date.now());
        const tx = Number(wp?.x ?? u.targetX ?? u.x);
        const ty = Number(wp?.y ?? u.targetY ?? u.y);
        const toTX = tx - rs.x;
        const toTY = ty - rs.y;
        const toTLen = Math.hypot(toTX, toTY);
        const speed = Number(u.speed || 0);
        const isWalking = String(u.aiState || "") === "walking";
        const dx = serverX - rs.x;
        const dy = serverY - rs.y;
        const dot = dx * toTX + dy * toTY;

        let multiplier = 1.0;
        if (isWalking) {
          if (dot < -5) multiplier = 0.45;
          else if (distToServer > 20) multiplier = 1.35;
          else if (distToServer > 8) multiplier = 1.15;
        }

        const desiredVX = (isWalking && toTLen > 2) ? (toTX / toTLen) * speed * multiplier : 0;
        const desiredVY = (isWalking && toTLen > 2) ? (toTY / toTLen) * speed * multiplier : 0;
        const accel = isWalking ? 12 : 20;
        const blend = 1 - Math.exp(-accel * dt);
        rs.vx += (desiredVX - rs.vx) * blend;
        rs.vy += (desiredVY - rs.vy) * blend;
        rs.x += rs.vx * dt;
        rs.y += rs.vy * dt;

        if (distToServer > 0.1) {
          const corrPower = isWalking ? 0.012 : 0.024;
          const corr = 1 - Math.exp(-delta * corrPower);
          rs.x += (serverX - rs.x) * corr;
          rs.y += (serverY - rs.y) * corr;
        }
      }

      e.x = rs.x;
      e.y = rs.y;
      rs.lastAt = performance.now();
      return;
    }

    let s = this.localUnitRenderState.get(id);
    if (!s) {
      s = { x: Number(u.x), y: Number(u.y), vx: 0, vy: 0, lastAt: performance.now() };
      this.localUnitRenderState.set(id, s);
    }

    let tx = Number(u.targetX ?? u.x);
    let ty = Number(u.targetY ?? u.y);

    const isAutoEngaged = this.autoEngagedUnitIds.has(id);
    const atkTargetId = this.unitAttackTarget.get(id);
    const atkTarget = atkTargetId
      ? (this.room?.state?.units?.get ? this.room.state.units.get(atkTargetId) : this.room?.state?.units?.[atkTargetId])
        || (this.room?.state?.structures?.get ? this.room.state.structures.get(atkTargetId) : this.room?.state?.structures?.[atkTargetId])
        || (this.room?.state?.cores?.get ? this.room.state.cores.get(atkTargetId) : this.room?.state?.cores?.[atkTargetId])
      : null;

    const firingRange = isTank ? RTS_TANK_PROJECTILE_RANGE : RTS_SOLDIER_PROJECTILE_RANGE;
    const distToAtkTarget = atkTarget ? Math.hypot(Number(atkTarget.x) - s.x, Number(atkTarget.y) - s.y) : Number.POSITIVE_INFINITY;
    const inFiringRange = !!atkTarget && distToAtkTarget <= (firingRange * 0.95);

    if (isAutoEngaged && atkTarget && !inFiringRange) {
      tx = Number(atkTarget.x);
      ty = Number(atkTarget.y);
    }

    const nowMs = Date.now();
    const manualTarget = this.getLocalUnitManualTarget(id);
    const distToSlot = manualTarget ? Math.hypot(manualTarget.finalX - s.x, manualTarget.finalY - s.y) : Number.POSITIVE_INFINITY;
    if (manualTarget) {
      tx = manualTarget.currentX;
      ty = manualTarget.currentY;
    }

    const arrivalPos = this.localUnitArrivalPos.get(id);
    if (arrivalPos && this.unitSlotLocked.has(id)) {
      if (manualTarget) {
        this.unitSlotLocked.delete(id);
        this.localUnitArrivalPos.delete(id);
      } else {
        const serverIdle = String(u.aiState || "") !== "walking";
        s.x = arrivalPos.x;
        s.y = arrivalPos.y;
        s.vx = 0;
        s.vy = 0;
        e.x = s.x;
        e.y = s.y;
        s.lastAt = performance.now();
        if (serverIdle) {
          this.unitSlotLocked.delete(id);
          this.localUnitArrivalPos.delete(id);
        } else if (nowMs - this.lastUnitPoseSentAt > 140) {
          const dir = this.unitFacing.get(id) ?? Number(u.dir ?? 1);
          this.pendingFinalPoses.push({
            unitId: id,
            x: arrivalPos.x,
            y: arrivalPos.y,
            dir,
            tx: arrivalPos.x,
            ty: arrivalPos.y,
            final: true,
          });
        }
        return;
      }
    }

    const producedExitGraceActive = Number(u.manualUntil || 0) > nowMs && (!manualTarget || manualTarget.isAuto);
    if (producedExitGraceActive) {
      s.x = Number(u.x);
      s.y = Number(u.y);
      s.vx = 0;
      s.vy = 0;
      e.x = s.x;
      e.y = s.y;
      s.lastAt = performance.now();
      return;
    }

    if (manualTarget && distToSlot <= Math.max(TILE_SIZE * 0.24, this.localUnitBodyRadius(u) * 0.75 + 4)) {
      const velSpeed = Math.hypot(s.vx, s.vy);
      const arrivalDir = velSpeed > 0.2
        ? this.angleToDir8(Math.atan2(s.vy, s.vx))
        : (distToSlot > 0.5
          ? this.angleToDir8(Math.atan2(manualTarget.finalY - s.y, manualTarget.finalX - s.x))
          : Number(u.dir ?? 1));

      this.unitFacing.set(id, arrivalDir);
      this.pendingFinalPoses.push({
        unitId: id,
        x: manualTarget.finalX,
        y: manualTarget.finalY,
        dir: arrivalDir,
        tx: manualTarget.finalX,
        ty: manualTarget.finalY,
        final: true,
      });

      this.localUnitGhostMode.delete(id);
      s.x = manualTarget.finalX;
      s.y = manualTarget.finalY;
      s.vx = 0;
      s.vy = 0;
      e.x = s.x;
      e.y = s.y;
      s.lastAt = performance.now();

      this.localUnitArrivalPos.set(id, { x: manualTarget.finalX, y: manualTarget.finalY });
      this.unitSlotLocked.add(id);
      this.localUnitTargetOverride.delete(id);
      this.localUnitMovePriority.delete(id);
      this.localUnitPathRadiusOverride.delete(id);
      this.unitClientPathCache.delete(id);
      return;
    }

    const wp = manualTarget?.directSteer
      ? { x: tx, y: ty }
      : this.getClientUnitWaypoint(
        id,
        { x: s.x, y: s.y, targetX: tx, targetY: ty, type: u.type },
        nowMs,
        this.localUnitBodyRadius(u),
      );
    const navX = Number(wp?.x ?? tx);
    const navY = Number(wp?.y ?? ty);

    const toTX = navX - s.x;
    const toTY = navY - s.y;
    const toTLen = Math.hypot(toTX, toTY);
    const speed = Number(u.speed || 0);
    const moving = toTLen > TILE_SIZE * 0.16 && speed > 1 && !(isAutoEngaged && inFiringRange);

    const maxSpeed = speed;
    const steerForce = { x: 0, y: 0 };

    if (moving) {
      const desiredVX = (toTX / toTLen) * maxSpeed;
      const desiredVY = (toTY / toTLen) * maxSpeed;
      steerForce.x += (desiredVX - s.vx) * 20;
      steerForce.y += (desiredVY - s.vy) * 20;
    } else {
      steerForce.x -= s.vx * 8;
      steerForce.y -= s.vy * 8;
    }

    const uid = String(id);
    const ignoreSid = producedExitGraceActive ? this.getStructureIdAt(Math.floor(s.x / TILE_SIZE), Math.floor(s.y / TILE_SIZE)) : undefined;
    const isJammedGhost = this.localUnitGhostMode.has(uid);

    if (!isJammedGhost && this.room?.state?.units?.forEach) {
      const me = this.room.state.players?.get ? this.room.state.players.get(this.currentPlayerId) : this.room.state.players?.[this.currentPlayerId];
      const myTeam = me?.team;
      const myRadius = this.localUnitBodyRadius(u);
      const unitCount = Number((this.room?.state?.units as { size?: number } | undefined)?.size ?? 0);
      const crowdScale = unitCount >= 80 ? 1.15 : 1.8;
      const searchRadius = 160 * crowdScale;
      const neighborLimit = this.getCrowdRepulsionNeighborLimit(unitCount);
      const potentialNeighbors = this.unitGrid.getNeighbors(s.x, s.y, searchRadius);
      let processedNeighbors = 0;

      for (const oid of potentialNeighbors) {
        if (oid === id || producedExitGraceActive) continue;
        const ou = this.room.state.units.get ? this.room.state.units.get(oid) : (this.room.state.units as any)?.[oid];
        if (!ou || (ou.hp ?? 0) <= 0) continue;
        if (myTeam && ou.team !== myTeam) continue;
        processedNeighbors += 1;
        if (processedNeighbors > neighborLimit) break;

        const myDistToTarget = toTLen;
        const ouX = Number(ou.x);
        const ouY = Number(ou.y);
        const ouTX = Number(ou.targetX ?? ouX);
        const ouTY = Number(ou.targetY ?? ouY);
        const ouDistToTarget = Math.hypot(ouX - ouTX, ouY - ouTY);
        if (u.aiState === "idle" && ou.aiState === "idle" && myDistToTarget < 12 && ouDistToTarget < 12) {
          continue;
        }

        const ors = this.localUnitRenderState.get(oid);
        const ox = Number(ors?.x ?? ou.x);
        const oy = Number(ors?.y ?? ou.y);
        const oRadius = this.localUnitBodyRadius(ou);
        let dx = s.x - ox;
        let dy = s.y - oy;
        let dist = Math.hypot(dx, dy);

        const uType = String(u.type || "");
        const padding = uType === "tank" ? 118 : 55;
        const minDist = myRadius + oRadius + padding;
        if (dist >= minDist) continue;

        if (dist < 0.1) {
          const ang = Math.random() * Math.PI * 2;
          dx = Math.cos(ang) * 0.1;
          dy = Math.sin(ang) * 0.1;
          dist = 0.1;
        }

        const baseForce = 5000;
        const ratio = 1.0 - dist / minDist;
        let pushStrength = ratio * ratio * baseForce;
        if (dist < (myRadius + oRadius)) pushStrength *= 2.0;
        else if (ratio > 0.5) pushStrength *= 1.3;

        steerForce.x += (dx / dist) * pushStrength;
        steerForce.y += (dy / dist) * pushStrength;
      }
    }

    if (!isJammedGhost) {
      const gx = Math.floor(s.x / TILE_SIZE);
      const gy = Math.floor(s.y / TILE_SIZE);
      const wallR = 4;
      const baseWForce = 1504;

      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const cx = gx + dx;
          const cy = gy + dy;
          if (this.tileAt(cx, cy) !== 0 || (this.hasStructureAt(cx, cy) && this.getStructureIdAt(cx, cy) !== ignoreSid) || this.hasCoreAt(cx, cy)) {
            const tileMinX = cx * TILE_SIZE;
            const tileMaxX = (cx + 1) * TILE_SIZE;
            const tileMinY = cy * TILE_SIZE;
            const tileMaxY = (cy + 1) * TILE_SIZE;

            const closestX = Math.max(tileMinX, Math.min(s.x, tileMaxX));
            const closestY = Math.max(tileMinY, Math.min(s.y, tileMaxY));

            let wdx = s.x - closestX;
            let wdy = s.y - closestY;
            let wdist = Math.hypot(wdx, wdy);
            if (wdist < 1.0) {
              const tileCX = (cx + 0.5) * TILE_SIZE;
              const tileCY = (cy + 0.5) * TILE_SIZE;
              wdx = s.x - tileCX;
              wdy = s.y - tileCY;
              wdist = Math.hypot(wdx, wdy) || 0.1;
            }

            if (wdist < wallR) {
              const pushStrength = (1.0 - wdist / wallR) * baseWForce;
              steerForce.x += (wdx / wdist) * pushStrength;
              steerForce.y += (wdy / wdist) * pushStrength;
            }
          }
        }
      }
    }

    s.vx += steerForce.x * dt;
    s.vy += steerForce.y * dt;

    const currentSpeed = Math.hypot(s.vx, s.vy);
    const limitSpeed = Math.max(maxSpeed, currentSpeed * 0.92);
    if (currentSpeed > limitSpeed && currentSpeed > 0.1) {
      s.vx = (s.vx / currentSpeed) * limitSpeed;
      s.vy = (s.vy / currentSpeed) * limitSpeed;
    }

    const nx = s.x + s.vx * dt;
    const ny = s.y + s.vy * dt;
    const r = this.localUnitBodyRadius(u);

    const isFullFree = this.canOccupyLocalUnit(nx, ny, r, uid, ignoreSid as any);
    if (isJammedGhost || isFullFree) {
      s.x = nx;
      s.y = ny;
    } else {
      if (isJammedGhost || this.canOccupyLocalUnit(nx, s.y, r, uid, ignoreSid as any)) {
        s.x = nx;
      } else if (isJammedGhost || this.canOccupyLocalUnit(s.x, ny, r, uid, ignoreSid as any)) {
        s.y = ny;
      }
      s.vx *= 0.8;
      s.vy *= 0.8;
    }

    const errX = Number(u.x) - s.x;
    const errY = Number(u.y) - s.y;
    const err = Math.hypot(errX, errY);
    const threshold = 44;
    const snap = 0.05;
    if (err > threshold) {
      s.x = Number(u.x);
      s.y = Number(u.y);
      s.vx = 0;
      s.vy = 0;
    } else {
      s.x += errX * snap;
      s.y += errY * snap;
    }

    if (s.jamRefX === undefined || !moving) {
      s.jamRefX = s.x;
      s.jamRefY = s.y;
      this.localUnitJamTicks.set(uid, 0);
    } else {
      const jamRefX = s.jamRefX ?? s.x;
      const jamRefY = s.jamRefY ?? s.y;
      const distFromRef = Math.hypot(s.x - jamRefX, s.y - jamRefY);
      if (distFromRef > TILE_SIZE * 0.85) {
        s.jamRefX = s.x;
        s.jamRefY = s.y;
        this.localUnitJamTicks.set(uid, 0);
      } else {
        const ticks = (this.localUnitJamTicks.get(uid) ?? 0) + 1;
        this.localUnitJamTicks.set(uid, ticks);
        if (ticks > 30) this.localUnitGhostMode.add(uid);
      }
    }

    const velSpeedSq = s.vx * s.vx + s.vy * s.vy;
    if (velSpeedSq > 64) {
      const moveDir = this.angleToDir8(Math.atan2(s.vy, s.vx));
      this.unitFacing.set(id, moveDir);
    }

    s.lastAt = performance.now();
    e.x = s.x;
    e.y = s.y;
  }
}

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
  directSteer: false;
  kind: "override";
  leaderAlive: true;
};

export class BaseDefenseScene_Movement extends BaseDefenseScene_Server {
  pendingFinalPoses: any[] = [];
  
  // Build 524: Caching for performance
  private cachedUnitArray: any[] = [];
  private lastFrameUnitsCachedAt: number = -1;

  stringHash(input: string) {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash) + input.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  getUnitPathRecalcIntervalMs(unitCount: number) {
    if (unitCount >= 120) return 600;
    if (unitCount >= 80) return 500;
    if (unitCount >= 40) return 400;
    return 300;
  }

  getUnitPathFrameStride(unitCount: number) {
    // Build 521: Stagger recalculations over up to 10 frames to optimize CPU
    if (unitCount >= 100) return 10;
    if (unitCount >= 60) return 6;
    if (unitCount >= 30) return 4;
    return 2;
  }

  getCrowdRepulsionNeighborLimit(unitCount: number) {
    if (unitCount >= 120) return 10;
    if (unitCount >= 80) return 14;
    if (unitCount >= 40) return 18;
    return 24;
  }

  getPathCost(cells: { x: number; y: number }[]) {
    if (!cells || cells.length <= 1) return 0;
    let cost = 0;
    for (let i = 1; i < cells.length; i++) {
        const dx = Math.abs(cells[i].x - cells[i - 1].x);
        const dy = Math.abs(cells[i].y - cells[i - 1].y);
        if (dx > 0 && dy > 0) cost += 1.4142;
        else cost += 1.0;
    }
    return cost;
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
    // Build 510: Lanes removed. Return base world waypoint directly.
    return { x: baseWorld.x, y: baseWorld.y };
  }

  getVisiblePathShortcut(
    cache: { cells: { x: number; y: number }[]; idx: number },
    ux: number,
    uy: number,
    tx: number,
    ty: number,
    manualTarget: LocalManualTarget | null,
    useRadius: number
  ) {
    const maxLookAhead = 8;
    let best: { x: number; y: number } | null = null;
    const maxIdx = Math.min(cache.cells.length - 1, cache.idx + maxLookAhead);
    
    // Build 519: First check if the final target is directly visible
    if (this.lineOfSightClear(ux, uy, tx, ty)) {
       return { x: tx, y: ty };
    }

    for (let i = maxIdx; i >= cache.idx; i--) {
      const cell = cache.cells[i];
      const baseWorld = this.gridToWorld(cell.x, cell.y);
      const nextCell = i < cache.cells.length - 1 ? cache.cells[i + 1] : { x: Math.floor(tx / TILE_SIZE), y: Math.floor(ty / TILE_SIZE) };
      const nextWorld = this.gridToWorld(nextCell.x, nextCell.y);
      const distToGoal = Math.hypot(tx - ux, ty - uy);
      const world = this.getLaneAdjustedWaypoint(baseWorld, nextWorld, manualTarget, distToGoal, useRadius);
      if (!this.lineOfSightClear(ux, uy, world.x, world.y)) continue;
      cache.idx = i;
      best = world;
      break;
    }
    return best;
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

    return {
      currentX: override.x,
      currentY: override.y,
      finalX: override.x,
      finalY: override.y,
      setAt: override.setAt,
      isAuto: !!override.isAuto,
      directSteer: false,
      kind: "override" as const,
      leaderAlive: true,
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

    let hasTank = false;
    let hasHarvester = false;
    let hasSoldier = false;
    for (const id of unitIds) {
      const unit = this.room.state.units.get ? this.room.state.units.get(id) : this.room.state.units?.[id];
      if (!unit || (unit.hp ?? 0) <= 0) continue;
      const type = String(unit.type || "");
      if (type === "tank") hasTank = true;
      else if (type === "harvester") hasHarvester = true;
      else hasSoldier = true;
    }

    if (hasTank) return 65;
    if (hasHarvester) return 60;
    if (hasSoldier) return 30;
    return TILE_SIZE * 0.8;
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
      const unitId = ids[i];
      const unit = this.room.state.units.get ? this.room.state.units.get(unitId) : this.room.state.units?.[unitId];
      const unitRadius = this.localUnitBodyRadius(unit);
      
      // Build 518: Revert to uniform spacing for the grid 'base' to prevent overlapping/stall issues,
      // but keep the reduced tank spacing (65) if any tanks are present.
      const unitSlotRadius = Math.max(unitRadius + 4, spacing * 0.34);
      
      let slot: { x: number; y: number } | null = null;
      while (!slot && gridIndex < maxSlotIndex) {
        const base = this.localFormationSlot(targetX, targetY, gridIndex, ids.length, spacing, angle);
        slot = this.resolveLocalFormationSlot(base.x, base.y, unitSlotRadius, unitId, reserved, selectedSet, (sx, sy) => {
          return slotCandidateIsFree(sx, sy, unitSlotRadius);
        });
        gridIndex++;
      }

      if (!slot) {
        const base = this.localFormationSlot(targetX, targetY, i, ids.length, spacing, angle);
        slot = {
          x: Phaser.Math.Clamp(base.x, unitSlotRadius, this.room.state.mapWidth * TILE_SIZE - unitSlotRadius),
          y: Phaser.Math.Clamp(base.y, unitSlotRadius, this.room.state.mapHeight * TILE_SIZE - unitSlotRadius),
        };
      }

      reserved.push({ x: slot.x, y: slot.y, radius: unitSlotRadius });
      slots.push({ x: slot.x, y: slot.y, r: unitSlotRadius });
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
    for (const id of ids) {
      const slot = assignments.get(id);
      if (!slot) continue;
      this.localUnitTargetOverride.set(id, {
        x: slot.x,
        y: slot.y,
        setAt: now,
        isAuto: isAutoSegment,
      });
      this.localUnitMovePriority.set(id, priority++);
      this.localUnitPathRadiusOverride.set(id, this.localUnitBodyRadius(
        this.room.state.units.get ? this.room.state.units.get(id) : this.room.state.units?.[id],
      ));

      const unit = this.room.state.units.get ? this.room.state.units.get(id) : this.room.state.units?.[id];
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

    const resolvedGoal = this.resolvePathGoal(rawGoalGX, rawGoalGY, useRadius, tx, ty);
    if (!resolvedGoal) {
      this.unitClientPathCache.delete(unitId);
      return null;
    }

    const goalGX = resolvedGoal.gx;
    const goalGY = resolvedGoal.gy;
    const manualTarget = this.getLocalUnitManualTarget(unitId);
    let cache = this.unitClientPathCache.get(unitId);

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
        
        let cells = sharedEntry?.cells ?? null;
        let cost = sharedEntry?.cost ?? 0;
        
        const directDist = Math.hypot(goalGX - startGX, goalGY - startGY);
        const isSuspiciousDetour = sharedEntry && cost > directDist * 2.5;

        if (!cells || cells.length === 0 || isSuspiciousDetour) {
          const newCells = this.findPath(startGX, startGY, goalGX, goalGY, false, unitId, useRadius);
          const newCost = this.getPathCost(newCells || []);
          
          if (newCells && newCells.length > 0) {
            // Build 512: If we found a significantly better path (20% shorter), update shared cache
            const isBetter = !sharedEntry || newCost < cost * 0.8;
            if (sharedPathKey && isBetter) {
              this.sharedMovePathCache.set(sharedPathKey, { cells: newCells, cost: newCost, updatedAt: now });
            }
            cells = newCells;
            cost = newCost;
          } else if (sharedEntry) {
            // Fallback to shared if local failed
            cells = sharedEntry.cells;
            cost = sharedEntry.cost;
          }
        } else {
          sharedEntry!.updatedAt = now;
        }

        if (!cells || cells.length === 0) {
          this.unitClientPathCache.delete(unitId);
          if (Math.hypot(tx - ux, ty - uy) <= TILE_SIZE * 0.9) {
            return { x: tx, y: ty };
          }
          return null;
        }

        const goalDirX = tx - ux;
        const goalDirY = ty - uy;
        const goalDirLen = Math.hypot(goalDirX, goalDirY);
        const dirNX = goalDirLen > 0.001 ? goalDirX / goalDirLen : 0;
        const dirNY = goalDirLen > 0.001 ? goalDirY / goalDirLen : 0;
        let bestIdx = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        let bestForwardIdx = -1;
        let bestForwardDistance = Number.POSITIVE_INFINITY;

        for (let i = 0; i < cells.length; i++) {
          const world = this.gridToWorld(cells[i].x, cells[i].y);
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
          cells,
          idx: bestForwardIdx >= 0 ? bestForwardIdx : bestIdx,
          updatedAt: now,
        };
        this.unitClientPathCache.set(unitId, cache);
      }
    }

    if (!cache) return null;
    cache.updatedAt = now;
    
    // Build 519: Prioritize direct line-of-sight to the individual slot.
    // This prevents units from clumping at a shared path "bottleneck" waypoint.
    if (this.lineOfSightClear(ux, uy, tx, ty)) {
       this.unitClientPathCache.delete(unitId); // Clear path, we are on direct final approach
       return { x: tx, y: ty };
    }
    
    const shortcut = this.getVisiblePathShortcut(cache, ux, uy, tx, ty, manualTarget, useRadius);
    if (shortcut) return shortcut;

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
        if (distToWaypoint <= TILE_SIZE * 0.38 || distToNext + TILE_SIZE * 0.12 < distToWaypoint) {
          cache.idx += 1;
          continue;
        }
      } else if (Math.hypot(tx - ux, ty - uy) <= TILE_SIZE * 2.5 && this.lineOfSightClear(ux, uy, tx, ty)) {
        return { x: tx, y: ty };
      }

      if (distToWaypoint <= TILE_SIZE * 0.38) {
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
          const distToServer = Math.hypot(Number(u.x) - arrivalPos.x, Number(u.y) - arrivalPos.y);
          if (distToServer > TILE_SIZE * 2) {
            this.unitSlotLocked.delete(id);
            this.localUnitArrivalPos.delete(id);
          }
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
        ? Math.atan2(s.vy, s.vx)
        : (distToSlot > 0.5
          ? Math.atan2(manualTarget.finalY - s.y, manualTarget.finalX - s.x)
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

    const wp = this.getClientUnitWaypoint(
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

    // Build 509: All crowd repulsion and wall avoidance forces removed for simplified movement.

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

    // Build 521/524: Simple Overlap Avoidance (Rightmost-Push)
    // Build 524 Optimizations: Staggered across frames and cached unit list.
    const frame = Number(this.game?.loop?.frame ?? 0);
    if (moving && ((frame + this.stringHash(uid)) % 10 === 0)) {
        // Cache unit list once per frame for all units to share
        if (this.lastFrameUnitsCachedAt !== frame) {
            this.cachedUnitArray = Array.from(this.room?.state?.units?.values() ?? []);
            this.lastFrameUnitsCachedAt = frame;
        }

        const units = this.cachedUnitArray;
        // Check even fewer neighbors to keep it ultra-performant O(N)
        const checkCount = units.length < 80 ? 6 : 3;
        const startIdx = (this.stringHash(uid) + frame) % units.length;
        const radiusA = r;
        const velX = s.vx;
        const velY = s.vy;
        const speedSq = velX * velX + velY * velY;
        
        if (speedSq > 1) { // Reduced threshold to allow slower movement separation
            const speed = Math.sqrt(speedSq);
            const dirX = velX / speed;
            const dirY = velY / speed;
            const rightX = -dirY;
            const rightY = dirX;

            for (let i = 0; i < checkCount; i++) {
                const other = units[(startIdx + i) % units.length];
                if (!other || String(other.id) === uid || (other.hp ?? 0) <= 0) continue;
                const otherRS = this.localUnitRenderState.get(String(other.id));
                if (!otherRS) continue;
                
                const dx = s.x - otherRS.x;
                const dy = s.y - otherRS.y;
                const distSq = dx * dx + dy * dy;
                const radiusB = this.localUnitBodyRadius(other);
                const minDist = (radiusA + radiusB) * this.overlapPushDistanceScale;
                
                // Cheap square distance check first
                if (distSq < minDist * minDist) {
                    // Project both onto the 'right' vector relative to MY movement
                    const projA = s.x * rightX + s.y * rightY;
                    const projB = otherRS.x * rightX + otherRS.y * rightY;
                    
                    if (projA > projB) {
                        // I am the rightmost, so I push further right
                        const pushForce = this.overlapPushStrength; 
                        const nx2 = s.x + rightX * pushForce;
                        const ny2 = s.y + rightY * pushForce;
                        if (this.canOccupyLocalUnit(nx2, ny2, radiusA, uid)) {
                            s.x = nx2;
                            s.y = ny2;
                        }
                    }
                }
            }
        }
    }

    const errX = Number(u.x) - s.x;
    const errY = Number(u.y) - s.y;
    const err = Math.hypot(errX, errY);
    const threshold = TILE_SIZE * 2.5;
    const snap = 0.02;
    if (err > threshold) {
      s.x = Number(u.x);
      s.y = Number(u.y);
      s.vx = 0;
      s.vy = 0;
    } else if (err > 1.0) {
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
      const moveDir = Math.atan2(s.vy, s.vx);
      this.unitFacing.set(id, moveDir);
    }

    s.lastAt = performance.now();
    e.x = s.x;
    e.y = s.y;
  }
}

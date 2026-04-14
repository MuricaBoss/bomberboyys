import Phaser from "phaser";
import {
  PRODUCED_UNIT_EXIT_GRACE_MS,
  RTS_SOLDIER_PROJECTILE_RANGE,
  RTS_TANK_PROJECTILE_RANGE,
  TILE_SIZE,
} from "./constants";
import { BaseDefenseScene_Server } from "./BaseDefenseServer";

export class BaseDefenseScene_Movement extends BaseDefenseScene_Server {
  shouldKeepLocalUnitSimulationActive(id: string, u: any, ux: number, uy: number) {
    const rs = this.localUnitRenderState.get(id);
    return (String(u.ownerId || "") === this.currentPlayerId) && (u.hp ?? 0) > 0 && (
      this.hasLocalUnitManualCommand(id)
      || this.autoEngagedUnitIds.has(id)
      || String(u.aiState || "") === "walking"
      || Math.hypot(Number(rs?.vx ?? 0), Number(rs?.vy ?? 0)) > 4
      || Math.hypot(Number(u.targetX ?? ux) - ux, Number(u.targetY ?? uy) - uy) > TILE_SIZE * 0.2
    );
  }

  hasLocalUnitManualCommand(id: string) {
    return this.localUnitTargetOverride.has(id) || this.localUnitFollowState.has(id);
  }

  getLocalUnitManualTarget(id: string) {
    const override = this.localUnitTargetOverride.get(id);
    if (override) {
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
        sharedPathKey: String(override.sharedPathKey || ""),
        sharedPathCenterX: Number(override.sharedPathCenterX ?? override.x),
        sharedPathCenterY: Number(override.sharedPathCenterY ?? override.y),
        sharedPathOffsetX: Number(override.sharedPathOffsetX ?? 0),
        sharedPathOffsetY: Number(override.sharedPathOffsetY ?? 0),
        pathRadius: Number(override.pathRadius ?? 0),
      };
    }

    const follow = this.localUnitFollowState.get(id);
    if (!follow || !this.room?.state) return null;

    const leader = this.room.state.units.get
      ? this.room.state.units.get(follow.leaderId)
      : this.room.state.units?.[follow.leaderId];
    const leaderAlive = !!leader && (leader.hp ?? 0) > 0;

    let currentX = follow.slotX;
    let currentY = follow.slotY;
    let directSteer = false;

    if (leaderAlive) {
      const leaderRs = this.localUnitRenderState.get(follow.leaderId);
      const leaderX = Number(leaderRs?.x ?? leader?.x ?? follow.leaderGoalX);
      const leaderY = Number(leaderRs?.y ?? leader?.y ?? follow.leaderGoalY);
      const leaderGoalDist = Math.hypot(follow.leaderGoalX - leaderX, follow.leaderGoalY - leaderY);
      if (leaderGoalDist > TILE_SIZE * 1.4) {
        currentX = leaderX + follow.offsetX;
        currentY = leaderY + follow.offsetY;
        directSteer = true;
      }
    }

    const minBound = TILE_SIZE * 0.5;
    const maxX = Math.max(minBound, this.room.state.mapWidth * TILE_SIZE - minBound);
    const maxY = Math.max(minBound, this.room.state.mapHeight * TILE_SIZE - minBound);
    currentX = Math.max(minBound, Math.min(currentX, maxX));
    currentY = Math.max(minBound, Math.min(currentY, maxY));

    return {
      currentX,
      currentY,
      finalX: follow.slotX,
      finalY: follow.slotY,
      setAt: follow.setAt,
      isAuto: !!follow.isAuto,
      directSteer,
      kind: "follow" as const,
      leaderAlive,
      sharedPathKey: "",
      sharedPathCenterX: follow.slotX,
      sharedPathCenterY: follow.slotY,
      sharedPathOffsetX: 0,
      sharedPathOffsetY: 0,
      pathRadius: 0,
    };
  }

  localFormationRadiusForUnit(unit: any) {
    const t = String(unit?.type || "");
    if (t === "tank") return TILE_SIZE * 0.55;
    if (t === "harvester") return TILE_SIZE * 0.45;
    return TILE_SIZE * 0.35;
  }

  localFormationSpacingForIds(unitIds: string[]) {
    if (!this.room?.state?.units) return TILE_SIZE * 0.8;
    let maxRadius = TILE_SIZE * 0.42;
    for (const id of unitIds) {
      const unit = this.room.state.units.get ? this.room.state.units.get(id) : this.room.state.units?.[id];
      if (!unit || (unit.hp ?? 0) <= 0) continue;
      maxRadius = Math.max(maxRadius, this.localFormationRadiusForUnit(unit));
    }
    return Math.max(TILE_SIZE * 0.8, maxRadius * 2 + 2);
  }

  localFormationSlot(centerX: number, centerY: number, gridIndex: number, _totalUnits: number, spacing: number, angle = 0) {
    const sp = Math.max(TILE_SIZE * 0.8, spacing);
    const cols = 5;
    const totalRows = Math.ceil(_totalUnits / cols);
    const row = Math.floor(gridIndex / cols);
    const isLastExpectedRow = row === totalRows - 1;
    const unitsInThisRow = (isLastExpectedRow && _totalUnits % cols !== 0) 
      ? _totalUnits % cols 
      : cols;
    const col = gridIndex % cols;
    const lateralOffset = (col - (unitsInThisRow - 1) / 2) * sp;
    const depthCenter = Math.max(0, totalRows - 1) / 2;
    const depthOffset = (row - depthCenter) * sp;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rx = lateralOffset * (-sin) + (-depthOffset) * cos;
    const ry = lateralOffset * cos + (-depthOffset) * sin;
    return { x: centerX + rx, y: centerY + ry };
  }

  getSharedMovePathKey(now: number, targetX: number, targetY: number, unitCount: number) {
    const tx = Math.round(targetX);
    const ty = Math.round(targetY);
    return `movecmd_${now}_${tx}_${ty}_${unitCount}`;
  }

  sharedPathStillUsed(pathKey: string, excludeIds = new Set<string>()) {
    let used = false;
    this.localUnitTargetOverride.forEach((override, id) => {
      if (used || excludeIds.has(id)) return;
      if (override.sharedPathKey === pathKey) used = true;
    });
    return used;
  }

  issueLocalUnitMoveCommand(targetX: number, targetY: number, isAutoSegment = false) {
    if (!this.room?.state || this.selectedUnitIds.size <= 0) return;

    const ids = Array.from(this.selectedUnitIds).filter((id) => {
      const unit = this.room.state.units.get ? this.room.state.units.get(id) : this.room.state.units?.[id];
      return !!unit && (unit.hp ?? 0) > 0 && String(unit.ownerId || "") === this.currentPlayerId;
    });
    if (ids.length === 0) return;

    this.lastCommandedUnitIds = new Set(ids);

    const unitPositions = ids.map((id) => {
      const s = this.localUnitRenderState.get(id);
      const u = this.room?.state?.units?.get ? this.room.state.units.get(id) : this.room?.state?.units?.[id];
      return { id, x: Number(s?.x ?? u?.x ?? 0), y: Number(s?.y ?? u?.y ?? 0) };
    });

    const groupCX = unitPositions.reduce((sum, unit) => sum + unit.x, 0) / Math.max(1, unitPositions.length);
    const groupCY = unitPositions.reduce((sum, unit) => sum + unit.y, 0) / Math.max(1, unitPositions.length);
    const angle = Math.atan2(targetY - groupCY, targetX - groupCX);
    this.lastCommandGroupAngle = angle;

    const spacing = this.localFormationSpacingForIds(ids);
    const n = ids.length;
    this.lastCommandGroupRadius = 3.0 * spacing;

    let maxUnitRadius = TILE_SIZE * 0.17;
    const unitRadiusById = new Map<string, number>();
    for (const id of ids) {
      const unit = this.room.state.units.get ? this.room.state.units.get(id) : this.room.state.units?.[id];
      const radius = this.localUnitBodyRadius(unit);
      unitRadiusById.set(id, radius);
      maxUnitRadius = Math.max(maxUnitRadius, radius);
    }

    const slots: Array<{ x: number; y: number; r: number }> = [];
    const reserved: Array<{ x: number; y: number; radius: number }> = [];
    const selectedSet = new Set(ids);
    let gridIndex = 0;
    const maxSlotIndex = Math.max(64, n * 24);
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

    for (let i = 0; i < n; i++) {
      const slotRadius = Math.max(maxUnitRadius + 2, spacing * 0.35);
      let slot: { x: number; y: number } | null = null;
      while (!slot && gridIndex < maxSlotIndex) {
        const base = this.localFormationSlot(targetX, targetY, gridIndex, n, spacing, angle);
        slot = this.resolveLocalFormationSlot(base.x, base.y, slotRadius, ids[i], reserved, selectedSet, (sx, sy) => {
          return slotCandidateIsFree(sx, sy, slotRadius);
        });
        gridIndex++;
      }

      if (!slot) {
        const base = this.localFormationSlot(targetX, targetY, i, n, spacing, angle);
        slot = {
          x: Phaser.Math.Clamp(base.x, slotRadius, this.room.state.mapWidth * TILE_SIZE - slotRadius),
          y: Phaser.Math.Clamp(base.y, slotRadius, this.room.state.mapHeight * TILE_SIZE - slotRadius),
        };
      }

      reserved.push({ x: slot.x, y: slot.y, radius: slotRadius });
      slots.push({ x: slot.x, y: slot.y, r: slotRadius });
    }

    const usedUnits = new Set<string>();
    const usedSlots = new Set<number>();
    const assignments = new Map<string, { x: number; y: number }>();
    const priorityOrder: Array<{ id: string; slot: { x: number; y: number } }> = [];

    for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
      let bestUnitIdx = -1;
      let minDistance = Infinity;

      for (let unitIdx = 0; unitIdx < unitPositions.length; unitIdx++) {
        if (usedUnits.has(unitPositions[unitIdx].id)) continue;
        const d = Math.hypot(unitPositions[unitIdx].x - slots[slotIdx].x, unitPositions[unitIdx].y - slots[slotIdx].y);
        if (d < minDistance) {
          minDistance = d;
          bestUnitIdx = unitIdx;
        }
      }

      if (bestUnitIdx === -1) break;
      const id = unitPositions[bestUnitIdx].id;
      const slot = slots[slotIdx];
      usedUnits.add(id);
      usedSlots.add(slotIdx);
      assignments.set(id, { x: slot.x, y: slot.y });
      priorityOrder.push({ id, slot: { x: slot.x, y: slot.y } });
      this.recentAssignedSlots.set(id, { x: slot.x, y: slot.y, r: slot.r, at: Date.now() });
    }

    if (assignments.size === 0) return;

    let maxDist = 0;
    for (const up of unitPositions) {
      const slot = assignments.get(up.id);
      if (slot) maxDist = Math.max(maxDist, Math.hypot(up.x - slot.x, up.y - slot.y));
    }
    const avgSpeed = 80;
    const previewMs = Math.max(8000, (maxDist / avgSpeed) * 1000 * 2 + 4000);
    this.formationPreviewSlots = slots;
    this.formationPreviewAssignments = assignments;
    this.formationPreviewCenter = { x: targetX, y: targetY };
    this.formationPreviewUntil = Date.now() + previewMs;

    const previousSharedKeys = new Set<string>();
    for (const id of ids) {
      const prev = this.localUnitTargetOverride.get(id);
      if (prev?.sharedPathKey) previousSharedKeys.add(prev.sharedPathKey);
    }

    for (const id of ids) {
      this.localUnitTargetOverride.delete(id);
      this.localUnitFollowState.delete(id);
      this.localUnitMovePriority.delete(id);
      this.localUnitPathRadiusOverride.delete(id);
      this.autoEngagedUnitIds.delete(id);
      this.unitAttackTarget.delete(id);
      this.unitClientPathCache.delete(id);
    }

    const pathRadius = Math.max(maxUnitRadius + 4, TILE_SIZE * 0.28);
    let sharedPathCenterX = targetX;
    let sharedPathCenterY = targetY;
    const targetGrid = this.worldToGrid(sharedPathCenterX, sharedPathCenterY);
    if (!this.isPathWalkableForRadius(targetGrid.gx, targetGrid.gy, pathRadius)) {
      let nearestSlot = slots[0];
      let nearestDist = Infinity;
      for (const slot of slots) {
        const d = Math.hypot(slot.x - targetX, slot.y - targetY);
        if (d < nearestDist) {
          nearestDist = d;
          nearestSlot = slot;
        }
      }
      sharedPathCenterX = nearestSlot.x;
      sharedPathCenterY = nearestSlot.y;
    }

    const startGrid = this.worldToGrid(groupCX, groupCY);
    const goalGrid = this.worldToGrid(sharedPathCenterX, sharedPathCenterY);
    const now = Date.now();
    const sharedPathKey = this.getSharedMovePathKey(now, sharedPathCenterX, sharedPathCenterY, ids.length);
    const sharedPath = this.findPath(
      startGrid.gx,
      startGrid.gy,
      goalGrid.gx,
      goalGrid.gy,
      false,
      undefined,
      pathRadius,
    );
    if (sharedPath && sharedPath.length > 0) {
      this.sharedPathCache.set(sharedPathKey, sharedPath);
    }

    priorityOrder.sort((a, b) => {
      const aPos = unitPositions.find((entry) => entry.id === a.id);
      const bPos = unitPositions.find((entry) => entry.id === b.id);
      const aDist = aPos ? Math.hypot(aPos.x - a.slot.x, aPos.y - a.slot.y) : 0;
      const bDist = bPos ? Math.hypot(bPos.x - b.slot.x, bPos.y - b.slot.y) : 0;
      return bDist - aDist;
    });

    this.lastMoveLeaderCount = sharedPath && sharedPath.length > 0 ? 1 : 0;
    this.lastMoveFollowerCount = ids.length;
    this.lastMoveSubgroupSize = ids.length;

    let priority = 0;
    for (const entry of priorityOrder) {
      const slot = assignments.get(entry.id);
      if (!slot) continue;
      this.localUnitTargetOverride.set(entry.id, {
        x: slot.x,
        y: slot.y,
        setAt: now,
        isAuto: isAutoSegment,
        sharedPathKey: sharedPath && sharedPath.length > 0 ? sharedPathKey : undefined,
        sharedPathCenterX,
        sharedPathCenterY,
        sharedPathOffsetX: slot.x - sharedPathCenterX,
        sharedPathOffsetY: slot.y - sharedPathCenterY,
        pathRadius,
      });
      this.localUnitMovePriority.set(entry.id, priority);
      this.localUnitPathRadiusOverride.set(entry.id, pathRadius);
      this.room.send("command_units", {
        unitIds: [entry.id],
        targetX: slot.x,
        targetY: slot.y,
      });
      priority++;
    }

    for (const key of previousSharedKeys) {
      if (!this.sharedPathStillUsed(key)) this.sharedPathCache.delete(key);
    }
  }

  getClientUnitWaypoint(unitId: string, unit: any, now: number, unitRadius = this.localUnitBodyRadius(unit)) {
    const ux = Number(unit?.x ?? 0);
    const uy = Number(unit?.y ?? 0);
    const tx = Number(unit?.targetX ?? ux);
    const ty = Number(unit?.targetY ?? uy);
    const finalX = Number(unit?.finalX ?? tx);
    const finalY = Number(unit?.finalY ?? ty);
    const sharedPathKey = typeof unit?.sharedPathKey === "string" ? String(unit.sharedPathKey) : "";
    const hasSharedPath = sharedPathKey.length > 0;
    const sharedPathCenterX = Number(unit?.sharedPathCenterX ?? tx);
    const sharedPathCenterY = Number(unit?.sharedPathCenterY ?? ty);
    const pathTargetX = hasSharedPath ? sharedPathCenterX : tx;
    const pathTargetY = hasSharedPath ? sharedPathCenterY : ty;
    const startGX = Math.floor(ux / TILE_SIZE);
    const startGY = Math.floor(uy / TILE_SIZE);
    const goalGX = Math.floor(pathTargetX / TILE_SIZE);
    const goalGY = Math.floor(pathTargetY / TILE_SIZE);

    const radiusOverride = this.localUnitPathRadiusOverride.get(unitId);
    const useRadius = radiusOverride ?? Number(unit?.pathRadius ?? unitRadius);
    const radiusBucket = Math.max(4, Math.round(useRadius / 4) * 4);

    let cache = this.unitClientPathCache.get(unitId);
    const cacheExpired = hasSharedPath
      ? false
      : ((now - Number(cache?.updatedAt ?? 0)) > 520);
    const needRecalc = !cache
      || cache.goalGX !== goalGX
      || cache.goalGY !== goalGY
      || cache.radiusBucket !== radiusBucket
      || cache.sharedPathKey !== (hasSharedPath ? sharedPathKey : undefined)
      || cacheExpired
      || cache.idx >= cache.cells.length;

    if (needRecalc) {
      let cells: Array<{ x: number; y: number }> | null = null;

      if (hasSharedPath) {
        cells = this.sharedPathCache.get(sharedPathKey) ?? null;
        if ((!cells || cells.length === 0) && this.isPathWalkableForRadius(goalGX, goalGY, useRadius)) {
          cells = this.findPath(startGX, startGY, goalGX, goalGY, false, unitId, useRadius);
          if (cells && cells.length > 0) this.sharedPathCache.set(sharedPathKey, cells);
        }
      } else {
        const sectorKey = `sector_${Math.floor(goalGX / 4)}_${Math.floor(goalGY / 4)}_r${radiusBucket}`;
        cells = this.sharedPathCache.get(sectorKey) ?? null;
        if ((!cells || cells.length === 0) && this.isPathWalkableForRadius(goalGX, goalGY, useRadius)) {
          cells = this.findPath(startGX, startGY, goalGX, goalGY, false, unitId, useRadius);
          if (cells && cells.length > 0) this.sharedPathCache.set(sectorKey, cells);
        }
      }

      if (!cells || cells.length === 0) {
        this.unitClientPathCache.delete(unitId);
        return null;
      }

      let bestIdx = Math.max(0, Math.min(cache?.idx ?? 0, cells.length - 1));
      let minD = Infinity;
      const railCenterX = hasSharedPath ? sharedPathCenterX : (goalGX * TILE_SIZE + TILE_SIZE / 2);
      const railCenterY = hasSharedPath ? sharedPathCenterY : (goalGY * TILE_SIZE + TILE_SIZE / 2);
      const railOffsetX = finalX - railCenterX;
      const railOffsetY = finalY - railCenterY;
      const searchStart = hasSharedPath && cache ? Math.max(0, cache.idx - 1) : 0;
      const searchEnd = hasSharedPath && cache ? cells.length : cells.length;
      const goalDirX = pathTargetX - ux;
      const goalDirY = pathTargetY - uy;
      const goalDirLen = Math.hypot(goalDirX, goalDirY);
      const goalDirNX = goalDirLen > 0.001 ? (goalDirX / goalDirLen) : 0;
      const goalDirNY = goalDirLen > 0.001 ? (goalDirY / goalDirLen) : 0;
      let bestForwardIdx = -1;
      let bestForwardDist = Infinity;

      for (let i = searchStart; i < searchEnd; i++) {
        const centerWX = cells[i].x * TILE_SIZE + TILE_SIZE / 2;
        const centerWY = cells[i].y * TILE_SIZE + TILE_SIZE / 2;
        const wx = centerWX + railOffsetX;
        const wy = centerWY + railOffsetY;
        const d = hasSharedPath
          ? Math.hypot(centerWX - ux, centerWY - uy)
          : Math.hypot(wx - ux, wy - uy);
        const centerDX = centerWX - ux;
        const centerDY = centerWY - uy;
        const forwardDot = centerDX * goalDirNX + centerDY * goalDirNY;
        if (d < minD) {
          minD = d;
          bestIdx = i;
        }
        if (hasSharedPath && forwardDot >= -TILE_SIZE * 0.12 && d < bestForwardDist) {
          bestForwardDist = d;
          bestForwardIdx = i;
        }
      }

      if (hasSharedPath && !cache && bestForwardIdx >= 0) {
        bestIdx = bestForwardIdx;
      }

      cache = {
        goalGX,
        goalGY,
        radiusBucket,
        cells,
        idx: bestIdx,
        updatedAt: now,
        sharedPathKey: hasSharedPath ? sharedPathKey : undefined,
      };
      this.unitClientPathCache.set(unitId, cache);
    } else if (cache && cache.sharedPathKey && cache.cells.length > 0) {
      cache.updatedAt = now;
    }

    if (!cache) return null;

    const railCenterX = hasSharedPath ? sharedPathCenterX : (goalGX * TILE_SIZE + TILE_SIZE / 2);
    const railCenterY = hasSharedPath ? sharedPathCenterY : (goalGY * TILE_SIZE + TILE_SIZE / 2);
    const railOffsetX = finalX - railCenterX;
    const railOffsetY = finalY - railCenterY;

    while (cache.idx < cache.cells.length) {
      const c = cache.cells[cache.idx];
      let wx = c.x * TILE_SIZE + TILE_SIZE / 2 + railOffsetX;
      let wy = c.y * TILE_SIZE + TILE_SIZE / 2 + railOffsetY;

      if (this.clearanceGrid && this.clearanceGrid.length > 0) {
        const gridIdx = c.y * this.gridW + c.x;
        const clearanceTiles = this.clearanceGrid[gridIdx];
        if (clearanceTiles !== undefined) {
          const maxDistPx = Math.max(TILE_SIZE * 0.1, (clearanceTiles * TILE_SIZE) - unitRadius - 6);
          const currentOffsetDist = Math.hypot(railOffsetX, railOffsetY);
          if (currentOffsetDist > maxDistPx && currentOffsetDist > 0.001) {
            const scale = maxDistPx / currentOffsetDist;
            wx = c.x * TILE_SIZE + TILE_SIZE / 2 + railOffsetX * scale;
            wy = c.y * TILE_SIZE + TILE_SIZE / 2 + railOffsetY * scale;
          }
        }
      }

      if (Math.hypot(wx - ux, wy - uy) <= TILE_SIZE * 0.45) {
        cache.idx += 1;
      } else {
        return { x: wx, y: wy };
      }
    }

    return null;
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
        const tx = Number(u.targetX ?? u.x);
        const ty = Number(u.targetY ?? u.y);
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
          const corrPower = isWalking ? 0.006 : 0.016;
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
    const atkTarget = atkTargetId ? (this.room?.state?.units?.get ? this.room.state.units.get(atkTargetId) : this.room?.state?.units?.[atkTargetId])
      || (this.room?.state?.structures?.get ? this.room.state.structures.get(atkTargetId) : this.room?.state?.structures?.[atkTargetId])
      || (this.room?.state?.cores?.get ? this.room.state.cores.get(atkTargetId) : this.room?.state?.cores?.[atkTargetId]) : null;

    const firingRange = isTank ? RTS_TANK_PROJECTILE_RANGE : RTS_SOLDIER_PROJECTILE_RANGE;
    const distToAtkTarget = atkTarget ? Math.hypot(Number(atkTarget.x) - s.x, Number(atkTarget.y) - s.y) : 99999;
    const inFiringRange = !!atkTarget && distToAtkTarget <= (firingRange * 0.95);

    if (isAutoEngaged && atkTarget && !inFiringRange) {
      tx = Number(atkTarget.x);
      ty = Number(atkTarget.y);
    }

    const nowMs = Date.now();
    const manualTarget = this.getLocalUnitManualTarget(id);
    const distToSlot = manualTarget
      ? Math.hypot(manualTarget.finalX - s.x, manualTarget.finalY - s.y)
      : 0;
    const distToSharedCenter = manualTarget?.sharedPathKey
      ? Math.hypot(manualTarget.sharedPathCenterX - s.x, manualTarget.sharedPathCenterY - s.y)
      : 0;
    const finalApproachRadius = manualTarget?.sharedPathKey
      ? Math.max(
        TILE_SIZE * 4.5,
        Math.hypot(
          Number(manualTarget.sharedPathOffsetX ?? 0),
          Number(manualTarget.sharedPathOffsetY ?? 0),
        ) + TILE_SIZE * 2.25,
      )
      : 0;
    const useFinalApproachPath = !!manualTarget?.sharedPathKey && !manualTarget.directSteer && (
      distToSharedCenter <= finalApproachRadius
      || distToSlot <= finalApproachRadius * 1.35
    );
    if (manualTarget) {
      const prio = this.localUnitMovePriority.get(id) ?? 0;
      const groupSize = Math.max(1, this.localUnitTargetOverride.size + this.localUnitFollowState.size);
      const delayStep = groupSize >= 20 ? 20 : groupSize >= 10 ? 16 : 12;
      const maxDelay = groupSize >= 20 ? 620 : groupSize >= 10 ? 420 : 220;
      const startDelay = (manualTarget.isAuto || manualTarget.directSteer) ? 0 : Math.min(maxDelay, prio * delayStep);
      if (manualTarget.isAuto || nowMs - manualTarget.setAt >= startDelay) {
        tx = manualTarget.currentX;
        ty = manualTarget.currentY;
      }
      if (!manualTarget.directSteer && distToSlot <= TILE_SIZE * 0.48) {
        if (!this.unitSlotLocked.has(String(id))) {
          const velSpeed = Math.hypot(s.vx, s.vy);
          let arrivalDir: number | null = null;
          if (velSpeed > 0.2) {
            arrivalDir = this.angleToDir8(Math.atan2(s.vy, s.vx));
          } else if (distToSlot > 0.5) {
            arrivalDir = this.angleToDir8(Math.atan2(manualTarget.finalY - s.y, manualTarget.finalX - s.x));
          } else {
            arrivalDir = (u.dir !== undefined) ? u.dir : 1;
          }

          if (arrivalDir !== null) this.unitFacing.set(String(id), arrivalDir);
          this.unitSlotLocked.add(String(id));

          const committedDir = this.unitFacing.get(id) ?? arrivalDir ?? (u.dir || 1);
          this.room.send("unit_client_pose_batch", {
            poses: [{
              unitId: id,
              x: manualTarget.finalX,
              y: manualTarget.finalY,
              dir: committedDir,
              tx: manualTarget.finalX,
              ty: manualTarget.finalY,
              final: true,
            }],
          });
        }

        this.localUnitGhostMode?.delete(String(id));
        if (Number(u.manualUntil || 0) > 0) u.manualUntil = 0;
        s.x = manualTarget.finalX;
        s.y = manualTarget.finalY;
        s.vx = 0;
        s.vy = 0;
        e.x = s.x;
        e.y = s.y;
        s.lastAt = performance.now();
        return;
      }

      this.unitSlotLocked.delete(String(id));
    } else {
      this.unitSlotLocked.delete(String(id));
    }

    const waypointInput = manualTarget
      ? {
        x: s.x,
        y: s.y,
        targetX: useFinalApproachPath
          ? manualTarget.finalX
          : (manualTarget.sharedPathKey ? manualTarget.sharedPathCenterX : tx),
        targetY: useFinalApproachPath
          ? manualTarget.finalY
          : (manualTarget.sharedPathKey ? manualTarget.sharedPathCenterY : ty),
        finalX: manualTarget.finalX,
        finalY: manualTarget.finalY,
        sharedPathKey: useFinalApproachPath ? "" : manualTarget.sharedPathKey,
        sharedPathCenterX: manualTarget.sharedPathCenterX,
        sharedPathCenterY: manualTarget.sharedPathCenterY,
        pathRadius: manualTarget.pathRadius,
      }
      : { x: s.x, y: s.y, targetX: tx, targetY: ty };

    const wp = manualTarget?.directSteer ? null : this.getClientUnitWaypoint(
      id,
      waypointInput,
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
    // Build 350: Professional Steering (HowToRTS Inspired)
    const maxSpeed = speed;
    const steerForce = { x: 0, y: 0 };

    // 1. SEEK FORCE
    if (moving) {
      const desiredVX = (toTX / toTLen) * maxSpeed;
      const desiredVY = (toTY / toTLen) * maxSpeed;
      steerForce.x += (desiredVX - s.vx) * 12;
      steerForce.y += (desiredVY - s.vy) * 12;
    } else {
      // Friction when stopping
      steerForce.x -= s.vx * 8;
      steerForce.y -= s.vy * 8;
    }

    // 2. SEPARATION FORCE (Continuous)
    const inGracePeriod = manualTarget && (Date.now() - manualTarget.setAt) < 800;
    const producedExitGraceActive = Number(u.manualUntil || 0) > nowMs;
    const uid = String(id);
    const ignoreSid = producedExitGraceActive ? this.getStructureIdAt(Math.floor(s.x / TILE_SIZE), Math.floor(s.y / TILE_SIZE)) : undefined;
    const isJammedGhost = this.localUnitGhostMode?.has(uid) ?? false;

    // Build 353: Enable separation even during spawn (unless jammed), but respect factory ignore
    if (!isJammedGhost && isLocalOwned && !inGracePeriod && this.room?.state?.units?.forEach) {
      const me = this.room.state.players?.get ? this.room.state.players.get(this.currentPlayerId) : this.room.state.players?.[this.currentPlayerId];
      const myTeam = me?.team;
      const myRadius = this.localUnitBodyRadius(u);
      const searchRadius = TILE_SIZE * 1.5;
      const potentialNeighbors = this.unitGrid.getNeighbors(s.x, s.y, searchRadius);
      
      for (const oid of potentialNeighbors) {
        if (oid === id) continue;
        const ou = this.room.state.units.get ? this.room.state.units.get(oid) : (this.room.state.units as any)?.[oid];
        if (!ou || (ou.hp ?? 0) <= 0) continue;
        if (myTeam && ou.team !== myTeam) continue;
        
        const ors = this.localUnitRenderState.get(oid);
        const ox = Number(ors?.x ?? ou.x);
        const oy = Number(ors?.y ?? ou.y);
        const oRadius = this.localUnitBodyRadius(ou);
        const dx = s.x - ox;
        const dy = s.y - oy;
        const dist = Math.hypot(dx, dy);
        const minDist = myRadius + oRadius + 4;
        
        if (dist > 0 && dist < minDist) {
          const pushStrength = (1.0 - dist / minDist) * 450;
          steerForce.x += (dx / dist) * pushStrength;
          steerForce.y += (dy / dist) * pushStrength;
        }
      }
    }

    // 3. WALL AVOIDANCE FORCE
    if (!isJammedGhost) {
      const gx = Math.floor(s.x / TILE_SIZE);
      const gy = Math.floor(s.y / TILE_SIZE);
      const wallR = this.localUnitBodyRadius(u) + 6;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const cx = gx + dx;
          const cy = gy + dy;
          if (this.tileAt(cx, cy) !== 0 || (this.hasStructureAt(cx, cy) && this.getStructureIdAt(cx, cy) !== ignoreSid) || this.hasCoreAt(cx, cy)) {
            const tileCX = (cx + 0.5) * TILE_SIZE;
            const tileCY = (cy + 0.5) * TILE_SIZE;
            const wdx = s.x - tileCX;
            const wdy = s.y - tileCY;
            const wdist = Math.hypot(wdx, wdy);
            if (wdist < wallR && wdist > 0.01) {
              const pushStrength = (1.0 - wdist / wallR) * 600;
              steerForce.x += (wdx / wdist) * pushStrength;
              steerForce.y += (wdy / wdist) * pushStrength;
            }
          }
        }
      }
    }

    // 4. INTEGRATE & LIMIT
    s.vx += steerForce.x * dt;
    s.vy += steerForce.y * dt;

    const currentSpeed = Math.hypot(s.vx, s.vy);
    const limitSpeed = Math.max(maxSpeed, currentSpeed * 0.92); // Allow some burst from push
    if (currentSpeed > limitSpeed && currentSpeed > 0.1) {
      s.vx = (s.vx / currentSpeed) * limitSpeed;
      s.vy = (s.vy / currentSpeed) * limitSpeed;
    }

    // Final Move
    const nx = s.x + s.vx * dt;
    const ny = s.y + s.vy * dt;
    const r = this.localUnitBodyRadius(u);
    // Build 353: Use selective constraint
    if (isJammedGhost || this.canOccupyLocalUnit(nx, ny, r, uid, ignoreSid as any)) {
      s.x = nx;
      s.y = ny;
    } else {
      // Small slide fallback if still hitting something hard
      if (this.canOccupyLocalUnit(nx, s.y, r, uid, ignoreSid as any)) s.x = nx;
      else if (this.canOccupyLocalUnit(s.x, ny, r, uid, ignoreSid as any)) s.y = ny;
      s.vx *= 0.8;
      s.vy *= 0.8;
    }
    // Build 350: Sync with Server & Jam Detection
    const errX = Number(u.x) - s.x;
    const errY = Number(u.y) - s.y;
    const err = Math.hypot(errX, errY);
    const unitType = String(u.type || "");
    const isClientDriven = isLocalOwned && this.isClientAuthoritativeUnitType(unitType);

    if (isClientDriven) {
      if (!manualTarget && err > TILE_SIZE * 2.4) {
        // Snap if dangerously out of sync
        const isGhost = isJammedGhost || producedExitGraceActive;
        if (isGhost || this.canOccupyLocalUnit(Number(u.x), Number(u.y), r, uid)) {
          s.x = Number(u.x);
          s.y = Number(u.y);
          s.vx = 0; s.vy = 0;
        }
      }
    } else if (!manualTarget && err > TILE_SIZE * 1.15) {
      // Remote unit sync
      s.x = Number(u.x);
      s.y = Number(u.y);
      s.vx = 0; s.vy = 0;
    }

    // Jam Detection for GhostMode
    if (s.jamRefX === undefined || !moving) {
      s.jamRefX = s.x;
      s.jamRefY = s.y;
      this.localUnitJamTicks.set(uid, 0);
    } else {
      const distFromRef = Math.hypot(s.x - s.jamRefX!, s.y - s.jamRefY!);
      if (distFromRef > TILE_SIZE * 0.85) {
        s.jamRefX = s.x;
        s.jamRefY = s.y;
        this.localUnitJamTicks.set(uid, 0);
      } else {
        const ticks = (this.localUnitJamTicks.get(uid) ?? 0) + 1;
        this.localUnitJamTicks.set(uid, ticks);
        if (ticks > 20) {
          if (!this.localUnitGhostMode) this.localUnitGhostMode = new Set<string>();
          this.localUnitGhostMode.add(uid);
        }
      }
    }

    // Facing Update
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

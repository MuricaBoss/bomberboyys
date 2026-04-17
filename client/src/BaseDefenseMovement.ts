import Phaser from "phaser";
import {
  PRODUCED_UNIT_EXIT_GRACE_MS,
  RTS_SOLDIER_PROJECTILE_RANGE,
  RTS_TANK_PROJECTILE_RANGE,
  TILE_SIZE,
} from "./constants";
import { BaseDefenseScene_Server } from "./BaseDefenseServer";

export class BaseDefenseScene_Movement extends BaseDefenseScene_Server {
  pendingFinalPoses: any[] = [];

  sendClientUnitPoses(now: number) {
    if (this.pendingFinalPoses && this.pendingFinalPoses.length > 0) {
      // Build 434: Group all final:true poses into a single batch to avoid dropping packets when 50 units arrive simultaneously
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
    // Build 364: Use real-time tuner value
    if (this.physicsTuner) return this.physicsTuner.formationSpacing;
    if (!this.room?.state?.units) return TILE_SIZE * 3.0; 
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

  // Build 487: 'String Pulling' logic. Checks if a straight line between nodes is obstacle-free.
  isLineOfSightWalkable(a: { x: number, y: number }, b: { x: number, y: number }, radius: number) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    // Sample every half-tile to verify path
    const steps = Math.max(2, Math.ceil(dist / (TILE_SIZE * 0.5)));
    for (let i = 1; i <= steps; i++) {
      const px = a.x + (b.x - a.x) * (i / steps);
      const py = a.y + (b.y - a.y) * (i / steps);
      const ogx = Math.floor(px / TILE_SIZE);
      const ogy = Math.floor(py / TILE_SIZE);
      if (!this.isPathWalkableForRadius(ogx, ogy, radius)) {
        return false;
      }
    }
    return true;
  }

  // Build 487: Post-processes A* nodes by skipping intermediate points if a shortcut is possible.
  smoothPath(path: { x: number, y: number }[], radius: number) {
    if (path.length <= 2) return path;
    const result: { x: number, y: number }[] = [path[0]];
    let currentIdx = 0;
    
    while (currentIdx < path.length - 1) {
      let furthestVisibleIdx = currentIdx + 1;
      // Look ahead up to 6 nodes (roughly 6 tiles) to find shortcuts
      for (let next = currentIdx + 2; next < Math.min(path.length, currentIdx + 7); next++) {
        if (this.isLineOfSightWalkable(path[currentIdx], path[next], radius)) {
          furthestVisibleIdx = next;
        } else {
          break; // Obstacle found, stop looking ahead from this node
        }
      }
      result.push(path[furthestVisibleIdx]);
      currentIdx = furthestVisibleIdx;
    }
    return result;
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
      this.unitSlotLocked.delete(id);
      this.localUnitArrivalPos?.delete(id);
    }

    const now = Date.now();
    const firstU = this.room.state.units.get ? this.room.state.units.get(ids[0]) : this.room.state.units?.[ids[0]];
    const isTankGroup = firstU?.type === "tank";
    // Build 232: Use a shared high-level path for the whole group instead of individual A* for everyone.
    // This allows column movement on "Locked Rails".
    const sharedPathKey = `path_${now}_${Math.random().toString(36).substr(2, 5)}`;
    const pathRadius = isTankGroup ? 24 : 10;
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

    // Build 487: Use the group centroid as the path start for better representative direction.
    let sumX = 0;
    let sumY = 0;
    for (const p of unitPositions) {
      sumX += p.x;
      sumY += p.y;
    }
    let pathStartCX = sumX / unitPositions.length;
    let pathStartCY = sumY / unitPositions.length;

    const startGrid = this.worldToGrid(pathStartCX, pathStartCY);
    const goalGrid = this.worldToGrid(sharedPathCenterX, sharedPathCenterY);
    
    const gridPath = this.findPath(startGrid.gx, startGrid.gy, goalGrid.gx, goalGrid.gy, false, undefined, pathRadius);
    if (!gridPath || gridPath.length === 0) return;

    // Build 486: World pixel conversion
    let rawMasterPath = gridPath.map(node => ({
        x: node.x * TILE_SIZE + TILE_SIZE / 2,
        y: node.y * TILE_SIZE + TILE_SIZE / 2
    }));

    // Build 487: 'String Pulling' smoothing pass to remove zig-zags and detours
    const masterPath = this.smoothPath(rawMasterPath, 6);

    const laneKeys: string[] = [];
    const laneCount = Math.max(1, Math.min(3, Math.ceil(ids.length / 25)));
    const laneGap = firstU?.type === "tank" ? 40 : 16;

    for (let l = 0; l < laneCount; l++) {
      const lOffset = (l - (laneCount - 1) / 2) * laneGap;
      const lPath: Array<{ x: number; y: number }> = [];

      for (let i = 0; i < masterPath.length; i++) {
        const node = masterPath[i];
        let dx = 0;
        let dy = 0;

        // Calculate direction for perpendicular offset
        if (i < masterPath.length - 1) {
          dx += (masterPath[i + 1].x - node.x);
          dy += (masterPath[i + 1].y - node.y);
        }
        if (i > 0) {
          dx += (node.x - masterPath[i - 1].x);
          dy += (node.y - masterPath[i - 1].y);
        }

        const len = Math.hypot(dx, dy);
        const pnx = len > 0.1 ? -dy / len : 0;
        const pny = len > 0.1 ? dx / len : 0;

        let ox = node.x + pnx * lOffset;
        let oy = node.y + pny * lOffset;

        // Build 483: Nudge check. If the offset rail hits a wall, we pull it back towards the center path.
        // This ensures the army 'squeezes' through tight corridors together.
        const ogx = Math.floor(ox / TILE_SIZE);
        const ogy = Math.floor(oy / TILE_SIZE);
        if (!this.isPathWalkableForRadius(ogx, ogy, 6)) {
          ox = node.x;
          oy = node.y;
        }

        lPath.push({ x: ox, y: oy });
      }

      const pKey = `pPath_${now}_${l}`;
      this.activeCommandPaths.set(pKey, {
        nodes: lPath,
        participants: new Set()
      });
      laneKeys.push(pKey);

      // Keep in shared cache for backward compatibility
      const sharedPathBaseKey = this.getSharedMovePathKey(now, sharedPathCenterX, sharedPathCenterY, ids.length);
      this.sharedPathCache.set(`${sharedPathBaseKey}_L${l}`, lPath as any);
    }

    this.lastMoveLeaderCount = laneCount;
    this.lastMoveFollowerCount = ids.length;
    this.lastMoveSubgroupSize = ids.length;

    priorityOrder.sort((a, b) => {
      const aPos = unitPositions.find((entry) => entry.id === a.id);
      const bPos = unitPositions.find((entry) => entry.id === b.id);
      const aDist = aPos ? Math.hypot(aPos.x - a.slot.x, aPos.y - a.slot.y) : 0;
      const bDist = bPos ? Math.hypot(bPos.x - b.slot.x, bPos.y - b.slot.y) : 0;
      return bDist - aDist;
    });

    let priority = 0;
    const commandedUnitIds: string[] = [];
    
    // Build 472: Deep Optimization. Increased squad size from 5 to 12.
    const squadSize = 12;
    let totalSquads = 0;
    for (let sStart = 0; sStart < priorityOrder.length; sStart += squadSize) {
      const squad = priorityOrder.slice(sStart, sStart + squadSize);
      const leaderEntry = squad[0];
      const leaderId = leaderEntry.id;
      const leaderSlot = assignments.get(leaderId);
      if (!leaderSlot) continue;

      totalSquads++;
      // --- Setup Leader ---
      const laneIdx = Math.floor(sStart / squadSize) % laneKeys.length;
      const pPathId = laneKeys[laneIdx];
      
      // Clean up previous context
      this.localUnitFollowState.delete(leaderId);
      const oldTarget = this.localUnitTargetOverride.get(leaderId);
      if (oldTarget?.persistentPathId) {
        this.activeCommandPaths.get(oldTarget.persistentPathId)?.participants.delete(leaderId);
      }
      if (pPathId) {
        this.activeCommandPaths.get(pPathId)?.participants.add(leaderId);
      }

      this.localUnitTargetOverride.set(leaderId, {
        x: leaderSlot.x,
        y: leaderSlot.y,
        setAt: now,
        isAuto: isAutoSegment,
        persistentPathId: pPathId,
        sharedPathCenterX,
        sharedPathCenterY,
        sharedPathOffsetX: leaderSlot.x - sharedPathCenterX,
        sharedPathOffsetY: leaderSlot.y - sharedPathCenterY,
        pathRadius,
      });

      this.unitClientPathCache.delete(leaderId);
      this.localUnitMovePriority.set(leaderId, priority++);
      this.localUnitPathRadiusOverride.set(leaderId, pathRadius);
      this.localUnitGhostMode?.delete(leaderId);
      
      const lServerUnit = this.room?.state?.units?.[leaderId];
      if (lServerUnit) lServerUnit.manualUntil = 0;
      commandedUnitIds.push(leaderId);

      // --- Setup Followers ---
      for (let f = 1; f < squad.length; f++) {
        const followerId = squad[f].id;
        const followerSlot = assignments.get(followerId);
        if (!followerSlot) continue;

        // Clean up previous context
        this.localUnitTargetOverride.delete(followerId);
        const fOldTarget = this.localUnitTargetOverride.get(followerId);
        if (fOldTarget?.persistentPathId) {
            this.activeCommandPaths.get(fOldTarget.persistentPathId)?.participants.delete(followerId);
        }

        // Build 472: Support larger squads (up to 12). Grid pattern around leader.
        const fCol = (f % 3) - 1;
        const fRow = Math.floor(f / 3) - 1;
        let ox = fCol * TILE_SIZE * 0.35;
        let oy = fRow * TILE_SIZE * 0.35;

        this.localUnitFollowState.set(followerId, {
          leaderId: leaderId,
          offsetX: ox,
          offsetY: oy,
          slotX: followerSlot.x,
          slotY: followerSlot.y,
          leaderGoalX: leaderSlot.x,
          leaderGoalY: leaderSlot.y,
          setAt: now,
          isAuto: isAutoSegment
        });

        this.unitClientPathCache.delete(followerId);
        this.localUnitMovePriority.set(followerId, priority++);
        this.localUnitPathRadiusOverride.set(followerId, pathRadius);
        this.localUnitGhostMode?.delete(followerId);

        const fServerUnit = this.room?.state?.units?.[followerId];
        if (fServerUnit) fServerUnit.manualUntil = 0;
        commandedUnitIds.push(followerId);
      }
    }
    this.activeSquadCount = totalSquads;

    if (commandedUnitIds.length > 0) {
      this.room.send("command_units", {
        unitIds: commandedUnitIds,
        targetX: sharedPathCenterX,
        targetY: sharedPathCenterY,
      });
    }

    // Clear shared caches just in case
    for (const key of previousSharedKeys) {
      this.sharedPathCache.delete(key);
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
    
    // Build 391: Force recalculation if the command's sharedKey changed (e.g. new move order)
    const keyMismatch = hasSharedPath && cache?.sharedPathKey !== sharedPathKey;
    
    const cacheExpired = hasSharedPath
      ? keyMismatch
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
        // Build 429: Include start position in sector key so units at different positions
        // don't reuse a path calculated from another unit's starting location.
        const sectorKey = `sector_${startGX}_${startGY}_${goalGX}_${goalGY}_r${radiusBucket}`;
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

    // Build 390: Multi-Path. Each path (L0, L1, etc) is already offset and obstacle-aware.
    while (cache.idx < cache.cells.length) {
      const c = cache.cells[cache.idx];
      
      // Target the cell center directly. Rail offset is preserved for finalizing the approach.
      let wx = c.x * TILE_SIZE + TILE_SIZE / 2 + railOffsetX;
      let wy = c.y * TILE_SIZE + TILE_SIZE / 2 + railOffsetY;

      if (cache.idx === cache.cells.length - 1) {
          wx = finalX;
          wy = finalY;
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
          const corrPower = isWalking ? 0.012 : 0.024; // Build 394: Increased responsiveness
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
      if (!manualTarget.directSteer && distToSlot <= TILE_SIZE * 0.65) {
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
          this.pendingFinalPoses.push({
            unitId: id,
            x: manualTarget.finalX,
            y: manualTarget.finalY,
            dir: committedDir,
            tx: manualTarget.finalX,
            ty: manualTarget.finalY,
            final: true,
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
        // Save arrival position for post-arrival hold
        this.localUnitArrivalPos.set(String(id), { x: manualTarget.finalX, y: manualTarget.finalY });
        this.localUnitTargetOverride.delete(String(id));
        this.unitClientPathCache.delete(String(id));
        if (manualTarget.sharedPathKey) {
          this.sharedPathCache.delete(manualTarget.sharedPathKey);
        }
        this.localUnitMovePriority.delete(String(id));
        this.localUnitPathRadiusOverride.delete(String(id));
        this.unitSlotLocked.delete(String(id));
        return;
      }

      this.unitSlotLocked.delete(String(id));
    } else {
      this.unitSlotLocked.delete(String(id));
    }
    const producedExitGraceActive = Number(u.manualUntil || 0) > nowMs && (!manualTarget || !!manualTarget.isAuto);

    // Build 382: True Legacy/Absolute Lock. If spawning, bypass EVERYTHING.
    // This allows the server to guide the unit to its slot 'on-rails' without any physics interference.
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


    // Build 431: Post-arrival hold — keep unit locked at arrival position until server confirms idle
    // This prevents physics or server-state drift from pulling the unit after it has arrived.
    const arrivalPos = this.localUnitArrivalPos?.get(String(id));
    if (arrivalPos && this.unitSlotLocked.has(String(id))) {
      if (manualTarget && !manualTarget.isAuto) {
        // Build 457: If user issued a manual command, immediately break the arrival lock
        this.unitSlotLocked.delete(String(id));
        this.localUnitArrivalPos?.delete(String(id));
      } else if (!manualTarget) {
        const serverIdle = String(u.aiState || "") !== "walking";
        s.x = arrivalPos.x;
        s.y = arrivalPos.y;
        s.vx = 0;
        s.vy = 0;
        e.x = s.x;
        e.y = s.y;
        s.lastAt = performance.now();
        if (serverIdle) {
          // Server confirmed idle — release lock
          this.unitSlotLocked.delete(String(id));
          this.localUnitArrivalPos?.delete(String(id));
        } else {
          // Re-send final:true to ensure server gets it
          const dir = this.unitFacing.get(String(id)) ?? Number(u.dir ?? 1);
          this.pendingFinalPoses.push({ unitId: id, x: arrivalPos.x, y: arrivalPos.y, dir, tx: arrivalPos.x, ty: arrivalPos.y, final: true });
        }
        return;
      }
    }

    // Build 427: When grace ends, if unit is already at its spawn exit slot, clear it immediately
    // so it doesn't try to re-navigate back to the slot from a stale path cache.
    if (manualTarget && !manualTarget.sharedPathKey && distToSlot <= TILE_SIZE * 1.5) {
      this.localUnitGhostMode?.delete(String(id));
      // Send final:true so server sets aiState=idle and doesn't run its fallback movement
      const dir = this.unitFacing.get(id) ?? Number(u.dir ?? 1);
      this.pendingFinalPoses.push({ unitId: id, x: s.x, y: s.y, dir, tx: s.x, ty: s.y, final: true });
      this.localUnitTargetOverride.delete(String(id));
      this.unitClientPathCache.delete(String(id));
      this.localUnitMovePriority.delete(String(id));
      this.localUnitPathRadiusOverride.delete(String(id));
    }
    const waypointInput = manualTarget
      ? {
        x: s.x,
        y: s.y,
        type: u.type, // Build 387: Pass type for lane tuning
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
      : { x: s.x, y: s.y, targetX: tx, targetY: ty, type: u.type };

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
      steerForce.x += (desiredVX - s.vx) * 20;
      steerForce.y += (desiredVY - s.vy) * 20;
    } else {
      // Friction when stopping
      steerForce.x -= s.vx * 8;
      steerForce.y -= s.vy * 8;
    }

    // 2. SEPARATION FORCE (Continuous)
    const inGracePeriod = manualTarget && (Date.now() - manualTarget.setAt) < 800;
    const uid = String(id);
    const ignoreSid = producedExitGraceActive ? this.getStructureIdAt(Math.floor(s.x / TILE_SIZE), Math.floor(s.y / TILE_SIZE)) : undefined;
    const isJammedGhost = this.localUnitGhostMode?.has(uid) ?? false;

    // Build 353: Enable separation even during spawn (unless jammed), but respect factory ignore
    // Build 363: REMOVED isLocalOwned and !inGracePeriod to ensure ALL units repel each other globally.
    // Build 364: Use PhysicsTuner values
    if (!isJammedGhost && this.room?.state?.units?.forEach) {
      const me = this.room.state.players?.get ? this.room.state.players.get(this.currentPlayerId) : this.room.state.players?.[this.currentPlayerId];
      const myTeam = me?.team;
      const myRadius = this.localUnitBodyRadius(u);
      
      const p = this.physicsTuner;
      const searchRadius = p ? p.repulsionRange * 1.8 : TILE_SIZE * 6.0; 
      const potentialNeighbors = this.unitGrid.getNeighbors(s.x, s.y, searchRadius);
      
      for (const oid of potentialNeighbors) {
        if (oid === id || producedExitGraceActive) continue; // Build 380: Grace units don't repel
        const ou = this.room.state.units.get ? this.room.state.units.get(oid) : (this.room.state.units as any)?.[oid];
        if (!ou || (ou.hp ?? 0) <= 0) continue;
        if (myTeam && ou.team !== myTeam) continue;

        // Build 448: Social Distance Relaxation
        // If both units are idle and settled near their slots, skip repulsion
        // to prevent vibration near destinations.
        const myDistToTarget = toTLen; 
        const ouX = Number(ou.x);
        const ouY = Number(ou.y);
        const ouTX = Number(ou.targetX ?? ouX);
        const ouTY = Number(ou.targetY ?? ouY);
        const ouDistToTarget = Math.sqrt((ouX - ouTX)**2 + (ouY - ouTY)**2);

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
        
        // Build 388: Type-specific repulsion range
        const uType = String(u.type || "");
        const padding = uType === "tank" ? (p?.tankRepulsionRange ?? 120) : (p?.soldierRepulsionRange ?? 48);
        const minDist = myRadius + oRadius + padding;
        
        if (dist < minDist) {
          if (dist < 0.1) {
            const ang = Math.random() * Math.PI * 2;
            dx = Math.cos(ang) * 0.1;
            dy = Math.sin(ang) * 0.1;
            dist = 0.1;
          }
          const baseForce = p ? p.repulsionForce : 100000;
          
          // Build 376: Exponential Repulsion (Stiffer response when breaking social distance)
          const ratio = 1.0 - dist / minDist;
          let pushStrength = ratio * ratio * baseForce;
          
          // Build 429: Reduced overlap kick to prevent explosive separation
          if (dist < (myRadius + oRadius)) {
              pushStrength *= 2.0; // Hard separation kick (reduced from 5x)
          } else if (ratio > 0.5) {
              pushStrength *= 1.3; // (reduced from 2x)
          }

          steerForce.x += (dx / dist) * pushStrength;
          steerForce.y += (dy / dist) * pushStrength;
        }
      }
    }

    // 3. OBSTACLE AVOIDANCE FORCE (Build 370: Improved 5x5 edge-based detection)
    if (!isJammedGhost) {
      const gx = Math.floor(s.x / TILE_SIZE);
      const gy = Math.floor(s.y / TILE_SIZE);
      
      const p = this.physicsTuner;
      const wallR = p ? p.wallAvoidanceRange : this.localUnitBodyRadius(u) + TILE_SIZE * 1.8;
      const baseWForce = p ? p.wallAvoidanceForce : 35000;

      // Check 5x5 area around unit
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const cx = gx + dx;
          const cy = gy + dy;
          if (this.tileAt(cx, cy) !== 0 || (this.hasStructureAt(cx, cy) && this.getStructureIdAt(cx, cy) !== ignoreSid) || this.hasCoreAt(cx, cy)) {
            // Build 370: Closest point on the square tile boundary logic
            const tileMinX = cx * TILE_SIZE;
            const tileMaxX = (cx + 1) * TILE_SIZE;
            const tileMinY = cy * TILE_SIZE;
            const tileMaxY = (cy + 1) * TILE_SIZE;

            // Find closest point on this tile to unit center s.x, s.y
            const closestX = Math.max(tileMinX, Math.min(s.x, tileMaxX));
            const closestY = Math.max(tileMinY, Math.min(s.y, tileMaxY));

            let wdx = s.x - closestX;
            let wdy = s.y - closestY;
            let wdist = Math.hypot(wdx, wdy);
            
            // Build 372: Anti-Stuck Un-Sticker
            // If we are deep inside or on the exact edge, push from the tile center
            if (wdist < 1.0) {
                const tileCX = (cx + 0.5) * TILE_SIZE;
                const tileCY = (cy + 0.5) * TILE_SIZE;
                wdx = s.x - tileCX;
                wdy = s.y - tileCY;
                wdist = Math.hypot(wdx, wdy) || 0.1;
            }

            if (wdist < wallR) {
              const pushStrength = (1.0 - wdist / wallR) * baseWForce;
              // Smooth normalized push direction
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

    // Build 380: Skip repulsion and complex collision during the spawn grace period
    // to allow units to move to their assigned grid slots orderly.
    // Build 381: True On-Rails Move. Lock 1:1 to server position during grace to kill all 'explosions'.
    if (producedExitGraceActive) {
      s.x = Number(u.x);
      s.y = Number(u.y);
      s.vx = 0;
      s.vy = 0;
      return;
    }

    // Build 375: Phantom Rocks (Soft Collision)
    // Terrain (Tiles) no longer perform a hard-block on movement. This prevents permanent jams.
    // Steering forces still handle avoidance, and Pathfinding still routes around tiles.
    const isFullFree = this.canOccupyLocalUnit(nx, ny, r, uid, ignoreSid as any);

    if (isJammedGhost || isFullFree) {
      s.x = nx;
      s.y = ny;
    } else {
      // Sloped slide fallback (Mainly for Structures/Buildings now)
      if (isJammedGhost || this.canOccupyLocalUnit(nx, s.y, r, uid, ignoreSid as any)) {
        s.x = nx;
      } else if (isJammedGhost || this.canOccupyLocalUnit(s.x, ny, r, uid, ignoreSid as any)) {
        s.y = ny;
      }
      s.vx *= 0.8;
      s.vy *= 0.8;
    }
    // Build 350: Sync with Server & Jam Detection
    // Build 364: Soft Sync (Independent Simulation)
    const errX = Number(u.x) - s.x;
    const errY = Number(u.y) - s.y;
    const err = Math.hypot(errX, errY);
    const p = this.physicsTuner;

    const threshold = p ? p.syncThreshold : TILE_SIZE * 2.5;
    const snap = p ? p.snapAmount : 0.02;

    if (err > threshold) {
      // Hard snap only if way off
      s.x = Number(u.x);
      s.y = Number(u.y);
      s.vx = 0; s.vy = 0;
    } else {
      // Soft drift towards server
      s.x += errX * snap;
      s.y += errY * snap;
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
        if (ticks > 30) { // Build 374: Reduced threshold to 0.5 seconds for faster detours
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

  stringHash(s: string) {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = ((hash << 5) - hash) + s.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
  }
}

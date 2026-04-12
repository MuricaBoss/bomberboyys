import Phaser from "phaser";
import { Room } from "colyseus.js";
import { DISPLAY_BUILD_NUMBER } from "./build-meta";
import { client, CLIENT_BUNDLE_VERSION, activeClientBuildId } from "./network";
import {
  TILE_SIZE, RTS_GROUND_TILE_SCALE, RTS_BLOCK_TEXTURE_KEYS, RTS_INTERIOR_WALL_VISUAL_SCALE,
  RTS_BUILDING_TEXTURE_KEYS, RTS_UI_TEXTURE_KEYS, RTS_TANK_TEXTURE_KEYS, RTS_TANK_TEXTURE_BY_DIR,
  RTS_SOLDIER_SPRITESHEET_KEYS, RTS_SOLDIER_FRAME_SIZE, RTS_SOLDIER_FRAME_COLS,
  RTS_SOLDIER_ROW_BY_DIR, RTS_SOLDIER_IDLE_FRAMES,
  RTS_SOLDIER_PROJECTILE_RANGE, RTS_TANK_PROJECTILE_RANGE,
  RTS_SOLDIER_PROJECTILE_INTERVAL_MS, RTS_SOLDIER_PROJECTILE_SPEED, RTS_SOLDIER_PROJECTILE_RADIUS,
  RTS_TANK_PROJECTILE_SPEED, RTS_TANK_PROJECTILE_RADIUS, RTS_TANK_PROJECTILE_INTERVAL_MS,
  RTS_MOVE_CLICK_MARKER_LIFETIME_MS, RTS_TANK_DISPLAY_SIZE, RTS_TANK_ORIGIN_Y,
  RTS_SOLDIER_DISPLAY_SIZE, RTS_SOLDIER_ORIGIN_Y, RTS_PLAYER_SOLDIER_DISPLAY_SIZE,
  RTS_PLAYER_CONSTRUCTOR_DISPLAY_SIZE, RTS_PLAYER_CONSTRUCTOR_ORIGIN_Y,
  RTS_TANK_SELECTION_BOX_SIZE_SCALE, RTS_TANK_SELECTION_CENTER_Y, RTS_TANK_SELECTION_SIDE_Y_OFFSET,
  RTS_TANK_HP_BOTTOM_OFFSET, RTS_TANK_TRAIL_SEGMENT_LENGTH, RTS_TANK_TRAIL_SEGMENT_WIDTH,
  RTS_TANK_TRAIL_GAP, RTS_TANK_TRAIL_BACK_OFFSET, RTS_TANK_TRAIL_SPAWN_DISTANCE,
  RTS_TANK_TRAIL_LIFETIME_MS, RTS_TANK_TRAIL_ALPHA, RTS_IMAGE_SHADOW_ALPHA, RTS_TILE_SHADOW_ALPHA,
  WORLD_DEPTH_BASE, WORLD_DEPTH_PER_PIXEL, WORLD_DEPTH_TILE_OFFSET, WORLD_DEPTH_TRAIL_OFFSET,
  WORLD_DEPTH_RESOURCE_OFFSET, WORLD_DEPTH_STRUCTURE_OFFSET, WORLD_DEPTH_PLAYER_OFFSET,
  WORLD_DEPTH_UNIT_OFFSET, WORLD_DEPTH_PROJECTILE_OFFSET, WORLD_DEPTH_SHADOW_GAP,
  WORLD_DEPTH_SELECTION_OFFSET, WORLD_DEPTH_LABEL_OFFSET, WORLD_DEPTH_HP_OFFSET,
  PRODUCED_UNIT_EXIT_GRACE_MS, FOG_CELL_SIZE, FOG_UPDATE_MS, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM,
} from "./constants";
import { BaseDefenseScene_Map } from "./BaseDefenseMap";

export class BaseDefenseScene_Server extends BaseDefenseScene_Map {
  recentAssignedSlots = new Map<string, { x: number; y: number; r: number; at: number }>();
  groupFinalTarget: { x: number; y: number } | null = null;
  groupSegmentTarget: { x: number; y: number } | null = null;
  lastSegmentUpdateAt = 0;
  // Build 239: Explicitly ensure the server simulation ignores all fog logic
  fogEnabled = false;

  createLocalBaseDefenseRoom() {
    const state: any = {
      mode: "base_defense",
      mapWidth: 140,
      mapHeight: 140,
      phase: "build",
      phaseEndsAt: Date.now() + 60 * 60 * 1000,
      roundActive: true,
      winnerTeam: "",
      map: [] as number[],
      players: new Map<string, any>(),
      cores: new Map<string, any>(),
      resources: new Map<string, any>(),
      structures: new Map<string, any>(),
      units: new Map<string, any>(),
    };
    this.generateLocalBaseMap(state);
    this.spawnLocalBaseResources(state);
    const spawn = this.findLocalBaseSpawn(state, "A");
    state.players.set(this.currentPlayerId, {
      id: this.currentPlayerId,
      name: "Local",
      x: spawn.x,
      y: spawn.y,
      isAlive: true,
      speed: 140,
      kills: 0,
      deaths: 0,
      score: 0,
      invulnerableUntil: 0,
      team: "A",
      resources: 1000,
      buildKits: 0,
      coreHp: 260,
      coreHpMax: 260,
      isCoreAnchored: false,
      coreX: spawn.x,
      coreY: spawn.y,
      powerProduced: 0,
      powerUsed: 0,
      buildCooldownUntil: 0,
      unitCooldownUntil: 0,
      devMode: true,
    });
    return {
      sessionId: this.currentPlayerId,
      state,
      send: (type: string, data?: any) => this.handleLocalBaseRoomMessage(state, type, data),
    } as any;
  }

  spawnLocalProducedUnit(state: any, me: any, type: "soldier" | "tank" | "harvester") {
    const now = Date.now();
    const producerType = type === "soldier" ? "barracks" : "war_factory";
    const producer = this.findOwnedReadyStructure(state, producerType, now);
    const radius = this.localUnitBodyRadius({ type });
    const exitPoint = producer
      ? this.findLocalProducedUnitExitPoint(state, producer, String(me.team || "A"), radius)
      : this.findLocalUnitSpawnPoint(state, Number(me.coreX ?? me.x), Number(me.coreY ?? me.y), radius);
    if (!exitPoint) return false;
    const startPoint = producer ? this.getProducedUnitStartPoint(producer, exitPoint) : exitPoint;

    if (producer) producer.produceCooldownUntil = now + (type === "soldier" ? 800 : 1100);

    const stats = type === "tank"
      ? { hp: 140, speed: 64.4 }
      : type === "harvester"
        ? { hp: 110, speed: 76 }
        : { hp: 70, speed: 50 };

    const id = this.nextLocalId("unit");
    state.units.set(id, {
      id,
      ownerId: this.currentPlayerId,
      team: me.team,
      type,
      x: startPoint.x,
      y: startPoint.y,
      targetX: exitPoint.x,
      targetY: exitPoint.y,
      hp: stats.hp,
      maxHp: stats.hp,
      speed: stats.speed,
      dir: 0,
      homeStructureId: String(producer?.id || ""),
      manualUntil: producer ? now + PRODUCED_UNIT_EXIT_GRACE_MS : 0,
      aiState: producer ? "walking" : "idle",
    });
    if (producer) {
      this.localUnitTargetOverride.set(id, { x: exitPoint.x, y: exitPoint.y, setAt: now });
      this.localUnitMovePriority.set(id, 0);
      this.localUnitGhostMode.add(id);
      this.localUnitRenderState.set(id, {
        x: startPoint.x,
        y: startPoint.y,
        vx: 0,
        vy: 0,
        lastAt: performance.now(),
      });
    }
    return true;
  }

  handleLocalBaseRoomMessage(state: any, type: string, data?: any) {
    const me = state.players.get(this.currentPlayerId);
    if (!me) return;
    if (type === "move") {
      const nextX = typeof data?.x === "number" ? data.x : me.x;
      const nextY = typeof data?.y === "number" ? data.y : me.y;
      if (this.canOccupy(nextX, nextY, TILE_SIZE * 0.3)) {
        me.x = nextX;
        me.y = nextY;
      } else {
        if (this.canOccupy(nextX, me.y, TILE_SIZE * 0.3)) me.x = nextX;
        if (this.canOccupy(me.x, nextY, TILE_SIZE * 0.3)) me.y = nextY;
      }
      return;
    }
    if (type === "anchor_base") {
      if (me.isCoreAnchored) return;
      me.isCoreAnchored = true;
      me.coreX = me.x;
      me.coreY = me.y;
      state.cores.set(`core_${this.currentPlayerId}`, {
        id: `core_${this.currentPlayerId}`,
        team: me.team,
        x: me.x,
        y: me.y,
        hp: 300,
        maxHp: 300,
      });
      return;
    }
    if (type === "build_structure") {
      const buildType = String(data?.type || "");
      const gridX = Number(data?.gridX);
      const gridY = Number(data?.gridY);
      if (!Number.isFinite(gridX) || !Number.isFinite(gridY)) return;
      const validType = buildType === "ore_refinery" || buildType === "solar_panel" || buildType === "barracks" || buildType === "war_factory";
      if (!validType) return;
      if (!this.canPlaceBuildAt(buildType, gridX, gridY)) return;
      const costs: Record<string, number> = {
        ore_refinery: 55,
        solar_panel: 40,
        barracks: 80,
        war_factory: 130,
      };
      const buildMs: Record<string, number> = {
        ore_refinery: 5000,
        solar_panel: 3500,
        barracks: 6500,
        war_factory: 7000,
      };
      const cost = costs[buildType] ?? 0;
      if (!me.devMode) me.resources = Math.max(0, Number(me.resources || 0) - cost);
      me.buildCooldownUntil = Date.now() + 250;
      state.structures.set(`struct_${Date.now()}_${gridX}_${gridY}`, {
        id: `struct_${Date.now()}_${gridX}_${gridY}`,
        ownerId: this.currentPlayerId,
        team: me.team,
        type: buildType,
        x: gridX * TILE_SIZE + TILE_SIZE / 2,
        y: gridY * TILE_SIZE + TILE_SIZE / 2,
        hp: 120,
        maxHp: 120,
        buildStartedAt: Date.now(),
        buildCompleteAt: Date.now() + buildMs[buildType],
        harvesterSpawned: false,
        produceCooldownUntil: 0,
      });
      return;
    }
    if (type === "toggle_dev_mode") me.devMode = !me.devMode;
    if (type === "produce_unit") {
      if (this.getUnitProduceBlockedReason()) return;
      if (!this.spawnLocalProducedUnit(state, me, "soldier")) return;
      if (!me.devMode) me.resources = Math.max(0, Number(me.resources || 0) - 35);
      return;
    }
    if (type === "produce_tank") {
      if (this.getFactoryProduceBlockedReason("tank")) return;
      if (!this.spawnLocalProducedUnit(state, me, "tank")) return;
      if (!me.devMode) me.resources = Math.max(0, Number(me.resources || 0) - 90);
      return;
    }
    if (type === "produce_harvester") {
      if (this.getFactoryProduceBlockedReason("harvester")) return;
      if (!this.spawnLocalProducedUnit(state, me, "harvester")) return;
      if (!me.devMode) me.resources = Math.max(0, Number(me.resources || 0) - 70);
      return;
    }
    if (type === "command_units") {
      const unitIds = Array.isArray(data?.unitIds) ? data.unitIds.map((id: any) => String(id)) : [];
      const targetX = Number(data?.targetX);
      const targetY = Number(data?.targetY);
      if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return;
      for (const unitId of unitIds) {
        const unit = state.units.get(unitId);
        if (!unit) continue;
        if (String(unit.ownerId || "") !== this.currentPlayerId) continue;
        unit.targetX = targetX;
        unit.targetY = targetY;
      }
      return;
    }
    if (type === "unit_client_pose_batch") {
      const poses = Array.isArray(data?.poses) ? data.poses : [];
      for (const pose of poses) {
        const unitId = String(pose?.unitId || pose?.id || "");
        const unit = state.units.get(unitId);
        if (!unit) continue;
        if (String(unit.ownerId || "") !== this.currentPlayerId) continue;
        const x = Number(pose?.x);
        const y = Number(pose?.y);
        if (Number.isFinite(x)) unit.x = x;
        if (Number.isFinite(y)) unit.y = y;
        if (Number.isFinite(Number(pose?.tx))) unit.targetX = Number(pose.tx);
        if (Number.isFinite(Number(pose?.ty))) unit.targetY = Number(pose.ty);
        if (Number.isFinite(Number(pose?.dir))) unit.dir = Number(pose.dir);
      }
    }
  }

  applyLocalCoreMove(nextX: number, nextY: number) {
    const me = this.room?.state?.players?.get
      ? this.room.state.players.get(this.currentPlayerId)
      : this.room?.state?.players?.[this.currentPlayerId];
    const entity = this.playerEntities[this.currentPlayerId];
    if (!me || !entity) return;

    const radius = TILE_SIZE * 0.3;
    let moved = false;
    if (this.canOccupy(nextX, nextY, radius)) {
      entity.x = nextX;
      entity.y = nextY;
      moved = true;
    } else {
      if (this.canOccupy(nextX, entity.y, radius)) {
        entity.x = nextX;
        moved = true;
      }
      if (this.canOccupy(entity.x, nextY, radius)) {
        entity.y = nextY;
        moved = true;
      }
    }

    if (moved || this.localOnly) {
      me.x = entity.x;
      me.y = entity.y;
    }
  }

  sendClientAvoidIntents(now: number) {
    if (!this.room?.state?.units?.forEach) return;
    if (this.selectedUnitIds.size <= 0) return;
    const sendInterval = this.selectedUnitIds.size >= 160 ? 220 : this.selectedUnitIds.size >= 80 ? 160 : 120;
    if (now - this.lastAvoidIntentSentAt < sendInterval) return;
    const me = this.room.state.players.get ? this.room.state.players.get(this.currentPlayerId) : this.room.state.players?.[this.currentPlayerId];
    const myTeam = me?.team;
    if (!myTeam) return;

    const friendly: Array<{ id: string; x: number; y: number }> = [];
    this.room.state.units.forEach((u: any, id: string) => {
      if (u.team !== myTeam || (u.hp ?? 0) <= 0) return;
      friendly.push({ id, x: Number(u.x), y: Number(u.y) });
    });
    if (friendly.length <= 1) return;

    const intents: Array<{ unitId: string; tx: number; ty: number }> = [];
    const maxUnits = this.selectedUnitIds.size >= 160 ? 100 : 120;
    const selected = Array.from(this.selectedUnitIds).slice(0, maxUnits);
    for (const unitId of selected) {
      const u = this.room.state.units.get ? this.room.state.units.get(unitId) : this.room.state.units?.[unitId];
      if (!u || u.team !== myTeam || (u.hp ?? 0) <= 0) continue;
      const ux = Number(u.x);
      const uy = Number(u.y);
      const tx = Number(u.targetX ?? ux);
      const ty = Number(u.targetY ?? uy);
      const moving = Math.hypot(tx - ux, ty - uy) > TILE_SIZE * 0.3;
      if (!moving) continue;
      const wp = this.getClientUnitWaypoint(unitId, u, now);
      const wtx = Number(wp?.x ?? tx);
      const wty = Number(wp?.y ?? ty);
      const navX = wtx - ux;
      const navY = wty - uy;
      const navMag = Math.hypot(navX, navY);
      if (navMag < 0.001) continue;
      const navNX = navX / navMag;
      const navNY = navY / navMag;
      let pushX = 0;
      let pushY = 0;
      for (const o of friendly) {
        if (o.id === unitId) continue;
        const dx = ux - o.x;
        const dy = uy - o.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.001 || d > TILE_SIZE * 1.35) continue;
        const w = 1 - (d / (TILE_SIZE * 1.35));
        pushX += (dx / d) * w;
        pushY += (dy / d) * w;
      }
      const pushMag = Math.hypot(pushX, pushY);
      const pushNX = pushMag > 0.001 ? (pushX / pushMag) : 0;
      const pushNY = pushMag > 0.001 ? (pushY / pushMag) : 0;
      const mixX = navNX * 0.82 + pushNX * 0.42;
      const mixY = navNY * 0.82 + pushNY * 0.42;
      const mixMag = Math.hypot(mixX, mixY);
      if (mixMag < 0.001) continue;
      const txOut = ux + (mixX / mixMag) * TILE_SIZE * 0.92;
      const tyOut = uy + (mixY / mixMag) * TILE_SIZE * 0.92;
      intents.push({ unitId, tx: txOut, ty: tyOut });
    }

    if (intents.length > 0) {
      this.room.send("unit_avoid_intent", { intents });
      this.lastAvoidIntentSentAt = now;
    }
  }

  sendClientUnitPoses(now: number) {
    if (!this.room?.state?.units?.forEach) return;
    const minInterval = 50;
    if (now - this.lastUnitPoseSentAt < minInterval) return;
    const poses: Array<{ unitId: string; x: number; y: number; dir: number; tx: number; ty: number }> = [];
    let hasMoving = false;
    this.room.state.units.forEach((u: any, id: string) => {
      if ((u.hp ?? 0) <= 0) return;
      if (String(u.ownerId || "") !== this.currentPlayerId) return;
      if (!this.isClientAuthoritativeUnitType(String(u.type || ""))) return;
      const s = this.localUnitRenderState.get(id);
      if (!s) return;
      const manualTarget = this.getLocalUnitManualTarget(id);
      const tx = Number(manualTarget?.finalX ?? u.targetX ?? u.x);
      const ty = Number(manualTarget?.finalY ?? u.targetY ?? u.y);
      const vx = Number(s.vx || 0);
      const vy = Number(s.vy || 0);
      const speedNow = Math.hypot(vx, vy);
      const movingNow = speedNow > 10 || Math.hypot(tx - s.x, ty - s.y) > TILE_SIZE * 0.2;
      if (movingNow) hasMoving = true;
      const committedDir = (this as any).unitFacing?.get(id);
      const dir = (committedDir !== undefined) ? committedDir : (Math.hypot(vx, vy) > 0.1
        ? this.angleToDir8(Math.atan2(vy, vx))
        : (u.dir ?? 0));
      const prev = this.lastUnitPoseState.get(id);
      const changed = !prev
        || Math.hypot(prev.x - s.x, prev.y - s.y) > 1.35
        || prev.dir !== dir
        || Math.hypot(prev.tx - tx, prev.ty - ty) > 1.35;
      if (!movingNow && !changed) return;
      poses.push({ unitId: id, x: s.x, y: s.y, dir, tx, ty });
      this.lastUnitPoseState.set(id, { x: s.x, y: s.y, dir, tx, ty });
    });
    if (poses.length > 0 || hasMoving) {
      if (poses.length === 0) return;
      this.room.send("unit_client_pose_batch", { poses });
      this.lastUnitPoseSentAt = now;
    }
  }

  issueLocalUnitMoveCommand(targetX: number, targetY: number, isAutoSegment = false) {
    if (!this.room?.state || this.selectedUnitIds.size <= 0) return;
    
    // Calculate group center to determine the 7m (220px) segment
    const ids = Array.from(this.selectedUnitIds);
    this.lastCommandedUnitIds = new Set(ids);
    const unitPositions = ids.map(id => {
      const s = this.localUnitRenderState.get(id);
      const u = this.room?.state?.units?.get ? this.room.state.units.get(id) : this.room?.state?.units?.[id];
      return { id, x: Number(s?.x ?? u?.x ?? 0), y: Number(s?.y ?? u?.y ?? 0) };
    });
    const groupCX = unitPositions.reduce((s, u) => s + u.x, 0) / Math.max(1, unitPositions.length);
    const groupCY = unitPositions.reduce((s, u) => s + u.y, 0) / Math.max(1, unitPositions.length);
    const angle = Math.atan2(targetY - groupCY, targetX - groupCX);
    this.lastCommandGroupAngle = angle;

    const spacing = this.localFormationSpacingForIds(ids);
    const n = ids.length;
    
    // Build 248: Calculate total formation clearance needed for the 5-lane setup
    // 5 columns spread laterally. Radius = half width.
    this.lastCommandGroupRadius = (3.0 * spacing);

    const slots: Array<{ x: number; y: number; r: number }> = [];
    const reserved: Array<{ x: number; y: number; radius: number }> = [];
    const selectedSet = new Set(ids);
    let gridIndex = 0;
    
    // Build 243: Always use the true targetX/Y. No more segmenting.
    targetX = targetX;
    targetY = targetY;

    for (let i = 0; i < n; i++) {
      const id = ids[i];
      const u = this.room.state.units.get ? this.room.state.units.get(id) : this.room.state.units?.[id];
      const unitRadius = this.localUnitBodyRadius(u);
      const wallRadius = unitRadius + TILE_SIZE * 0.45;

      let slot: {x: number, y: number} | null = null;
      
      // Build 240: Always perform full formation slot search to avoid clumping
      while (gridIndex < 1000) {
        const base = this.localFormationSlot(targetX, targetY, gridIndex, n, spacing, angle);
        gridIndex++;
        
        if (this.canOccupy(base.x, base.y, wallRadius)) {
          let blocked = false;
          
          // Check other units
          if (this.room?.state?.units) {
            for (const [otherId, otherU] of this.room.state.units.entries()) {
              if (selectedSet.has(otherId) || (otherU.hp ?? 0) <= 0) continue;
              const otherS = this.localUnitRenderState.get(otherId);
              const ox = Number(otherS?.x ?? otherU.x);
              const oy = Number(otherS?.y ?? otherU.y);
              const oRad = this.localUnitBodyRadius(otherU);
              if (Math.hypot(base.x - ox, base.y - oy) < unitRadius + oRad + 2) {
                blocked = true;
                break;
              }
            }
          }
          if (blocked) continue;

          const now = Date.now();
          for (const [rid, rslot] of this.recentAssignedSlots.entries()) {
            if (now - rslot.at > 15000) {
              this.recentAssignedSlots.delete(rid);
              continue;
            }
            if (Math.hypot(base.x - rslot.x, base.y - rslot.y) < unitRadius + rslot.r + 2) {
              blocked = true;
              break;
            }
          }
          if (blocked) continue;

          for (const prevSlot of slots) {
            if (Math.hypot(base.x - prevSlot.x, base.y - prevSlot.y) < unitRadius + prevSlot.r) {
              blocked = true;
              break;
            }
          }
          if (blocked) continue;

          slot = base;
          break;
        }
      }
      
      if (!slot) slot = { x: targetX, y: targetY };

      reserved.push({ x: slot.x, y: slot.y, radius: unitRadius });
      slots.push({ x: slot.x, y: slot.y, r: Math.max(spacing * 0.35, unitRadius + 2) });
    }

    // Build 230: unitPositions, groupCX, groupCY are already computed at the start of the function

    // Build 246: Absolute Greedy Proximity Matching
    // Find the closest (unit, slot) pair across all available combinations to prevent crossing.
    const usedUnits = new Set<string>();
    const usedSlots = new Set<number>();
    const assignments = new Map<string, { x: number; y: number }>();
    const priorityOrder: Array<{ id: string; slot: { x: number; y: number } }> = [];

    const numUnits = unitPositions.length;
    const numSlots = slots.length;

    for (let iteration = 0; iteration < numUnits; iteration++) {
      let bestUnitIdx = -1;
      let bestSlotIdx = -1;
      let minD = Infinity;

      for (let ui = 0; ui < numUnits; ui++) {
        if (usedUnits.has(unitPositions[ui].id)) continue;
        for (let si = 0; si < numSlots; si++) {
          if (usedSlots.has(si)) continue;
          const d = Math.hypot(unitPositions[ui].x - slots[si].x, unitPositions[ui].y - slots[si].y);
          if (d < minD) {
            minD = d;
            bestUnitIdx = ui;
            bestSlotIdx = si;
          }
        }
      }

      if (bestUnitIdx !== -1 && bestSlotIdx !== -1) {
        const id = unitPositions[bestUnitIdx].id;
        const slot = slots[bestSlotIdx];
        usedUnits.add(id);
        usedSlots.add(bestSlotIdx);
        assignments.set(id, { x: slot.x, y: slot.y });
        priorityOrder.push({ id, slot: { x: slot.x, y: slot.y } });
        this.recentAssignedSlots.set(id, { x: slot.x, y: slot.y, r: slot.r, at: Date.now() });
      } else {
        break; // No more pairings possible
      }
    }

    // Store for preview drawing — duration scales with max unit distance
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

    const orderedAssignments = Array.from(assignments.entries())
      .map(([id, slot]) => ({ id, slot }))
      .sort((a, b) => {
        const adx = a.slot.x - targetX;
        const ady = a.slot.y - targetY;
        const bdx = b.slot.x - targetX;
        const bdy = b.slot.y - targetY;
        const aDepth = -(adx * Math.cos(angle) + ady * Math.sin(angle));
        const bDepth = -(bdx * Math.cos(angle) + bdy * Math.sin(angle));
        if (Math.abs(aDepth - bDepth) > spacing * 0.25) return aDepth - bDepth;
        const aLateral = adx * (-Math.sin(angle)) + ady * Math.cos(angle);
        const bLateral = bdx * (-Math.sin(angle)) + bdy * Math.cos(angle);
        return aLateral - bLateral;
      });

    const subgroupSize = ids.length >= 240 ? 8 : ids.length >= 120 ? 7 : ids.length >= 48 ? 6 : 5;
    this.lastMoveSubgroupSize = subgroupSize;
    const subgroupCommands: Array<{
      leaderId: string;
      leaderSlot: { x: number; y: number };
      memberIds: string[];
      pathRadius: number;
    }> = [];
    const subgroupFollowerState = new Map<string, {
      leaderId: string;
      offsetX: number;
      offsetY: number;
      slotX: number;
      slotY: number;
      leaderGoalX: number;
      leaderGoalY: number;
      setAt: number;
      isAuto?: boolean;
    }>();
    const now = Date.now();

    for (let start = 0; start < orderedAssignments.length; start += subgroupSize) {
      const subgroup = orderedAssignments.slice(start, start + subgroupSize);
      if (subgroup.length === 0) continue;

      const centerX = subgroup.reduce((sum, entry) => sum + entry.slot.x, 0) / subgroup.length;
      const centerY = subgroup.reduce((sum, entry) => sum + entry.slot.y, 0) / subgroup.length;

      let leader = subgroup[0];
      let bestLeaderDist = Number.POSITIVE_INFINITY;
      for (const entry of subgroup) {
        const d = Math.hypot(entry.slot.x - centerX, entry.slot.y - centerY);
        if (d < bestLeaderDist) {
          bestLeaderDist = d;
          leader = entry;
        }
      }

      const memberIds = subgroup.map((entry) => entry.id);
      let subgroupRadius = 0;
      for (const entry of subgroup) {
        subgroupRadius = Math.max(subgroupRadius, Math.hypot(entry.slot.x - leader.slot.x, entry.slot.y - leader.slot.y));
        if (entry.id === leader.id) continue;
        subgroupFollowerState.set(entry.id, {
          leaderId: leader.id,
          offsetX: entry.slot.x - leader.slot.x,
          offsetY: entry.slot.y - leader.slot.y,
          slotX: entry.slot.x,
          slotY: entry.slot.y,
          leaderGoalX: leader.slot.x,
          leaderGoalY: leader.slot.y,
          setAt: now,
          isAuto: isAutoSegment,
        });
      }

      const leaderUnit = this.room.state.units.get ? this.room.state.units.get(leader.id) : this.room.state.units?.[leader.id];
      const leaderRadius = this.localUnitBodyRadius(leaderUnit);
      subgroupCommands.push({
        leaderId: leader.id,
        leaderSlot: { x: leader.slot.x, y: leader.slot.y },
        memberIds,
        pathRadius: Math.max(leaderRadius, subgroupRadius + leaderRadius + 4),
      });
    }

    subgroupCommands.sort((a, b) => {
      const aPos = unitPositions.find((entry) => entry.id === a.leaderId);
      const bPos = unitPositions.find((entry) => entry.id === b.leaderId);
      const aDist = aPos ? Math.hypot(aPos.x - a.leaderSlot.x, aPos.y - a.leaderSlot.y) : 0;
      const bDist = bPos ? Math.hypot(bPos.x - b.leaderSlot.x, bPos.y - b.leaderSlot.y) : 0;
      return bDist - aDist;
    });
    this.lastMoveLeaderCount = subgroupCommands.length;
    this.lastMoveFollowerCount = Math.max(0, ids.length - subgroupCommands.length);

    // Only clear movement state for the units being commanded — leave unrelated units intact.
    for (const id of ids) {
      this.localUnitTargetOverride.delete(id);
      this.localUnitFollowState.delete(id);
      this.localUnitMovePriority.delete(id);
      this.localUnitPathRadiusOverride.delete(id);
      // Clear auto-engage state so manual move takes priority
      this.autoEngagedUnitIds.delete(id);
      this.unitAttackTarget.delete(id);
      // Build 231: Clear path cache immediately to prevent backtracking to old waypoints
      this.unitClientPathCache.delete(id);
    }

    // Only subgroup leaders receive the long-distance path; the rest follow locally.
    let prio = 0;
    for (const subgroup of subgroupCommands) {
      this.localUnitTargetOverride.set(subgroup.leaderId, {
        x: subgroup.leaderSlot.x,
        y: subgroup.leaderSlot.y,
        setAt: now,
        isAuto: isAutoSegment,
      });
      this.localUnitMovePriority.set(subgroup.leaderId, prio);
      this.localUnitPathRadiusOverride.set(subgroup.leaderId, subgroup.pathRadius);

      for (const memberId of subgroup.memberIds) {
        if (memberId === subgroup.leaderId) continue;
        const follow = subgroupFollowerState.get(memberId);
        if (!follow) continue;
        this.localUnitFollowState.set(memberId, follow);
        this.localUnitMovePriority.set(memberId, prio);
      }

      for (const memberId of subgroup.memberIds) {
        const follow = subgroupFollowerState.get(memberId);
        const target = follow
          ? { x: follow.slotX, y: follow.slotY }
          : subgroup.leaderSlot;
        this.room.send("command_units", {
          unitIds: [memberId],
          targetX: target.x,
          targetY: target.y,
        });
      }
      prio++;
    }
  }

  showMoveClickMarker(worldX: number, worldY: number) {
    const now = Date.now();
    this.moveClickMarker = {
      x: worldX,
      y: worldY,
      createdAt: now,
      expiresAt: now + RTS_MOVE_CLICK_MARKER_LIFETIME_MS,
    };
  }

  drawMoveClickMarker(now: number) {
    const marker = this.moveClickMarker;
    if (!marker || now >= marker.expiresAt) {
      this.moveClickMarker = null;
      this.moveClickMarkerSprite?.setVisible(false);
      return;
    }
    if (!this.moveClickMarkerSprite) {
      this.moveClickMarkerSprite = this.add.image(marker.x, marker.y, RTS_UI_TEXTURE_KEYS.move_target_marker)
        .setDepth(96);
    }
    const sprite = this.moveClickMarkerSprite;
    sprite.setVisible(true);
    const life = 1 - ((now - marker.createdAt) / Math.max(1, marker.expiresAt - marker.createdAt));
    const pulse = 1 + (1 - life) * 0.35;
    const alpha = Math.max(0, Math.min(1, life));
    sprite.setPosition(marker.x, marker.y);
    sprite.setScale(0.72 * pulse);
    sprite.setAlpha(0.95 * alpha);
    sprite.setRotation((1 - life) * 0.1);
  }

}

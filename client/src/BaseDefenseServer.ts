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
      const tx = Number(u.targetX ?? u.x);
      const ty = Number(u.targetY ?? u.y);
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

  issueLocalUnitMoveCommand(targetX: number, targetY: number) {
    if (!this.room?.state || this.selectedUnitIds.size <= 0) return;
    this.showMoveClickMarker(targetX, targetY);
    const ids = Array.from(this.selectedUnitIds);
    const spacing = this.localFormationSpacingForIds(ids);
    const n = ids.length;

    const slots: Array<{ x: number; y: number; r: number }> = [];
    const reserved: Array<{ x: number; y: number; radius: number }> = [];
    const selectedSet = new Set(ids);
    let gridIndex = 0;
    
    for (let i = 0; i < n; i++) {
      const id = ids[i];
      const u = this.room.state.units.get ? this.room.state.units.get(id) : this.room.state.units?.[id];
      const unitRadius = this.localUnitBodyRadius(u);
      const wallRadius = unitRadius + TILE_SIZE * 0.45;

      let slot: {x: number, y: number} | null = null;
      while (gridIndex < 200) {
        const base = this.localFormationSlot(targetX, targetY, gridIndex, n, spacing);
        gridIndex++;
        // "jos tile osuu seinään se poistetaan ja tehdään uuteen paikkaan"
        if (this.canOccupy(base.x, base.y, wallRadius)) {
          let occupied = false;
          if (this.room?.state?.units) {
            for (const [otherId, otherU] of this.room.state.units.entries()) {
              if (selectedSet.has(otherId) || (otherU.hp ?? 0) <= 0) continue;
              const otherS = this.localUnitRenderState.get(otherId);
              const ox = Number(otherS?.x ?? otherU.x);
              const oy = Number(otherS?.y ?? otherU.y);
              const oRad = this.localUnitBodyRadius(otherU);
              // Avoid all existing units (we will let Ghost Mode handle collision ignoring if near)
              if (Math.hypot(base.x - ox, base.y - oy) < unitRadius + oRad + 2) {
                occupied = true;
                break;
              }
            }
          }
          if (!occupied) {
            for (const prevSlot of slots) {
              if (Math.hypot(base.x - prevSlot.x, base.y - prevSlot.y) < unitRadius + prevSlot.r) {
                occupied = true;
                break;
              }
            }
          }
          if (!occupied) {
            const now = Date.now();
            for (const [rid, rslot] of this.recentAssignedSlots.entries()) {
              if (now - rslot.at > 15000) {
                this.recentAssignedSlots.delete(rid);
                continue;
              }
              if (Math.hypot(base.x - rslot.x, base.y - rslot.y) < unitRadius + rslot.r + 2) {
                occupied = true;
                break;
              }
            }
          }
          if (!occupied) {
            slot = base;
            break;
          }
        }
      }
      if (!slot) slot = { x: targetX, y: targetY };

      reserved.push({ x: slot.x, y: slot.y, radius: unitRadius });
      slots.push({ x: slot.x, y: slot.y, r: Math.max(spacing * 0.35, unitRadius + 2) });
    }

    // Compute the group's current center
    const unitPositions = ids.map(id => {
      const s = this.localUnitRenderState.get(id);
      const u = this.room?.state?.units?.get ? this.room.state.units.get(id) : this.room?.state?.units?.[id];
      return { id, x: Number(s?.x ?? u?.x ?? 0), y: Number(s?.y ?? u?.y ?? 0) };
    });
    const groupCX = unitPositions.reduce((s, u) => s + u.x, 0) / Math.max(1, unitPositions.length);
    const groupCY = unitPositions.reduce((s, u) => s + u.y, 0) / Math.max(1, unitPositions.length);

    // Sort slots by distance from group center — FARTHEST first
    const slotIndices = slots.map((_, i) => i).sort((a, b) => {
      const da = Math.hypot(slots[a].x - groupCX, slots[a].y - groupCY);
      const db = Math.hypot(slots[b].x - groupCX, slots[b].y - groupCY);
      return db - da; // farthest slot first
    });

    // For each slot (farthest first), assign the nearest available unit
    const usedUnits = new Set<string>();
    const assignments = new Map<string, { x: number; y: number }>();
    const priorityOrder: Array<{ id: string; slot: { x: number; y: number } }> = [];
    for (const si of slotIndices) {
      let bestId = "";
      let bestDist = Number.POSITIVE_INFINITY;
      for (const up of unitPositions) {
        if (usedUnits.has(up.id)) continue;
        const d = Math.hypot(up.x - slots[si].x, up.y - slots[si].y);
        if (d < bestDist) { bestDist = d; bestId = up.id; }
      }
      if (bestId) {
        usedUnits.add(bestId);
        assignments.set(bestId, { x: slots[si].x, y: slots[si].y });
        priorityOrder.push({ id: bestId, slot: { x: slots[si].x, y: slots[si].y } });
        this.recentAssignedSlots.set(bestId, { x: slots[si].x, y: slots[si].y, r: slots[si].r, at: Date.now() });
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

    // Only clear overrides for the units being commanded — leave other units' overrides intact
    for (const id of ids) {
      this.localUnitTargetOverride.delete(id);
      this.localUnitMovePriority.delete(id);
      // Clear auto-engage state so manual move takes priority
      this.autoEngagedUnitIds.delete(id);
      this.unitAttackTarget.delete(id);
    }
    // Priority 0 = farthest slot = departs first
    let prio = 0;
    for (const entry of priorityOrder) {
      this.localUnitTargetOverride.set(entry.id, { x: entry.slot.x, y: entry.slot.y, setAt: Date.now() });
      this.localUnitMovePriority.set(entry.id, prio++);
    }
    // Send individual move commands per unit so the SERVER knows each unit's slot target.
    // This ensures units continue moving correctly even when the browser tab is backgrounded.
    for (const entry of priorityOrder) {
      const slot = assignments.get(entry.id);
      if (slot) {
        this.room.send("command_units", { unitIds: [entry.id], targetX: slot.x, targetY: slot.y });
      }
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

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
import { BaseDefenseScene_Data } from "./BaseDefenseData";

export class BaseDefenseScene_Map extends BaseDefenseScene_Data {
  isLocalSpawnPointFree(state: any, x: number, y: number, radius: number) {
    if (!this.canOccupyLocalUnit(x, y, radius)) return false;
    const gx = Math.floor(x / TILE_SIZE);
    const gy = Math.floor(y / TILE_SIZE);
    if (this.hasResourceAt(gx, gy)) return false;

    let blocked = false;
    state.players?.forEach?.((p: any) => {
      if (blocked || !p?.isAlive) return;
      if (Math.hypot(Number(p.x) - x, Number(p.y) - y) < radius + TILE_SIZE * 0.34) blocked = true;
    });
    state.units?.forEach?.((u: any) => {
      if (blocked || (u.hp ?? 0) <= 0) return;
      if (Math.hypot(Number(u.x) - x, Number(u.y) - y) < radius + this.localUnitBodyRadius(u) + 4) blocked = true;
    });
    return !blocked;
  }

  getProducedUnitExitCellOrder(structure: any, team: string) {
    const centerGX = Math.floor(Number(structure.x) / TILE_SIZE);
    const centerGY = Math.floor(Number(structure.y) / TILE_SIZE);
    const footprint = this.getStructureFootprint(String(structure.type || ""));
    const halfW = Math.floor(footprint.width / 2);
    const halfH = Math.floor(footprint.height / 2);
    const sideDir = team === "B" ? -1 : 1;
    const cells: Array<{ gx: number; gy: number }> = [];
    const seen = new Set<string>();
    const pushCell = (gx: number, gy: number) => {
      const key = `${gx},${gy}`;
      if (seen.has(key)) return;
      seen.add(key);
      cells.push({ gx, gy });
    };
    if (String(structure.type || "") === "war_factory") {
      pushCell(centerGX, centerGY + halfH + 2);
      pushCell(centerGX - 1, centerGY + halfH + 2);
      pushCell(centerGX + 1, centerGY + halfH + 2);
      pushCell(centerGX, centerGY + halfH + 3);
      pushCell(centerGX - 1, centerGY + halfH + 3);
      pushCell(centerGX + 1, centerGY + halfH + 3);
      pushCell(centerGX, centerGY + halfH + 4);
      pushCell(centerGX + sideDir * (halfW + 2), centerGY);
      pushCell(centerGX + sideDir * (halfW + 2), centerGY + 1);
      pushCell(centerGX + sideDir * (halfW + 2), centerGY - 1);
      pushCell(centerGX - sideDir * (halfW + 2), centerGY);
      pushCell(centerGX, centerGY - (halfH + 2));
      pushCell(centerGX, centerGY + halfH + 1);
      for (let extra = 5; extra <= 12; extra++) {
        pushCell(centerGX, centerGY + halfH + extra);
        pushCell(centerGX - 1, centerGY + halfH + extra);
        pushCell(centerGX + 1, centerGY + halfH + extra);
        if (extra >= 7) {
          pushCell(centerGX - 2, centerGY + halfH + extra);
          pushCell(centerGX + 2, centerGY + halfH + extra);
        }
      }
      for (let extra = 3; extra <= 7; extra++) {
        pushCell(centerGX + sideDir * (halfW + extra), centerGY);
        pushCell(centerGX + sideDir * (halfW + extra), centerGY + 1);
        pushCell(centerGX + sideDir * (halfW + extra), centerGY - 1);
      }
      return cells;
    }
    pushCell(centerGX, centerGY + halfH + 1);
    pushCell(centerGX - 1, centerGY + halfH + 1);
    pushCell(centerGX + 1, centerGY + halfH + 1);
    pushCell(centerGX + sideDir * (halfW + 1), centerGY);
    pushCell(centerGX + sideDir * (halfW + 1), centerGY + 1);
    pushCell(centerGX + sideDir * (halfW + 1), centerGY - 1);
    pushCell(centerGX - sideDir * (halfW + 1), centerGY);
    pushCell(centerGX, centerGY - (halfH + 1));
    pushCell(centerGX - 1, centerGY - (halfH + 1));
    pushCell(centerGX + 1, centerGY - (halfH + 1));
    pushCell(centerGX, centerGY + halfH + 2);
    pushCell(centerGX + sideDir * (halfW + 2), centerGY);
    pushCell(centerGX - sideDir * (halfW + 2), centerGY);
    for (let extra = 3; extra <= 12; extra++) {
      pushCell(centerGX, centerGY + halfH + extra);
      pushCell(centerGX - 1, centerGY + halfH + extra);
      pushCell(centerGX + 1, centerGY + halfH + extra);
      if (extra >= 5) {
        pushCell(centerGX - 2, centerGY + halfH + extra);
        pushCell(centerGX + 2, centerGY + halfH + extra);
      }
    }
    for (let extra = 2; extra <= 6; extra++) {
      pushCell(centerGX + sideDir * (halfW + extra), centerGY);
      pushCell(centerGX + sideDir * (halfW + extra), centerGY + 1);
      pushCell(centerGX + sideDir * (halfW + extra), centerGY - 1);
    }
    return cells;
  }

  isLocalProducedUnitExitPointClaimed(
    state: any,
    structureId: string,
    worldX: number,
    worldY: number,
    radius: number
  ) {
    let claimed = false;
    state.units?.forEach?.((u: any) => {
      if (claimed || (u.hp ?? 0) <= 0) return;
      if (String(u.homeStructureId || "") !== structureId) return;
      const currentX = Number(u.x);
      const currentY = Number(u.y);
      const targetX = Number(u.targetX ?? u.x);
      const targetY = Number(u.targetY ?? u.y);
      const targetDist = Math.hypot(targetX - worldX, targetY - worldY);
      const currentDist = Math.hypot(currentX - worldX, currentY - worldY);
      const claimRadius = Math.max(TILE_SIZE * 0.42, radius + this.localUnitBodyRadius(u) + 2);
      if (targetDist > claimRadius && currentDist > claimRadius) return;
      claimed = true;
    });
    return claimed;
  }

  findLocalProducedUnitExitPoint(state: any, structure: any, team: string, radius: number) {
    for (const cell of this.getProducedUnitExitCellOrder(structure, team)) {
      const wx = cell.gx * TILE_SIZE + TILE_SIZE / 2;
      const wy = cell.gy * TILE_SIZE + TILE_SIZE / 2;
      if (this.isLocalProducedUnitExitPointClaimed(state, String(structure.id || ""), wx, wy, radius)) continue;
      if (this.isLocalSpawnPointFree(state, wx, wy, radius)) {
        return { x: wx, y: wy };
      }
    }
    return this.findLocalUnitSpawnPoint(state, Number(structure.x), Number(structure.y), radius);
  }

  getProducedUnitStartPoint(structure: any, exitPoint: { x: number; y: number }) {
    const dirX = Math.sign(exitPoint.x - Number(structure.x));
    const dirY = Math.sign(exitPoint.y - Number(structure.y));
    const baseYOffset = String(structure.type || "") === "war_factory" ? -TILE_SIZE * 0.32 : -TILE_SIZE * 0.22;
    return {
      x: Number(structure.x) + dirX * TILE_SIZE * 0.34,
      y: Number(structure.y) + baseYOffset + dirY * TILE_SIZE * 0.12,
    };
  }

  findLocalUnitSpawnPoint(state: any, centerX: number, centerY: number, radius: number) {
    const baseGX = Math.floor(centerX / TILE_SIZE);
    const baseGY = Math.floor(centerY / TILE_SIZE);
    for (let ring = 1; ring <= 12; ring++) {
      for (let oy = -ring; oy <= ring; oy++) {
        for (let ox = -ring; ox <= ring; ox++) {
          if (Math.abs(ox) !== ring && Math.abs(oy) !== ring) continue;
          const wx = (baseGX + ox) * TILE_SIZE + TILE_SIZE / 2;
          const wy = (baseGY + oy) * TILE_SIZE + TILE_SIZE / 2;
          if (this.isLocalSpawnPointFree(state, wx, wy, radius)) return { x: wx, y: wy };
        }
      }
    }
    return null;
  }

  generateLocalBaseMap(state: any) {
    const width = state.mapWidth;
    const height = state.mapHeight;
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    state.map.length = 0;
    const keepOpen = new Set<string>();
    const markOpen = (gx: number, gy: number, radius: number) => {
      for (let oy = -radius; oy <= radius; oy++) {
        for (let ox = -radius; ox <= radius; ox++) {
          const x = gx + ox;
          const y = gy + oy;
          if (x >= 0 && y >= 0 && x < width && y < height) keepOpen.add(`${x},${y}`);
        }
      }
    };
    [
      { gx: 4, gy: centerY },
      { gx: 4, gy: centerY - 5 },
      { gx: 4, gy: centerY + 5 },
      { gx: width - 5, gy: centerY },
      { gx: width - 5, gy: centerY - 5 },
      { gx: width - 5, gy: centerY + 5 },
    ].forEach((slot) => markOpen(slot.gx, slot.gy, 2));
    markOpen(centerX, centerY, 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let tile = 0;
        const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
        if (border) tile = 1;
        else if (!keepOpen.has(`${x},${y}`)) {
          const symmetricBlock = ((x % 6 === 0) && (y % 4 === 0)) || ((x % 6 === 3) && (y % 5 === 2));
          const centerCover = Math.abs(x - centerX) <= 6 && Math.abs(y - centerY) <= 6 && ((x + y) % 4 === 0);
          if (symmetricBlock || centerCover) tile = 1;
        }
        state.map.push(tile);
      }
    }
  }

  localBaseTileAt(state: any, gx: number, gy: number) {
    if (gx < 0 || gy < 0 || gx >= state.mapWidth || gy >= state.mapHeight) return 1;
    return state.map[gy * state.mapWidth + gx] ?? 1;
  }

  spawnLocalBaseResources(state: any) {
    const nodes = [
      { gx: 9, gy: 7 },
      { gx: 9, gy: state.mapHeight - 8 },
      { gx: state.mapWidth - 10, gy: 7 },
      { gx: state.mapWidth - 10, gy: state.mapHeight - 8 },
      { gx: Math.floor(state.mapWidth / 2), gy: 6 },
      { gx: Math.floor(state.mapWidth / 2), gy: state.mapHeight - 7 },
    ];
    nodes.forEach((node, index) => {
      if (this.localBaseTileAt(state, node.gx, node.gy) !== 0) return;
      state.resources.set(`res_${index}`, {
        id: `res_${index}`,
        x: node.gx * TILE_SIZE + TILE_SIZE / 2,
        y: node.gy * TILE_SIZE + TILE_SIZE / 2,
        value: 25,
      });
    });
  }

  findLocalBaseSpawn(state: any, team: string) {
    const width = state.mapWidth;
    const centerY = Math.floor(state.mapHeight / 2);
    const slots = team === "A"
      ? [{ gx: 4, gy: centerY }, { gx: 4, gy: centerY - 5 }, { gx: 4, gy: centerY + 5 }]
      : [{ gx: width - 5, gy: centerY }, { gx: width - 5, gy: centerY - 5 }, { gx: width - 5, gy: centerY + 5 }];
    const slot = slots.find((s) => this.localBaseTileAt(state, s.gx, s.gy) === 0) || slots[0];
    return { x: slot.gx * TILE_SIZE + TILE_SIZE / 2, y: slot.gy * TILE_SIZE + TILE_SIZE / 2 };
  }

  withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
      promise.then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      }).catch((err) => {
        window.clearTimeout(timer);
        reject(err);
      });
    });
  }

  syncMap() {
    const state = this.room.state;
    if (!state?.map) return;
    const width = state.mapWidth;
    const total = state.mapWidth * state.mapHeight;
    for (let i = 0; i < total; i++) {
      const tile = state.map[i] ?? 0;
      const prev = this.mapCache[i];
      if (prev === tile) continue;
      if (this.tileEntities[i]) {
        this.tileEntities[i].destroy();
        this.tileEntities[i] = undefined as unknown as Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
      }
      if (this.tileShadowEntities[i]) {
        this.tileShadowEntities[i]?.destroy();
        this.tileShadowEntities[i] = undefined;
      }
      if (tile === 1) {
        const x = i % width;
        const y = Math.floor(i / width);
        this.tileEntities[i] = this.createWallTile(x, y, width, state.mapHeight);
        this.tileShadowEntities[i] = this.createWallTileShadow(x, y, width, state.mapHeight);
      }
      this.mapCache[i] = tile;
    }
  }

  updateObstacleGrid() {
    if (!this.obstacleGrid || !this.room?.state) return;
    this.obstacleGrid.fill(0);
    const structures = this.room.state.structures;
    if (structures?.forEach) {
      structures.forEach((s: any) => {
        const sgx = Math.floor(Number(s.x) / TILE_SIZE);
        const sgy = Math.floor(Number(s.y) / TILE_SIZE);
        this.forEachStructureFootprintCell(sgx, sgy, String(s.type || ""), (cx, cy) => {
          if (cx >= 0 && cx < this.gridW && cy >= 0 && cy < this.gridH) {
            this.obstacleGrid![cy * this.gridW + cx] = 1;
          }
        });
      });
    }
  }

  updateVisionGrid() {
    if (!this.currentVisionGrid) return;
    this.currentVisionGrid.fill(0);
    // Paint vision from all sources onto the grid
    for (const v of this.visionSources) {
      const gcx = Math.floor(v.x / TILE_SIZE);
      const gcy = Math.floor(v.y / TILE_SIZE);
      const gr = Math.ceil(Math.sqrt(v.r2) / TILE_SIZE);
      
      for (let gy = gcy - gr; gy <= gcy + gr; gy++) {
        for (let gx = gcx - gr; gx <= gcx + gr; gx++) {
          if (gx < 0 || gx >= this.gridW || gy < 0 || gy >= this.gridH) continue;
          if (this.currentVisionGrid[gy * this.gridW + gx] === 1) continue;
          
          const dx = (gx * TILE_SIZE + TILE_SIZE/2) - v.x;
          const dy = (gy * TILE_SIZE + TILE_SIZE/2) - v.y;
          if (dx*dx + dy*dy <= v.r2) {
             // For simple "fast" fog, we check LOS only if it's far
             if (dx*dx + dy*dy <= (TILE_SIZE*2.5)*(TILE_SIZE*2.5) || this.lineOfSightClear(v.x, v.y, gx*TILE_SIZE+TILE_SIZE/2, gy*TILE_SIZE+TILE_SIZE/2)) {
                this.currentVisionGrid[gy * this.gridW + gx] = 1;
             }
          }
        }
      }
    }
  }

  canOccupy(x: number, y: number, radius: number) {
    const samples = [
      { x, y },
      { x: x - radius, y: y - radius },
      { x: x + radius, y: y - radius },
      { x: x - radius, y: y + radius },
      { x: x + radius, y: y + radius },
    ];
    for (const p of samples) {
      const gx = Math.floor(p.x / TILE_SIZE);
      const gy = Math.floor(p.y / TILE_SIZE);
      if (this.tileAt(gx, gy) !== 0) return false;
      if (this.hasStructureAt(gx, gy)) return false;
      if (this.hasCoreAt(gx, gy)) return false;
    }
    return true;
  }

  canOccupyLocalUnit(x: number, y: number, radius: number, _ignoreUnitId?: string) {
    // Check center + 8 perimeter points against tiles, structures, cores
    const samples = [
      { x, y },
      { x: x - radius, y },
      { x: x + radius, y },
      { x, y: y - radius },
      { x, y: y + radius },
      { x: x - radius, y: y - radius },
      { x: x + radius, y: y - radius },
      { x: x - radius, y: y + radius },
      { x: x + radius, y: y + radius },
    ];
    for (const p of samples) {
      const gx = Math.floor(p.x / TILE_SIZE);
      const gy = Math.floor(p.y / TILE_SIZE);
      if (this.tileAt(gx, gy) !== 0) return false;
      if (this.hasStructureAt(gx, gy)) return false;
      if (this.hasCoreAt(gx, gy)) return false;
    }
    return true;
  }

  localUnitBodyRadius(unit: any) {
    const t = String(unit?.type || "");
    if (t === "tank") return TILE_SIZE * 0.31;
    if (t === "harvester") return TILE_SIZE * 0.29;
    return TILE_SIZE * 0.17;
  }

  isClientAuthoritativeUnitType(type: string) {
    return type === "tank" || type === "harvester" || type === "soldier";
  }

  isLocalSlotFree(
    x: number,
    y: number,
    radius: number,
    _unitId: string,
    reserved: Array<{ x: number; y: number; radius: number }>,
    _ignoreIds: Set<string>
  ) {
    if (!this.canOccupy(x, y, radius)) return false;
    for (const r of reserved) {
      if (Math.hypot(x - r.x, y - r.y) < radius + r.radius + 3) return false;
    }
    return true;
  }

  resolveLocalFormationSlot(
    desiredX: number,
    desiredY: number,
    radius: number,
    unitId: string,
    reserved: Array<{ x: number; y: number; radius: number }>,
    ignoreIds: Set<string>,
    canReach?: (x: number, y: number) => boolean
  ): { x: number; y: number } | null {
    const maxX = this.room.state.mapWidth * TILE_SIZE;
    const maxY = this.room.state.mapHeight * TILE_SIZE;
    const clamp = (v: number, hi: number) => Math.max(radius, Math.min(v, hi - radius));
    const baseX = clamp(desiredX, maxX);
    const baseY = clamp(desiredY, maxY);
    if (this.isLocalSlotFree(baseX, baseY, radius, unitId, reserved, ignoreIds) && (!canReach || canReach(baseX, baseY))) {
      return { x: baseX, y: baseY };
    }

    let best: { x: number; y: number; score: number } | null = null;
    const step = TILE_SIZE * 0.5;
    const groupSize = Math.max(1, ignoreIds.size);
    const maxRing = Math.max(8, Math.min(14, Math.ceil(Math.sqrt(groupSize)) + 6));
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let oy = -ring; oy <= ring; oy++) {
        for (let ox = -ring; ox <= ring; ox++) {
          if (Math.abs(ox) !== ring && Math.abs(oy) !== ring) continue;
          const cx = clamp(baseX + ox * step, maxX);
          const cy = clamp(baseY + oy * step, maxY);
          if (!this.isLocalSlotFree(cx, cy, radius, unitId, reserved, ignoreIds)) continue;
          if (canReach && !canReach(cx, cy)) continue;
          const score = Math.hypot(cx - baseX, cy - baseY);
          if (!best || score < best.score) best = { x: cx, y: cy, score };
        }
      }
      if (best) break;
    }
    if (best !== null) {
      const chosen = best as any;
      return { x: Number(chosen.x), y: Number(chosen.y) };
    }
    if (canReach) return null;
    return { x: baseX, y: baseY };
  }

  tryRelocateLocalBlocker(
    blockerId: string,
    moverId: string,
    dirX: number,
    dirY: number,
    depth: number,
    visited: Set<string>
  ) {
    if (depth < 0) return false;
    if (visited.has(blockerId)) return false;
    visited.add(blockerId);
    const u = this.room?.state?.units?.get ? this.room.state.units.get(blockerId) : this.room?.state?.units?.[blockerId];
    if (!u || (u.hp ?? 0) <= 0) return false;
    if (String(u.ownerId || "") !== this.currentPlayerId) return false;

    let s = this.localUnitRenderState.get(blockerId);
    if (!s) {
      s = { x: Number(u.x), y: Number(u.y), vx: 0, vy: 0, lastAt: performance.now() };
      this.localUnitRenderState.set(blockerId, s);
    }

    const tx = Number(u.targetX ?? u.x);
    const ty = Number(u.targetY ?? u.y);
    const standing = Math.hypot(tx - s.x, ty - s.y) <= TILE_SIZE * 0.35 && Math.hypot(s.vx, s.vy) <= 12;
    if (!standing) return false;

    const side = Math.max(TILE_SIZE * 0.28, Math.min(TILE_SIZE * 0.44, TILE_SIZE * 0.34));
    const left = { x: -dirY, y: dirX };
    const right = { x: dirY, y: -dirX };
    const back = { x: -dirX, y: -dirY };
    const candidates = [
      { x: s.x + left.x * side, y: s.y + left.y * side },
      { x: s.x + right.x * side, y: s.y + right.y * side },
      { x: s.x + (left.x + back.x * 0.55) * side, y: s.y + (left.y + back.y * 0.55) * side },
      { x: s.x + (right.x + back.x * 0.55) * side, y: s.y + (right.y + back.y * 0.55) * side },
      { x: s.x + back.x * side * 0.8, y: s.y + back.y * side * 0.8 },
    ];

    const radius = this.localUnitBodyRadius(u);

    for (const c of candidates) {
      if (!this.canOccupyLocalUnit(c.x, c.y, radius, blockerId)) continue;
      // keep moved blocker away from mover's desired direction a little
      const m = this.localUnitRenderState.get(moverId);
      if (m && Math.hypot(c.x - m.x, c.y - m.y) < TILE_SIZE * 0.6) continue;
      s.x = c.x;
      s.y = c.y;
      s.vx = 0;
      s.vy = 0;
      this.localUnitRenderState.set(blockerId, s);
      return true;
    }

    // If still blocked by another standing ally, attempt one level deeper.
    if (depth > 0) {
      const near = TILE_SIZE * 0.75;
      let moved = false;
      this.room?.state?.units?.forEach?.((ou: any, oid: string) => {
        if (moved) return;
        if (oid === blockerId || oid === moverId) return;
        if (String(ou.ownerId || "") !== this.currentPlayerId || (ou.hp ?? 0) <= 0) return;
        const os = this.localUnitRenderState.get(oid);
        const ox = Number(os?.x ?? ou.x);
        const oy = Number(os?.y ?? ou.y);
        if (Math.hypot(ox - s.x, oy - s.y) > near) return;
        if (this.tryRelocateLocalBlocker(oid, moverId, dirX, dirY, depth - 1, visited)) {
          moved = this.tryRelocateLocalBlocker(blockerId, moverId, dirX, dirY, 0, visited);
        }
      });
      if (moved) return true;
    }

    return false;
  }

  tryLocalYieldOnPath(moverId: string, desiredX: number, desiredY: number, dirX: number, dirY: number) {
    if (!this.room?.state?.units?.forEach) return false;
    const near = TILE_SIZE * 0.72;
    const blockers: string[] = [];
    this.room.state.units.forEach((u: any, id: string) => {
      if (id === moverId) return;
      if ((u.hp ?? 0) <= 0) return;
      if (String(u.ownerId || "") !== this.currentPlayerId) return;
      const s = this.localUnitRenderState.get(id);
      const x = Number(s?.x ?? u.x);
      const y = Number(s?.y ?? u.y);
      if (Math.hypot(x - desiredX, y - desiredY) <= near) blockers.push(id);
    });
    if (blockers.length === 0) return false;
    const visited = new Set<string>([moverId]);
    for (const id of blockers) {
      if (this.tryRelocateLocalBlocker(id, moverId, dirX, dirY, 2, visited)) return true;
    }
    return false;
  }

  pairLockShouldYield(selfId: string, otherId: string) {
    // Deterministic: lexicographically larger id yields.
    return selfId > otherId;
  }

  shouldYieldByWorldX(selfId: string, otherId: string) {
    const su = this.room?.state?.units?.get ? this.room.state.units.get(selfId) : this.room?.state?.units?.[selfId];
    const ou = this.room?.state?.units?.get ? this.room.state.units.get(otherId) : this.room?.state?.units?.[otherId];
    if (!su || !ou) return null;
    const ss = this.localUnitRenderState.get(selfId);
    const os = this.localUnitRenderState.get(otherId);
    const sx = Number(ss?.x ?? su.x);
    const ox = Number(os?.x ?? ou.x);
    const eps = TILE_SIZE * 0.08;
    if (Math.abs(sx - ox) <= eps) return null;
    // Rightmost unit yields.
    return sx > ox;
  }

  unitTargetForYield(id: string) {
    const override = this.localUnitTargetOverride.get(id);
    if (override) return { x: override.x, y: override.y };
    const u = this.room?.state?.units?.get ? this.room.state.units.get(id) : this.room?.state?.units?.[id];
    if (!u) return null;
    return { x: Number(u.targetX ?? u.x), y: Number(u.targetY ?? u.y) };
  }

  shouldYieldByGridDistance(selfId: string, otherId: string) {
    const su = this.room?.state?.units?.get ? this.room.state.units.get(selfId) : this.room?.state?.units?.[selfId];
    const ou = this.room?.state?.units?.get ? this.room.state.units.get(otherId) : this.room?.state?.units?.[otherId];
    if (!su || !ou) return null;
    const ss = this.localUnitRenderState.get(selfId);
    const os = this.localUnitRenderState.get(otherId);
    const sx = Number(ss?.x ?? su.x);
    const sy = Number(ss?.y ?? su.y);
    const ox = Number(os?.x ?? ou.x);
    const oy = Number(os?.y ?? ou.y);
    const st = this.unitTargetForYield(selfId);
    const ot = this.unitTargetForYield(otherId);
    if (!st || !ot) return null;
    const sd = Math.hypot(st.x - sx, st.y - sy);
    const od = Math.hypot(ot.x - ox, ot.y - oy);
    const eps = TILE_SIZE * 0.22;
    if (Math.abs(sd - od) <= eps) return null;
    // Farther-from-own-grid unit yields.
    return sd > od;
  }

  shouldYieldInPair(selfId: string, otherId: string) {
    const byWorldX = this.shouldYieldByWorldX(selfId, otherId);
    if (byWorldX !== null) return byWorldX;
    const byGridDist = this.shouldYieldByGridDistance(selfId, otherId);
    if (byGridDist !== null) return byGridDist;
    return this.pairLockShouldYield(selfId, otherId);
  }

  isPathWalkable(gx: number, gy: number) {
    if (this.tileAt(gx, gy) !== 0) return false;
    if (this.hasStructureAt(gx, gy)) return false;
    if (this.hasCoreAt(gx, gy)) return false;
    return true;
  }

  isPathWalkableForRadius(gx: number, gy: number, radius: number) {
    if (!this.isPathWalkable(gx, gy)) return false;
    if (!(radius > 0)) return true;
    const world = this.gridToWorld(gx, gy);
    return this.canOccupyLocalUnit(world.x, world.y, radius);
  }

  worldToGrid(x: number, y: number) {
    return { gx: Math.floor(x / TILE_SIZE), gy: Math.floor(y / TILE_SIZE) };
  }

  gridToWorld(gx: number, gy: number) {
    return { x: gx * TILE_SIZE + TILE_SIZE / 2, y: gy * TILE_SIZE + TILE_SIZE / 2 };
  }

  lineOfSightClear(ax: number, ay: number, bx: number, by: number) {
    const x0 = Math.floor(ax / TILE_SIZE);
    const y0 = Math.floor(ay / TILE_SIZE);
    const x1 = Math.floor(bx / TILE_SIZE);
    const y1 = Math.floor(by / TILE_SIZE);
    let x = x0;
    let y = y0;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    const maxSteps = 96;
    let steps = 0;
    while (!(x === x1 && y === y1) && steps < maxSteps) {
      if (!(x === x0 && y === y0)) {
        if (this.tileAt(x, y) !== 0) return false;
        if (this.hasStructureAt(x, y)) return false;
      }
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      steps += 1;
    }
    return true;
  }

   refreshVisionSources(myTeam?: string) {
    this.visionSources = [];
    if (!myTeam) return;
    const addSource = (x: number, y: number, tiles: number) => {
      const r = Math.max(1, tiles) * TILE_SIZE;
      this.visionSources.push({ x, y, r2: r * r });
    };
    const me = (this.room.state.players as any).get ? (this.room.state.players as any).get(this.currentPlayerId) : (this.room.state.players as any)?.[this.currentPlayerId];
    if (me?.isAlive) addSource(Number(me.x), Number(me.y), 7.5);
    if (this.room.state.units?.forEach) {
      this.room.state.units.forEach((u: any) => {
        if (u.team !== myTeam || (u.hp ?? 0) <= 0) return;
        const unitId = String(u.id || "");
        const isLocalOwned = String(u.ownerId || "") === this.currentPlayerId;
        const localRender = isLocalOwned ? this.localUnitRenderState.get(unitId) : null;
        const t = String(u.type || "");
        const tiles = t === "tank" ? 7.2 : t === "harvester" ? 5.4 : 6.4;
        addSource(Number(localRender?.x ?? u.x), Number(localRender?.y ?? u.y), tiles);
      });
    }
    if (this.room.state.structures?.forEach) {
      this.room.state.structures.forEach((s: any) => {
        if (s.team !== myTeam || (s.hp ?? 0) <= 0) return;
        const t = String(s.type || "");
        const tiles = t === "base" ? 9.2 : t === "turret" ? 7.4 : 5.8;
        addSource(Number(s.x), Number(s.y), tiles);
      });
    }
    
    // Build 99: Stagger vision grid update (8 FPS)
    const now = Date.now();
    if (now - this.lastVisionUpdateAt > 120) {
       this.lastVisionUpdateAt = now;
       this.updateVisionGrid();
    }
  }

  isVisibleToTeam(worldX: number, worldY: number) {
    if (!this.currentVisionGrid) return true; // Fail-safe (visible until grid ready)
    const gx = Math.floor(worldX / TILE_SIZE);
    const gy = Math.floor(worldY / TILE_SIZE);
    if (gx < 0 || gx >= this.gridW || gy < 0 || gy >= this.gridH) return false;
    return this.currentVisionGrid[gy * this.gridW + gx] === 1;
  }

  fogAlphaAtWorld(worldX: number, worldY: number) {
    if (!this.fogSeenAt || this.fogCols <= 0 || this.fogRows <= 0) return 0.9;
    const col = Math.max(0, Math.min(this.fogCols - 1, Math.floor(worldX / FOG_CELL_SIZE)));
    const row = Math.max(0, Math.min(this.fogRows - 1, Math.floor(worldY / FOG_CELL_SIZE)));
    const seenTime = this.fogSeenAt[row * this.fogCols + col];
    if (seenTime <= -1000) return 0.9;
    const visibleHoldSec = 0.35;
    const fadeToDarkSec = 16;
    const ageSec = Math.max(0, this.fogClockSec - seenTime);
    if (ageSec <= visibleHoldSec) return 0;
    const t = Math.min(1, (ageSec - visibleHoldSec) / fadeToDarkSec);
    return 0.14 + t * 0.76;
  }

  isVisibleToTeamWithFogMemory(worldX: number, worldY: number) {
    if (this.isVisibleToTeam(worldX, worldY)) return true;
    // Keep enemies visible until the area is clearly dark.
    return this.fogAlphaAtWorld(worldX, worldY) < 0.78;
  }

  findPath(
    startGX: number,
    startGY: number,
    goalGX: number,
    goalGY: number,
    _avoidUnits = false,
    _movingUnitId?: string,
    unitRadius = 0
  ) {
    if (!this.room?.state) return null;
    if (!this.isPathWalkableForRadius(goalGX, goalGY, unitRadius)) return null;

    const width = this.room.state.mapWidth;
    const height = this.room.state.mapHeight;
    const key = (x: number, y: number) => `${x},${y}`;
    const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;

    const open: { x: number; y: number; f: number }[] = [];
    const came = new Map<string, string>();
    const gScore = new Map<string, number>();
    const closed = new Set<string>();

    const startKey = key(startGX, startGY);
    const goalKey = key(goalGX, goalGY);
    const h = (x: number, y: number) => {
      const dx = Math.abs(x - goalGX);
      const dy = Math.abs(y - goalGY);
      const mn = Math.min(dx, dy);
      const mx = Math.max(dx, dy);
      return mn * 1.4142 + (mx - mn);
    };

    gScore.set(startKey, 0);
    open.push({ x: startGX, y: startGY, f: h(startGX, startGY) });

    const dirs = [
      { dx: 1, dy: 0, c: 1 },
      { dx: -1, dy: 0, c: 1 },
      { dx: 0, dy: 1, c: 1 },
      { dx: 0, dy: -1, c: 1 },
      { dx: 1, dy: 1, c: 1.4142 },
      { dx: 1, dy: -1, c: 1.4142 },
      { dx: -1, dy: 1, c: 1.4142 },
      { dx: -1, dy: -1, c: 1.4142 },
    ];

    while (open.length > 0) {
      let best = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < open[best].f) best = i;
      }
      const current = open.splice(best, 1)[0];
      const cKey = key(current.x, current.y);
      if (cKey === goalKey) {
        const path: { x: number; y: number }[] = [];
        let walk = goalKey;
        while (walk !== startKey) {
          const [px, py] = walk.split(",").map(Number);
          path.push({ x: px, y: py });
          const prev = came.get(walk);
          if (!prev) break;
          walk = prev;
        }
        path.reverse();
        return path;
      }

      if (closed.has(cKey)) continue;
      closed.add(cKey);

      const currentG = gScore.get(cKey) ?? Number.POSITIVE_INFINITY;
      for (const d of dirs) {
        const nx = current.x + d.dx;
        const ny = current.y + d.dy;
        if (d.dx !== 0 && d.dy !== 0) {
          if (!this.isPathWalkableForRadius(current.x + d.dx, current.y, unitRadius)) continue;
          if (!this.isPathWalkableForRadius(current.x, current.y + d.dy, unitRadius)) continue;
        }
        if (!inBounds(nx, ny)) continue;
        if (!this.isPathWalkableForRadius(nx, ny, unitRadius)) continue;
        // Unit-unit avoidance disabled: only static walkability blocks path nodes.
        const nKey = key(nx, ny);
        if (closed.has(nKey)) continue;

        const tentative = currentG + d.c;
        const known = gScore.get(nKey) ?? Number.POSITIVE_INFINITY;
        if (tentative < known) {
          came.set(nKey, cKey);
          gScore.set(nKey, tentative);
          open.push({ x: nx, y: ny, f: tentative + h(nx, ny) });
        }
      }
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
    const goalGX = Math.floor(tx / TILE_SIZE);
    const goalGY = Math.floor(ty / TILE_SIZE);

    let cache = this.unitClientPathCache.get(unitId);
    const needRecalc = !cache
      || cache.goalGX !== goalGX
      || cache.goalGY !== goalGY
      || (now - cache.updatedAt) > 520
      || cache.idx >= cache.cells.length;

    if (needRecalc) {
      const cells = this.findPath(startGX, startGY, goalGX, goalGY, false, unitId, unitRadius);
      if (!cells || cells.length === 0) {
        this.unitClientPathCache.delete(unitId);
        return null;
      }
      cache = { goalGX, goalGY, cells, idx: 0, updatedAt: now };
      this.unitClientPathCache.set(unitId, cache);
    }
    if (!cache) return null;

    while (cache.idx < cache.cells.length) {
      const c = cache.cells[cache.idx];
      const wx = c.x * TILE_SIZE + TILE_SIZE / 2;
      const wy = c.y * TILE_SIZE + TILE_SIZE / 2;
      const d = Math.hypot(wx - ux, wy - uy);
      if (d <= TILE_SIZE * 0.28) cache.idx += 1;
      else return { x: wx, y: wy };
    }
    return null;
  }

  recalcPathToTarget() {
    if (!this.moveTarget) {
      this.movePath = [];
      return;
    }
    const meEntity = this.playerEntities[this.currentPlayerId];
    if (!meEntity) return;

    const { gx: startGX, gy: startGY } = this.worldToGrid(meEntity.x, meEntity.y);
    const { gx: goalGX, gy: goalGY } = this.worldToGrid(this.moveTarget.x, this.moveTarget.y);
    const path = this.findPath(startGX, startGY, goalGX, goalGY);
    if (!path || path.length === 0) {
      this.movePath = [];
      return;
    }
    this.movePath = path.map((p) => this.gridToWorld(p.x, p.y));
  }

  findFriendlyUnitAtWorld(x: number, y: number, team?: string) {
    if (!team || !this.room?.state?.units?.forEach) return null;
    let pickedId: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    this.room.state.units.forEach((u: any, id: string) => {
      if (u.team !== team) return;
      const rs = this.localUnitRenderState.get(id);
      const dx = Number(rs?.x ?? u.x) - x;
      const dy = Number(rs?.y ?? u.y) - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > TILE_SIZE * 0.75) return; // Slightly larger pick radius for easier clicks
      if (d < bestDist) {
        bestDist = d;
        pickedId = id;
      }
    });
    return pickedId;
  }

  findFriendlyStructureAtWorld(x: number, y: number, team?: string) {
    if (!team || !this.room?.state?.structures?.forEach) return null;
    let pickedId: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    this.room.state.structures.forEach((s: any, id: string) => {
      if (s.team !== team) return;
      const dx = s.x - x;
      const dy = s.y - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > this.getStructurePickRadius(String(s.type || ""))) return;
      if (d < bestDist) {
        bestDist = d;
        pickedId = id;
      }
    });
    return pickedId;
  }

  findEnemyUnitAtWorld(x: number, y: number, myTeam?: string) {
    if (!myTeam || !this.room?.state?.units?.forEach) return null;
    let pickedId: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    this.room.state.units.forEach((u: any, id: string) => {
      if (u.team === myTeam) return;
      if ((u.hp ?? 0) <= 0) return;
      const rs = this.localUnitRenderState.get(id);
      const d = Math.hypot(Number(rs?.x ?? u.x) - x, Number(rs?.y ?? u.y) - y);
      if (d > TILE_SIZE * 0.75) return;
      if (d < bestDist) {
        bestDist = d;
        pickedId = id;
      }
    });
    return pickedId;
  }

  findEnemyStructureAtWorld(x: number, y: number, myTeam?: string) {
    if (!myTeam || !this.room?.state?.structures?.forEach) return null;
    let pickedId: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    this.room.state.structures.forEach((s: any, id: string) => {
      if (s.team === myTeam) return;
      if ((s.hp ?? 0) <= 0) return;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d > this.getStructurePickRadius(String(s.type || ""))) return;
      if (d < bestDist) {
        bestDist = d;
        pickedId = id;
      }
    });
    return pickedId;
  }

  findEnemyPlayerAtWorld(x: number, y: number, myTeam?: string) {
    if (!myTeam || !this.room?.state?.players?.forEach) return null;
    let pickedId: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    this.room.state.players.forEach((p: any, id: string) => {
      if (!p.isAlive || p.team === myTeam) return;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > TILE_SIZE * 0.7) return;
      if (d < bestDist) {
        bestDist = d;
        pickedId = id;
      }
    });
    return pickedId;
  }

  pickAnyAttackTargetAtWorld(x: number, y: number) {
    let best: any = null;
    if (this.room?.state?.units?.forEach) {
      this.room.state.units.forEach((u: any, id: string) => {
        if ((u.hp ?? 0) <= 0) return;
        const rs = this.localUnitRenderState.get(id);
        const d = Math.hypot(Number(rs?.x ?? u.x) - x, Number(rs?.y ?? u.y) - y);
        if (d > TILE_SIZE * 0.8) return;
        if (!best || d < best.d) best = { type: "unit", id, d };
      });
    }
    if (this.room?.state?.structures?.forEach) {
      this.room.state.structures.forEach((s: any, id: string) => {
        if ((s.hp ?? 0) <= 0) return;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d > TILE_SIZE * 0.85) return;
        if (!best || d < best.d) best = { type: "structure", id, d };
      });
    }
    if (this.room?.state?.players?.forEach) {
      this.room.state.players.forEach((p: any, id: string) => {
        if (!p.isAlive) return;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d > TILE_SIZE * 0.8) return;
        if (!best || d < best.d) best = { type: "player", id, d };
      });
    }
    if (!best) return null;
    return { type: best.type as "player" | "unit" | "structure", id: String(best.id) };
  }

  localFormationRadiusForUnit(unit: any) {
    const t = String(unit?.type || "");
    if (t === "tank") return TILE_SIZE * 0.55;
    if (t === "harvester") return TILE_SIZE * 0.45;
    return TILE_SIZE * 0.35;
  }

  localFormationSpacingForIds(unitIds: string[]) {
    if (!this.room?.state?.units) return TILE_SIZE * 1.5;
    let maxRadius = TILE_SIZE * 0.42;
    for (const id of unitIds) {
      const unit = this.room.state.units.get ? this.room.state.units.get(id) : this.room.state.units?.[id];
      if (!unit || (unit.hp ?? 0) <= 0) continue;
      maxRadius = Math.max(maxRadius, this.localFormationRadiusForUnit(unit));
    }
    return Math.max(TILE_SIZE * 1.4, maxRadius * 2.8 + 16);
  }

  localFormationSlot(centerX: number, centerY: number, gridIndex: number, _totalUnits: number, spacing: number) {
    const sp = Math.max(TILE_SIZE * 1.4, spacing);
    
    let x = 0, y = 0;
    let dx = 1, dy = 0;
    let stepsToTake = 1;
    let stepCount = 0;
    let changes = 0;
    
    for (let i = 0; i < gridIndex; i++) {
      x += dx;
      y += dy;
      stepCount++;
      if (stepCount === stepsToTake) {
        stepCount = 0;
        // Rotate 90 degrees counter-clockwise (downwards in screen coordinates)
        const t = dx;
        dx = -dy;
        dy = t;
        changes++;
        if (changes % 2 === 0) {
          stepsToTake++;
        }
      }
    }
    
    return { x: centerX + x * sp, y: centerY + y * sp };
  }

  isClickOnOwnPlayer(x: number, y: number) {
    const meEntity = this.playerEntities[this.currentPlayerId];
    if (!meEntity) return false;
    const dx = meEntity.x - x;
    const dy = meEntity.y - y;
    return Math.sqrt(dx * dx + dy * dy) <= TILE_SIZE * 0.55;
  }

  canPlaceSelectedBuildAt(gx: number, gy: number) {
    return this.canPlaceBuildAt(this.selectedBuild, gx, gy);
  }

  reflowFormationAssignments(now: number) {
    if (now > this.formationPreviewUntil) {
      this.formationPreviewSlots = [];
      this.formationPreviewAssignments.clear();
      this.formationPreviewCenter = null;
      this.formationPreviewUntil = 0;
    }
  }

}

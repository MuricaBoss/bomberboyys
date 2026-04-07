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
import { BaseDefenseScene_Server } from "./BaseDefenseServer";

export class BaseDefenseScene_Render extends BaseDefenseScene_Server {
  syncWorldBackground(width: number, height: number) {
    const safeWidth = Math.max(TILE_SIZE, Math.round(width));
    const safeHeight = Math.max(TILE_SIZE, Math.round(height));
    const needsRefresh = !this.groundTileSprite
      || this.groundTileSprite.width !== safeWidth
      || this.groundTileSprite.height !== safeHeight;
    if (!needsRefresh) return;

    this.groundTileSprite?.destroy();
    this.groundTintOverlay?.destroy();

    this.groundTileSprite = this.add.tileSprite(0, 0, safeWidth, safeHeight, "rts_ground")
      .setOrigin(0)
      .setDepth(-120)
      .setTileScale(RTS_GROUND_TILE_SCALE)
      .setAlpha(0.98);
    this.groundTintOverlay = this.add.rectangle(safeWidth / 2, safeHeight / 2, safeWidth, safeHeight, 0xd8e7f5, 0.06)
      .setDepth(-110);
  }

  getStructureTopY(entity: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image) {
    const originY = typeof (entity as { originY?: number }).originY === "number"
      ? Number((entity as { originY?: number }).originY)
      : 0.5;
    return entity.y - entity.displayHeight * originY;
  }

  hideGroundShadow(shadow: Phaser.GameObjects.Ellipse | undefined) {
    shadow?.setVisible(false);
  }

  destroyGroundShadow(shadow: Phaser.GameObjects.Ellipse | undefined) {
    shadow?.destroy();
  }

  getTankTextureKeyByDir(dir: number) {
    return RTS_TANK_TEXTURE_BY_DIR[dir] ?? RTS_TANK_TEXTURE_KEYS.e;
  }

  getSoldierSheetRowByDir(dir: number) {
    return RTS_SOLDIER_ROW_BY_DIR[dir] ?? RTS_SOLDIER_ROW_BY_DIR[0];
  }

  getSoldierAnimKey(action: "idle" | "run" | "shoot", dir: number) {
    return `soldier_${action}_${dir}`;
  }

  ensureSoldierAnimations() {
    for (let dir = 0; dir < 8; dir++) {
      const rowStart = this.getSoldierSheetRowByDir(dir) * RTS_SOLDIER_FRAME_COLS;
      const idleKey = this.getSoldierAnimKey("idle", dir);
      if (!this.anims.exists(idleKey)) {
        this.anims.create({
          key: idleKey,
          frames: RTS_SOLDIER_IDLE_FRAMES.map((frame) => ({
            key: RTS_SOLDIER_SPRITESHEET_KEYS.run,
            frame: rowStart + frame,
          })),
          frameRate: 1.2,
          repeat: -1,
        });
      }
      const runKey = this.getSoldierAnimKey("run", dir);
      if (!this.anims.exists(runKey)) {
        this.anims.create({
          key: runKey,
          frames: this.anims.generateFrameNumbers(RTS_SOLDIER_SPRITESHEET_KEYS.run, {
            start: rowStart,
            end: rowStart + RTS_SOLDIER_FRAME_COLS - 1,
          }),
          frameRate: 12,
          repeat: -1,
        });
      }
      const shootKey = this.getSoldierAnimKey("shoot", dir);
      if (!this.anims.exists(shootKey)) {
        this.anims.create({
          key: shootKey,
          frames: this.anims.generateFrameNumbers(RTS_SOLDIER_SPRITESHEET_KEYS.shoot, {
            start: rowStart,
            end: rowStart + RTS_SOLDIER_FRAME_COLS - 1,
          }),
          frameRate: 16,
          repeat: -1,
        });
      }
    }
  }

  getImageTopY(entity: Phaser.GameObjects.Image) {
    return entity.y - entity.displayHeight * entity.originY;
  }

  getSpriteTopY(entity: Phaser.GameObjects.Sprite) {
    return entity.y - entity.displayHeight * entity.originY;
  }

  getTankSelectionBoxSize(entity: Phaser.GameObjects.Image) {
    return entity.displayWidth * RTS_TANK_SELECTION_BOX_SIZE_SCALE;
  }

  getTankSelectionY(entity: Phaser.GameObjects.Image, dir?: number) {
    let y = this.getImageTopY(entity) + entity.displayHeight * RTS_TANK_SELECTION_CENTER_Y;
    if (dir === 0 || dir === 4) y += RTS_TANK_SELECTION_SIDE_Y_OFFSET;
    return y;
  }

  getTankHpY(entity: Phaser.GameObjects.Image) {
    return this.getImageTopY(entity) + RTS_TANK_HP_BOTTOM_OFFSET;
  }

  getTankTrailAnchor(entity: Phaser.GameObjects.Image) {
    return {
      x: entity.x,
      y: this.getImageTopY(entity) + entity.displayHeight * 0.74,
    };
  }

  getTankShadowSpec(entity: Phaser.GameObjects.Image) {
    return {
      x: entity.x,
      y: this.getImageTopY(entity) + entity.displayHeight * 0.84,
      width: entity.displayWidth * 0.62,
      height: entity.displayHeight * 0.18,
    };
  }

  getSoldierShadowSpec(entity: Phaser.GameObjects.Sprite) {
    return {
      x: entity.x,
      y: this.getSpriteTopY(entity) + entity.displayHeight * 0.86,
      width: entity.displayWidth * 0.42,
      height: entity.displayHeight * 0.14,
    };
  }

  spawnUnitProjectile(unitId: string, fromX: number, fromY: number, toX: number, toY: number, isFriendly: boolean, dir: number, victimId: string, isTank: boolean) {
    const now = Date.now();
    const color = isFriendly ? (isTank ? 0xccf0ff : 0xa8e8ff) : (isTank ? 0xffb080 : 0xffd3a6);
    const radius = isTank ? RTS_TANK_PROJECTILE_RADIUS : RTS_SOLDIER_PROJECTILE_RADIUS;
    const speed = isTank ? RTS_TANK_PROJECTILE_SPEED : RTS_SOLDIER_PROJECTILE_SPEED;
    
    let bullet = this.projectilePool.get(fromX, fromY) as Phaser.GameObjects.Arc;
    if (!bullet) return;
    bullet.setActive(true).setVisible(true).setRadius(radius).setFillStyle(color, 0.95).setDepth(17);
    
    let glow = this.projectilePool.get(fromX, fromY) as Phaser.GameObjects.Arc;
    if (glow) {
       glow.setActive(true).setVisible(true).setRadius(radius * 2.4).setFillStyle(color, 0.35)
         .setBlendMode(Phaser.BlendModes.ADD)
         .setDepth(16.9);
    }

    const distance = Math.hypot(toX - fromX, toY - fromY);
    const duration = Math.max(70, Math.min(600, (distance / speed) * 1000));
    if (glow) this.applyWorldDepth(glow, fromY, WORLD_DEPTH_PROJECTILE_OFFSET - 0.001);
    this.applyWorldDepth(bullet, fromY, WORLD_DEPTH_PROJECTILE_OFFSET);
    this.unitProjectileEffects.push({
      bullet,
      glow,
      fromX,
      fromY,
      toX,
      toY,
      startedAt: now,
      expiresAt: now + duration,
      unitId,
      victimId,
      isFriendly,
    });
    this.unitLastShotDir.set(unitId, { dir, at: now });
    this.soldierLastShotAt.set(unitId, now);
  }

  updateUnitProjectileEffects(nowMs: number) {
    if (this.unitProjectileEffects.length <= 0) return;
    this.unitProjectileEffects = this.unitProjectileEffects.filter((fx) => {
      if (nowMs >= fx.expiresAt) {
        if (fx.unitId && fx.victimId) {
          const unit = this.room?.state?.units?.get ? this.room.state.units.get(fx.unitId) : this.room?.state?.units?.[fx.unitId];
          const isLocalOwned = unit && String(unit.ownerId || "") === this.currentPlayerId;
          if (isLocalOwned) {
            this.room?.send("projectile_hit", { shooterId: fx.unitId, victimId: fx.victimId });
          }
        }
        fx.bullet.setActive(false).setVisible(false);
        if (fx.glow) fx.glow.setActive(false).setVisible(false);
        return false;
      }
      const span = Math.max(1, fx.expiresAt - fx.startedAt);
      const t = Phaser.Math.Clamp((nowMs - fx.startedAt) / span, 0, 1);
      const x = Phaser.Math.Linear(fx.fromX, fx.toX, t);
      const y = Phaser.Math.Linear(fx.fromY, fx.toY, t);
      fx.bullet.setPosition(x, y);
      fx.glow.setPosition(x, y);
      fx.bullet.setAlpha(0.9 - t * 0.18);
      fx.glow.setAlpha(0.35 * (1 - t));
      this.applyWorldDepth(fx.glow, y, WORLD_DEPTH_PROJECTILE_OFFSET - 0.001);
      this.applyWorldDepth(fx.bullet, y, WORLD_DEPTH_PROJECTILE_OFFSET);
      return true;
    });
  }

  maybeFireUnitProjectile(id: string, unit: any, entity: any, isFriendly: boolean, visible: boolean, dir: number, isTank: boolean) {
    if ((unit.hp ?? 0) <= 0) return;
    const targetId = this.unitAttackTarget.get(id);
    if (!targetId) return;
    let target = this.room?.state?.units?.get ? this.room.state.units.get(targetId) : this.room?.state?.units?.[targetId];
    if (!target) {
        target = this.room?.state?.structures?.get ? this.room.state.structures.get(targetId) : this.room?.state?.structures?.[targetId];
    }
    if (!target) {
        target = this.room?.state?.cores?.get ? this.room.state.cores.get(targetId) : this.room?.state?.cores?.[targetId];
    }
    if (!target || (target.hp ?? 0) <= 0 || target.team === unit.team) return;

    // Show fire if source is visible, OR if target is visible, OR if firing at US
    const player = this.room?.state?.players?.get ? this.room.state.players.get(this.currentPlayerId) : this.room?.state?.players?.[this.currentPlayerId];
    const playerTeam = player?.team;
    const targetIsMe = target.team === playerTeam;
    
    const targetRs = this.localUnitRenderState.get(targetId);
    const targetX = Number(targetRs?.x ?? target.x);
    const targetY = Number(targetRs?.y ?? target.y);
    const targetVisible = this.isVisibleToTeamWithFogMemory(targetX, targetY);

    if (!visible && !targetVisible && !targetIsMe) return;

    const rs = this.localUnitRenderState.get(id);
    const sourceX = Number(rs?.x ?? unit.x);
    const sourceY = Number(rs?.y ?? unit.y);
    const dist = Math.hypot(targetX - sourceX, targetY - sourceY);
    const range = (isTank ? RTS_TANK_PROJECTILE_RANGE : RTS_SOLDIER_PROJECTILE_RANGE) * 1.1; // 10% buffer
    if (dist > range) return;

    // Softened: allow firing even if moving (visual only)
    // (Previous code blocked it entirely)

    const now = Date.now();
    const lastShotAt = this.soldierLastShotAt.get(id) ?? 0;
    const interval = isTank ? RTS_TANK_PROJECTILE_INTERVAL_MS : RTS_SOLDIER_PROJECTILE_INTERVAL_MS;
    if (now - lastShotAt < interval) return;

    const angle = Math.atan2(targetY - sourceY, targetX - sourceX);
    const muzzleOffset = entity.displayWidth * 0.42;
    const fromX = entity.x + Math.cos(angle) * muzzleOffset;
    const topY = isTank ? this.getImageTopY(entity as Phaser.GameObjects.Image) : this.getSpriteTopY(entity as Phaser.GameObjects.Sprite);
    const fromY = topY + entity.displayHeight * 0.58 + Math.sin(angle) * muzzleOffset * 0.28;
    this.spawnUnitProjectile(id, fromX, fromY, targetX, targetY, isFriendly, dir, targetId, isTank);
  }

  getStructureShadowSpec(
    type: string,
    artSpec: { size: number; originY: number; pickRadius: number; labelY: number },
    x: number,
    y: number,
  ) {
    const footprint = this.getStructureFootprint(type);
    const footprintWidth = footprint.width * TILE_SIZE * 0.88;
    const width = Math.min(artSpec.size * 0.76, footprintWidth);
    return {
      x,
      y: y + TILE_SIZE * 0.18,
      width,
      height: width * 0.28,
    };
  }

  spawnTankTrail(entity: Phaser.GameObjects.Image, angleRad: number) {
    const dirX = Math.cos(angleRad);
    const dirY = Math.sin(angleRad);
    const perpX = -dirY;
    const perpY = dirX;
    const trailAnchor = this.getTankTrailAnchor(entity);
    const backOffset = Math.max(RTS_TANK_TRAIL_BACK_OFFSET, entity.displayWidth * 0.14);
    const centerX = trailAnchor.x - dirX * backOffset;
    const centerY = trailAnchor.y - dirY * backOffset;
    const gap = Math.max(RTS_TANK_TRAIL_GAP, entity.displayWidth * 0.18) * 0.5;
    const left = this.add.rectangle(
      centerX - perpX * gap,
      centerY - perpY * gap,
      RTS_TANK_TRAIL_SEGMENT_WIDTH,
      RTS_TANK_TRAIL_SEGMENT_LENGTH,
      0x4b4f55,
      1,
    ).setRotation(angleRad - Math.PI / 2).setAlpha(RTS_TANK_TRAIL_ALPHA);
    const right = this.add.rectangle(
      centerX + perpX * gap,
      centerY + perpY * gap,
      RTS_TANK_TRAIL_SEGMENT_WIDTH,
      RTS_TANK_TRAIL_SEGMENT_LENGTH,
      0x4b4f55,
      1,
    ).setRotation(angleRad - Math.PI / 2).setAlpha(RTS_TANK_TRAIL_ALPHA);
    this.applyWorldDepth(left, left.y, WORLD_DEPTH_TRAIL_OFFSET);
    this.applyWorldDepth(right, right.y, WORLD_DEPTH_TRAIL_OFFSET);
    this.tankTrailEffects.push({
      left,
      right,
      expiresAt: Date.now() + RTS_TANK_TRAIL_LIFETIME_MS,
    });
  }

  updateTankTrailForUnit(id: string, entity: Phaser.GameObjects.Image, visible: boolean) {
    let state = this.tankTrailState.get(id);
    if (!state) {
      state = {
        lastX: entity.x,
        lastY: entity.y,
        lastSpawnX: entity.x,
        lastSpawnY: entity.y,
      };
      this.tankTrailState.set(id, state);
      return;
    }

    const dx = entity.x - state.lastX;
    const dy = entity.y - state.lastY;
    const frameDist = Math.hypot(dx, dy);
    if (visible && frameDist > 0.35) {
      const spawnDist = Math.hypot(entity.x - state.lastSpawnX, entity.y - state.lastSpawnY);
      if (spawnDist >= RTS_TANK_TRAIL_SPAWN_DISTANCE) {
        this.spawnTankTrail(entity, Math.atan2(dy, dx));
        state.lastSpawnX = entity.x;
        state.lastSpawnY = entity.y;
      }
    }

    state.lastX = entity.x;
    state.lastY = entity.y;
  }

  updateTankTrailEffects(nowMs: number) {
    if (this.tankTrailEffects.length <= 0) return;
    this.tankTrailEffects = this.tankTrailEffects.filter((fx) => {
      if (nowMs >= fx.expiresAt) {
        fx.left.destroy();
        fx.right.destroy();
        return false;
      }
      const life = Math.max(0, (fx.expiresAt - nowMs) / RTS_TANK_TRAIL_LIFETIME_MS);
      const alpha = RTS_TANK_TRAIL_ALPHA * life;
      fx.left.setAlpha(alpha);
      fx.right.setAlpha(alpha);
      return true;
    });
  }

  drawMap(state: any) {
    const width = state.mapWidth;
    const height = state.mapHeight;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = state.map[y * width + x];
        if (tile === 1) {
          this.tileEntities[y * width + x] = this.createWallTile(x, y, width, height);
          this.tileShadowEntities[y * width + x] = this.createWallTileShadow(x, y, width, height);
        } else {
          this.tileEntities[y * width + x] = undefined as unknown as Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
          this.tileShadowEntities[y * width + x] = undefined;
        }
      }
    }
  }

  ensureTankTextures() {
  }

  updateUnitRenderPos(
    id: string,
    e: Phaser.GameObjects.GameObject & { x: number; y: number },
    u: any,
    delta: number,
    isLocalOwned: boolean,
    _isTank: boolean
  ) {
    // Dead units become static wreckage — stop all client-side physics processing
    if ((u.hp ?? 0) <= 0) return;

    // If tab was backgrounded, delta can be huge — hard reset to server state
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
      // Remove stale overrides
      this.localUnitTargetOverride.delete(id);
      this.localUnitMovePriority.delete(id);
      this.autoEngagedUnitIds.delete(id);
      this.unitAttackTarget.delete(id);
      return;
    }
    const dt = Math.max(0.001, Math.min(0.05, delta / 1000));
    if (!isLocalOwned) {
      // Full client-side physics simulation for enemy units — same quality as owned units
      let rs = this.localUnitRenderState.get(id);
      if (!rs) {
        rs = { x: Number(u.x), y: Number(u.y), vx: 0, vy: 0, lastAt: performance.now() };
        this.localUnitRenderState.set(id, rs);
      }
      const serverX = Number(u.x);
      const serverY = Number(u.y);
      const dist = Math.hypot(serverX - rs.x, serverY - rs.y);
      if (dist > TILE_SIZE * 3) {
        // Teleport if too far
        e.x = serverX;
        e.y = serverY;
        rs.x = serverX;
        rs.y = serverY;
        rs.vx = 0;
        rs.vy = 0;
        rs.lastAt = performance.now();
        return;
      }

      // Simulate movement toward target using speed — exactly like owned units
      const tx = Number(u.targetX ?? u.x);
      const ty = Number(u.targetY ?? u.y);
      const toTX = tx - rs.x;
      const toTY = ty - rs.y;
      const toTLen = Math.hypot(toTX, toTY);
      const speed = Number(u.speed || 0);

      const desiredVX = (toTLen > TILE_SIZE * 0.1) ? (toTX / toTLen) * speed : 0;
      const desiredVY = (toTLen > TILE_SIZE * 0.1) ? (toTY / toTLen) * speed : 0;

      const accel = 12;
      const blend = 1 - Math.exp(-accel * dt);
      rs.vx += (desiredVX - rs.vx) * blend;
      rs.vy += (desiredVY - rs.vy) * blend;

      // Step forward
      rs.x += rs.vx * dt;
      rs.y += rs.vy * dt;

      // Gentle server correction — pull toward actual server position
      const errX = serverX - rs.x;
      const errY = serverY - rs.y;
      const err = Math.hypot(errX, errY);
      if (err > TILE_SIZE * 1.5) {
        // Hard snap if diverged too much
        rs.x = serverX;
        rs.y = serverY;
        rs.vx = 0;
        rs.vy = 0;
      } else if (err > 0.5) {
        const corr = 1 - Math.exp(-delta * 0.006);
        rs.x += errX * corr;
        rs.y += errY * corr;
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

    const firingRange = _isTank ? RTS_TANK_PROJECTILE_RANGE : RTS_SOLDIER_PROJECTILE_RANGE;
    const distToAtkTarget = atkTarget ? Math.hypot(Number(atkTarget.x) - s.x, Number(atkTarget.y) - s.y) : 99999;
    const inFiringRange = atkTarget && distToAtkTarget <= (firingRange * 0.95);

    if (isAutoEngaged && atkTarget && !inFiringRange) {
        tx = Number(atkTarget.x);
        ty = Number(atkTarget.y);
    }

    const nowMs = Date.now();
    const override = this.localUnitTargetOverride.get(id);
    if (override) {
      const prio = this.localUnitMovePriority.get(id) ?? 0;
      const groupSize = Math.max(1, this.localUnitTargetOverride.size);
      const delayStep = groupSize >= 20 ? 20 : groupSize >= 10 ? 16 : 12;
      const maxDelay = groupSize >= 20 ? 620 : groupSize >= 10 ? 420 : 220;
      const startDelay = Math.min(maxDelay, prio * delayStep);
      if (nowMs - override.setAt >= startDelay) {
        tx = override.x;
        ty = override.y;
      }
      const distToSlot = Math.hypot(override.x - s.x, override.y - s.y);
      if (distToSlot <= TILE_SIZE * 0.7) {
        // Arrived at slot — snap and hold position permanently
        this.localUnitGhostMode?.delete(String(id));
        if (Number(u.manualUntil || 0) > 0) u.manualUntil = 0;
        s.x = override.x;
        s.y = override.y;
        s.vx = 0;
        s.vy = 0;
        e.x = s.x;
        e.y = s.y;
        s.lastAt = performance.now();
        // Override stays active until a new command clears it
        return;
      }
    }
    const wp = this.getClientUnitWaypoint(
      id,
      { x: s.x, y: s.y, targetX: tx, targetY: ty },
      nowMs,
      this.localUnitBodyRadius(u),
    );
    let navX = Number(wp?.x ?? tx);
    let navY = Number(wp?.y ?? ty);

    // Soft repulsion between units (calculated later in this method) will naturally push units
    // apart without forcing them into a massive synchronized detour spiral.

    const toTX = navX - s.x;
    const toTY = navY - s.y;
    const toTLen = Math.hypot(toTX, toTY);
    const speed = Number(u.speed || 0);
    // A unit only stops moving for auto-engagement if it's actually in firing range
    const moving = toTLen > TILE_SIZE * 0.16 && speed > 1 && !(isAutoEngaged && inFiringRange);
    const desiredVX = moving ? (toTX / toTLen) * speed : 0;
    const desiredVY = moving ? (toTY / toTLen) * speed : 0;

    const accel = moving ? 16 : 10;
    const blend = 1 - Math.exp(-accel * dt);
    s.vx += (desiredVX - s.vx) * blend;
    s.vy += (desiredVY - s.vy) * blend;
    const r = this.localUnitBodyRadius(u);
    const stepX = s.vx * dt;
    const stepY = s.vy * dt;
    const nx = s.x + stepX;
    const ny = s.y + stepY;
    const uid = String(id);
    const producedExitGraceActive = Number(u.manualUntil || 0) > nowMs;
    if (producedExitGraceActive && Math.hypot(tx - s.x, ty - s.y) <= TILE_SIZE * 0.65) {
      u.manualUntil = 0;
    }
    const isGhost = (this.localUnitGhostMode?.has(uid) ?? false) || producedExitGraceActive;
    if (isGhost || this.canOccupyLocalUnit(nx, ny, r, uid)) {
      s.x = nx;
      s.y = ny;
    } else {
      let moved = false;
      if (isGhost || this.canOccupyLocalUnit(nx, s.y, r, uid)) {
        s.x = nx;
        moved = true;
      }
      if (isGhost || this.canOccupyLocalUnit(s.x, ny, r, uid)) {
        s.y = ny;
        moved = true;
      }
      if (!moved && (Math.abs(stepX) > 0.001 || Math.abs(stepY) > 0.001)) {
        const len = Math.hypot(stepX, stepY);
        const dirX = stepX / Math.max(0.001, len);
        const dirY = stepY / Math.max(0.001, len);
        const side = Math.min(TILE_SIZE * 0.26, len * 1.15);
        const lX = s.x - dirY * side;
        const lY = s.y + dirX * side;
        const rX = s.x + dirY * side;
        const rY = s.y - dirX * side;
        const canL = isGhost || this.canOccupyLocalUnit(lX, lY, r, uid);
        const canR = isGhost || this.canOccupyLocalUnit(rX, rY, r, uid);
        if (canL && canR) {
          const dL = Math.hypot(lX - navX, lY - navY);
          const dR = Math.hypot(rX - navX, rY - navY);
          if (dL <= dR) {
            s.x = lX;
            s.y = lY;
          } else {
            s.x = rX;
            s.y = rY;
          }
        } else if (canL) {
          s.x = lX;
          s.y = lY;
        } else if (canR) {
          s.x = rX;
          s.y = rY;
        } else {
          s.vx *= 0.2;
          s.vy *= 0.2;
        }
      } else if (!moved) {
        s.vx *= 0.2;
        s.vy *= 0.2;
      }

      // Track progress to detect jams even if the unit jitters.
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
          // We DO NOT cancel ghost mode here. If a unit was jammed enough to become a ghost,
          // let it glide smoothly all the way to its destination slot before re-solidifying.
          // Otherwise, it rapidly toggles solid->ghost->solid and explodes units apart violently.
        } else {
          const ticks = (this.localUnitJamTicks.get(uid) ?? 0) + 1;
          this.localUnitJamTicks.set(uid, ticks);
          if (ticks > 40) {
            if (!this.localUnitGhostMode) this.localUnitGhostMode = new Set<string>();
            this.localUnitGhostMode.add(uid);
          }
        }
      }
    }

    // Server error correction — always active, but gentler when unit has an override
    const hasOverride = this.localUnitTargetOverride.has(id);
    const errX = Number(u.x) - s.x;
    const errY = Number(u.y) - s.y;
    const err = Math.hypot(errX, errY);
    const unitR = this.localUnitBodyRadius(u);
    const unitType = String(u.type || "");
    const isClientDriven = isLocalOwned && this.isClientAuthoritativeUnitType(unitType);
    if (isClientDriven) {
      const movingNow = Math.hypot(s.vx, s.vy) > 8 || moving;
      if (!hasOverride && err > TILE_SIZE * 2.4) {
        const snapX = Number(u.x);
        const snapY = Number(u.y);
        if (isGhost || this.canOccupyLocalUnit(snapX, snapY, unitR, id)) {
          s.x = snapX;
          s.y = snapY;
          s.vx = 0;
          s.vy = 0;
        }
      } else if (!movingNow && !hasOverride && err > 8) {
        const corr = 1 - Math.exp(-delta * 0.0025);
        const newCX = s.x + errX * corr;
        const newCY = s.y + errY * corr;
        if (isGhost || this.canOccupyLocalUnit(newCX, newCY, unitR, id)) {
          s.x = newCX;
          s.y = newCY;
        }
      }
    } else if (!hasOverride && err > TILE_SIZE * 1.15) {
      // Hard snap only for non-override units — but check wall validity
      const snapX = Number(u.x);
      const snapY = Number(u.y);
      if (isGhost || this.canOccupyLocalUnit(snapX, snapY, unitR, id)) {
        s.x = snapX;
        s.y = snapY;
        s.vx = 0;
        s.vy = 0;
      }
    } else if (err > 0.5) {
      const movingNow = Math.hypot(s.vx, s.vy) > 8;
      // Gentler correction for overridden units to avoid fighting the override target
      const corr = hasOverride
        ? (1 - Math.exp(-delta * 0.002))
        : movingNow
          ? (1 - Math.exp(-delta * 0.004))
          : (1 - Math.exp(-delta * 0.012));
      const newCX = s.x + errX * corr;
      const newCY = s.y + errY * corr;
      // Only apply correction if result is not inside a wall
      if (isGhost || this.canOccupyLocalUnit(newCX, newCY, unitR, id)) {
        s.x = newCX;
        s.y = newCY;
      }
    }

    // Grace period: skip colliders for 800ms after movement command to prevent initial jamming
    const graceOverride = this.localUnitTargetOverride.get(id);
    const inGracePeriod = graceOverride && (Date.now() - graceOverride.setAt) < 800;

    // Soft repulsion between friendly units — push apart gently instead of blocking
    if (!isGhost && isLocalOwned && !inGracePeriod && this.room?.state?.units?.forEach) {
      const me = this.room.state.players?.get
        ? this.room.state.players.get(this.currentPlayerId)
        : this.room.state.players?.[this.currentPlayerId];
      const myTeam = me?.team;
      const myRadius = this.localUnitBodyRadius(u);
      let pushX = 0;
      let pushY = 0;
      let yieldingPairs = 0;
      this.room.state.units.forEach((ou: any, oid: string) => {
        if (oid === id) return;
        if ((ou.hp ?? 0) <= 0) return;
        if (myTeam && ou.team !== myTeam) return;
        const ors = this.localUnitRenderState.get(oid);
        const ox = Number(ors?.x ?? ou.x);
        const oy = Number(ors?.y ?? ou.y);
        const oRadius = this.localUnitBodyRadius(ou);
        const minDist = myRadius + oRadius;
        const yieldDist = minDist + TILE_SIZE * 0.14;
        const dx = s.x - ox;
        const dy = s.y - oy;
        const dist = Math.hypot(dx, dy);
        if (dist >= yieldDist || dist <= 0.01) return;
        if (!this.shouldYieldInPair(uid, String(oid))) return;

        const overlap = yieldDist - dist;
        const awayStrength = (dist < minDist ? 0.9 : 0.5) * overlap;
        pushX += (dx / dist) * awayStrength;
        pushY += (dy / dist) * awayStrength;
        yieldingPairs += 1;
      });
      if (yieldingPairs > 0 && Math.hypot(pushX, pushY) > 0.01) {
        const pushMag = Math.hypot(pushX, pushY);
        const maxPush = TILE_SIZE * 0.18;
        if (pushMag > maxPush) {
          const scale = maxPush / pushMag;
          pushX *= scale;
          pushY *= scale;
        }
        const newX = s.x + pushX;
        const newY = s.y + pushY;
        if (this.canOccupyLocalUnit(newX, newY, myRadius, id)) {
          s.x = newX;
          s.y = newY;
        } else if (this.canOccupyLocalUnit(s.x + pushX, s.y, myRadius, id)) {
          s.x += pushX;
        } else if (this.canOccupyLocalUnit(s.x, s.y + pushY, myRadius, id)) {
          s.y += pushY;
        }
        s.vx *= 0.7;
        s.vy *= 0.7;
      }
    }

    // Wall repulsion — ALWAYS active for all units to prevent sticking to buildings
    // Bypassed if in Ghost Mode
    if (!isGhost) {
      const wallCheckR = Math.max(TILE_SIZE * 0.46, this.localUnitBodyRadius(u) + TILE_SIZE * 0.24);
      const gx = Math.floor(s.x / TILE_SIZE);
      const gy = Math.floor(s.y / TILE_SIZE);
      let wallPX = 0;
      let wallPY = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const cx = gx + dx;
          const cy = gy + dy;
          if (this.tileAt(cx, cy) !== 0 || this.hasStructureAt(cx, cy) || this.hasCoreAt(cx, cy)) {
            const tileCX = (cx + 0.5) * TILE_SIZE;
            const tileCY = (cy + 0.5) * TILE_SIZE;
            const wdx = s.x - tileCX;
            const wdy = s.y - tileCY;
            const wdist = Math.hypot(wdx, wdy);
            if (wdist < wallCheckR && wdist > 0.01) {
              const overlap = wallCheckR - wdist;
              wallPX += (wdx / wdist) * overlap * 1.2;
              wallPY += (wdy / wdist) * overlap * 1.2;
            }
          }
        }
      }
      if (Math.hypot(wallPX, wallPY) > 0.01) {
        s.x += wallPX;
        s.y += wallPY;
      }
    }

    e.x = s.x;
    e.y = s.y;
    s.lastAt = performance.now();
  }

  drawFormationPreview(now: number) {
    if (!this.formationPreviewGraphics) {
      this.formationPreviewGraphics = this.add.graphics().setDepth(19);
    }
    const g = this.formationPreviewGraphics;
    g.clear();

    this.reflowFormationAssignments(now);

    // --- Always-on slot+path debug: shows orange circle at target slot + path line for each owned unit ---
    const me = this.room?.state?.players?.get
      ? this.room.state.players.get(this.currentPlayerId)
      : this.room?.state?.players?.[this.currentPlayerId];
    const myTeam = me?.team;
    if (this.localUnitTargetOverride.size > 0 && this.room?.state?.units?.forEach) {
      this.room.state.units.forEach((u: any, unitId: string) => {
        if ((u.hp ?? 0) <= 0) return;
        // Show for ALL units on my team (not just ownerId match - produced units have different ownerId)
        if (!myTeam || u.team !== myTeam) return;
        let sx: number, sy: number;
        const override = this.localUnitTargetOverride.get(unitId);
        if (override) {
          sx = override.x;
          sy = override.y;
        } else if (u.aiState === "walking" && Number.isFinite(u.targetX) && Number.isFinite(u.targetY)) {
          sx = Number(u.targetX);
          sy = Number(u.targetY);
        } else {
          // Neither an override nor a server-commanded walk is occurring
          return;
        }

        const rs = this.localUnitRenderState.get(unitId);
        const ux = Number(rs?.x ?? u.x);
        const uy = Number(rs?.y ?? u.y);
        if (Math.hypot(sx - ux, sy - uy) < TILE_SIZE * 0.4) return; // Arrived — hide
        // Target slot: orange ring + cross
        g.lineStyle(2, 0xff8800, 0.9);
        g.strokeCircle(sx, sy, TILE_SIZE * 0.28);
        g.fillStyle(0xff8800, 0.1);
        g.fillCircle(sx, sy, TILE_SIZE * 0.28);
        const cs = 5;
        g.lineStyle(1.5, 0xff8800, 0.85);
        g.beginPath(); g.moveTo(sx - cs, sy); g.lineTo(sx + cs, sy); g.strokePath();
        g.beginPath(); g.moveTo(sx, sy - cs); g.lineTo(sx, sy + cs); g.strokePath();
        // Path to slot
        const cache = this.unitClientPathCache.get(unitId);
        if (cache && cache.cells.length > 0) {
          g.lineStyle(1.2, 0xffaa33, 0.45);
          g.beginPath();
          g.moveTo(ux, uy);
          for (let ci = cache.idx; ci < cache.cells.length; ci++) {
            const c = cache.cells[ci];
            g.lineTo(c.x * TILE_SIZE + TILE_SIZE / 2, c.y * TILE_SIZE + TILE_SIZE / 2);
          }
          g.lineTo(sx, sy);
          g.strokePath();
        } else {
          g.lineStyle(1.2, 0xffaa33, 0.38);
          g.beginPath(); g.moveTo(ux, uy); g.lineTo(sx, sy); g.strokePath();
        }
      });
    }
    // --- End slot+path debug overlay ---

    if (this.formationPreviewSlots.length === 0 || now > this.formationPreviewUntil) return;

    // Fade out in the last 1.5s
    const fadeStart = this.formationPreviewUntil - 1500;
    const alpha = now > fadeStart ? Math.max(0, (this.formationPreviewUntil - now) / 1500) : 1;

    if (this.formationPreviewCenter) {
      const cx = this.formationPreviewCenter.x;
      const cy = this.formationPreviewCenter.y;
      g.lineStyle(2, 0x7fffe4, 0.9 * alpha);
      g.strokeCircle(cx, cy, 14);
      g.lineStyle(1.25, 0x7fffe4, 0.5 * alpha);
      g.strokeCircle(cx, cy, 22);
      g.beginPath();
      g.moveTo(cx - 7, cy);
      g.lineTo(cx + 7, cy);
      g.strokePath();
      g.beginPath();
      g.moveTo(cx, cy - 7);
      g.lineTo(cx, cy + 7);
      g.strokePath();
    }

    // Draw grid slot markers
    for (const slot of this.formationPreviewSlots) {
      g.lineStyle(1.5, 0x00ffcc, 0.45 * alpha);
      g.strokeCircle(slot.x, slot.y, slot.r);
      g.fillStyle(0x00ffcc, 0.08 * alpha);
      g.fillCircle(slot.x, slot.y, slot.r);
      // Small cross at center
      const cs = 4;
      g.lineStyle(1, 0x00ffcc, 0.55 * alpha);
      g.beginPath();
      g.moveTo(slot.x - cs, slot.y);
      g.lineTo(slot.x + cs, slot.y);
      g.strokePath();
      g.beginPath();
      g.moveTo(slot.x, slot.y - cs);
      g.lineTo(slot.x, slot.y + cs);
      g.strokePath();
    }

    // Draw path lines from each unit to its assigned slot
    for (const [unitId, slotPos] of this.formationPreviewAssignments.entries()) {
      const rs = this.localUnitRenderState.get(unitId);
      const u = this.room?.state?.units?.get ? this.room.state.units.get(unitId) : this.room?.state?.units?.[unitId];
      if (!u || (u.hp ?? 0) <= 0) continue;
      const ux = Number(rs?.x ?? u.x);
      const uy = Number(rs?.y ?? u.y);
      const dist = Math.hypot(slotPos.x - ux, slotPos.y - uy);

      // If arrived, don't draw the line
      if (dist < TILE_SIZE * 0.5) continue;

      // Try to draw along the A* path if available
      const cache = this.unitClientPathCache.get(unitId);
      if (cache && cache.cells.length > 0) {
        // Draw path segments
        g.lineStyle(1.2, 0x00ffcc, 0.35 * alpha);
        g.beginPath();
        g.moveTo(ux, uy);
        for (let ci = cache.idx; ci < cache.cells.length; ci++) {
          const c = cache.cells[ci];
          g.lineTo(c.x * TILE_SIZE + TILE_SIZE / 2, c.y * TILE_SIZE + TILE_SIZE / 2);
        }
        // Final segment to the slot
        g.lineTo(slotPos.x, slotPos.y);
        g.strokePath();
      } else {
        // Fallback: straight line
        g.lineStyle(1.2, 0x00ffcc, 0.3 * alpha);
        g.beginPath();
        g.moveTo(ux, uy);
        g.lineTo(slotPos.x, slotPos.y);
        g.strokePath();
      }

      // Small arrow head at slot
      const dx = slotPos.x - ux;
      const dy = slotPos.y - uy;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        const nx = dx / len;
        const ny = dy / len;
        const arrowLen = 6;
        const tipX = slotPos.x;
        const tipY = slotPos.y;
        g.fillStyle(0x00ffcc, 0.5 * alpha);
        g.fillTriangle(
          tipX, tipY,
          tipX - nx * arrowLen - ny * arrowLen * 0.5, tipY - ny * arrowLen + nx * arrowLen * 0.5,
          tipX - nx * arrowLen + ny * arrowLen * 0.5, tipY - ny * arrowLen - nx * arrowLen * 0.5
        );
      }
    }
  }

}

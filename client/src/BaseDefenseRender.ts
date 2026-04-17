import Phaser from "phaser";
import { Room } from "colyseus.js";
import { DISPLAY_BUILD_NUMBER } from "./build-meta";
import { client, CLIENT_BUNDLE_VERSION, activeClientBuildId } from "./network";
import {
  TILE_SIZE, RTS_GROUND_TILE_SCALE, RTS_BLOCK_TEXTURE_KEYS, RTS_INTERIOR_WALL_VISUAL_SCALE,
  RTS_BUILDING_TEXTURE_KEYS, RTS_UI_TEXTURE_KEYS, RTS_TANK_TEXTURE_KEYS, RTS_TANK_TEXTURE_BY_DIR,
  RTS_SOLDIER_SPRITESHEET_KEYS, RTS_SOLDIER_RUN_FRAME_COLS, RTS_SOLDIER_SHOOT_FRAME_COLS,
  RTS_SOLDIER_ROW_BY_DIR, RTS_SOLDIER_IDLE_FRAME,
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
import { BaseDefenseScene_Movement } from "./BaseDefenseMovement";
import { RTS_TANK_SPRITE_META } from "./tankSpriteMeta";
import { getGraphicsQuality, getGraphicsProfile, getGroundTileScale } from "./graphicsQuality";

export class BaseDefenseScene_Render extends BaseDefenseScene_Movement {
  syncWorldBackground(width: number, height: number) {
    // Build 284: Windowed background optimization. Use a fixed 3000px buffer to save GPU fill rate on large maps.
    const bufferSize = 3000;
    const targetW = Math.min(width, bufferSize);
    const targetH = Math.min(height, bufferSize);

    const needsRefresh = !this.groundTileSprite
      || this.groundTileSprite.width !== targetW
      || this.groundTileSprite.height !== targetH;
    
    if (!needsRefresh) return;

    this.groundTileSprite?.destroy();
    this.groundTintOverlay?.destroy();

    const tier = getGraphicsProfile(getGraphicsQuality()).worldTier;
    const tileScale = getGroundTileScale(tier);

    this.groundTileSprite = this.add.tileSprite(0, 0, targetW, targetH, this.getGroundTextureKey())
      .setOrigin(0)
      .setDepth(-120)
      .setTileScale(tileScale)
      .setAlpha(0.98);
      
    this.groundTintOverlay = this.add.rectangle(targetW / 2, targetH / 2, targetW, targetH, 0xd8e7f5, 0.06)
      .setDepth(-110);
  }

  updateWorldBackground(camX: number, camY: number) {
    if (!this.groundTileSprite) return;
    const state = this.room?.state;
    if (!state) return;

    const worldW = state.mapWidth * TILE_SIZE;
    const worldH = state.mapHeight * TILE_SIZE;
    
    // Snap sprite to camera, allowing it to "window" the world
    const tier = getGraphicsProfile(getGraphicsQuality()).worldTier;
    const tileScale = getGroundTileScale(tier);
    
    // Position sprite to cover the camera area, but clamp to world bounds
    const screenW = this.cameras.main.width;
    const screenH = this.cameras.main.height;
    
    // Center the 3000px sprite on the camera
    let posX = camX - (this.groundTileSprite.width - screenW) / 2;
    let posY = camY - (this.groundTileSprite.height - screenH) / 2;
    
    // Ensure we don't bleed outside the world boundaries
    posX = Phaser.Math.Clamp(posX, 0, Math.max(0, worldW - this.groundTileSprite.width));
    posY = Phaser.Math.Clamp(posY, 0, Math.max(0, worldH - this.groundTileSprite.height));
    
    this.groundTileSprite.setPosition(posX, posY);
    if (this.groundTintOverlay) this.groundTintOverlay.setPosition(posX + this.groundTileSprite.width/2, posY + this.groundTileSprite.height/2);

    // KEY FIX: Offset the tile position by the sprite's world position 
    // to keep the underlying repeating texture locked to world coordinate (0,0).
    // This eliminates the "jitter" observed in previous windowed attempts.
    this.groundTileSprite.setTilePosition(posX / tileScale, posY / tileScale);
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
    return this.getTankBodyTextureKey();
  }

  getTankBaseTextureKeyByDir(dir: number) {
    return RTS_TANK_TEXTURE_BY_DIR[dir] ?? RTS_TANK_TEXTURE_KEYS.e;
  }

  getTankBodyTextureKey() {
    return this.getTankTextureKey("tank_body_sheet");
  }

  getTankTurretTextureKey() {
    return this.getTankTextureKey("tank_turret_sheet");
  }

  getTankFrameByDir(dir: number) {
    const d8 = (dir >= 0 && dir <= 7 && Number.isInteger(dir)) ? dir : this.angleToDir8(dir);
    const frameByDir = [7, 6, 5, 4, 3, 2, 1, 0];
    return frameByDir[d8] ?? 3;
  }

  getSoldierSheetRowByDir(dir: number) {
    const d8 = (dir >= 0 && dir <= 7 && Number.isInteger(dir)) ? dir : this.angleToDir8(dir);
    return RTS_SOLDIER_ROW_BY_DIR[d8] ?? RTS_SOLDIER_ROW_BY_DIR[0];
  }

  getSoldierAnimKey(action: "idle" | "run" | "shoot", dir: number) {
    const d8 = (dir >= 0 && dir <= 7 && Number.isInteger(dir)) ? dir : this.angleToDir8(dir);
    return `soldier_${action}_${d8}_${this.getGraphicsProfile().unitTier}`;
  }

  getSoldierIdleFrame(dir: number) {
    return this.getSoldierSheetRowByDir(dir) * RTS_SOLDIER_RUN_FRAME_COLS + RTS_SOLDIER_IDLE_FRAME;
  }

  ensureSoldierAnimations() {
    for (let dir = 0; dir < 8; dir++) {
      const runRowStart = this.getSoldierSheetRowByDir(dir) * RTS_SOLDIER_RUN_FRAME_COLS;
      const runKey = this.getSoldierAnimKey("run", dir);
      if (!this.anims.exists(runKey)) {
        this.anims.create({
          key: runKey,
          frames: this.anims.generateFrameNumbers(this.getSoldierSheetTextureKey("run"), {
            start: runRowStart,
            end: runRowStart + RTS_SOLDIER_RUN_FRAME_COLS - 1,
          }),
          frameRate: 22.46,
          repeat: -1,
        });
      }
      const shootRowStart = this.getSoldierSheetRowByDir(dir) * RTS_SOLDIER_SHOOT_FRAME_COLS;
      const shootKey = this.getSoldierAnimKey("shoot", dir);
      if (!this.anims.exists(shootKey)) {
        this.anims.create({
          key: shootKey,
          frames: this.anims.generateFrameNumbers(this.getSoldierSheetTextureKey("shoot"), {
            start: shootRowStart,
            end: shootRowStart + RTS_SOLDIER_SHOOT_FRAME_COLS - 1,
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

  getTankSpritePoint(entity: Phaser.GameObjects.Image, normalizedX: number, normalizedY: number) {
    return {
      x: entity.x + (normalizedX - entity.originX) * entity.displayWidth,
      y: entity.y + (normalizedY - entity.originY) * entity.displayHeight,
    };
  }

  getTankSpriteMeta(dir: number) {
    return RTS_TANK_SPRITE_META[this.getTankBaseTextureKeyByDir(dir)];
  }

  getTankTrailAnchor(entity: Phaser.GameObjects.Image, dir: number) {
    const meta = this.getTankSpriteMeta(dir);
    return this.getTankSpritePoint(entity, meta.rearX, meta.rearY);
  }

  getTankBodyCenter(entity: Phaser.GameObjects.Image, dir: number) {
    const meta = this.getTankSpriteMeta(dir);
    return this.getTankSpritePoint(entity, meta.centerX, meta.centerY);
  }

  getTankShadowPosition(entity: Phaser.GameObjects.Image, dir: number) {
    const bodyCenter = this.getTankBodyCenter(entity, dir);
    const meta = this.getTankSpriteMeta(dir);
    return {
      x: bodyCenter.x - (meta.centerX - entity.originX) * entity.displayWidth + entity.displayWidth * 0.08,
      y: bodyCenter.y - (meta.centerY - entity.originY) * entity.displayHeight + entity.displayHeight * 0.1,
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
      y: this.getSpriteTopY(entity) + entity.displayHeight * 0.74,
      width: entity.displayWidth * 0.42,
      height: entity.displayHeight * 0.14,
    };
  }

  getSoldierHpY(entity: Phaser.GameObjects.Sprite) {
    return this.getSpriteTopY(entity) - 8;
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

  spawnTankTrail(entity: Phaser.GameObjects.Image, angleRad: number, dir: number) {
    const dirX = Math.cos(angleRad);
    const dirY = Math.sin(angleRad);
    const perpX = -dirY;
    const perpY = dirX;
    const trailAnchor = this.getTankTrailAnchor(entity, dir);
    const centerX = trailAnchor.x;
    const centerY = trailAnchor.y;
    const gap = Math.max(RTS_TANK_TRAIL_GAP, entity.displayWidth * this.getTankSpriteMeta(dir).trailHalfGap);
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

  updateTankTrailForUnit(id: string, entity: Phaser.GameObjects.Image, visible: boolean, dir: number) {
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
        this.spawnTankTrail(entity, Math.atan2(dy, dx), dir);
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


  ensureTankTextures() {
  }

  drawFormationPreview(now: number) {
    if (!this.formationPreviewGraphics) {
      // Build 225: Elevated depth (300) to ensure visibility above Fog of War (240)
      this.formationPreviewGraphics = this.add.graphics().setDepth(300);
    }
    const g = this.formationPreviewGraphics;
    g.clear();

    const me = this.room?.state?.players?.get
      ? this.room.state.players.get(this.currentPlayerId)
      : this.room?.state?.players?.[this.currentPlayerId];
    const myTeam = me?.team;

    // Build 225: If multiple units are selected, show one summary line instead of many individual paths
    const isGroupSelected = this.selectedUnitIds.size > 1;

    if ((this.localUnitTargetOverride.size > 0 || this.localUnitFollowState.size > 0) && this.room?.state?.units?.forEach) {
      let groupUX = 0, groupUY = 0, groupCount = 0;
      let targetCenterSumX = 0, targetCenterSumY = 0;

      this.room.state.units.forEach((u: any, unitId: string) => {
        if ((u.hp ?? 0) <= 0) return;
        // Show for ALL units on my team (not just ownerId match - produced units have different ownerId)
        if (!myTeam || u.team !== myTeam) return;
        let sx: number, sy: number;
        const manualTarget = this.getLocalUnitManualTarget(unitId);
        if (manualTarget) {
          sx = manualTarget.finalX;
          sy = manualTarget.finalY;
        } else if (u.aiState === "walking" && Number.isFinite(u.targetX) && Number.isFinite(u.targetY)) {
          sx = Number(u.targetX);
          sy = Number(u.targetY);
        } else {
          return;
        }

        const rs = this.localUnitRenderState.get(unitId);
        const ux = Number(rs?.x ?? u.x);
        const uy = Number(rs?.y ?? u.y);

        // Build 228: Optimization — Skip individual drawing if unit not selected AND detailed paths are off.
        // This is the biggest win for 200 units moving simultaneously.
        const isSelected = this.selectedUnitIds.has(unitId);
        if (!isSelected && !this.showDetailedPaths) return;

        if (isGroupSelected && isSelected) {
           groupUX += ux; groupUY += uy; groupCount++;
           targetCenterSumX += sx; targetCenterSumY += sy;
           return; // Skip individual drawing for group members
        }

        if (Math.hypot(sx - ux, sy - uy) < TILE_SIZE * 0.4) return; // Arrived — hide
        
        // Build 234: Individual target slots (orange rounds) are now HIDDEN to reduce clutter.
        /*
        g.lineStyle(2, 0xff8800, 0.9);
        g.strokeCircle(sx, sy, TILE_SIZE * 0.28);
        g.fillStyle(0xff8800, 0.1);
        g.fillCircle(sx, sy, TILE_SIZE * 0.28);
        const cs = 5;
        g.lineStyle(1.5, 0xff8800, 0.85);
        g.beginPath(); g.moveTo(sx - cs, sy); g.lineTo(sx + cs, sy); g.strokePath();
        g.beginPath(); g.moveTo(sx, sy - cs); g.lineTo(sx, sy + cs); g.strokePath();
        */
        
        // Build 235: Only show detailed paths (orange) if explicitly toggled on (debug mode).
        // Selection alone no longer shows them to keep the UI clean.
        if (this.showDetailedPaths) {
          const cache = this.unitClientPathCache.get(unitId);
          if (cache && cache.cells.length > 0) {
            g.lineStyle(2.5, 0xff7733, 0.8);
            g.beginPath();
            g.moveTo(ux, uy);
            for (let ci = cache.idx; ci < cache.cells.length; ci++) {
              const c = cache.cells[ci];
              g.lineTo(c.x * TILE_SIZE + TILE_SIZE / 2, c.y * TILE_SIZE + TILE_SIZE / 2);
            }
            g.lineTo(sx, sy);
            g.strokePath();
          } else {
            g.lineStyle(2.5, 0xff7733, 0.7);
            g.beginPath(); g.moveTo(ux, uy); g.lineTo(sx, sy); g.strokePath();
          }
        }
      });

      // Build 234: Single persistent guide line for the entire group
      if (this.groupFinalTarget) {
        // Calculate the center of the squad being commanded
        let squadX = 0, squadY = 0, commandedCount = 0;
        for (const id of this.lastCommandedUnitIds) {
           const u = this.room?.state?.units?.[id];
           if (u && (u.hp || 0) > 0) {
             const s = this.localUnitRenderState.get(id);
             squadX += (s?.x ?? u.x ?? 0);
             squadY += (s?.y ?? u.y ?? 0);
             commandedCount++;
           }
        }
        
        if (commandedCount > 0) {
          const avgX = squadX / commandedCount;
          const avgY = squadY / commandedCount;
          const finalTX = this.groupFinalTarget.x;
          const finalTY = this.groupFinalTarget.y;
          
          if (Math.hypot(finalTX - avgX, finalTY - avgY) > TILE_SIZE * 1.5) {
            // Draw a single bright line to the ultimate destination
            g.lineStyle(4.5, 0x00ccaa, 0.85); // Darker, thicker Cyan guide line
            g.beginPath();
            g.moveTo(avgX, avgY);
            g.lineTo(finalTX, finalTY);
            g.strokePath();
            // Destination crosshair (Build 236: Removed to simplify UI)
            /*
            g.lineStyle(1.5, 0x00ffcc, 0.8);
            g.strokeCircle(finalTX, finalTY, 8);
            g.beginPath(); g.moveTo(finalTX - 12, finalTY); g.lineTo(finalTX + 12, finalTY); g.strokePath();
            g.beginPath(); g.moveTo(finalTX, finalTY - 12); g.lineTo(finalTX, finalTY + 12); g.strokePath();
            */
          }
        }
      }
    }
    // --- End slot+path debug overlay ---

    if (this.formationPreviewSlots.length === 0 || now > this.formationPreviewUntil) return;

    // Fade out in the last 1.5s
    const fadeStart = this.formationPreviewUntil - 1500;
    const alpha = now > fadeStart ? Math.max(0, (this.formationPreviewUntil - now) / 1500) : 1;

    // Build 225: Simplified group preview — only show center marker and destination dots
    // (We skip individual assignment lines from group center to reduce clutter)
    if (this.formationPreviewCenter) {
      const cx = this.formationPreviewCenter.x;
      const cy = this.formationPreviewCenter.y;
      g.lineStyle(2, 0x7fffe4, 0.9 * alpha);
      g.strokeCircle(cx, cy, 14);
      g.lineStyle(1.25, 0x7fffe4, 0.5 * alpha);
      g.strokeCircle(cx, cy, 22);
    }

    // Draw grid slot markers (Build 236: Removed to simplify UI)
    /*
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
    */


    // Build 226: Assignment lines (transient) - only show if toggled on
    if (this.showDetailedPaths) {
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
          g.lineStyle(2.5, 0x00ccaa, 0.7 * alpha);
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
          g.lineStyle(2.5, 0x00ccaa, 0.6 * alpha);
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
          g.fillStyle(0x00ccaa, 0.8 * alpha);
          g.fillTriangle(
            tipX, tipY,
            tipX - nx * arrowLen - ny * arrowLen * 0.5, tipY - ny * arrowLen + nx * arrowLen * 0.5,
            tipX - nx * arrowLen + ny * arrowLen * 0.5, tipY - ny * arrowLen - nx * arrowLen * 0.5
          );
        }
      }
    }
  }
}

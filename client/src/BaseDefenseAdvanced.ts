import Phaser from "phaser";
import { Room } from "colyseus.js";
import { DISPLAY_BUILD_NUMBER } from "./build-meta";
import { client, CLIENT_BUNDLE_VERSION, activeClientBuildId } from "./network";
import {
  TILE_SIZE, RTS_GROUND_TILE_SCALE, RTS_BLOCK_TEXTURE_KEYS, RTS_INTERIOR_WALL_VISUAL_SCALE,
  RTS_BUILDING_TEXTURE_KEYS, RTS_UI_TEXTURE_KEYS, RTS_TANK_TEXTURE_KEYS, RTS_TANK_TEXTURE_BY_DIR,
  RTS_SOLDIER_SPRITESHEET_KEYS, RTS_SOLDIER_RUN_FRAME_SIZE, RTS_SOLDIER_SHOOT_FRAME_SIZE,
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
import { BaseDefenseScene_Hud } from "./BaseDefenseHud";
import {
  getAssetBasePath,
  getGraphicsQuality,
  getSoldierRunFrameSize,
  getSoldierShootFrameSize,
  getTieredTextureKey,
  shouldRoundPixels,
} from "./graphicsQuality";
import { ensureSoldierEntity, syncSoldierRuntime } from "./BaseDefenseSoldierRuntime";
import { ensureTankEntity, syncTankRuntime } from "./BaseDefenseTankRuntime";

export class BaseDefenseScene_Advanced extends BaseDefenseScene_Hud {
  public tankTrailState = new Map<string, any>();
  protected unitAutoRallied?: Set<string>;
  protected lastDefensiveSlotRefreshAt = 0;

  constructor() {
    super("BaseDefenseScene_Advanced");
  }

  init(data?: { localOnly?: boolean }) {
    this.localOnly = data?.localOnly ?? false;
  }

  preload() {
    // Load ONLY the currently active quality tier.
    // Previously all 4 tiers were loaded simultaneously (4× VRAM waste).
    // A quality change triggers a full page reload (window.location.reload)
    // so the new tier and its associated render settings (antialias, fps, etc.)
    // are applied correctly from main.ts at Phaser game creation time.
    const tier = getGraphicsQuality();
    const path = getAssetBasePath(tier);
    const soldierRunFrameSize = getSoldierRunFrameSize(tier);
    const soldierShootFrameSize = getSoldierShootFrameSize(tier);

    this.load.image(getTieredTextureKey("rts_ground", tier), `${path}/rts_ground_texture_winter.png`);
    this.load.image(getTieredTextureKey("rts_button_base", tier), `${path}/rts_button_base.png`);
    this.load.image(getTieredTextureKey("rts_button_active", tier), `${path}/rts_button_active.png`);
    RTS_BLOCK_TEXTURE_KEYS.forEach(key => {
      this.load.image(getTieredTextureKey(key, tier), `${path}/blocks/${key}.png`);
    });
    this.load.image(getTieredTextureKey(RTS_BUILDING_TEXTURE_KEYS.constructor, tier), `${path}/buildings/constructor.png`);
    this.load.image(getTieredTextureKey(RTS_BUILDING_TEXTURE_KEYS.ore_refinery, tier), `${path}/buildings/ore_refinery.png`);
    this.load.image(getTieredTextureKey(RTS_BUILDING_TEXTURE_KEYS.solar_panel, tier), `${path}/buildings/solar_panel.png`);
    this.load.image(getTieredTextureKey(RTS_BUILDING_TEXTURE_KEYS.barracks, tier), `${path}/buildings/barracks.png`);
    this.load.image(getTieredTextureKey(RTS_BUILDING_TEXTURE_KEYS.war_factory, tier), `${path}/buildings/war_factory.png`);

    this.load.image(getTieredTextureKey(RTS_TANK_TEXTURE_KEYS.n, tier), `${path}/tanks/tank_ready_n.png`);
    this.load.image(getTieredTextureKey(RTS_TANK_TEXTURE_KEYS.ne, tier), `${path}/tanks/tank_ready_ne.png`);
    this.load.image(getTieredTextureKey(RTS_TANK_TEXTURE_KEYS.e, tier), `${path}/tanks/tank_ready_e.png`);
    this.load.image(getTieredTextureKey(RTS_TANK_TEXTURE_KEYS.se, tier), `${path}/tanks/tank_ready_se.png`);
    this.load.image(getTieredTextureKey(RTS_TANK_TEXTURE_KEYS.s, tier), `${path}/tanks/tank_ready_s.png`);
    this.load.image(getTieredTextureKey(RTS_TANK_TEXTURE_KEYS.sw, tier), `${path}/tanks/tank_ready_sw.png`);
    this.load.image(getTieredTextureKey(RTS_TANK_TEXTURE_KEYS.w, tier), `${path}/tanks/tank_ready_w.png`);
    this.load.image(getTieredTextureKey(RTS_TANK_TEXTURE_KEYS.nw, tier), `${path}/tanks/tank_ready_nw.png`);

    this.load.spritesheet(getTieredTextureKey(RTS_SOLDIER_SPRITESHEET_KEYS.run, tier), `${path}/soldier/run.png`, {
      frameWidth: soldierRunFrameSize,
      frameHeight: soldierRunFrameSize,
    });
    this.load.spritesheet(getTieredTextureKey(RTS_SOLDIER_SPRITESHEET_KEYS.shoot, tier), `${path}/soldier/shoot.png`, {
      frameWidth: soldierShootFrameSize,
      frameHeight: soldierShootFrameSize,
    });

    this.load.image(RTS_UI_TEXTURE_KEYS.move_target_marker, "assets/ui/move_target_marker.svg");
  }

  applyNextGraphicsQuality() {
    this.showNotice("Graphics fixed to Ultra", "#ffd27a");
  }

  refreshGraphicsPresentation() {
    const state = this.room?.state;
    if (!state || !this.hasInitialized) return;
    this.syncWorldBackground(state.mapWidth * TILE_SIZE, state.mapHeight * TILE_SIZE);
    this.syncMap();
    this.mapSyncPending = false;
    for (const entity of Object.values(this.playerEntities)) {
        if (entity instanceof Phaser.GameObjects.Image) {
          entity.setTexture(this.getBuildingTextureKey(RTS_BUILDING_TEXTURE_KEYS.constructor));
      } else if (entity instanceof Phaser.GameObjects.Sprite) {
        entity.stop();
        entity.setTexture(this.getSoldierSheetTextureKey("run"), this.getSoldierIdleFrame(2));
      }
    }
    for (const [id, entity] of Object.entries(this.structureEntities)) {
      if (!(entity instanceof Phaser.GameObjects.Image)) continue;
      const structure = state.structures?.get ? state.structures.get(id) : state.structures?.[id];
      const artSpec = structure ? this.getStructureArtSpec(String(structure.type || "")) : null;
      if (artSpec?.textureKey) entity.setTexture(artSpec.textureKey);
    }
    for (const [id, entity] of Object.entries(this.unitEntities)) {
      const unit = state.units?.get ? state.units.get(id) : state.units?.[id];
      if (!unit) continue;
      if (entity instanceof Phaser.GameObjects.Image && unit.type === "tank") {
        entity.setTexture(this.getTankTextureKeyByDir(this.unitFacing.get(id) ?? Number(unit.dir || 0)));
      } else if (entity instanceof Phaser.GameObjects.Sprite && unit.type === "soldier") {
        const dir = this.unitFacing.get(id) ?? Number(unit.dir || 0);
        entity.stop();
        entity.setTexture(this.getSoldierSheetTextureKey("run"), this.getSoldierIdleFrame(dir));
      }
    }
  }

  async create() {
    this.clientClockStartedAt = Date.now();
    this.ensureSoldierAnimations();
    this.cameras.main.setRoundPixels(shouldRoundPixels(getGraphicsQuality()));
    this.input.addPointer(2);
    document.body.style.overscrollBehavior = "none";
    const canvas = this.game.canvas;
    if (canvas) canvas.style.touchAction = "none";
    this.gestureBlockHandler = (event: Event) => {
      event.preventDefault();
    };
    window.addEventListener("gesturestart", this.gestureBlockHandler as EventListener, { passive: false });
    window.addEventListener("gesturechange", this.gestureBlockHandler as EventListener, { passive: false });
    window.addEventListener("gestureend", this.gestureBlockHandler as EventListener, { passive: false });
    this.cameras.main.setBackgroundColor(0x121212);

    this.syncWorldBackground(40 * TILE_SIZE, 40 * TILE_SIZE);

    const loading = this.add.text(this.cameras.main.centerX, this.cameras.main.centerY, "Joining Base Defense...", {
      fontSize: "28px",
      color: "#fff",
      fontFamily: "Arial",
    }).setOrigin(0.5).setDepth(200);
    this.clientClockText = this.add.text(this.cameras.main.centerX, this.cameras.main.centerY + 68, "CLIENT 00:00 ●", {
      fontSize: "24px",
      color: "#ffffff",
      fontFamily: "Arial",
      backgroundColor: "#00000088",
      fontStyle: "bold",
    }).setPadding(8).setScrollFactor(0).setDepth(206).setOrigin(0.5).setVisible(false);
    this.layoutClientClock();
    this.createClientClockDom();
    const preInitDebug = this.add.text(12, 12, "BaseDefense scene booting...", {
      fontSize: "15px",
      color: "#ffffff",
      fontFamily: "Arial",
      backgroundColor: "#000000aa",
      wordWrap: { width: Math.max(220, this.cameras.main.width - 24), useAdvancedWrap: true },
    }).setPadding(8).setScrollFactor(0).setDepth(205).setVisible(false);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys("W,A,S,D") as { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
    this.keyE = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.key1 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ONE);
    this.key2 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.TWO);
    this.key3 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.THREE);
    this.key4 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR);
    this.keyB = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.B);
    this.keyQ = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.keyT = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.T);
    this.keyH = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.H);
    this.keyShift = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.keyR = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.keyF = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.keyF10 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F10);
    this.keyEsc = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.keyL = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.L);
    this.input.mouse?.disableContextMenu();

    this.cameras.main.setBackgroundColor(0x1f5f1f);
    this.muzzlePool = this.add.group({ classType: Phaser.GameObjects.Arc, maxSize: 50 });
    this.projectilePool = this.add.group({ classType: Phaser.GameObjects.Arc, maxSize: 120 });
    this.setupBaseDefenseRuntimeUi();

    const finishWorldInit = () => {
      const state = this.room?.state;
      if (this.hasInitialized || !this.hasReadyWorldState(state)) return;
      try {
        this.initializeWorld();
        this.worldInitRetryTimer?.remove(false);
        this.worldInitRetryTimer = null;
        loading.destroy();
        preInitDebug.destroy();
      } catch (error) {
        console.error("BaseDefenseScene_Advanced initializeWorld failed", error);
      }
    };
    const ensureWorldInitRetry = () => {
      if (this.worldInitRetryTimer || this.hasInitialized) return;
      this.worldInitRetryTimer = this.time.addEvent({
        delay: 300,
        loop: true,
        callback: () => {
          finishWorldInit();
          if (this.hasInitialized) {
            this.worldInitRetryTimer?.remove(false);
            this.worldInitRetryTimer = null;
          }
        },
      });
    };
    if (this.localOnly) {
      const localRoom = this.createLocalBaseDefenseRoom();
      this.setupRoom(localRoom, finishWorldInit);
      finishWorldInit();
    } else {
      try {
        const initialRoom = await this.withTimeout(client.joinOrCreate("base_defense_room"), 8000, "joinOrCreate");
        this.setupRoom(initialRoom, finishWorldInit);
        ensureWorldInitRetry();
        finishWorldInit();
      } catch (error) {
        console.error("BaseDefenseScene_Advanced join failed", error);
        loading.setText("Connection failed.\nPress SPACE to retry");
        preInitDebug.destroy();
        this.worldInitRetryTimer?.remove(false);
        this.worldInitRetryTimer = null;
        this.input.keyboard?.once("keydown-SPACE", () => this.scene.restart());
        return;
      }
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.worldInitRetryTimer?.remove(false);
      this.worldInitRetryTimer = null;
    });

    this.selectionRectGraphics = this.add.graphics().setDepth(200).setScrollFactor(0).setVisible(true);
    this.attackCursorGraphics = this.add.graphics().setDepth(220).setVisible(this.phaserHudEnabled);

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!this.room?.state || !this.hasInitialized) return;
      if (this.isTouchPointer(pointer)) {
        if (this.handleMobilePointerDown(pointer)) return;
      }
      if (pointer.middleButtonDown()) {
        this.cameraDragging = true;
        this.cameraDragLastX = pointer.x;
        this.cameraDragLastY = pointer.y;
        return;
      }
      if (this.handleBuildPanelPointer(pointer)) return;
      const world = this.getPointerWorld(pointer);

      if (pointer.rightButtonDown()) {
        if (this.actionMode === "build") {
          return;
        }
        if (this.selectedUnitIds.size > 0) {
          // Check if clicking on an enemy — if so, attack instead of move
          const picked = this.pickAnyAttackTargetAtWorld(world.x, world.y);
          const me = this.room.state.players?.get
            ? this.room.state.players.get(this.currentPlayerId)
            : this.room.state.players?.[this.currentPlayerId];
          const myTeam = me?.team;
          if (picked && picked.type === "unit") {
            const targetUnit = this.room.state.units?.get ? this.room.state.units.get(picked.id) : this.room.state.units?.[picked.id];
            if (targetUnit && myTeam && targetUnit.team !== myTeam) {
              // Attack enemy unit
              const ids = Array.from(this.selectedUnitIds);
              for (const uid of ids) {
                this.localUnitTargetOverride.delete(uid);
                this.localUnitFollowState.delete(uid);
                this.localUnitMovePriority.delete(uid);
                this.localUnitPathRadiusOverride.delete(uid);
                this.autoEngagedUnitIds.add(uid);
                this.unitAttackTarget.set(uid, picked.id);
              }
              this.room.send("command_attack", {
                unitIds: ids,
                targetType: "unit",
                targetId: picked.id,
                targetX: Number(targetUnit.x),
                targetY: Number(targetUnit.y),
              });
              return;
            }
          }
          if (picked && picked.type === "structure") {
            const targetStruct = this.room.state.structures?.get ? this.room.state.structures.get(picked.id) : this.room.state.structures?.[picked.id];
            if (targetStruct && myTeam && targetStruct.team !== myTeam) {
              const ids = Array.from(this.selectedUnitIds);
              for (const uid of ids) {
                this.localUnitTargetOverride.delete(uid);
                this.localUnitFollowState.delete(uid);
                this.localUnitMovePriority.delete(uid);
                this.localUnitPathRadiusOverride.delete(uid);
              }
              this.room.send("command_attack", {
                unitIds: ids,
                targetType: "structure",
                targetId: picked.id,
                targetX: Number(targetStruct.x),
                targetY: Number(targetStruct.y),
              });
              return;
            }
          }
          // No enemy under cursor — normal move
          this.issueLocalUnitMoveCommand(world.x, world.y);
        }
        return;
      }

      if (this.actionMode === "build") {
        this.cameraDragging = true;
        this.cameraDragLastX = pointer.x;
        this.cameraDragLastY = pointer.y;
        return;
      }

      this.selectionStart = { x: world.x, y: world.y };
      this.selectionScreenStart = { x: pointer.x, y: pointer.y };
      this.isDraggingSelection = false;
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.isTouchPointer(pointer)) {
        if (this.handleMobilePointerMove(pointer)) return;
      }
      if (this.cameraDragging) {
        const cam = this.cameras.main;
        const dx = pointer.x - this.cameraDragLastX;
        const dy = pointer.y - this.cameraDragLastY;
        cam.scrollX -= dx / cam.zoom;
        cam.scrollY -= dy / cam.zoom;
        this.cameraDragLastX = pointer.x;
        this.cameraDragLastY = pointer.y;
        this.clampCameraToWorld();
        return;
      }
      if (this.draggingBuildType) {
        this.updateBuildGhost(pointer);
        return;
      }
      if (!this.selectionStart || !this.selectionRectGraphics) return;
      if (!this.selectionScreenStart) return;
      const dx = pointer.x - this.selectionScreenStart.x;
      const dy = pointer.y - this.selectionScreenStart.y;
      if (!this.isDraggingSelection && Math.sqrt(dx * dx + dy * dy) > 10) {
        this.isDraggingSelection = true;
      }
      if (!this.isDraggingSelection) return;

      const x1 = this.selectionScreenStart.x;
      const y1 = this.selectionScreenStart.y;
      const x2 = pointer.x;
      const y2 = pointer.y;
      this.renderSelectionBoxDom(x1, y1, x2, y2);
    });

    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (this.isTouchPointer(pointer)) {
        if (this.handleMobilePointerUp(pointer)) return;
      }
      if (this.cameraDragging) {
        this.cameraDragging = false;
        return;
      }
      if (this.draggingBuildType) {
        const world = this.getPointerWorld(pointer);
        const me = this.room.state.players.get ? this.room.state.players.get(this.currentPlayerId) : this.room.state.players?.[this.currentPlayerId];
        const droppedOnPanel = this.pointInRect(pointer.x, pointer.y, this.buildPanelBg);
        if (me?.isAlive && me.isCoreAnchored && !droppedOnPanel) {
          const gx = Math.floor(world.x / TILE_SIZE);
          const gy = Math.floor(world.y / TILE_SIZE);
          if (this.canPlaceBuildAt(this.draggingBuildType, gx, gy)) {
            this.selectedBuild = this.draggingBuildType;
            this.room.send("build_structure", { type: this.draggingBuildType, gridX: gx, gridY: gy });
          }
        }
        this.stopBuildDrag();
        return;
      }
      if (!this.selectionStart) return;
      const world = this.getPointerWorld(pointer);
      const me = this.room.state.players.get ? this.room.state.players.get(this.currentPlayerId) : this.room.state.players?.[this.currentPlayerId];
      const myTeam = me?.team;

      if (me?.isAlive && !me.isCoreAnchored && !this.isDraggingSelection) {
        if (this.isClickOnOwnPlayer(world.x, world.y)) {
          const now = Date.now();
          if (now - this.lastSelfClickAt <= 320) {
            this.room.send("anchor_base");
            this.lastSelfClickAt = 0;
          } else {
            this.lastSelfClickAt = now;
          }
        } else {
          this.lastSelfClickAt = 0;
          this.selectedUnitIds.clear();
          this.selectedStructureId = null;
          this.moveTarget = { x: world.x, y: world.y };
          this.recalcPathToTarget();
        }
        this.clearSelectionDragState();
        return;
      }

      if (this.isDraggingSelection) {
        const minX = Math.min(this.selectionStart.x, world.x);
        const maxX = Math.max(this.selectionStart.x, world.x);
        const minY = Math.min(this.selectionStart.y, world.y);
        const maxY = Math.max(this.selectionStart.y, world.y);
        const selected = new Set<string>();
        if (myTeam && this.room.state.units?.forEach) {
          this.room.state.units.forEach((u: any, id: string) => {
            if (u.team !== myTeam) return;
            const rs = this.localUnitRenderState.get(id);
            const ux = Number(rs?.x ?? u.x);
            const uy = Number(rs?.y ?? u.y);
            if (ux >= minX && ux <= maxX && uy >= minY && uy <= maxY) selected.add(id);
          });
        }
        this.selectedUnitIds = selected;
        this.selectedStructureId = null;
        if (this.selectedUnitIds.size > 0) {
          this.moveTarget = null;
          this.movePath = [];
        }
      } else {
        if (me?.isAlive && !me.isCoreAnchored && this.isClickOnOwnPlayer(world.x, world.y)) {
          const now = Date.now();
          if (now - this.lastSelfClickAt <= 320) {
            this.room.send("anchor_base");
            this.lastSelfClickAt = 0;
            this.clearSelectionDragState();
            return;
          }
          this.lastSelfClickAt = now;
        } else {
          this.lastSelfClickAt = 0;
        }

        const shiftAttack = this.keyShift?.isDown || !!pointer.event?.shiftKey;
        if (shiftAttack && this.selectedUnitIds.size > 0) {
          const picked = this.pickAnyAttackTargetAtWorld(world.x, world.y);
          this.room.send("command_attack", {
            unitIds: Array.from(this.selectedUnitIds),
            targetType: picked?.type || "point",
            targetId: picked?.id || "",
            targetX: world.x,
            targetY: world.y,
          });
          this.selectedStructureId = null;
          this.moveTarget = null;
          this.movePath = [];
          this.clearSelectionDragState();
          return;
        }

        const clickedUnitId = this.findFriendlyUnitAtWorld(world.x, world.y, myTeam);
        if (clickedUnitId) {
          this.selectedUnitIds = new Set<string>([clickedUnitId]);
          this.selectedStructureId = null;
          this.moveTarget = null;
          this.movePath = [];
        } else {
          const clickedStructureId = this.findFriendlyStructureAtWorld(world.x, world.y, myTeam);
          if (clickedStructureId) {
            this.selectedStructureId = clickedStructureId;
            this.selectedUnitIds.clear();
            this.moveTarget = null;
            this.movePath = [];
            this.clearSelectionDragState();
            return;
          }
        }
        if (this.selectedUnitIds.size > 0) {
          this.issueLocalUnitMoveCommand(world.x, world.y);
          this.selectedStructureId = null;
          this.moveTarget = null;
          this.movePath = [];
        } else {
          this.selectedStructureId = null;
          if (me?.isAlive && !me.isCoreAnchored && this.actionMode === "move") {
            this.moveTarget = { x: world.x, y: world.y };
            this.recalcPathToTarget();
          } else {
            this.moveTarget = null;
            this.movePath = [];
          }
        }
      }

      this.clearSelectionDragState();
    });

    this.input.on("pointerupoutside", () => {
      this.activeTouchIds.clear();
      if (this.touchPinching) this.endTouchPinch();
      this.cameraDragging = false;
      this.selectionStart = null;
      this.isDraggingSelection = false;
      this.selectionRectGraphics?.clear();
    });

    // ── Scroll-wheel zoom (cursor-centred) ─────────────────────────────────
    // Restored in Build 187. Zoom is anchored to the mouse position so
    // the world point under the cursor stays fixed while zooming in/out.
    this.input.on("wheel",
      (pointer: Phaser.Input.Pointer, _gos: any, _dx: number, deltaY: number) => {
        if (!this.room?.state || !this.hasInitialized) return;
        const cam = this.cameras.main;
        const zoomFactor = deltaY > 0 ? 0.88 : 1.14; // scroll-down = zoom out
        const nextZoom = Phaser.Math.Clamp(
          cam.zoom * zoomFactor,
          this.getMinCameraZoom(),
          MAX_CAMERA_ZOOM
        );
        if (Math.abs(nextZoom - cam.zoom) < 0.001) return;
        this.applyZoomToScreenPoint(nextZoom, pointer.x, pointer.y);
        this.layoutBaseDefenseHud();
      }
    );
  }

  initializeWorld() {
    this.hasInitialized = true;
    const state = this.room.state;
    this.cameras.main.setBackgroundColor(0x1f5f1f);
    this.syncWorldBackground(state.mapWidth * TILE_SIZE, state.mapHeight * TILE_SIZE);
    this.syncMap();
    this.mapCache = Array.from(state.map as number[]);
    this.mapSyncPending = false;
    if (!this.worldFogOverlay) {
      this.worldFogOverlay = this.add.renderTexture(0, 0, this.cameras.main.width, this.cameras.main.height)
        .setOrigin(0)
        .setScrollFactor(1)
        .setDepth(240);
    }
    if (!this.worldFogMaskGraphics) {
      this.worldFogMaskGraphics = this.add.graphics().setVisible(false);
    }
    if (!this.unitUiGraphics) {
      this.unitUiGraphics = this.add.graphics().setDepth(WORLD_DEPTH_HP_OFFSET);
    }
    if (!this.unitShadowGraphics) {
      this.unitShadowGraphics = this.add.graphics()
        .setDepth(WORLD_DEPTH_BASE + WORLD_DEPTH_SHADOW_GAP)
        .setAlpha(0.4);
    }
    this.worldFogOverlay.setVisible(true);
    this.cameras.main.removeBounds();
    
    const worldW = state.mapWidth * TILE_SIZE;
    const worldH = state.mapHeight * TILE_SIZE;
    this.cameras.main.setBounds(-500, -500, worldW + 1000, worldH + 1000);

    if (!this.visionTrailTexture) {
      this.visionTrailTexture = this.add.renderTexture(0, 0, Math.ceil(worldW / 4), Math.ceil(worldH / 4))
        .setVisible(false);
    }
    if (!this.sharedTrailGraphics) {
      this.sharedTrailGraphics = this.add.graphics().setVisible(false);
    }
    if (!this.visionTrailSprite && this.visionTrailTexture) {
      this.visionTrailSprite = this.add.sprite(0, 0, this.visionTrailTexture.texture)
        .setOrigin(0)
        .setVisible(false);
    }

    const me = state.players?.get ? state.players.get(this.currentPlayerId) : state.players?.[this.currentPlayerId];
    if (me && !this.hasHadInitialCameraSnap && Number(me.x) > 10 && Number(me.y) > 10) {
      // Start camera at perfect world center first to establish stable bounds
      this.setCameraCenterWorld(worldW / 2, worldH / 2);
      this.clampCameraToWorld();
      
      // Then smoothly animate to player base layout
      this.centerCameraOnWorldPoint(Number(me.x), Number(me.y), true);
      this.hasHadInitialCameraSnap = true;
    }
  }

  pairLockSideSign(aId: string, bId: string) {
    // Deterministic side choice for a pair to avoid mirrored oscillation.
    const k = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
    let h = 2166136261;
    for (let i = 0; i < k.length; i++) {
      h ^= k.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h & 1) === 0 ? 1 : -1;
  }

  isGridUnitOccupied(gx: number, gy: number, ignoreUnitId?: string) {
    if (!this.room?.state?.units?.forEach) return false;
    const worldX = gx * TILE_SIZE + TILE_SIZE / 2;
    const worldY = gy * TILE_SIZE + TILE_SIZE / 2;
    const neighbors = this.unitGrid.getNeighbors(worldX, worldY, TILE_SIZE * 0.6);
    for (const id of neighbors) {
      if (id === ignoreUnitId) continue;
      const u = this.room.state.units.get ? this.room.state.units.get(id) : (this.room.state.units as any)?.[id];
      if (!u || (u.hp ?? 0) <= 0) continue;
      const ux = Math.floor(Number(u.x) / TILE_SIZE);
      const uy = Math.floor(Number(u.y) / TILE_SIZE);
      if (ux === gx && uy === gy) return true;
    }
    return false;
  }

  isVisibleToTeamFast(worldX: number, worldY: number) {
    for (const v of this.visionSources) {
      const dx = worldX - v.x;
      const dy = worldY - v.y;
      if ((dx * dx + dy * dy) <= v.r2) return true;
    }
    return false;
  }

  createMinimap() {
    return;
    /*
    if (!this.room?.state) return;
    const worldW = this.room.state.mapWidth * TILE_SIZE;
    const worldH = this.room.state.mapHeight * TILE_SIZE;
    const maxW = 260;
    const maxH = 170;
    const scale = Math.min(maxW / Math.max(1, worldW), maxH / Math.max(1, worldH));
    this.minimapW = Math.max(120, Math.floor(worldW * scale));
    this.minimapH = Math.max(80, Math.floor(worldH * scale));
    this.minimapScaleX = this.minimapW / Math.max(1, worldW);
    this.minimapScaleY = this.minimapH / Math.max(1, worldH);
    this.minimapX = this.cameras.main.width - this.minimapW - 14;
    this.minimapY = this.cameras.main.height - this.minimapH - 14;

    this.minimapBg = this.add.rectangle(this.minimapX, this.minimapY, this.minimapW, this.minimapH, 0x050505, 0.9)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(300);
    this.minimapMapGraphics = this.add.graphics().setScrollFactor(0).setDepth(301);
    this.minimapVisionGraphics = this.add.graphics().setScrollFactor(0).setDepth(302);
    this.minimapEntityGraphics = this.add.graphics().setScrollFactor(0).setDepth(303);
    this.minimapBorder = this.add.rectangle(this.minimapX, this.minimapY, this.minimapW, this.minimapH, 0x000000, 0)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(304).setStrokeStyle(2, 0x9bb7ce, 0.9);

    this.minimapMapGraphics.clear();
    this.minimapMapGraphics.fillStyle(0x0f2b11, 0.9);
    this.minimapMapGraphics.fillRect(this.minimapX, this.minimapY, this.minimapW, this.minimapH);
    for (let gy = 0; gy < this.room.state.mapHeight; gy++) {
      for (let gx = 0; gx < this.room.state.mapWidth; gx++) {
        if (this.tileAt(gx, gy) !== 1) continue;
        const x = this.minimapX + gx * TILE_SIZE * this.minimapScaleX;
        const y = this.minimapY + gy * TILE_SIZE * this.minimapScaleY;
        const w = Math.max(1, TILE_SIZE * this.minimapScaleX);
        const h = Math.max(1, TILE_SIZE * this.minimapScaleY);
        this.minimapMapGraphics.fillStyle(0x55616b, 0.9);
        this.minimapMapGraphics.fillRect(x, y, w, h);
      }
    }
    */
  }

  worldToMinimap(x: number, y: number) {
    return {
      x: this.minimapX + x * this.minimapScaleX,
      y: this.minimapY + y * this.minimapScaleY,
    };
  }

  updateMinimap(_myTeam?: string) {
    return;
    /*
    if (!this.minimapVisionGraphics || !this.minimapEntityGraphics || !this.room?.state || !myTeam) return;
    const mmVision = this.minimapVisionGraphics;
    const mmEntities = this.minimapEntityGraphics;
    mmVision.clear();
    mmVision.fillStyle(0x000000, 0.92);
    mmVision.fillRect(this.minimapX, this.minimapY, this.minimapW, this.minimapH);
    mmVision.fillStyle(0x1f4e25, 0.92);
    for (const v of this.visionSources) {
      const p = this.worldToMinimap(v.x, v.y);
      const r = Math.sqrt(v.r2) * Math.max(this.minimapScaleX, this.minimapScaleY);
      mmVision.fillCircle(p.x, p.y, Math.max(2, r));
    }

    mmEntities.clear();
    this.room.state.units?.forEach?.((u: any) => {
      const isFriendly = u.team === myTeam;
      if (!isFriendly && !this.isVisibleToTeam(Number(u.x), Number(u.y))) return;
      const p = this.worldToMinimap(Number(u.x), Number(u.y));
      mmEntities.fillStyle(isFriendly ? 0x7cd4ff : 0xff7f66, 1);
      mmEntities.fillCircle(p.x, p.y, 2);
    });
    this.room.state.structures?.forEach?.((s: any) => {
      const isFriendly = s.team === myTeam;
      if (!isFriendly && !this.isVisibleToTeam(Number(s.x), Number(s.y))) return;
      const p = this.worldToMinimap(Number(s.x), Number(s.y));
      mmEntities.fillStyle(isFriendly ? 0xb7e7ff : 0xffa08f, 0.95);
      mmEntities.fillRect(p.x - 2, p.y - 2, 4, 4);
    });

    const view = this.cameras.main.worldView;
    const vx = this.minimapX + view.x * this.minimapScaleX;
    const vy = this.minimapY + view.y * this.minimapScaleY;
    const vw = view.width * this.minimapScaleX;
    const vh = view.height * this.minimapScaleY;
    mmEntities.lineStyle(1, 0xffffff, 0.9);
    mmEntities.strokeRect(vx, vy, vw, vh);
    */
  }

  stampPersistentVisionTrail() {
    const vtt = this.visionTrailTexture;
    const stg = this.sharedTrailGraphics;
    if (!vtt || !stg || this.visionSources.length === 0) return;
    stg.clear();
    stg.fillStyle(0xffffff, 1);
    for (const src of this.visionSources) {
      const radius = Math.sqrt(src.r2);
      stg.fillCircle(src.x / 4, src.y / 4, radius / 4);
    }
    vtt.draw(stg as any);
  }

  updateWorldFog(now: number) {
    if (!this.worldFogOverlay || !this.worldFogMaskGraphics || !this.room?.state) return;
    this.updateFogMemory(now);

    if (!this.fogEnabled) {
      this.worldFogOverlay.clear();
      this.worldFogOverlay.setVisible(false);
      return;
    }
    this.worldFogOverlay.setVisible(true);

    const cam = this.cameras.main;
    const camView = cam.worldView;
    const camZoom = cam.zoom;
    this.worldFogOverlay.setPosition(camView.x, camView.y);

    const zoomChanged = !Number.isFinite(this.lastFogZoom) || Math.abs(camZoom - this.lastFogZoom) > 0.001;
    const camMoved = !Number.isFinite(this.lastFogCamX)
      || Math.abs(camView.x - this.lastFogCamX) >= 0.5
      || Math.abs(camView.y - this.lastFogCamY) >= 0.5;

    if (!camMoved && !zoomChanged && now - this.lastWorldFogDrawAt < FOG_UPDATE_MS) return;

    this.lastWorldFogDrawAt = now;
    this.lastFogCamX = camView.x;
    this.lastFogCamY = camView.y;
    this.lastFogZoom = camZoom;
    this.stampPersistentVisionTrail();

    let overlay = this.worldFogOverlay;
    const screenW = cam.width;
    const screenH = cam.height;
    const renderScale = 0.25;
    const bufferScale = 1.5;
    const invScale = 1 / renderScale;
    
    const fogW = Math.ceil(screenW * bufferScale * renderScale);
    const fogH = Math.ceil(screenH * bufferScale * renderScale);

    // Redraw Trigger: Time, Zoom, or Camera moved too close to buffer edge
    const timeElapsed = now - this.lastWorldFogDrawAt;
    const moveThreshold = (screenW * (bufferScale - 1.0)) * 0.4; // redraw when camera moves 40% into the buffer margin
    const movedTooFar = !Number.isFinite(this.lastFogDrawX) 
      || Math.abs(camView.centerX - this.lastFogDrawX) > moveThreshold
      || Math.abs(camView.centerY - this.lastFogDrawY) > moveThreshold;

    if (timeElapsed < FOG_UPDATE_MS && !zoomChanged && !movedTooFar) return;

    this.lastWorldFogDrawAt = now;
    this.lastFogDrawX = camView.centerX;
    this.lastFogDrawY = camView.centerY;

    if (overlay && (overlay.width !== fogW || overlay.height !== fogH)) {
      overlay.destroy();
      this.worldFogOverlay = null as any;
      overlay = null as any;
    }

    if (!this.worldFogOverlay) {
      this.worldFogOverlay = this.add.renderTexture(0, 0, fogW, fogH)
        .setOrigin(0)
        .setScrollFactor(1)
        .setDepth(240)
        .setScale(invScale);
      overlay = this.worldFogOverlay;
    }
    
    const drawX = this.lastFogDrawX - (screenW * bufferScale) / 2;
    const drawY = this.lastFogDrawY - (screenH * bufferScale) / 2;

    overlay.setPosition(drawX, drawY);
    overlay.setDisplaySize(screenW * bufferScale, screenH * bufferScale);
    overlay.clear();
    overlay.fill(0x000000, 0.88, 0, 0, fogW, fogH);

    const vts = this.visionTrailSprite;
    if (vts) {
      vts.setScale(camZoom);
      vts.setPosition(-drawX / 4 * camZoom, -drawY / 4 * camZoom);
      overlay.erase(vts);
    }
  }

  autoEngageUnits(now: number) {
    if (!this.room?.state?.units?.forEach) return;
    if (now - this.lastAutoEngageAt < 500) return;
    this.lastAutoEngageAt = now;

    const me = this.room.state.players?.get
      ? this.room.state.players.get(this.currentPlayerId)
      : this.room.state.players?.[this.currentPlayerId];
    const myTeam = me?.team;
    if (!myTeam) return;

    // OPTIMIZATION: Stagger the full enemy search.
    if ((this as any)._autoEngageFrameSkip === undefined) (this as any)._autoEngageFrameSkip = 0;
    (this as any)._autoEngageFrameSkip++;
    if ((this as any)._autoEngageFrameSkip % 4 !== 0 && this.unitAttackTarget.size > 0) {
        this.verifyCurrentEngagements();
        return;
    }

    // Collect all potential targets by team
    const teamA: Array<{ id: string; x: number; y: number; type: string }> = [];
    const teamB: Array<{ id: string; x: number; y: number; type: string }> = [];

    const collectToTeam = (entity: any, id: string, type: string) => {
        if ((entity.hp ?? 0) <= 0) return;
        const ex = Number(entity.x);
        const ey = Number(entity.y);
        const entry = { id, x: ex, y: ey, type };
        if (entity.team === "A") teamA.push(entry);
        else if (entity.team === "B") teamB.push(entry);
    };

    this.room.state.units.forEach((u: any, id: string) => collectToTeam(u, id, String(u.type || "")));
    this.room.state.structures.forEach((s: any, id: string) => collectToTeam(s, id, "structure"));
    this.room.state.cores.forEach((c: any, id: string) => collectToTeam(c, id, "core"));

    const engageRange = TILE_SIZE * 16.8;
    const threatRange = TILE_SIZE * 12.6;
    const unitsToEngage: Array<{ unitId: string; enemyId: string }> = [];

    // Process ALL combat units
    this.room.state.units.forEach((u: any, id: string) => {
      if ((u.hp ?? 0) <= 0) return;
      const uType = String(u.type || "");
      if (uType !== "tank" && uType !== "soldier") return;

      const rs = this.localUnitRenderState.get(id);
      const ux = Number(rs?.x ?? u.x);
      const uy = Number(rs?.y ?? u.y);

      // Current unit's enemies are on the OTHER team
      const enemies = u.team === "A" ? teamB : teamA;
      if (enemies.length === 0) return;

      // Find nearest enemy in range using the spatial grid (O(1) lookup)
      let nearestEnemy: { id: string; x: number; y: number } | null = null;
      let nearestDist = engageRange;
      
      const potentialEnemyIds = this.unitGrid.getNeighbors(ux, uy, engageRange);
      for (const eid of potentialEnemyIds) {
        if (eid === id) continue;
        const e = enemies.find(en => en.id === eid);
        if (!e) continue;
        const d = Math.hypot(e.x - ux, e.y - uy);
        if (d < nearestDist) {
          nearestDist = d;
          nearestEnemy = e;
        }
      }

      // If already engaged, check for re-targeting
      if (this.autoEngagedUnitIds.has(id)) {
        const currentTargetId = this.unitAttackTarget.get(id);
        const currentTarget = enemies.find(en => en.id === currentTargetId);
        const currentDist = currentTarget ? Math.hypot(currentTarget.x - ux, currentTarget.y - uy) : 99999;
        
        if (nearestEnemy && nearestDist < currentDist * 0.7) {
          this.unitAttackTarget.set(id, nearestEnemy.id);
        }
        return;
      }

      // Manual command override check (only for local units)
      if (String(u.ownerId || "") === this.currentPlayerId) {
          const manualTarget = this.getLocalUnitManualTarget(id);
          if (manualTarget && nearestDist > threatRange) {
            const distToSlot = Math.hypot(manualTarget.finalX - ux, manualTarget.finalY - uy);
            if (distToSlot > TILE_SIZE * 0.7) return;
          }
      }

      if (nearestEnemy) {
        unitsToEngage.push({ unitId: id, enemyId: nearestEnemy.id });
      }
    });

    for (const engage of unitsToEngage) {
      this.autoEngagedUnitIds.add(engage.unitId);
      this.unitAttackTarget.set(engage.unitId, engage.enemyId);
    }

    // Clean up auto-engaged units that no longer exist or are out of range
    for (const id of Array.from(this.autoEngagedUnitIds)) {
      const u = this.room.state.units.get ? this.room.state.units.get(id) : (this.room.state.units as any)?.[id];
      if (!u || (u.hp ?? 0) <= 0) {
        this.autoEngagedUnitIds.delete(id);
        this.unitAttackTarget.delete(id);
        continue;
      }
      const targetId = this.unitAttackTarget.get(id);
      if (!targetId) {
        this.autoEngagedUnitIds.delete(id);
        continue;
      }
      
      let target: any = this.room.state.units.get ? this.room.state.units.get(targetId) : (this.room.state.units as any)?.[targetId];
      if (!target) target = this.room.state.structures.get ? this.room.state.structures.get(targetId) : (this.room.state.structures as any)?.[targetId];
      if (!target) target = this.room.state.cores.get ? this.room.state.cores.get(targetId) : (this.room.state.cores as any)?.[targetId];

      if (!target || (target.hp ?? 0) <= 0) {
        this.autoEngagedUnitIds.delete(id);
        this.unitAttackTarget.delete(id);
        continue;
      }

      const rs = this.localUnitRenderState.get(id);
      const ux = Number(rs?.x ?? u.x);
      const uy = Number(rs?.y ?? u.y);
      if (Math.hypot(Number(target.x) - ux, Number(target.y) - uy) > engageRange * 1.6) {
        this.autoEngagedUnitIds.delete(id);
        this.unitAttackTarget.delete(id);
      }
    }
  }

  verifyCurrentEngagements() {
    if (!this.room?.state?.units) return;
    const now = Date.now();
    const engageRange = TILE_SIZE * 18.0;
    for (const id of Array.from(this.autoEngagedUnitIds)) {
        const u = this.room.state.units.get ? this.room.state.units.get(id) : (this.room.state.units as any)?.[id];
        if (!u || (u.hp ?? 0) <= 0) {
            this.autoEngagedUnitIds.delete(id);
            this.unitAttackTarget.delete(id);
            continue;
        }
        const targetId = this.unitAttackTarget.get(id);
        if (!targetId) continue;

        let target: any = this.room.state.units.get ? this.room.state.units.get(targetId) : (this.room.state.units as any)?.[targetId];
        if (!target) target = this.room.state.structures.get ? this.room.state.structures.get(targetId) : (this.room.state.structures as any)?.[targetId];
        if (!target) target = this.room.state.cores.get ? this.room.state.cores.get(targetId) : (this.room.state.cores as any)?.[targetId];

        if (!target || (target.hp ?? 0) <= 0) {
            this.autoEngagedUnitIds.delete(id);
            this.unitAttackTarget.delete(id);
            continue;
        }

        const rs = this.localUnitRenderState.get(id);
        const ux = Number(rs?.x ?? u.x);
        const uy = Number(rs?.y ?? u.y);
        if (Math.hypot(Number(target.x) - ux, Number(target.y) - uy) > engageRange) {
            this.autoEngagedUnitIds.delete(id);
            this.unitAttackTarget.delete(id);
        }
        this.lastAvoidIntentSentAt = now;
    }
  }

  toggleDetailedPaths() {
    this.showDetailedPaths = !this.showDetailedPaths;
    const msg = this.showDetailedPaths ? "Detailed paths enabled (Individual)" : "Simple paths enabled (Group line)";
    this.showNotice(msg, "#8fccff");
    this.updateActionPanelDom();
  }

  update(_time: number, delta: number) {
    if (this.profilingActive) {
      this.fpsHistory.push(this.game.loop.actualFps);
      if (this.fpsHistory.length > 5000) this.fpsHistory.shift(); // Keep buffer reasonable
    }
    const nowUpdate = Date.now();
    if (nowUpdate - this.lastResizePollAt > 2000) {
      this.lastResizePollAt = nowUpdate;
      if (window.innerWidth !== this.lastKnownWindowWidth || window.innerHeight !== this.lastKnownWindowHeight) {
        this.lastKnownWindowWidth = window.innerWidth;
        this.lastKnownWindowHeight = window.innerHeight;
        this.handleViewportResize(this.scale.gameSize);
      }
    }
    this.updateActionPanelDom();
    const clientElapsedSec = Math.max(0, Math.floor((Date.now() - this.clientClockStartedAt) / 1000));
    const clientMinutes = Math.floor(clientElapsedSec / 60);
    const clientSeconds = clientElapsedSec % 60;
    const clientHeartbeat = Math.floor(Date.now() / 500) % 2 === 0 ? "●" : "○";
    if (this.clientClockText) {
      this.clientClockText.setText(
        `CLIENT ${String(clientMinutes).padStart(2, "0")}:${String(clientSeconds).padStart(2, "0")} ${clientHeartbeat}`
      );
    }
    if (!this.room?.state || !this.hasInitialized) return;
    if (this.mapSyncPending) {
      this.perfStart("syncMap");
      this.syncMap();
      this.perfEnd("syncMap");
      this.mapSyncPending = false;
    }
    const state = this.room.state;
    const players = state.players;
    const me = players?.get ? players.get(this.currentPlayerId) : players?.[this.currentPlayerId];

    // Performance Optimization: Rebuild spatial grid for fast unit proximity lookups
    this.unitGrid.clear();
    state.units.forEach((u: any, id: string) => {
      if ((u.hp ?? 0) <= 0) return;
      const rs = this.localUnitRenderState.get(id);
      this.unitGrid.add(id, Number(rs?.x ?? u.x), Number(rs?.y ?? u.y));
    });

    if (state.players && !this.hasLoggedTeam) {
       const mTeam = me?.team;
       if (mTeam) {
         console.log(`[BaseDefense] My team is:`, mTeam);
         this.hasLoggedTeam = true;
       }
    }

    if (me) {
      this.perfStart("hud");
      const phase = String(state.phase || "build");
      const phaseLeft = phase === "build" ? Math.max(0, Math.ceil((Number(state.phaseEndsAt || 0) - Date.now()) / 1000)) : 0;
      if (!me.isCoreAnchored && !me.devMode) {
        this.buildMenuText.setText("MOVE CONSTRUCTOR: WASD/Arrows/Left Click  |  ANCHOR: [F] OR ANCHOR BUTTON");
      } else {
        const active = this.actionMode === "build" ? "MAP PAN MODE" : "COMMAND MODE";
        this.buildMenuText.setText(
          `${active}\nDRAG BUILDINGS FROM PANEL | [B] TOGGLE MAP PAN\n[Q] SOLDIER 35 | [T] TANK 90 | [H] HARVESTER 70`
        );
      }
      const sessionClock = Math.max(0, 9999 - Math.floor(this.time.now / 1000));
      const heartbeat = (Math.floor(this.time.now / 500) % 2 === 0) ? "●" : "○";
      if (this.phaserHudEnabled) {
        if (!state.roundActive) this.statusText.setText(`Winner: Team ${state.winnerTeam || "?"}`);
        else if (phase === "build") this.statusText.setText(`Build phase: ${phaseLeft}s | ${heartbeat} ${sessionClock}`);
        else this.statusText.setText(`Battle phase | ${heartbeat} ${sessionClock}`);
        this.buildMenuText.setVisible(true);
      }
    this.updateBuildPanel(me);
    this.perfEnd("hud");
    }
    if (!me) this.updateBuildPanel(null);
    this.perfStart("camera");
    this.updateRtsCamera(delta);
    const cam = this.cameras.main;
    this.updateWorldBackground(cam.scrollX, cam.scrollY);
    this.updateMapCulling();
    this.perfEnd("camera");
    let nowMs = Date.now();
    this.drawMoveClickMarker(nowMs);
    this.reflowDefensiveAssignments(nowMs);
    this.drawFormationPreview(nowMs);
    if (this.phaserHudEnabled && this.attackCursorGraphics) {
      this.attackCursorGraphics.clear();
      const hasUnitsSelected = this.selectedUnitIds.size > 0 && !this.cameraDragging && !this.draggingBuildType;
      const shiftAttack = (this.keyShift?.isDown ?? false) && hasUnitsSelected;
      if (hasUnitsSelected) {
        const p = this.input.activePointer;
        const world = this.getPointerWorld(p);
        const picked = this.pickAnyAttackTargetAtWorld(world.x, world.y);
        // Show attack cursor if hovering over enemy or shift is held
        const mePlayer = this.room?.state?.players?.get
          ? this.room.state.players.get(this.currentPlayerId)
          : this.room?.state?.players?.[this.currentPlayerId];
        const mTeam = mePlayer?.team;
        let isEnemy = false;
        if (picked && mTeam) {
          if (picked.type === "unit") {
            const tu = this.room?.state?.units?.get ? this.room.state.units.get(picked.id) : this.room?.state?.units?.[picked.id];
            isEnemy = !!(tu && tu.team !== mTeam);
          } else if (picked.type === "structure") {
            const ts = this.room?.state?.structures?.get ? this.room.state.structures.get(picked.id) : this.room?.state?.structures?.[picked.id];
            isEnemy = !!(ts && ts.team !== mTeam);
          }
        }
        if (isEnemy || shiftAttack) {
          const color = isEnemy ? 0xff3333 : (picked ? 0xff6262 : 0x55ff88);
          const t = Date.now() * 0.01;
          const r1 = 8 + Math.sin(t) * 1.8;
          const r2 = 13 + Math.cos(t * 0.8) * 2.2;
          this.attackCursorGraphics.lineStyle(2, color, 0.95);
          this.attackCursorGraphics.strokeCircle(world.x, world.y, r1);
          this.attackCursorGraphics.lineStyle(1.5, color, 0.6);
          this.attackCursorGraphics.strokeCircle(world.x, world.y, r2);
          this.attackCursorGraphics.lineStyle(2, color, 0.9);
          this.attackCursorGraphics.lineBetween(world.x - 5, world.y, world.x + 5, world.y);
          this.attackCursorGraphics.lineBetween(world.x, world.y - 5, world.x, world.y + 5);
        }
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.key1)) this.selectedBuild = "ore_refinery";
    if (Phaser.Input.Keyboard.JustDown(this.key2)) this.selectedBuild = "solar_panel";
    if (Phaser.Input.Keyboard.JustDown(this.key3)) this.selectedBuild = "barracks";
    if (this.keyP && Phaser.Input.Keyboard.JustDown(this.keyP)) this.toggleProfiling();
    if (Phaser.Input.Keyboard.JustDown(this.key4)) this.selectedBuild = "war_factory";
    if (Phaser.Input.Keyboard.JustDown(this.keyB)) this.actionMode = this.actionMode === "move" ? "build" : "move";
    if (Phaser.Input.Keyboard.JustDown(this.keyL)) this.toggleDetailedPaths();
    if (Phaser.Input.Keyboard.JustDown(this.keyQ)) {
      const reason = this.getUnitProduceBlockedReason();
      if (reason) this.showNotice(`Cannot produce: ${reason}`, "#ffb080");
      else this.room.send("produce_unit");
    }
    if (Phaser.Input.Keyboard.JustDown(this.keyT)) {
      const reason = this.getFactoryProduceBlockedReason("tank");
      if (reason) this.showNotice(`Cannot produce: ${reason}`, "#ffb080");
      else this.room.send("produce_tank");
    }
    if (Phaser.Input.Keyboard.JustDown(this.keyH)) {
      const reason = this.getFactoryProduceBlockedReason("harvester");
      if (reason) this.showNotice(`Cannot produce: ${reason}`, "#ffb080");
      else this.room.send("produce_harvester");
    }
    if (Phaser.Input.Keyboard.JustDown(this.keyR)) this.room.send("produce_build_kit");
    if (Phaser.Input.Keyboard.JustDown(this.keyF)) this.room.send("anchor_base");
    if (Phaser.Input.Keyboard.JustDown(this.keyF10)) this.room.send("toggle_dev_mode");
    if (Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
      this.clearCommandSelectionState();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keyE)) this.room.send("base_attack");

    this.perfStart("autoEngage");
    this.autoEngageUnits(nowMs);
    this.perfEnd("autoEngage");

    const myTeam = me?.team;
    if (this.fpsText) {
       this.fpsText.setText(`FPS: ${Math.round(this.game.loop.actualFps)}`);
       if (this.game.loop.actualFps < 24) this.fpsText.setColor("#ff4444");
       else if (this.game.loop.actualFps < 28) this.fpsText.setColor("#ffff44");
       else this.fpsText.setColor("#00ff00");
    }
    this.updateClientVersionDom(this.game.loop.actualFps);
    this.perfStart("syncPlayers");
    const seenPlayers = new Set<string>();
    if (players?.forEach) {
      // Build 245: Throttle vision refresh to 10 FPS (every 100ms)
      const now = Date.now();
      if (now - (this as any)._lastVisionRefreshAt > 100 || (this as any)._lastVisionRefreshAt === undefined) {
          (this as any)._lastVisionRefreshAt = now;
          this.refreshVisionSources(myTeam);
      }
      players.forEach((p: any, id: string) => {
        seenPlayers.add(id);
        let e = this.playerEntities[id];
        const isFriendly = !!me && p.team === me.team;
        const visible = isFriendly || id === this.currentPlayerId || this.isVisibleToTeamWithFogMemory(Number(p.x), Number(p.y));
        const anchored = !!p.isCoreAnchored;
        const needsConstructor = anchored;
        const needsSoldier = !anchored;
        const wrongType = !e
          || (needsConstructor && !(e instanceof Phaser.GameObjects.Image))
          || (needsSoldier && !(e instanceof Phaser.GameObjects.Sprite));
        if (wrongType) {
          e?.destroy();
          if (needsConstructor) {
            e = this.add.image(p.x, p.y, this.getBuildingTextureKey(RTS_BUILDING_TEXTURE_KEYS.constructor))
              .setOrigin(0.5, RTS_PLAYER_CONSTRUCTOR_ORIGIN_Y)
              .setDisplaySize(RTS_PLAYER_CONSTRUCTOR_DISPLAY_SIZE, RTS_PLAYER_CONSTRUCTOR_DISPLAY_SIZE);
          } else {
            e = this.add.sprite(p.x, p.y, this.getSoldierSheetTextureKey("run"), 0)
              .setOrigin(0.5, RTS_SOLDIER_ORIGIN_Y)
              .setDisplaySize(RTS_PLAYER_SOLDIER_DISPLAY_SIZE, RTS_PLAYER_SOLDIER_DISPLAY_SIZE);
          }
          this.playerEntities[id] = e;
        }
        if (!this.playerLabels[id]) {
          const lbl = this.add.text(p.x, p.y - TILE_SIZE * 0.52, p.name || id.slice(0, 4), {
            fontSize: "13px",
            color: "#fff",
            fontFamily: "Arial",
            backgroundColor: "#00000077",
          }).setPadding(3, 1, 3, 1).setOrigin(0.5, 1);
          this.playerLabels[id] = lbl;
        }
        if (needsConstructor) {
          e.x = Number(p.x);
          e.y = Number(p.y);
        } else {
          e.x = Phaser.Math.Linear(e.x, p.x, 1 - Math.exp(-delta * 0.02));
          e.y = Phaser.Math.Linear(e.y, p.y, 1 - Math.exp(-delta * 0.02));
          if (e instanceof Phaser.GameObjects.Sprite) {
            e.anims.stop();
            e.setTexture(this.getSoldierSheetTextureKey("run"), this.getSoldierIdleFrame(2));
          }
        }
        this.applyWorldDepth(e, e.y, WORLD_DEPTH_PLAYER_OFFSET);
        e.setVisible(!!p.isAlive && visible);
        const label = this.playerLabels[id];
        const labelOffsetY = anchored ? TILE_SIZE * 0.9 : TILE_SIZE * 0.46;
        label.setPosition(e.x, e.y - labelOffsetY);
        label.setText(
          (p.name || `P-${id.slice(0, 4)}`)
          + (id === this.currentPlayerId ? " (YOU)" : "")
          + (anchored ? ` HP:${p.coreHp ?? 0}` : "")
        );
        this.applyWorldDepth(label, e.y, WORLD_DEPTH_LABEL_OFFSET);
        label.setVisible(!!p.isAlive && visible);
      });
    }
    for (const id of Object.keys(this.playerEntities)) {
      if (!seenPlayers.has(id)) {
        this.playerEntities[id].destroy();
        delete this.playerEntities[id];
        this.playerLabels[id]?.destroy();
        delete this.playerLabels[id];
      }
    }
    this.perfEnd("syncPlayers");

    this.perfStart("syncUnits");
    const seenUnits = new Set<string>();
    // Salt for Build 248 (5-Lane Rails): 1712924500
    
    // Build 218: Prepare shared graphics for batching
    this.unitUiGraphics?.clear();
    this.unitShadowGraphics?.clear();
    const camView = this.cameras.main.worldView;
    const pad = TILE_SIZE * 6; // Build 280: Standard optimized padding
    nowMs = Date.now();

    // Build 238: Periodic shared path cache clearing (every 500ms) to ensure path results stay fresh
    if (nowMs - (this as any)._lastSharedPathClearAt > 500 || (this as any)._lastSharedPathClearAt === undefined) {
      this.sharedPathCache.clear();
      (this as any)._lastSharedPathClearAt = nowMs;
    }
    // Build 228: Unit counters
    let countSoldiers = 0;
    let countTanks = 0;

    if (state.units?.forEach) {
      try {
        state.units.forEach((u: any, id: string) => {
          seenUnits.add(id);
          let e = this.unitEntities[id];
          const isTank = u.type === "tank";
          const isSoldier = u.type === "soldier";
          const isHarvester = u.type === "harvester";
          const isFriendly = !!myTeam && u.team === myTeam;
          const isLocalOwned = isFriendly && String(u.ownerId || "") === this.currentPlayerId;
          const isDead = (u.hp ?? 0) <= 0;

          // Build 228: Count friendly units
          if (isFriendly && !isDead) {
            if (isSoldier) countSoldiers += 1;
            else if (isTank) countTanks += 1;
          }

          const ux = Number(u.x);
          const uy = Number(u.y);

          // Build 221 Fix: Use Fog of War for visibility, not non-existent server property
          const visible = (isFriendly || this.isVisibleToTeamWithFogMemory(ux, uy)) && !isDead;
          const baseColor = isHarvester
            ? (isFriendly ? 0xe3c44a : 0xd4873c)
            : isTank
              ? (isFriendly ? 0x8ea7bf : 0xd24d2e)
              : (isFriendly ? 0x6ec4ff : 0xff4f1a);
          const radius = isHarvester ? TILE_SIZE * 0.18 : isTank ? TILE_SIZE * 0.3 : TILE_SIZE * 0.22;
          let dir = this.unitFacing.get(id) ?? (typeof u.dir === "number" ? u.dir : 1);

          if (!e || (isTank && !(e instanceof Phaser.GameObjects.Image)) || (isSoldier && !(e instanceof Phaser.GameObjects.Sprite))) {
            if (isTank) {
              e = ensureTankEntity(this, e, ux, uy, dir);
            } else if (isSoldier) {
              e = ensureSoldierEntity(this, e, ux, uy);
            } else {
              if (e) e.destroy();
              e = this.add.arc(ux, uy, radius, 0, 360, false, baseColor).setStrokeStyle(1.5, 0xffffff);
            }
            this.unitEntities[id] = e;
            this.applyWorldDepth(e, uy, WORLD_DEPTH_UNIT_OFFSET);
          }

          // 1. Sync Position
          if (!this.localUnitRenderState.has(id)) {
            const now = Date.now();
            if (u.manualUntil && Number(u.manualUntil) > now) {
              let spawnX = ux;
              let spawnY = uy;
              let bestDist = 96; // Build 223: Reduced search radius to prevent units flying from too far
              const targetType = isTank ? "war_factory" : "barracks";
              
              if (state.structures?.forEach) {
                state.structures.forEach((s: any) => {
                  if (s.type === targetType && s.team === u.team) {
                    const d = Math.hypot(s.x - ux, s.y - uy);
                    if (d < bestDist) {
                      bestDist = d;
                      spawnX = s.x;
                      spawnY = s.y;
                    }
                  }
                });
              }
              // Only apply if we actually found a nearby building
              if (bestDist < 96) {
                this.localUnitRenderState.set(id, { x: spawnX, y: spawnY, vx: 0, vy: 0, lastAt: performance.now() });
                if (e) { e.x = spawnX; e.y = spawnY; }
                
                // Build 226: Assign a defensive slot IMMEDIATELY on spawn
                this.lastDefensiveSlotRefreshAt = 0; 
              } else {
                this.localUnitRenderState.set(id, { x: ux, y: uy, vx: 0, vy: 0, lastAt: performance.now() });
              }
            } else {
              this.localUnitRenderState.set(id, { x: ux, y: uy, vx: 0, vy: 0, lastAt: performance.now() });
            }
          }

          const isSelected = this.selectedUnitIds.has(id);
          const rs = this.localUnitRenderState.get(id);
          const rx = Number(rs?.x ?? ux);
          const ry = Number(rs?.y ?? uy);

          const inCamera = isSelected || (
            (rx >= camView.x - pad && rx <= camView.right + pad && ry >= camView.y - pad && ry <= camView.bottom + pad) ||
            (ux >= camView.x - pad && ux <= camView.right + pad && uy >= camView.y - pad && uy <= camView.bottom + pad)
          );
          const needsLocalSimulation = this.shouldKeepLocalUnitSimulationActive(id, u, ux, uy);

          // 2. Visuals & Batching
          if (inCamera || needsLocalSimulation) {
            this.updateUnitRenderPos(id, e as any, u, delta, isLocalOwned, isTank);
          }

          if (inCamera) {
            dir = this.unitFacing.get(id) ?? (typeof u.dir === "number" ? u.dir : 1);
            const rs = this.localUnitRenderState.get(id);
            
            if (isTank && e instanceof Phaser.GameObjects.Image) {
              syncTankRuntime(this, {
                camView,
                dir,
                entity: e,
                id,
                isDead,
                isFriendly,
                isSelected,
                unit: u,
                visible,
              });
            } else if (isSoldier && e instanceof Phaser.GameObjects.Sprite) {
              syncSoldierRuntime(this, {
                camView,
                dir,
                entity: e,
                id,
                isDead,
                isFriendly,
                isSelected,
                renderState: rs,
                unit: u,
                visible,
              });
            }
            
            if (visible && this.unitUiGraphics && camView.contains(e.x, e.y)) {
              const uig = this.unitUiGraphics;
              const isSelected = this.selectedUnitIds.has(id);
              const camZoom = this.cameras.main.zoom;
              const hpRatio = Math.max(0, Math.min(1, (u.hp || 0) / (u.maxHp || 1)));

              // Build 285: HP Bar LOD - Hide bars for healthy units unless selected or zoomed in close
              const showHp = (isSelected || hpRatio < 1.0) && camZoom > 0.52;
              
              if (isSelected) {
                const ringSize = isTank ? this.getTankSelectionBoxSize(e as any) : TILE_SIZE * 0.7;
                const ringY = isTank ? this.getTankSelectionY(e as any, dir) : e.y + 2;
                uig.lineStyle(2, 0x00ffcc, 1);
                uig.strokeRect(e.x - ringSize / 2, ringY - ringSize / 2, ringSize, ringSize);
              }

              if (!isFriendly && camZoom > 0.45) {
                const topY = this.getSpriteTopY(e as any);
                uig.fillStyle(0xff0000, 0.9).fillCircle(e.x, topY - 14, 5);
                uig.lineStyle(1.5, 0xffffff, 0.7).strokeCircle(e.x, topY - 14, 5);
              }

              if (showHp) {
                const barW = isTank ? 40 : 20;
                const barH = 4;
                const barY = isTank ? this.getTankHpY(e as any) - barH : (e.y - TILE_SIZE * 0.95);
                uig.fillStyle(0x000000, 0.6).fillRect(e.x - barW / 2, barY, barW, barH);
                uig.fillStyle(hpRatio > 0.4 ? 0x00ff00 : 0xff0000, 0.9).fillRect(e.x - barW / 2, barY, barW * hpRatio, barH);
              }
            }
            
            e.setVisible(visible);
            this.applyWorldDepth(e, e.y, WORLD_DEPTH_UNIT_OFFSET);
          } else {
              e.setVisible(false);
              this.tankShadowEntities[id]?.setVisible(false);
          }
        });
      } catch (err) {
        console.error("[BaseDefense] Error in units loop:", err);
      }
    }

    // Build 230: Update consolidated HUD
    this.soldierCount = countSoldiers;
    this.tankCount = countTanks;
    this.updateClientVersionDom(this.game.loop.actualFps);

    // Build 234: Next segment trigger for chained movement (Persistent - works even if unselected)
    // Build 243: The 'Next segment trigger' logic has been removed. 
    // Movement is now direct and continuous to the final destination.

    for (const id of Object.keys(this.unitEntities)) {
      if (!state.units.has(id)) {
        this.unitEntities[id].destroy();
        delete this.unitEntities[id];
        this.tankShadowEntities[id]?.destroy();
        delete this.tankShadowEntities[id];
        this.unitFacing.delete(id);
        this.selectedUnitIds.delete(id);
      }
    }
    this.perfEnd("syncUnits");

        nowMs = Date.now();
    if (nowMs - (this.lastStructureSyncAt || 0) > 120) {
      this.lastStructureSyncAt = nowMs;
      this.updateObstacleGrid(); // Build 99: Update O(1) grid
      this.perfStart("syncStructures");
      const seenStructures = new Set<string>();
      const seenStructureHp = new Set<string>();
      const frameCount = (this.game.loop.frame % 32);
      const isCriticalUpdate = (frameCount === 0);
      const isTextUpdate = (frameCount % 4 === 0);
      if (state.structures?.forEach) {
        try {
          state.structures.forEach((s: any, id: string) => {
            seenStructures.add(id);
            let e: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image | undefined = this.structureEntities[id];
            let t = this.structureTexts[id];
            const artSpec = this.getStructureArtSpec(String(s.type || ""));
            const isFriendly = !!myTeam && s.team === myTeam;
            const sx = Number(s.x);
            const sy = Number(s.y);
            const inCamera = (sx >= camView.x - pad && sx <= camView.right + pad && sy >= camView.y - pad && sy <= camView.bottom + pad);
            const visible = (isFriendly || this.isVisibleToTeamWithFogMemory(sx, sy)) && inCamera;

            if (!inCamera) {
              e?.setVisible(false);
              this.structureShadowEntities[id]?.setVisible(false);
              this.structureTexts[id]?.setVisible(false);
              this.structureHpTexts[id]?.setVisible(false);
              this.structureEnemyIcons.get(id)?.setVisible(false);
              return;
            }

            if (!e) {
              if (artSpec) {
                e = this.add.image(s.x, s.y, artSpec.textureKey)
                  .setOrigin(0.5, artSpec.originY)
                  .setDisplaySize(artSpec.size, artSpec.size);
              } else {
                const fill = isFriendly ? 0x2a6fd1 : 0x9b2f2f;
                const stroke = 0xffffff;
                e = this.add.rectangle(s.x, s.y, TILE_SIZE * 0.9, TILE_SIZE * 0.9, fill, 0.92).setStrokeStyle(2, stroke);
              }
              e.setDepth(12);
              this.structureEntities[id] = e;
              const label = s.type?.toUpperCase?.() || "ST";
              t = this.add.text(s.x, s.y, label, {
                fontSize: "10px",
                color: "#ffffff",
                fontFamily: "Arial",
                fontStyle: "bold",
                backgroundColor: "#00000066",
              }).setOrigin(0.5).setDepth(13).setPadding(2, 1, 2, 1);
              this.structureTexts[id] = t;
            }

            if (e.x !== s.x) e.x = s.x;
            if (e.y !== s.y) e.y = s.y;
            
            if (artSpec && e instanceof Phaser.GameObjects.Image) {
              if (e.texture?.key !== artSpec.textureKey) e.setTexture(artSpec.textureKey);
              if (e.originY !== artSpec.originY) e.setOrigin(0.5, artSpec.originY);
              if (Math.abs(e.displayWidth - artSpec.size) > 0.1) e.setDisplaySize(artSpec.size, artSpec.size);
              // Build 156: No longer coloring enemy structures red
              e.clearTint();
            }
            
            if (e.visible !== visible) e.setVisible(visible);

            // Build 149: Update structure depth every frame (not just isCriticalUpdate).
            // Units are depth-sorted every frame; if structures only update every 32 frames
            // a unit can momentarily have higher depth and appear in front of a building it
            // should be behind.
            if (visible) {
              this.applyWorldDepth(e, e.y, WORLD_DEPTH_STRUCTURE_OFFSET);
            }

            if (t && visible && (isTextUpdate || !t.visible)) {
              const timeLeftValue = Math.max(0, Math.ceil((Number(s.buildCompleteAt || 0) - nowMs) / 1000));
              const label = s.type?.toUpperCase?.() || "ST";
              t.setPosition(s.x, artSpec ? s.y + artSpec.labelY : s.y);
              const newText = timeLeftValue > 0 ? `${label}\n${timeLeftValue}s` : label;
              if (t.text !== newText) t.setText(newText);
              if (isCriticalUpdate) this.applyWorldDepth(t, e.y, WORLD_DEPTH_LABEL_OFFSET);
              if (!t.visible) t.setVisible(true);
            } else if (t && !visible) {
              t.setVisible(false);
            }

            const isSelectedStructure = this.selectedStructureId === id;
            if (isSelectedStructure && isCriticalUpdate) {
                if (e instanceof Phaser.GameObjects.Rectangle) e.setStrokeStyle(3, 0x00ffcc);
                else e.setTint(0xa8fff2);
            }

            const showHp = visible;
            if (showHp && isTextUpdate) {
              let hp = this.structureHpTexts[id];
              if (!hp) {
                hp = this.add.text(s.x, s.y - TILE_SIZE * 0.58, "", {
                  fontSize: "11px",
                  color: "#ffffff",
                  fontFamily: "Arial",
                  backgroundColor: "#00000088",
                }).setPadding(3, 1, 3, 1).setOrigin(0.5, 1).setDepth(18);
                this.structureHpTexts[id] = hp;
              }
              const timeLeftValue = Math.max(0, Math.ceil((Number(s.buildCompleteAt || 0) - nowMs) / 1000));
              const hpText = timeLeftValue > 0
                ? `${Math.max(0, Math.floor(s.hp || 0))}/${Math.max(1, Math.floor(s.maxHp || 1))} (${timeLeftValue}s)`
                : `${Math.max(0, Math.floor(s.hp || 0))}/${Math.max(1, Math.floor(s.maxHp || 1))}`;
              if (hp.text !== hpText) hp.setText(hpText);
              hp.setPosition(s.x, artSpec ? this.getStructureTopY(e as any) - 6 : s.y - TILE_SIZE * 0.58);
              if (isCriticalUpdate) this.applyWorldDepth(hp, e.y, WORLD_DEPTH_HP_OFFSET);
              if (!hp.visible) hp.setVisible(true);
            }
            if (showHp) seenStructureHp.add(id);

            // Build 156: Red dot indicator for enemy buildings
            const shouldShowEnemyIcon = !isFriendly && visible && (s.hp ?? 0) > 0;
            let enemyIcon = this.structureEnemyIcons.get(id);
            if (shouldShowEnemyIcon) {
              if (!enemyIcon) {
                enemyIcon = this.add.graphics();
                enemyIcon.fillStyle(0xff0000, 0.9);
                enemyIcon.fillCircle(0, 0, 5);
                enemyIcon.lineStyle(1.5, 0xffffff, 0.7);
                enemyIcon.strokeCircle(0, 0, 5);
                enemyIcon.setDepth(20);
                this.structureEnemyIcons.set(id, enemyIcon);
              }
              enemyIcon.setVisible(true);
              const topY = artSpec ? this.getStructureTopY(e as any) : s.y - TILE_SIZE * 0.5;
              enemyIcon.setPosition(e.x, topY - 14);
            } else if (enemyIcon) {
              enemyIcon.setVisible(false);
            }

          });
        } catch (err) {
          console.error("[BaseDefense] Error in structures loop:", err);
        }
      }
      for (const id of Object.keys(this.structureEntities)) {
        if (!seenStructures.has(id)) {
          this.structureEntities[id].destroy();
          delete this.structureEntities[id];
          this.destroyGroundShadow(this.structureShadowEntities[id]);
          delete this.structureShadowEntities[id];
          this.structureTexts[id]?.destroy();
          delete this.structureTexts[id];
          this.structureHpTexts[id]?.destroy();
          delete this.structureHpTexts[id];
          this.structureEnemyIcons.get(id)?.destroy();
          this.structureEnemyIcons.delete(id);
          if (this.selectedStructureId === id) this.selectedStructureId = null;
        }
      }
      for (const id of Object.keys(this.structureHpTexts)) {
        if (!seenStructureHp.has(id)) {
          this.structureHpTexts[id].destroy();
          delete this.structureHpTexts[id];
        }
      }
      this.perfEnd("syncStructures");
    }

    this.perfStart("syncResources");
    const seenResources = new Set<string>();
    
    if (state.resources?.forEach) {
      state.resources.forEach((r: any, id: string) => {
        seenResources.add(id);
        let e = this.resourceEntities[id];
        const rx = Number(r.x);
        const ry = Number(r.y);
        
        const inCamera = (rx >= camView.x - pad && rx <= camView.right + pad && ry >= camView.y - pad && ry <= camView.bottom + pad);
        const visible = (this.isVisibleToTeamWithFogMemory(rx, ry)) && inCamera;
        
        if (!e) {
          e = this.add.circle(rx, ry, TILE_SIZE * 0.26, 0x44ddaa).setStrokeStyle(2, 0xffffff).setDepth(11);
          this.resourceEntities[id] = e;
        }
        
        if (inCamera) {
          e.x = rx;
          e.y = ry;
          this.applyWorldDepth(e, e.y, WORLD_DEPTH_RESOURCE_OFFSET);
        }
        e.setVisible(visible);
      });
    }
    for (const id of Object.keys(this.resourceEntities)) {
      if (!seenResources.has(id)) {
        this.resourceEntities[id].destroy();
        delete this.resourceEntities[id];
      }
    }
    this.perfEnd("syncResources");

    this.perfStart("sendClientPoses");
    this.sendClientUnitPoses(nowMs);
    this.perfEnd("sendClientPoses");

    this.perfStart("autoEngage");
    this.autoEngageUnits(nowMs);
    this.perfEnd("autoEngage");

    this.perfStart("effectsAndFog");
    this.updateWorldFog(nowMs);
    this.updateTankTrailEffects(nowMs);
    this.updateUnitProjectileEffects(nowMs);

    if (this.tankShotEffects.length > 0) {
      const nowFx = Date.now();
      this.tankShotEffects = this.tankShotEffects.filter((fx) => {
        if (nowFx >= fx.expiresAt) {
          fx.line.destroy();
          fx.glow.destroy();
          return false;
        }
        const life = Math.max(0, (fx.expiresAt - nowFx) / 140);
        fx.line.setAlpha(0.15 + life * 0.75);
        fx.glow.setAlpha(0.2 + life * 0.8);
        return true;
      });
    }
    this.perfEnd("effectsAndFog");

    // Core is represented by the player entity in this mode; no separate core visuals.
    for (const id of Object.keys(this.coreEntities)) {
      this.coreEntities[id].destroy();
      delete this.coreEntities[id];
      this.coreTexts[id]?.destroy();
      delete this.coreTexts[id];
    }

    if (me?.isAlive && state.roundActive && !me.isCoreAnchored) {
      this.perfStart("playerMove");
      let dx = 0;
      let dy = 0;
      if (this.cursors.left.isDown || this.wasd.A.isDown) dx -= 1;
      if (this.cursors.right.isDown || this.wasd.D.isDown) dx += 1;
      if (this.cursors.up.isDown || this.wasd.W.isDown) dy -= 1;
      if (this.cursors.down.isDown || this.wasd.S.isDown) dy += 1;
      if (dx !== 0 || dy !== 0) {
        this.moveTarget = null;
        this.movePath = [];
      } else if (this.moveTarget && this.selectedUnitIds.size === 0) {
        const entity = this.playerEntities[this.currentPlayerId];
        if (entity) {
          if (this.movePath.length === 0) {
            this.recalcPathToTarget();
          }
          const waypoint = this.movePath.length > 0 ? this.movePath[0] : this.moveTarget;
          const tx = waypoint.x;
          const ty = waypoint.y;
          const vx = tx - entity.x;
          const vy = ty - entity.y;
          const dist = Math.sqrt(vx * vx + vy * vy);
          if (dist <= 6) {
            if (this.movePath.length > 0) this.movePath.shift();
            if (this.movePath.length === 0) {
              const fx = this.moveTarget.x - entity.x;
              const fy = this.moveTarget.y - entity.y;
              if (Math.sqrt(fx * fx + fy * fy) <= 8) {
                this.moveTarget = null;
              } else {
                const now = Date.now();
                if (now - this.lastPathRecalcAt > 300) {
                  this.lastPathRecalcAt = now;
                  this.recalcPathToTarget();
                }
              }
            }
          } else {
            dx = vx / dist;
            dy = vy / dist;
          }
        }
      }

      if (dx !== 0 || dy !== 0) {
        if (dx !== 0 && dy !== 0) {
          dx *= 0.7071;
          dy *= 0.7071;
        }
        const entity = this.playerEntities[this.currentPlayerId];
        if (entity) {
          const speed = (me.speed || 140) * (delta / 1000);
          const nextX = entity.x + dx * speed;
          const nextY = entity.y + dy * speed;
          const radius = TILE_SIZE * 0.3;
          if (this.canOccupy(nextX, nextY, radius)) {
            entity.x = nextX;
            entity.y = nextY;
          } else {
            let moved = false;
            if (this.canOccupy(nextX, entity.y, radius)) {
              entity.x = nextX;
              moved = true;
            }
            if (this.canOccupy(entity.x, nextY, radius)) {
              entity.y = nextY;
              moved = true;
            }
            if (!moved && this.moveTarget) {
              const now = Date.now();
              if (now - this.lastPathRecalcAt > 300) {
                this.lastPathRecalcAt = now;
                this.recalcPathToTarget();
              }
            }
          }
          const now = Date.now();
          if (now - this.lastMoveSentAt > 45) {
            this.room.send("move", { x: entity.x, y: entity.y });
            this.lastMoveSentAt = now;
          }
        }
      }
      this.perfEnd("playerMove");
    } else {
      this.moveTarget = null;
      this.movePath = [];
    }
  }

  reflowDefensiveAssignments(now: number) {
    if (now - this.lastDefensiveSlotRefreshAt < 4000) return;
    this.lastDefensiveSlotRefreshAt = now;
    if (!this.room?.state?.units?.forEach) return;

    const me = this.room.state.players.get ? this.room.state.players.get(this.currentPlayerId) : this.room.state.players?.[this.currentPlayerId];
    if (!me) return;

    const defensiveStructures: Array<{ x: number, y: number }> = [];
    if (this.room.state.cores?.forEach) {
        this.room.state.cores.forEach((c: any) => { if (c.team === me.team) defensiveStructures.push({ x: c.x, y: c.y }); });
    }
    if (this.room.state.structures?.forEach) {
        this.room.state.structures.forEach((s: any) => { 
            if (s.team === me.team && (s.type === "barracks" || s.type === "war_factory")) {
                defensiveStructures.push({ x: s.x, y: s.y });
            }
        });
    }
    if (defensiveStructures.length <= 0) return;

    const idleUnits: string[] = [];
    this.room.state.units.forEach((u: any, id: string) => {
        if (u.team !== me.team || (u.hp ?? 0) <= 0) return;
        if (this.hasLocalUnitManualCommand(id)) return;
        
        const distToTarget = Math.hypot(Number(u.targetX ?? u.x) - u.x, Number(u.targetY ?? u.y) - u.y);
        if (distToTarget > TILE_SIZE) return; // Busy moving
        
        idleUnits.push(id);
    });

    // Build 227: Group idle units by their nearest defensive structure.
    // This ensures units form clusters around the building they spawned from or are currently defending.
    const groupings = new Map<number, string[]>();
    for (const id of idleUnits) {
        const u = this.room.state.units.get ? this.room.state.units.get(id) : this.room.state.units?.[id];
        const rs = this.localUnitRenderState.get(id);
        const ux = Number(rs?.x ?? u.x);
        const uy = Number(rs?.y ?? u.y);

        let bestDist = Infinity;
        let bestStructIdx = -1;
        for (let si = 0; si < defensiveStructures.length; si++) {
            const s = defensiveStructures[si];
            const d = Math.hypot(ux - s.x, uy - s.y);
            if (d < bestDist) {
                bestDist = d;
                bestStructIdx = si;
            }
        }
        if (bestStructIdx !== -1) {
            if (!groupings.has(bestStructIdx)) groupings.set(bestStructIdx, []);
            groupings.get(bestStructIdx)!.push(id);
        }
    }

    // Process each building's group independently
    for (let si = 0; si < defensiveStructures.length; si++) {
        const struct = defensiveStructures[si];
        const assignedUnits = groupings.get(si) || [];
        if (assignedUnits.length <= 0) continue;

        // Maintain stability within the building's cluster
        assignedUnits.sort();

        // Start grid search from index 4 to stay outside the building's footprint
        let gridIndex = 4;
        
        for (const id of assignedUnits) {
            const u = this.room.state.units.get ? this.room.state.units.get(id) : this.room.state.units?.[id];
            const spacing = u.type === "tank" ? TILE_SIZE * 1.8 : TILE_SIZE * 1.15;
            const unitRadius = this.localUnitBodyRadius(u);

            let slot: {x: number, y: number} | null = null;
            let searchAttempts = 0;
            while (gridIndex < 500 && searchAttempts < 200) {
              const base = this.localFormationSlot(struct.x, struct.y, gridIndex, assignedUnits.length, spacing);
              gridIndex++;
              searchAttempts++;

              // Robust obstacle and reservation checking
              if (this.canOccupy(base.x, base.y, unitRadius + TILE_SIZE * 0.4)) {
                let blocked = false;
                
                // 1. Check current units
                if (this.room.state.units) {
                   for (const [otherId, otherU] of this.room.state.units.entries()) {
                     if (otherId === id || (otherU.hp ?? 0) <= 0) continue;
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

                // 2. Check 15-second reservations
                for (const [rid, rslot] of this.recentAssignedSlots.entries()) {
                  if (now - rslot.at > 15000) {
                    this.recentAssignedSlots.delete(rid);
                    continue;
                  }
                  if (rid !== id && Math.hypot(base.x - rslot.x, base.y - rslot.y) < spacing * 0.8) {
                    blocked = true;
                    break;
                  }
                }
                if (blocked) continue;

                slot = base;
                break;
              }
            }
            
            if (slot) {
              const rs = this.localUnitRenderState.get(id);
              const ux = Number(rs?.x ?? u.x);
              const uy = Number(rs?.y ?? u.y);
              if (Math.hypot(slot.x - ux, slot.y - uy) > TILE_SIZE * 1.2) {
                  this.localUnitTargetOverride.set(id, { x: slot.x, y: slot.y, setAt: now });
                  // Record reservation for 15s
                  this.recentAssignedSlots.set(id, { x: slot.x, y: slot.y, r: unitRadius + 2, at: now });
                  this.localUnitMovePriority.set(id, 0.5);
              }
            }
        }
    }
  }

  // --- RECONNECTION LOGIC Build 257 ---
  protected reconnectingOverlay?: Phaser.GameObjects.Container;
  protected isReconnecting = false;

  handleAccidentalDisconnect() {
    if (this.isReconnecting) return;
    this.isReconnecting = true;
    this.showNotice("Connection lost! Reconnecting...", "#ffcc00");
    this.tryToReconnect(1, 5);
  }

  async tryToReconnect(attempt: number, maxAttempts: number) {
    if (!this.room) return;
    console.log(`[BaseDefense] Reconnection attempt ${attempt}/${maxAttempts}...`);
    
    try {
      // client and activeClientBuildId come from network.ts
      // Build 258: Use reconnectionToken for Colyseus 0.16 compatibility
      const newRoom = await client.reconnect((this.room as any).reconnectionToken);
      console.log("[BaseDefense] RECONNECTED successfully!");
      
      this.isReconnecting = false;
      this.showNotice("Reconnected successfully!", "#00ff00");
      
      // Re-initialize with new room without restarting the whole scene
      // We pass a no-op as onReady because the state is already current
      this.setupRoom(newRoom, () => {}); 
    } catch (e) {
      if (attempt < maxAttempts) {
        this.time.delayedCall(2000, () => this.tryToReconnect(attempt + 1, maxAttempts));
      } else {
        this.isReconnecting = false;
        this.showConnectionLostOverlay();
      }
    }
  }

  showConnectionLostOverlay() {
    if (this.reconnectingOverlay) return;
    const cam = this.cameras.main;
    const overlay = this.add.container(cam.centerX, cam.centerY).setScrollFactor(0).setDepth(5000);
    const bg = this.add.rectangle(0, 0, cam.width, cam.height, 0x000000, 0.75);
    const txt = this.add.text(0, -30, "CONNECTION LOST", { fontSize: "32px", color: "#ff4444", fontStyle: "bold" }).setOrigin(0.5);
    const btn = this.add.text(0, 40, "TAP TO RETRY", { fontSize: "24px", color: "#ffffff", backgroundColor: "#333333" }).setPadding(10).setOrigin(0.5).setInteractive();
    btn.on("pointerdown", () => window.location.reload());
    overlay.add([bg, txt, btn]);
    this.reconnectingOverlay = overlay;
  }

  setupRoom(room: Room<any>, onReady: () => void) {
    this.room = room;
    this.currentPlayerId = room.sessionId;
    
    this.gridW = Number(this.room.state.mapWidth || 100);
    this.gridH = Number(this.room.state.mapHeight || 100);
    this.obstacleGrid = new Uint8Array(this.gridW * this.gridH);
    this.currentVisionGrid = new Uint8Array(this.gridW * this.gridH);

    this.room.onStateChange(() => {
      onReady();
    });

    this.room.onMessage("unit_damaged", (data: { victimId: string; shooterId: string }) => {
      const victim = (this.room.state.units as any)?.get ? (this.room.state.units as any).get(data.victimId) : (this.room.state.units as any)?.[data.victimId];
      if (victim && String(victim.ownerId || "") === this.currentPlayerId) {
          const attacker = (this.room.state.units as any)?.get ? (this.room.state.units as any).get(data.shooterId) : (this.room.state.units as any)?.[data.shooterId];
          if (attacker && (attacker.hp ?? 0) > 0) {
             const manualTarget = this.getLocalUnitManualTarget(data.victimId);
             if (!manualTarget || Math.hypot(attacker.x - victim.x, attacker.y - victim.y) < TILE_SIZE * 8) {
                 this.unitAttackTarget.set(data.victimId, data.shooterId);
                 this.autoEngagedUnitIds.add(data.victimId);
             }
          }
      }
    });

    this.room.onLeave((code) => {
      console.warn("[BaseDefense] DISCONNECTED:", code);
      if (code > 1001 && !this.localOnly) {
          this.handleAccidentalDisconnect();
      } else {
          this.showConnectionLostOverlay();
      }
    });
  }
}

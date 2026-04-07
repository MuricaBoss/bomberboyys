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
import { BaseDefenseScene_Hud } from "./BaseDefenseHud";

export class BaseDefenseScene_Advanced extends BaseDefenseScene_Hud {
  public tankTrailState = new Map<string, any>();
  protected unitAutoRallied?: Set<string>;

  constructor() {
    super("BaseDefenseScene_Advanced");
  }

  init(data?: { localOnly?: boolean }) {
    this.localOnly = data?.localOnly ?? false;
  }

  preload() {
    // Build 95: Using optimized low-res PNG textures for mobile performance
    const path = "assets/low";
    this.load.image("rts_ground", `${path}/rts_ground_texture_winter.png`);
    this.load.image("rts_button_base", `${path}/rts_button_base.png`);
    this.load.image("rts_button_active", `${path}/rts_button_active.png`);
    
    RTS_BLOCK_TEXTURE_KEYS.forEach(key => {
      this.load.image(key, `${path}/blocks/${key}.png`);
    });

    this.load.image(RTS_UI_TEXTURE_KEYS.move_target_marker, "assets/ui/move_target_marker.svg");
    
    this.load.image(RTS_BUILDING_TEXTURE_KEYS.constructor, `${path}/buildings/constructor.png`);
    this.load.image(RTS_BUILDING_TEXTURE_KEYS.ore_refinery, `${path}/buildings/ore_refinery.png`);
    this.load.image(RTS_BUILDING_TEXTURE_KEYS.solar_panel, `${path}/buildings/solar_panel.png`);
    this.load.image(RTS_BUILDING_TEXTURE_KEYS.barracks, `${path}/buildings/barracks.png`);
    this.load.image(RTS_BUILDING_TEXTURE_KEYS.war_factory, `${path}/buildings/war_factory.png`);

    this.load.image(RTS_TANK_TEXTURE_KEYS.n, `${path}/tanks/tank_ready_n.png`);
    this.load.image(RTS_TANK_TEXTURE_KEYS.ne, `${path}/tanks/tank_ready_ne.png`);
    this.load.image(RTS_TANK_TEXTURE_KEYS.e, `${path}/tanks/tank_ready_e.png`);
    this.load.image(RTS_TANK_TEXTURE_KEYS.se, `${path}/tanks/tank_ready_se.png`);
    this.load.image(RTS_TANK_TEXTURE_KEYS.s, `${path}/tanks/tank_ready_s.png`);
    this.load.image(RTS_TANK_TEXTURE_KEYS.sw, `${path}/tanks/tank_ready_sw.png`);
    this.load.image(RTS_TANK_TEXTURE_KEYS.w, `${path}/tanks/tank_ready_w.png`);
    this.load.image(RTS_TANK_TEXTURE_KEYS.nw, `${path}/tanks/tank_ready_nw.png`);

    this.load.spritesheet(RTS_SOLDIER_SPRITESHEET_KEYS.run, `${path}/soldier/run.png`, {
      frameWidth: RTS_SOLDIER_FRAME_SIZE,
      frameHeight: RTS_SOLDIER_FRAME_SIZE,
    });
    this.load.spritesheet(RTS_SOLDIER_SPRITESHEET_KEYS.shoot, `${path}/soldier/shoot.png`, {
      frameWidth: RTS_SOLDIER_FRAME_SIZE,
      frameHeight: RTS_SOLDIER_FRAME_SIZE,
    });
  }

  async create() {
    this.clientClockStartedAt = Date.now();
    this.ensureSoldierAnimations();
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
      this.currentPlayerId = "local-player";
      this.room = this.createLocalBaseDefenseRoom();
      finishWorldInit();
    } else {
      try {
        this.room = await this.withTimeout(client.joinOrCreate("base_defense_room"), 8000, "joinOrCreate");
        this.currentPlayerId = this.room.sessionId;
        
        // Build 99: Initialize O(1) grids
        this.gridW = Number(this.room.state.mapWidth || 100);
        this.gridH = Number(this.room.state.mapHeight || 100);
        this.obstacleGrid = new Uint8Array(this.gridW * this.gridH);
        this.currentVisionGrid = new Uint8Array(this.gridW * this.gridH);

        this.room.onStateChange(() => {
          finishWorldInit();
        });
        this.room.onLeave((code) => {
          console.warn("[BaseDefense] DISCONNECTED:", code);
          const overlay = this.add.container(this.cameras.main.centerX, this.cameras.main.centerY).setScrollFactor(0).setDepth(5000);
          const bg = this.add.rectangle(0, 0, this.cameras.main.width, this.cameras.main.height, 0x000000, 0.7);
          const txt = this.add.text(0, -30, "CONNECTION LOST", { fontSize: "32px", color: "#ff4444", fontStyle: "bold" }).setOrigin(0.5);
          const btn = this.add.text(0, 40, "TAP TO RETRY", { fontSize: "24px", color: "#ffffff", backgroundColor: "#333333" }).setPadding(10).setOrigin(0.5).setInteractive();
          btn.on("pointerdown", () => window.location.reload());
          overlay.add([bg, txt, btn]);
        });
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

    this.room.onMessage("unit_damaged", (data: { victimId: string; shooterId: string }) => {
      const victim = (this.room.state.units as any)?.get ? (this.room.state.units as any).get(data.victimId) : (this.room.state.units as any)?.[data.victimId];
      if (victim && String(victim.ownerId || "") === this.currentPlayerId) {
          // My unit was hit! Automatically retaliate if not busy with a manual move far away.
          const attacker = (this.room.state.units as any)?.get ? (this.room.state.units as any).get(data.shooterId) : (this.room.state.units as any)?.[data.shooterId];
          if (attacker && (attacker.hp ?? 0) > 0) {
             // Only switch if we don't have a high-priority manual move target close by
             const override = this.localUnitTargetOverride.get(data.victimId);
             if (!override || Math.hypot(attacker.x - victim.x, attacker.y - victim.y) < TILE_SIZE * 8) {
                 this.unitAttackTarget.set(data.victimId, data.shooterId);
                 this.autoEngagedUnitIds.add(data.victimId);
             }
          }
      }
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
                this.localUnitMovePriority.delete(uid);
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
                this.localUnitMovePriority.delete(uid);
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
        // Build 116: Removed clamp
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
  }

  initializeWorld() {
    this.hasInitialized = true;
    const state = this.room.state;
    this.cameras.main.setBackgroundColor(0x1f5f1f);
    this.cameras.main.setZoom(1);
    this.syncWorldBackground(state.mapWidth * TILE_SIZE, state.mapHeight * TILE_SIZE);
    this.drawMap(state);
    this.mapCache = Array.from(state.map as number[]);
    if (!this.worldFogGraphics) {
      this.worldFogGraphics = this.add.graphics().setDepth(90);
    }
    this.worldFogGraphics.setVisible(true);
    this.cameras.main.removeBounds();
    
    // Build 115: Re-introduced ONLY the initial-join snap, but with a safe-bounds check.
    const me = state.players?.get ? state.players.get(this.currentPlayerId) : state.players?.[this.currentPlayerId];
    if (me && !this.hasHadInitialCameraSnap && me.x > 10 && me.y > 10) {
      this.setCameraCenterWorld(Number(me.x), Number(me.y));
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
    let occupied = false;
    this.room.state.units.forEach((u: any, id: string) => {
      if (occupied) return;
      if (id === ignoreUnitId) return;
      if ((u.hp ?? 0) <= 0) return;
      const ux = Math.floor(Number(u.x) / TILE_SIZE);
      const uy = Math.floor(Number(u.y) / TILE_SIZE);
      if (ux === gx && uy === gy) occupied = true;
    });
    return occupied;
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

  updateWorldFog(now: number) {
    if (!this.worldFogGraphics || !this.room?.state) return;
    const cam = this.cameras.main.worldView;
    const camMoved = !Number.isFinite(this.lastFogCamX)
      || Math.abs(cam.x - this.lastFogCamX) >= FOG_CELL_SIZE * 2
      || Math.abs(cam.y - this.lastFogCamY) >= FOG_CELL_SIZE * 2;
    if (!camMoved && now - this.lastWorldFogDrawAt < FOG_UPDATE_MS) return;
    this.lastWorldFogDrawAt = now;
    this.lastFogCamX = cam.x;
    this.lastFogCamY = cam.y;
    if (!this.lastFogTickAt) this.lastFogTickAt = now;
    const dtSec = Math.max(0, Math.min(0.2, (now - this.lastFogTickAt) / 1000));
    this.lastFogTickAt = now;
    this.fogClockSec += dtSec;
    const worldW = this.room.state.mapWidth * TILE_SIZE;
    const worldH = this.room.state.mapHeight * TILE_SIZE;
    const cols = Math.ceil(worldW / FOG_CELL_SIZE);
    const rows = Math.ceil(worldH / FOG_CELL_SIZE);
    const total = cols * rows;
    if (!this.fogSeenAt || this.fogCols !== cols || this.fogRows !== rows || this.fogSeenAt.length !== total) {
      this.fogCols = cols;
      this.fogRows = rows;
      this.fogSeenAt = new Float32Array(total);
      this.fogSeenAt.fill(-9999);
    }
    const seenAt = this.fogSeenAt;
    for (const src of this.visionSources) {
      const radius = Math.sqrt(src.r2);
      const minCol = Math.max(0, Math.floor((src.x - radius) / FOG_CELL_SIZE));
      const maxCol = Math.min(cols - 1, Math.ceil((src.x + radius) / FOG_CELL_SIZE));
      const minRow = Math.max(0, Math.floor((src.y - radius) / FOG_CELL_SIZE));
      const maxRow = Math.min(rows - 1, Math.ceil((src.y + radius) / FOG_CELL_SIZE));
      for (let row = minRow; row <= maxRow; row++) {
        const y = row * FOG_CELL_SIZE + FOG_CELL_SIZE * 0.5;
        const dy = y - src.y;
        const maxDx2 = src.r2 - dy * dy;
        if (maxDx2 < 0) continue;
        const dx = Math.sqrt(maxDx2);
        const rowOffset = row * cols;
        const fromCol = Math.max(minCol, Math.floor((src.x - dx) / FOG_CELL_SIZE));
        const toCol = Math.min(maxCol, Math.ceil((src.x + dx) / FOG_CELL_SIZE));
        for (let col = fromCol; col <= toCol; col++) {
          seenAt[rowOffset + col] = this.fogClockSec;
        }
      }
    }

    const g = this.worldFogGraphics;
    g.clear();
    const visibleHoldSec = 0.35;
    const fadeToDarkSec = 16;
    const drawMarginPx = Math.max(cam.width, cam.height) * 0.5;
    const drawStartCol = Math.max(0, Math.floor((cam.x - drawMarginPx) / FOG_CELL_SIZE));
    const drawEndCol = Math.min(cols - 1, Math.ceil((cam.right + drawMarginPx) / FOG_CELL_SIZE));
    const drawStartRow = Math.max(0, Math.floor((cam.y - drawMarginPx) / FOG_CELL_SIZE));
    const drawEndRow = Math.min(rows - 1, Math.ceil((cam.bottom + drawMarginPx) / FOG_CELL_SIZE));
    const alphaFromSeenTime = (seenTime: number) => {
      if (seenTime <= -1000) return 0.9;
      const ageSec = Math.max(0, this.fogClockSec - seenTime);
      if (ageSec <= visibleHoldSec) return 0;
      const t = Math.min(1, (ageSec - visibleHoldSec) / fadeToDarkSec);
      return 0.14 + t * 0.76;
    };
    for (let row = drawStartRow; row <= drawEndRow; row++) {
      const rowOffset = row * cols;
      const rowUp = (row > 0 ? row - 1 : row) * cols;
      const rowDown = (row < rows - 1 ? row + 1 : row) * cols;
      for (let col = drawStartCol; col <= drawEndCol; col++) {
        const c0 = col > 0 ? col - 1 : col;
        const c2 = col < cols - 1 ? col + 1 : col;
        const center = alphaFromSeenTime(seenAt[rowOffset + col]) * 0.52;
        const neigh = (
          alphaFromSeenTime(seenAt[rowOffset + c0]) +
          alphaFromSeenTime(seenAt[rowOffset + c2]) +
          alphaFromSeenTime(seenAt[rowUp + col]) +
          alphaFromSeenTime(seenAt[rowDown + col])
        ) * 0.12;
        const alpha = center + neigh;
        if (alpha <= 0.01) continue;
        g.fillStyle(0x000000, alpha);
        g.fillRect(col * FOG_CELL_SIZE, row * FOG_CELL_SIZE, FOG_CELL_SIZE, FOG_CELL_SIZE);
      }
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
        // Only collect if visible to player (to respect fog of war)
        if (!this.isVisibleToTeam(ex, ey)) return;
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

      // Find nearest enemy in range
      let nearestEnemy: { id: string; x: number; y: number } | null = null;
      let nearestDist = engageRange;
      for (const e of enemies) {
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
          const override = this.localUnitTargetOverride.get(id);
          if (override && nearestDist > threatRange) {
            const distToSlot = Math.hypot(override.x - ux, override.y - uy);
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
    }
  }


    update(_time: number, delta: number) {
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
    this.perfStart("syncMap");
    this.syncMap();
    this.perfEnd("syncMap");
    const state = this.room.state;
    const players = state.players;
    const me = players?.get ? players.get(this.currentPlayerId) : players?.[this.currentPlayerId];

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
    this.perfEnd("camera");
    let nowMs = Date.now();
    this.drawMoveClickMarker(nowMs);
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
    
    this.reportClientPerformance();

    const myTeam = me?.team;
    if (this.fpsText) {
       this.fpsText.setText(`FPS: ${Math.round(this.game.loop.actualFps)}`);
       if (this.game.loop.actualFps < 24) this.fpsText.setColor("#ff4444");
       else if (this.game.loop.actualFps < 28) this.fpsText.setColor("#ffff44");
       else this.fpsText.setColor("#00ff00");
    }
    this.perfStart("syncPlayers");
    const seenPlayers = new Set<string>();
    if (players?.forEach) {
      this.refreshVisionSources(myTeam);
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
            e = this.add.image(p.x, p.y, RTS_BUILDING_TEXTURE_KEYS.constructor)
              .setOrigin(0.5, RTS_PLAYER_CONSTRUCTOR_ORIGIN_Y)
              .setDisplaySize(RTS_PLAYER_CONSTRUCTOR_DISPLAY_SIZE, RTS_PLAYER_CONSTRUCTOR_DISPLAY_SIZE);
          } else {
            e = this.add.sprite(p.x, p.y, RTS_SOLDIER_SPRITESHEET_KEYS.run, 0)
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
            e.play(this.getSoldierAnimKey("idle", 2), true);
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
    const seenUnitHp = new Set<string>();
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
        const inCamera = this.cameras.main.worldView.contains(u.x, u.y);
        const visible = (isFriendly || this.isVisibleToTeamWithFogMemory(Number(u.x), Number(u.y))) && inCamera;
        const baseColor = isHarvester
          ? (isFriendly ? 0xe3c44a : 0xd4873c)
          : isTank
            ? (isFriendly ? 0x8ea7bf : 0xd24d2e)
            : (isFriendly ? 0x6ec4ff : 0xff4f1a);
        const radius = isHarvester ? TILE_SIZE * 0.18 : isTank ? TILE_SIZE * 0.3 : TILE_SIZE * 0.22;
        let dir = this.unitFacing.get(id) ?? (typeof u.dir === "number" ? u.dir : 0);
        if (!this.unitFacing.has(id)) this.unitFacing.set(id, dir);
        if (
          !e
          || (isTank && !(e instanceof Phaser.GameObjects.Image))
          || (isSoldier && !(e instanceof Phaser.GameObjects.Sprite))
          || (!isTank && !isSoldier && !(e instanceof Phaser.GameObjects.Arc))
        ) {
          if (e) e.destroy();
          if (isTank) {
            e = this.add.image(u.x, u.y, this.getTankTextureKeyByDir(this.unitFacing.get(id) ?? 0))
              .setOrigin(0.5, RTS_TANK_ORIGIN_Y)
              .setDepth(16);
          } else if (isSoldier) {
            e = this.add.sprite(u.x, u.y, RTS_SOLDIER_SPRITESHEET_KEYS.run, 0)
              .setOrigin(0.5, RTS_SOLDIER_ORIGIN_Y)
              .setDepth(16);
          } else {
            e = this.add.arc(u.x, u.y, radius, 0, 360, false, baseColor).setStrokeStyle(1.5, 0xffffff);
            e.setDepth(16);
          }
          this.unitEntities[id] = e;

          // ----- AUTOMATIC CLIENT RALLY POINT -----
          if (isLocalOwned && String(u.aiState || "") === "idle" && (u.hp ?? 0) > 0 && !this.unitAutoRallied?.has(id)) {
            if (!this.unitAutoRallied) this.unitAutoRallied = new Set();
            this.unitAutoRallied.add(id);
            // New unit just popped out of our factory. Tell it to move to a clear slot nearby!
            // We use a fixed point slightly below the exit so the grid spiral naturally fills space
            // downwards without random detours.
            const tgtX = u.x;
            const tgtY = u.y + 60;
            
            // Temporarily trick the client into running the full collision-aware movement dispatch for this unit
            const tmpSelected = new Set(this.selectedUnitIds);
            this.selectedUnitIds = new Set([id]);
            // @ts-ignore
            if (typeof this.issueLocalUnitMoveCommand === "function") {
              // @ts-ignore
              this.issueLocalUnitMoveCommand(tgtX, tgtY);
            }
            this.selectedUnitIds = tmpSelected;
          }
        }

        // 1. Synchronize Position (Interpolation)
        this.updateUnitRenderPos(id, e as any, u, delta, isLocalOwned, isTank);
        const rs = this.localUnitRenderState.get(id);
        const ux = Number(rs?.x ?? u.x);
        const uy = Number(rs?.y ?? u.y);

        // 2. Calculate Orientation (Direction)
        const atkTargetId = this.unitAttackTarget.get(id);
        if (isTank || isSoldier) {
          const vx = Number(rs?.vx ?? 0);
          const vy = Number(rs?.vy ?? 0);
          const speed = Math.hypot(vx, vy);
          const isIdle = String(u.aiState || "") === "idle";
          const committedDir = this.unitFacing.get(id);
          const moving = (speed > 1) || (String(u.aiState || "") === "walking");

          if (isLocalOwned && moving) {
            dir = this.angleToDir8(Math.atan2(vy, vx));
          } else if (committedDir !== undefined && !moving && !atkTargetId) {
            dir = committedDir; // Hold last stable direction when idle/stopping
          } else if (typeof u.dir === "number" && u.dir >= 0 && u.dir < 8) {
            dir = u.dir;
          } else {
            const lastShot = this.unitLastShotDir.get(id);
            const atkTarget = atkTargetId
              ? (this.room?.state?.units?.get ? this.room.state.units.get(atkTargetId) : this.room?.state?.units?.[atkTargetId])
              : null;

            if (lastShot && (Date.now() - lastShot.at) < 800) {
              dir = lastShot.dir;
            } else if (atkTarget && (atkTarget.hp ?? 0) > 0) {
              const atkX = Number(atkTarget.x) - ux;
              const atkY = Number(atkTarget.y) - uy;
              if (Math.hypot(atkX, atkY) > 0.5) dir = this.angleToDir8(Math.atan2(atkY, atkX));
            } else if (moving) {
              dir = this.angleToDir8(Math.atan2(vy, vx));
            }
          }

          if (isLocalOwned && !moving && !atkTargetId) {
            const vote = this.unitDirVote.get(id);
            if (vote) {
              this.unitFacing.set(id, vote.dir);
              this.unitDirVote.delete(id);
              dir = vote.dir;
            }
          }
        }

        // 3. Update Visuals
        if (isTank) {
          const committedDir = this.unitFacing.get(id) ?? dir;
          if (dir !== committedDir) {
            const vote = this.unitDirVote.get(id);
            if (vote && vote.dir === dir) {
              vote.count += 1;
              if (vote.count >= 5) {
                this.unitFacing.set(id, dir);
                this.unitDirVote.delete(id);
              } else {
                dir = committedDir;
              }
            } else {
              this.unitDirVote.set(id, { dir, count: 1 });
              dir = committedDir;
            }
          } else {
            this.unitDirVote.delete(id);
            dir = committedDir;
          }

          const tankTextureKey = this.getTankTextureKeyByDir(dir);
          const tank = e as Phaser.GameObjects.Image;
          if (tank.texture?.key !== tankTextureKey) tank.setTexture(tankTextureKey);
          tank.setOrigin(0.5, RTS_TANK_ORIGIN_Y);
          tank.setDisplaySize(RTS_TANK_DISPLAY_SIZE, RTS_TANK_DISPLAY_SIZE);
          if (u.hp <= 0) tank.setTint(0x444444);
          else if (isFriendly) tank.clearTint();
          else tank.setTint(0xff2222);
        } else if (isSoldier) {
          const committedDir = this.unitFacing.get(id) ?? dir;
          if (dir !== committedDir) {
            const vote = this.unitDirVote.get(id);
            if (vote && vote.dir === dir) {
              vote.count += 1;
              if (vote.count >= 5) {
                this.unitFacing.set(id, dir);
                this.unitDirVote.delete(id);
              } else {
                dir = committedDir;
              }
            } else {
              this.unitDirVote.set(id, { dir, count: 1 });
              dir = committedDir;
            }
          } else {
            this.unitDirVote.delete(id);
            dir = committedDir;
          }

          const soldier = e as Phaser.GameObjects.Sprite;
          soldier.setOrigin(0.5, RTS_SOLDIER_ORIGIN_Y);
          soldier.setDisplaySize(RTS_SOLDIER_DISPLAY_SIZE, RTS_SOLDIER_DISPLAY_SIZE);
          const moving = Math.hypot(Number(rs?.vx ?? 0), Number(rs?.vy ?? 0)) > 14
            || (String(u.aiState || "") === "walking" && Math.hypot(Number(u.targetX ?? u.x) - ux, Number(u.targetY ?? u.y) - uy) > TILE_SIZE * 0.24);
          const isShooting = !moving && this.unitAttackTarget.has(id);
          const animKey = this.getSoldierAnimKey(isShooting ? "shoot" : moving ? "run" : "idle", dir);
          if (soldier.anims.currentAnim?.key !== animKey) soldier.anims.play(animKey, true);
          if (u.hp <= 0) soldier.setTint(0x444444);
          else if (isFriendly) soldier.clearTint();
          else soldier.setTint(0xff2222);
        } else if ("setRadius" in e) {
          (e as Phaser.GameObjects.Arc).setRadius(radius);
          (e as Phaser.GameObjects.Arc).setFillStyle(u.hp <= 0 ? 0x444444 : baseColor, 1);
        }

        if (e.visible !== visible) e.setVisible(visible);
        this.applyWorldDepth(e, e.y, WORLD_DEPTH_UNIT_OFFSET);

        // 4. Update Effects & Shadows
        if (inCamera) {
          if (isTank && e instanceof Phaser.GameObjects.Image) {
            // Only update trail if it's NOT a brand new unit to avoid 0,0 glitches
            const isNew = !this.tankTrailState.has(id);
            this.updateTankTrailForUnit(id, e, visible && (u.hp ?? 0) > 0);
            if (isNew) {
                const trailState = this.tankTrailState.get(id);
                if (trailState) {
                    trailState.lastSpawnX = e.x;
                    trailState.lastSpawnY = e.y;
                }
            }

            const shadowSpec = this.getTankShadowSpec(e);
            const shadow = this.syncGroundShadow(
              this.unitShadowEntities[id],
              shadowSpec.x,
              shadowSpec.y,
              shadowSpec.width,
              shadowSpec.height,
              shadowSpec.y,
              e.y,
              WORLD_DEPTH_UNIT_OFFSET,
              RTS_IMAGE_SHADOW_ALPHA,
            );
            shadow.setVisible(visible);
            this.unitShadowEntities[id] = shadow;
            
            this.maybeFireUnitProjectile(id, u, e, isFriendly, visible, dir, isTank);
          } else if (isSoldier && e instanceof Phaser.GameObjects.Sprite) {
            const shadowSpec = this.getSoldierShadowSpec(e);
            const shadow = this.syncGroundShadow(
              this.unitShadowEntities[id],
              shadowSpec.x,
              shadowSpec.y,
              shadowSpec.width,
              shadowSpec.height,
              shadowSpec.y,
              e.y,
              WORLD_DEPTH_UNIT_OFFSET,
              RTS_IMAGE_SHADOW_ALPHA,
            );
            shadow.setVisible(visible);
            this.unitShadowEntities[id] = shadow;
            this.maybeFireUnitProjectile(id, u, e, isFriendly, visible, dir, isTank);
          } else if (this.unitShadowEntities[id]) {
            this.destroyGroundShadow(this.unitShadowEntities[id]);
            delete this.unitShadowEntities[id];
          }
          if (isTank && e instanceof Phaser.GameObjects.Image && (u.hp ?? 0) > 0) {
            this.updateTankTrailForUnit(id, e, visible);
          }
        }
        e.setVisible(visible);

        const shouldShowEnemyIcon = !isFriendly && visible && (u.hp ?? 0) > 0;
        let enemyIcon = this.unitEnemyIcons.get(id);
        if (shouldShowEnemyIcon) {
          if (!enemyIcon) {
            enemyIcon = this.add.graphics();
            enemyIcon.fillStyle(0xff0000, 0.9);
            enemyIcon.fillCircle(0, 0, 4.5);
            enemyIcon.lineStyle(1.5, 0xffffff, 0.7);
            enemyIcon.strokeCircle(0, 0, 4.5);
            enemyIcon.setDepth(20);
            this.unitEnemyIcons.set(id, enemyIcon);
          }
          enemyIcon.setVisible(true);
          const topY = this.getSpriteTopY(e as any);
          enemyIcon.setPosition(e.x, topY - 14);
        } else if (enemyIcon) {
          enemyIcon.setVisible(false);
        }

        const shouldShowRing = !!myTeam && u.team === myTeam && this.selectedUnitIds.has(id);
        let ring = this.unitSelectionRings[id];
        const showHp = visible && u.hp > 0 && (!isFriendly || shouldShowRing || isTank);
        if (shouldShowRing && u.hp > 0) {
          const ringSize = isTank && e instanceof Phaser.GameObjects.Image
            ? this.getTankSelectionBoxSize(e)
            : TILE_SIZE * 0.7;
          const ringY = isTank && e instanceof Phaser.GameObjects.Image
            ? this.getTankSelectionY(e, dir)
            : e.y + 2;
          if (!ring) {
            ring = this.add.rectangle(e.x, ringY, ringSize, ringSize, 0x00ffcc, 0).setStrokeStyle(2, 0x00ffcc).setDepth(15);
            this.unitSelectionRings[id] = ring;
          }
          ring.setDisplaySize(ringSize, ringSize);
          ring.x = e.x;
          ring.y = ringY;
          this.applyWorldDepth(ring, e.y, WORLD_DEPTH_SELECTION_OFFSET);
          ring.setVisible(visible);
        } else if (ring) {
          ring.setVisible(false);
        }
        if (showHp) {
          let hp = this.unitHpTexts[id];
          if (!hp) {
            hp = this.add.text(e.x, e.y - TILE_SIZE * 0.46, "", {
              fontSize: "11px",
              color: "#ffffff",
              fontFamily: "Arial",
              backgroundColor: "#00000088",
            }).setPadding(3, 1, 3, 1).setOrigin(0.5, 1).setDepth(18);
            this.unitHpTexts[id] = hp;
          }
          hp.setText(`${Math.max(0, Math.floor(u.hp || 0))}/${Math.max(1, Math.floor(u.maxHp || 1))}`);
          hp.setPosition(e.x, isTank && e instanceof Phaser.GameObjects.Image ? this.getTankHpY(e) : e.y - TILE_SIZE * 0.46);
          this.applyWorldDepth(hp, e.y, WORLD_DEPTH_HP_OFFSET);
          hp.setVisible(true);
          seenUnitHp.add(id);
        }
      });
      } catch (err) {
        console.error("[BaseDefense] Error in units loop:", err);
      }
    }
    for (const id of Object.keys(this.unitEntities)) {
      if (!seenUnits.has(id)) {
        this.unitEntities[id].destroy();
        delete this.unitEntities[id];
        this.destroyGroundShadow(this.unitShadowEntities[id]);
        delete this.unitShadowEntities[id];
        this.unitFacing.delete(id);
        this.unitDirVote.delete(id);
        this.tankTrailState.delete(id);
        this.unitClientPathCache.delete(id);
        this.localUnitRenderState.delete(id);
        this.lastUnitPoseState.delete(id);
        this.localUnitJamTicks.delete(id);
        this.localUnitTargetOverride.delete(id);
        this.soldierLastShotAt.delete(id);
        this.localUnitMovePriority.delete(id);
        this.unitSelectionRings[id]?.destroy();
        delete this.unitSelectionRings[id];
        this.unitHpTexts[id]?.destroy();
        delete this.unitHpTexts[id];
        this.unitEnemyIcons.get(id)?.destroy();
        this.unitEnemyIcons.delete(id);
        this.selectedUnitIds.delete(id);
        this.autoEngagedUnitIds.delete(id);
        this.unitAttackTarget.delete(id);
        this.unitLastShotDir.delete(id);
      }
    }
    for (const id of Object.keys(this.unitHpTexts)) {
      if (!seenUnitHp.has(id)) {
        this.unitHpTexts[id].destroy();
        delete this.unitHpTexts[id];
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
            const inCamera = this.cameras.main.worldView.contains(s.x, s.y);
            const isFriendly = !!myTeam && s.team === myTeam;
            const visible = (isFriendly || this.isVisibleToTeamWithFogMemory(Number(s.x), Number(s.y))) && inCamera;

            if (!e) {
              if (artSpec) {
                e = this.add.image(s.x, s.y, artSpec.key)
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
              if (e.texture?.key !== artSpec.key) e.setTexture(artSpec.key);
              if (e.originY !== artSpec.originY) e.setOrigin(0.5, artSpec.originY);
              if (Math.abs(e.displayWidth - artSpec.size) > 0.1) e.setDisplaySize(artSpec.size, artSpec.size);
              if (isFriendly) { if (e.isTinted) e.clearTint(); }
              else { if (!e.isTinted) e.setTint(0xffd0d0); }
            }
            
            if (e.visible !== visible) e.setVisible(visible);

            if (visible && isCriticalUpdate) {
              this.applyWorldDepth(e, e.y, WORLD_DEPTH_STRUCTURE_OFFSET);
              // Shadow removal as per user request
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
            if (showHp) seenStructureHp.add(id); // Build 101: Keep label alive between syncs
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
        const inCamera = this.cameras.main.worldView.contains(r.x, r.y);
        const visible = (this.isVisibleToTeamWithFogMemory(Number(r.x), Number(r.y))) && inCamera;
        if (!e) {
          e = this.add.circle(r.x, r.y, TILE_SIZE * 0.26, 0x44ddaa).setStrokeStyle(2, 0xffffff).setDepth(11);
          this.resourceEntities[id] = e;
        }
        e.x = r.x;
        e.y = r.y;
        this.applyWorldDepth(e, e.y, WORLD_DEPTH_RESOURCE_OFFSET);
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
}

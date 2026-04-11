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
import { BaseDefenseScene_Render } from "./BaseDefenseRender";

export class BaseDefenseScene_Input extends BaseDefenseScene_Render {
  isTouchPointer(pointer: Phaser.Input.Pointer) {
    const event = pointer.event as PointerEvent | TouchEvent | MouseEvent | undefined;
    const pointerType = "pointerType" in (event || {}) ? (event as PointerEvent).pointerType : "";
    return pointerType === "touch" || String(event?.type || "").startsWith("touch");
  }

  getClampedScrollForCurrentView(scrollX: number, scrollY: number) {
    return { scrollX, scrollY };
  }

  setCameraCenterWorld(centerX: number, centerY: number) {
    if (!this.room?.state) return;
    const cam = this.cameras.main;
    this.cameraFocusWorldX = centerX;
    this.cameraFocusWorldY = centerY;
    const next = this.getCameraScrollForCenterWorld(centerX, centerY);
    cam.scrollX = next.scrollX;
    cam.scrollY = next.scrollY;
    this.syncCameraFocusToView();
  }

  getSelectionEdgePanIntent(pointer: Phaser.Input.Pointer) {
    if (!this.selectionStart || !this.isDraggingSelection || !pointer.isDown) return { x: 0, y: 0 };
    const cam = this.cameras.main;
    const edge = 22;
    let x = 0;
    let y = 0;
    if (pointer.x <= edge) x = -((edge - pointer.x) / edge);
    else if (pointer.x >= cam.width - edge) x = (pointer.x - (cam.width - edge)) / edge;
    if (pointer.y <= edge) y = -((edge - pointer.y) / edge);
    else if (pointer.y >= cam.height - edge) y = (pointer.y - (cam.height - edge)) / edge;
    return { x: Phaser.Math.Clamp(x, -1, 1), y: Phaser.Math.Clamp(y, -1, 1) };
  }

  clampCameraToWorld() {
    if (!this.room?.state) return;
    const cam = this.cameras.main;
    const worldW = this.room.state.mapWidth * TILE_SIZE;
    const worldH = this.room.state.mapHeight * TILE_SIZE;
    const viewW = cam.width / cam.zoom;
    const viewH = cam.height / cam.zoom;
    const maxX = Math.max(0, worldW - viewW);
    const maxY = Math.max(0, worldH - viewH);
    cam.scrollX = Phaser.Math.Clamp(cam.scrollX, 0, maxX);
    cam.scrollY = Phaser.Math.Clamp(cam.scrollY, 0, maxY);
  }

  updateRtsCamera(_delta: number) {
    if (this.touchPinching && this.getActiveTouchPointers().length >= 2) {
      this.camVelX = 0;
      this.camVelY = 0;
      return;
    }
    const dt = Math.max(0.001, Math.min(0.05, _delta / 1000));
    const pointer = this.input.activePointer;
    const edgeIntent = this.getSelectionEdgePanIntent(pointer);
    if (edgeIntent.x === 0 && edgeIntent.y === 0) {
      this.camVelX = 0;
      this.camVelY = 0;
      return;
    }
    const len = Math.hypot(edgeIntent.x, edgeIntent.y);
    const nx = len > 1 ? edgeIntent.x / len : edgeIntent.x;
    const ny = len > 1 ? edgeIntent.y / len : edgeIntent.y;
    const cam = this.cameras.main;
    const speed = 520 / cam.zoom;
    cam.scrollX += nx * speed * dt;
    cam.scrollY += ny * speed * dt;
    // Build 116: removed clamp
  }

  getPointerWorld(pointer: Phaser.Input.Pointer) {
    const cam = this.cameras.main;
    cam.preRender();
    pointer.updateWorldPoint(cam);
    return new Phaser.Math.Vector2(pointer.worldX, pointer.worldY);
  }

  beginTouchPinch() {
    const pointers = this.getActiveTouchPointers();
    if (pointers.length < 2) return false;
    const [a, b] = pointers;
    this.cameraCenterTween?.remove();
    this.cameraCenterTween = null;
    this.cameraClampBackX = null;
    this.cameraClampBackY = null;
    this.syncCameraFocusToView();
    this.touchPinching = true;
    this.touchPinchStartDist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    this.touchPinchStartZoom = this.cameras.main.zoom;
    const midX = (a.x + b.x) * 0.5;
    const midY = (a.y + b.y) * 0.5;
    this.touchWorldFocusX = this.cameras.main.worldView.centerX;
    this.touchWorldFocusY = this.cameras.main.worldView.centerY;
    this.touchPinchLastMidX = midX;
    this.touchPinchLastMidY = midY;
    this.touchPinchLastDist = this.touchPinchStartDist;
    this.touchPinchLastMoveAt = performance.now();
    this.touchPinchLockedScrollX = this.cameras.main.scrollX;
    this.touchPinchLockedScrollY = this.cameras.main.scrollY;
    this.touchGestureScrollVX = 0;
    this.touchGestureScrollVY = 0;
    this.cameraDragging = false;
    this.touchPanMaybe = false;
    this.clearSelectionDragState();
    return true;
  }

  updateTouchPinch() {
    const pointers = this.getActiveTouchPointers();
    if (!this.touchPinching || pointers.length < 2) return false;
    const [a, b] = pointers;
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const midX = (a.x + b.x) * 0.5;
    const midY = (a.y + b.y) * 0.5;
    const cam = this.cameras.main;
    const distRatio = dist / Math.max(1, this.touchPinchLastDist || dist);
    const ratioDelta = distRatio - 1;
    const ratioDeadZone = 0.008;
    const ratioDamp = 0.78;
    const effectiveRatioDelta = Math.sign(ratioDelta) * Math.max(0, Math.abs(ratioDelta) - ratioDeadZone) * ratioDamp;
    const prevZoom = cam.zoom;
    const nextZoom = Phaser.Math.Clamp(prevZoom * (1 + effectiveRatioDelta), this.getMinCameraZoom(), MAX_CAMERA_ZOOM);
    const now = performance.now();
    this.touchGestureScrollVX = 0;
    this.touchGestureScrollVY = 0;
    this.touchPinchLastMidX = midX;
    this.touchPinchLastMidY = midY;
    this.touchPinchLastMoveAt = now;
    cam.setZoom(nextZoom);
    const next = this.getCameraScrollForCenterWorld(this.touchWorldFocusX, this.touchWorldFocusY);
    cam.scrollX = next.scrollX;
    cam.scrollY = next.scrollY;
    this.syncCameraFocusToView();
    this.layoutBaseDefenseHud();
    this.touchPinchLastDist = dist;
    if (Math.abs(nextZoom - prevZoom) > 0.002) {
      this.touchMoved = true;
    }
    return true;
  }

  endTouchPinch() {
    this.touchPinching = false;
    this.touchPanMaybe = false;
    this.cameraDragging = false;
    this.touchGestureScrollVX = 0;
    this.touchGestureScrollVY = 0;
    this.cameraClampBackX = null;
    this.cameraClampBackY = null;
    this.syncCameraFocusToView();
    this.clearSelectionDragState();
    this.touchPinchCooldownUntil = Date.now() + 80;
  }

  handleMobilePointerDown(pointer: Phaser.Input.Pointer) {
    this.activeTouchIds.add(pointer.id);
    if (this.touchPinching && this.getActiveTouchPointers().length < 2) this.endTouchPinch();
    if (Date.now() < this.touchPinchCooldownUntil) return true;
    if (this.touchPinching) return true;
    if (this.getActiveTouchPointers().length >= 2) {
      this.cameraDragging = false;
      this.touchPanMaybe = false;
      this.clearSelectionDragState();
      return true;
    }
    if (this.handleMobileHudPointer(pointer)) return true;
    if (this.handleBuildPanelPointer(pointer)) return true;

    const world = this.getPointerWorld(pointer);
    this.touchPointerStartX = pointer.x;
    this.touchPointerStartY = pointer.y;
    this.touchPointerStartedAt = Date.now();
    this.touchMoved = false;
    this.touchPanMaybe = false;

    if (this.actionMode === "build") {
      this.cameraDragging = true;
      this.touchPanMaybe = true;
      this.cameraDragLastX = pointer.x;
      this.cameraDragLastY = pointer.y;
      return true;
    }

    if (this.mobileCommandMode === "select") {
      this.selectionStart = { x: world.x, y: world.y };
      this.selectionScreenStart = { x: pointer.x, y: pointer.y };
      this.isDraggingSelection = false;
      return true;
    }

    const clickedUnitId = this.findFriendlyUnitAtWorld(world.x, world.y, this.getMyTeam());
    const clickedStructureId = this.findFriendlyStructureAtWorld(world.x, world.y, this.getMyTeam());
    if (!clickedUnitId && !clickedStructureId) {
      this.touchPanMaybe = true;
      this.cameraDragging = true;
      this.cameraDragLastX = pointer.x;
      this.cameraDragLastY = pointer.y;
    }
    return true;
  }

  handleMobilePointerMove(pointer: Phaser.Input.Pointer) {
    if (this.getActiveTouchPointers().length >= 2 && this.selectionStart) {
      this.clearSelectionDragState();
    }
    if (this.getActiveTouchPointers().length >= 2) {
      return true;
    }

    const dist = Math.hypot(pointer.x - this.touchPointerStartX, pointer.y - this.touchPointerStartY);
    if (dist > 14) this.touchMoved = true;

    if (this.cameraDragging && this.touchPanMaybe) {
      const cam = this.cameras.main;
      const dx = pointer.x - this.cameraDragLastX;
      const dy = pointer.y - this.cameraDragLastY;
      cam.scrollX -= dx / cam.zoom;
      cam.scrollY -= dy / cam.zoom;
      this.cameraDragLastX = pointer.x;
      this.cameraDragLastY = pointer.y;
      this.clampCameraToWorld();
      this.syncCameraFocusToView();
      return true;
    }

    if (this.draggingBuildType) {
      this.updateBuildGhost(pointer);
      return true;
    }

    if (this.mobileCommandMode === "select" && this.selectionStart && this.selectionRectGraphics) {
      if (!this.selectionScreenStart) return true;
      const dx = pointer.x - this.selectionScreenStart.x;
      const dy = pointer.y - this.selectionScreenStart.y;
      if (!this.isDraggingSelection && Math.hypot(dx, dy) > 10) this.isDraggingSelection = true;
      if (!this.isDraggingSelection) return true;

      const x1 = this.selectionScreenStart.x;
      const y1 = this.selectionScreenStart.y;
      const x2 = pointer.x;
      const y2 = pointer.y;
      this.renderSelectionBoxDom(x1, y1, x2, y2);
      return true;
    }

    return false;
  }

  issueMobileAttackOrMove(worldX: number, worldY: number) {
    if (this.selectedUnitIds.size <= 0) return;
    if (this.mobileCommandMode === "attack") {
      const picked = this.pickAnyAttackTargetAtWorld(worldX, worldY);
      this.room.send("command_attack", {
        unitIds: Array.from(this.selectedUnitIds),
        targetType: picked?.type || "point",
        targetId: picked?.id || "",
        targetX: worldX,
        targetY: worldY,
      });
      return;
    }
    this.issueLocalUnitMoveCommand(worldX, worldY);
  }

  handleMobilePointerUp(pointer: Phaser.Input.Pointer) {
    this.activeTouchIds.delete(pointer.id);
    if (this.touchPinching) {
      if (this.activeTouchIds.size < 2) this.endTouchPinch();
      return true;
    }
    const releaseX = Number.isFinite(pointer.upX) ? pointer.upX : pointer.x;
    const releaseY = Number.isFinite(pointer.upY) ? pointer.upY : pointer.y;
    const tapScreenX = this.selectionScreenStart?.x ?? releaseX;
    const tapScreenY = this.selectionScreenStart?.y ?? releaseY;
    const tapWorld = this.selectionStart
      ? { x: this.selectionStart.x, y: this.selectionStart.y }
      : this.screenToWorldPoint(releaseX, releaseY);
    const releaseWorld = this.screenToWorldPoint(releaseX, releaseY);
    const pressDurationMs = Math.max(0, Date.now() - this.touchPointerStartedAt);
    const isTap = !this.touchMoved || (pressDurationMs < 250 && Math.hypot(pointer.x - this.touchPointerStartX, pointer.y - this.touchPointerStartY) < 24);
    const me = this.room.state.players.get ? this.room.state.players.get(this.currentPlayerId) : this.room.state.players?.[this.currentPlayerId];

    if (me?.isAlive && !me.isCoreAnchored && isTap && this.mobileCommandMode !== "select") {
      if (this.isClickOnOwnPlayer(tapWorld.x, tapWorld.y)) {
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
        this.moveTarget = { x: tapWorld.x, y: tapWorld.y };
        this.recalcPathToTarget();
      }
      this.clearSelectionDragState();
      return true;
    }

    if (this.cameraDragging && this.touchPanMaybe) {
      this.cameraDragging = false;
      this.touchPanMaybe = false;
      return true;
    }
    if (this.draggingBuildType) {
      this.completeBuildDragAtScreen(releaseX, releaseY);
      return true;
    }
    const myTeam = me?.team;

    if (this.mobileCommandMode === "select" && this.selectionStart) {
      if (this.isDraggingSelection) {
        const minX = Math.min(this.selectionStart.x, releaseWorld.x);
        const maxX = Math.max(this.selectionStart.x, releaseWorld.x);
        const minY = Math.min(this.selectionStart.y, releaseWorld.y);
        const maxY = Math.max(this.selectionStart.y, releaseWorld.y);
        const selected = new Set<string>();
        if (myTeam && this.room.state.units?.forEach) {
          this.room.state.units.forEach((u: any, id: string) => {
            if (u.team !== myTeam) return;
            if (u.x >= minX && u.x <= maxX && u.y >= minY && u.y <= maxY) selected.add(id);
          });
        }
        this.selectedUnitIds = selected;
        this.selectedStructureId = null;
      } else if (!this.touchMoved) {
        const nowTapAt = Date.now();
        const tapScreenDist = Math.hypot(tapScreenX - this.mobileLastTapScreenX, tapScreenY - this.mobileLastTapScreenY);
        const isDoubleTap = nowTapAt - this.mobileLastTapAt <= 320 && tapScreenDist <= 28;
        const shortTap = pressDurationMs <= 220;
        const shouldCenterAfterAction = shortTap && isDoubleTap;
        const clickedUnitId = this.findFriendlyUnitAtWorld(tapWorld.x, tapWorld.y, myTeam);
        const clickedStructureId = this.findFriendlyStructureAtWorld(tapWorld.x, tapWorld.y, myTeam);
        if (clickedUnitId) {
          this.selectedUnitIds = new Set<string>([clickedUnitId]);
          this.selectedStructureId = null;
        } else if (clickedStructureId) {
          this.selectedUnitIds.clear();
          this.selectedStructureId = clickedStructureId;
        } else {
          this.selectedStructureId = null;
          if (this.selectedUnitIds.size > 0) {
            this.issueLocalUnitMoveCommand(tapWorld.x, tapWorld.y);
          } else if (me?.isAlive && !me.isCoreAnchored) {
            this.selectedUnitIds.clear();
            this.moveTarget = { x: tapWorld.x, y: tapWorld.y };
            this.recalcPathToTarget();
          }
        }
        if (shouldCenterAfterAction) {
          this.mobileLastTapAt = 0;
          this.centerCameraOnScreenPoint(tapScreenX, tapScreenY, true);
        } else if (shortTap) {
          this.mobileLastTapAt = nowTapAt;
          this.mobileLastTapScreenX = tapScreenX;
          this.mobileLastTapScreenY = tapScreenY;
        } else {
          this.mobileLastTapAt = 0;
        }
      }
      this.clearSelectionDragState();
      return true;
    }

    if (!this.touchMoved && (this.mobileCommandMode === "move" || this.mobileCommandMode === "attack")) {
      this.issueMobileAttackOrMove(tapWorld.x, tapWorld.y);
      return true;
    }
    return true;
  }

  handleBuildPanelPointer(pointer: Phaser.Input.Pointer) {
    if (!this.phaserHudEnabled) return false;
    const me = this.room?.state?.players?.get
      ? this.room.state.players.get(this.currentPlayerId)
      : this.room?.state?.players?.[this.currentPlayerId];
    if (!me?.isCoreAnchored && !me?.devMode) return false;

    const px = pointer.x;
    const py = pointer.y;
    for (const b of this.buildButtons) {
      if (!this.pointInRect(px, py, b.rect)) continue;
      this.selectedBuild = b.type;
      const reason = this.getBuildBlockedReason(b.type);
      if (reason) {
        this.showNotice(`Cannot build: ${reason}`, "#ffb080");
        return true;
      }
      this.startBuildDrag(b.type, pointer);
      return true;
    }

    for (const b of this.unitButtons) {
      if (!this.pointInRect(px, py, b.rect)) continue;
      if (b.action === "soldier") {
        const reason = this.getUnitProduceBlockedReason();
        if (reason) this.showNotice(`Cannot produce: ${reason}`, "#ffb080");
        else this.room.send("produce_unit");
      } else if (b.action === "tank") {
        const reason = this.getFactoryProduceBlockedReason("tank");
        if (reason) this.showNotice(`Cannot produce: ${reason}`, "#ffb080");
        else this.room.send("produce_tank");
      } else {
        const reason = this.getFactoryProduceBlockedReason("harvester");
        if (reason) this.showNotice(`Cannot produce: ${reason}`, "#ffb080");
        else this.room.send("produce_harvester");
      }
      return true;
    }
    return false;
  }

}

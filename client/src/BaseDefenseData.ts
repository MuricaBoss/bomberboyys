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
import { getGraphicsProfile, getGraphicsQuality, getTieredTextureKey } from "./graphicsQuality";

export class BaseDefenseScene_Data extends Phaser.Scene {
  phaserHudEnabled = false;
  localOnly = false;
  desktopMobileFallback = false;
  room!: Room<any>;
  currentPlayerId = "";
  playerEntities: { [id: string]: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image } = {};
  playerLabels: { [id: string]: Phaser.GameObjects.Text } = {};
  unitEntities: { [id: string]: Phaser.GameObjects.Arc | Phaser.GameObjects.Image | Phaser.GameObjects.Sprite } = {};
  unitFacing = new Map<string, number>();
  // Hysteresis: tracks (tentativeDir, frameCount) to prevent rapid texture flipping.
  // Tank texture only switches after the same new direction appears 5+ consecutive frames.
  unitDirVote = new Map<string, { dir: number; count: number }>();
  unitDirSnapshot = new Map<string, number[]>();
  unitSlotLocked = new Set<string>();

  unitSelectionRings: { [id: string]: Phaser.GameObjects.Rectangle } = {};
  unitHpTexts: { [id: string]: Phaser.GameObjects.Text } = {};
  unitShadowEntities: { [id: string]: Phaser.GameObjects.Ellipse } = {};
  tankShadowEntities: { [id: string]: Phaser.GameObjects.Image } = {};
  structureEntities: { [id: string]: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image } = {};
  structureTexts: { [id: string]: Phaser.GameObjects.Text } = {};
  structureHpTexts: { [id: string]: Phaser.GameObjects.Text } = {};
  structureShadowEntities: { [id: string]: Phaser.GameObjects.Ellipse } = {};
  resourceEntities: { [id: string]: Phaser.GameObjects.Arc } = {};
  coreEntities: { [id: string]: Phaser.GameObjects.Rectangle } = {};
  projectilePool!: Phaser.GameObjects.Group;
  muzzlePool!: Phaser.GameObjects.Group;
  tmpVec = new Phaser.Math.Vector2();
  fpsText!: Phaser.GameObjects.Text;
  coreTexts: { [id: string]: Phaser.GameObjects.Text } = {};
  tileEntities: (Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle)[] = [];
  tileShadowEntities: (Phaser.GameObjects.Ellipse | undefined)[] = [];
  mapCache: number[] = [];
  mapSyncPending = false;
  uiText!: Phaser.GameObjects.Text;
  statusText!: Phaser.GameObjects.Text;
  clientClockText!: Phaser.GameObjects.Text;
  noticeText!: Phaser.GameObjects.Text;
  noticeTimer: Phaser.Time.TimerEvent | null = null;
  buildMenuText!: Phaser.GameObjects.Text;
  buildPanelStatsText!: Phaser.GameObjects.Text;
  buildPanelBg!: Phaser.GameObjects.Rectangle;
  buildButtons: Array<{
    type: "ore_refinery" | "solar_panel" | "barracks" | "war_factory";
    cost: number;
    buildMs: number;
    rect: Phaser.GameObjects.Rectangle;
    title: Phaser.GameObjects.Text;
    meta: Phaser.GameObjects.Text;
  }> = [];
  unitButtons: Array<{
    action: "soldier" | "tank" | "harvester";
    rect: Phaser.GameObjects.Rectangle;
    title: Phaser.GameObjects.Text;
    meta: Phaser.GameObjects.Text;
  }> = [];
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  keyE!: Phaser.Input.Keyboard.Key;
  key1!: Phaser.Input.Keyboard.Key;
  key2!: Phaser.Input.Keyboard.Key;
  key3!: Phaser.Input.Keyboard.Key;
  key4!: Phaser.Input.Keyboard.Key;
  keyB!: Phaser.Input.Keyboard.Key;
  keyQ!: Phaser.Input.Keyboard.Key;
  keyT!: Phaser.Input.Keyboard.Key;
  keyH!: Phaser.Input.Keyboard.Key;
  keyShift!: Phaser.Input.Keyboard.Key;
  keyR!: Phaser.Input.Keyboard.Key;
  keyF!: Phaser.Input.Keyboard.Key;
  keyF10!: Phaser.Input.Keyboard.Key;
  keyEsc!: Phaser.Input.Keyboard.Key;
  selectedBuild: "ore_refinery" | "solar_panel" | "barracks" | "war_factory" = "ore_refinery";
  actionMode: "move" | "build" = "move";
  mobileCommandMode: "select" | "move" | "attack" = "select";
  isMobileInput = false;
  draggingBuildType: "ore_refinery" | "solar_panel" | "barracks" | "war_factory" | null = null;
  buildGhost: Phaser.GameObjects.Rectangle | null = null;
  buildGhostText: Phaser.GameObjects.Text | null = null;
  moveTarget: { x: number; y: number } | null = null;
  movePath: { x: number; y: number }[] = [];
  selectedUnitIds = new Set<string>();
  selectedStructureId: string | null = null;
  lastSelfClickAt = 0;
  isDraggingSelection = false;
  selectionStart: { x: number; y: number } | null = null;
  selectionScreenStart: { x: number; y: number } | null = null;
  selectionRectGraphics: Phaser.GameObjects.Graphics | null = null;
  lastPathRecalcAt = 0;
  lastMoveSentAt = 0;
  hasInitialized = false;
  cameraDragging = false;
  cameraDragLastX = 0;
  cameraDragLastY = 0;
  cameraHasInitialFocus = false;
  hasHadInitialCameraSnap = false;
  tankTrailEffects: Array<{ left: Phaser.GameObjects.Rectangle; right: Phaser.GameObjects.Rectangle; expiresAt: number }> = [];
  tankTrailState = new Map<string, { lastX: number; lastY: number; lastSpawnX: number; lastSpawnY: number }>();
  tankShotEffects: Array<{ line: Phaser.GameObjects.Line; glow: Phaser.GameObjects.Arc; expiresAt: number }> = [];
  unitProjectileEffects: Array<{ bullet: Phaser.GameObjects.Arc; glow: Phaser.GameObjects.Arc; fromX: number; fromY: number; toX: number; toY: number; startedAt: number; expiresAt: number; unitId: string; victimId: string; isFriendly: boolean }> = [];
  soldierLastShotAt = new Map<string, number>();
  attackCursorGraphics: Phaser.GameObjects.Graphics | null = null;
  lastAvoidIntentSentAt = 0;
  unitClientPathCache = new Map<string, { goalGX: number; goalGY: number; cells: { x: number; y: number }[]; idx: number; updatedAt: number }>();
  localUnitRenderState = new Map<string, { x: number; y: number; vx: number; vy: number; lastAt: number; jamRefX?: number; jamRefY?: number }>();
  unitEnemyIcons = new Map<string, Phaser.GameObjects.Graphics>();
  structureEnemyIcons = new Map<string, Phaser.GameObjects.Graphics>();
  hasLoggedTeam = false;
  lastUnitPoseSentAt = 0;
  lastUnitPoseState = new Map<string, { x: number; y: number; dir: number; tx: number; ty: number }>();
  localUnitTargetOverride = new Map<string, { x: number; y: number; setAt: number }>();
  localUnitMovePriority = new Map<string, number>();
  localUnitJamTicks = new Map<string, number>();
  localUnitGhostMode = new Set<string>();
  formationPreviewGraphics: Phaser.GameObjects.Graphics | null = null;
  formationPreviewSlots: Array<{ x: number; y: number; r: number }> = [];
  formationPreviewAssignments = new Map<string, { x: number; y: number }>();
  formationPreviewCenter: { x: number; y: number } | null = null;
  formationPreviewUntil = 0;
  moveClickMarkerSprite: Phaser.GameObjects.Image | null = null;
  moveClickMarker: { x: number; y: number; createdAt: number; expiresAt: number } | null = null;
  lastFormationReflowAt = 0;
  visionSources: Array<{ x: number; y: number; r2: number }> = [];
  lastAutoEngageAt = 0;
  autoEngagedUnitIds = new Set<string>();
  unitAttackTarget = new Map<string, string>();
  unitLastShotDir = new Map<string, { dir: number; at: number }>();
  minimapBg: Phaser.GameObjects.Rectangle | null = null;
  minimapVisionGraphics: Phaser.GameObjects.Graphics | null = null;
  minimapEntityGraphics: Phaser.GameObjects.Graphics | null = null;
  minimapMapGraphics: Phaser.GameObjects.Graphics | null = null;
  lastStructureSyncAt = 0;
  lastResourceSyncAt = 0;
  perfNodes: { [key: string]: number } = {};
  obstacleGrid: Uint8Array | null = null;
  currentVisionGrid: Uint8Array | null = null;
  lastVisionUpdateAt = 0;
  gridW = 0;
  gridH = 0;
  minimapBorder: Phaser.GameObjects.Rectangle | null = null;
  minimapX = 0;
  minimapY = 0;
  minimapW = 0;
  minimapH = 0;
  minimapScaleX = 1;
  minimapScaleY = 1;
  groundTileSprite: Phaser.GameObjects.TileSprite | null = null;
  groundTintOverlay: Phaser.GameObjects.Rectangle | null = null;
  worldFogGraphics: Phaser.GameObjects.Graphics | null = null;
  worldFogOverlay: Phaser.GameObjects.RenderTexture | null = null;
  worldFogMaskGraphics: Phaser.GameObjects.Graphics | null = null;
  fogEnabled = true;
  lastWorldFogDrawAt = 0;
  fogCols = 0;
  fogRows = 0;
  fogSeenAt: Float32Array | null = null;
  lastFogCamX = Number.NaN;
  lastFogCamY = Number.NaN;
  lastFogZoom = Number.NaN;
  fogClockSec = 0;
  lastFogTickAt = 0;
  camVelX = 0;
  camVelY = 0;
  mobileHudButtons: Array<{
    mode: "select" | "move" | "attack" | "anchor" | "dev" | "full" | "zoom_in" | "zoom_out" | "build" | "ore" | "sol" | "bar" | "wf" | "soldier" | "tank";
    rect: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
    text: Phaser.GameObjects.Text;
  }> = [];
  touchPinching = false;
  touchPinchStartDist = 0;
  touchPinchStartZoom = 1;
  touchWorldFocusX = 0;
  touchWorldFocusY = 0;
  touchPinchLastMidX = 0;
  touchPinchLastMidY = 0;
  touchPinchLastDist = 0;
  touchPinchLastMoveAt = 0;
  touchPinchLockedScrollX = 0;
  touchPinchLockedScrollY = 0;
  touchGestureScrollVX = 0;
  touchGestureScrollVY = 0;
  touchPointerStartX = 0;
  touchPointerStartY = 0;
  touchPointerStartedAt = 0;
  touchPanMaybe = false;
  touchMoved = false;
  touchPinchCooldownUntil = 0;
  activeTouchIds = new Set<number>();
  mobileLastTapAt = 0;
  mobileLastTapScreenX = 0;
  mobileLastTapScreenY = 0;
  gestureBlockHandler: ((event: Event) => void) | null = null;
  mobileHudRootEl: HTMLDivElement | null = null;
  mobileHudDomButtons = new Map<string, HTMLButtonElement>();
  clientClockStartedAt = 0;
  clientClockRootEl: HTMLDivElement | null = null;
  clientClockTimer = 0;
  clientVersionRootEl: HTMLDivElement | null = null;
  selectionBoxRootEl: HTMLDivElement | null = null;
  fullscreenSyncHandler: (() => void) | null = null;
  actionPanelRootEl: HTMLDivElement | null = null;
  actionPanelButtons = new Map<string, HTMLButtonElement>();
  actionPanelReasonLabels = new Map<string, HTMLDivElement>();
  // Build 100: Removed all performance telemetry properties to maximize mobile CPU
  perfNotifyText: Phaser.GameObjects.Text | null = null;
  keyP: Phaser.Input.Keyboard.Key | null = null;
  lastResizePollAt = 0;
  lastKnownWindowWidth = 0;
  lastKnownWindowHeight = 0;
  resizeTimeout: any = null;
  hasInitialZoomSet = false;
  preResizeScrollX = 0;
  preResizeScrollY = 0;

  // Build 100: Removed all performance telemetry methods to maximize mobile CPU
  perfStart(_section: string) {}
  perfEnd(_section: string) {}
  reportClientPerformance() {}

  toggleProfiling() { /* Build 100: Removed */ }
  domBuildDragPointerId: number | null = null;
  domBuildDragMoveHandler: ((event: PointerEvent) => void) | null = null;
  domBuildDragEndHandler: ((event: PointerEvent) => void) | null = null;
  worldInitRetryTimer: Phaser.Time.TimerEvent | null = null;
  cameraCenterTween: Phaser.Tweens.Tween | null = null;
  cameraFocusWorldX = 0;
  cameraFocusWorldY = 0;
  cameraClampBackX: number | null = null;
  cameraClampBackY: number | null = null;

  applyNextGraphicsQuality() {}

  getGraphicsProfile() {
    return getGraphicsProfile(getGraphicsQuality());
  }

  getGroundTextureKey() {
    return getTieredTextureKey("rts_ground", this.getGraphicsProfile().worldTier);
  }

  getFogCellSize() {
    const state = this.room?.state;
    if (!state) return FOG_CELL_SIZE;
    const worldW = Math.max(1, Number(state.mapWidth || 1) * TILE_SIZE);
    const worldH = Math.max(1, Number(state.mapHeight || 1) * TILE_SIZE);
    const worldMax = Math.max(worldW, worldH);
    if (worldMax >= 4000) return 16;
    if (worldMax >= 2500) return 12;
    return FOG_CELL_SIZE;
  }

  getUiButtonTextureKey(active: boolean) {
    return getTieredTextureKey(active ? "rts_button_active" : "rts_button_base", this.getGraphicsProfile().worldTier);
  }

  getBuildingTextureKey(baseKey: string) {
    return getTieredTextureKey(baseKey, this.getGraphicsProfile().structureTier);
  }

  getTankTextureKey(baseKey: string) {
    return getTieredTextureKey(baseKey, this.getGraphicsProfile().unitTier);
  }

  getTankShadowTextureKey(dir: number) {
    return this.getTankTextureKey(RTS_TANK_TEXTURE_BY_DIR[dir] ?? RTS_TANK_TEXTURE_KEYS.e);
  }

  getSoldierSheetTextureKey(action: "run" | "shoot") {
    return getTieredTextureKey(RTS_SOLDIER_SPRITESHEET_KEYS[action], this.getGraphicsProfile().unitTier);
  }

  screenToWorldPoint(screenX: number, screenY: number) {
    const cam = this.cameras.main;
    cam.preRender();
    const point = cam.getWorldPoint(screenX, screenY);
    return { x: point.x, y: point.y };
  }

  getOverlayHostEl() {
    return document.getElementById("game-container") || document.body;
  }

  clearSelectionDragState() {
    this.selectionStart = null;
    this.selectionScreenStart = null;
    this.isDraggingSelection = false;
    this.selectionRectGraphics?.clear();
    this.hideSelectionBoxDom();
  }

  clearCommandSelectionState() {
    this.selectedUnitIds.clear();
    this.selectedStructureId = null;
    this.moveTarget = null;
    this.movePath = [];
    this.stopBuildDrag();
    this.clearSelectionDragState();
    this.formationPreviewUntil = 0;
  }

  nextLocalId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  }

  findOwnedReadyStructure(state: any, type: string, now: number) {
    let found: any = null;
    state.structures?.forEach?.((s: any) => {
      if (found) return;
      if (s.ownerId !== this.currentPlayerId) return;
      if (s.type !== type) return;
      if ((s.hp ?? 0) <= 0) return;
      if (Number(s.buildCompleteAt || 0) > now) return;
      if (Number(s.produceCooldownUntil || 0) > now) return;
      found = s;
    });
    return found;
  }

  getCameraScrollForCenterWorld(centerX: number, centerY: number) {
    const cam = this.cameras.main;
    cam.preRender();
    const viewW = cam.worldView.width;
    const viewH = cam.worldView.height;
    const scrollX = centerX - viewW * 0.5;
    const scrollY = centerY - viewH * 0.5;
    return { scrollX, scrollY };
  }

  syncCameraFocusToView() {
    const cam = this.cameras.main;
    cam.preRender();
    this.cameraFocusWorldX = cam.midPoint.x;
    this.cameraFocusWorldY = cam.midPoint.y;
  }

  syncCameraAfterZoom() {
    const cam = this.cameras.main;
    cam.preRender();
    this.syncCameraFocusToView();
  }

  applyZoomToScreenPoint(nextZoom: number, screenX: number, screenY: number) {
    const cam = this.cameras.main;
    const oldZoom = cam.zoom;
    
    const viewCenterX = cam.width / 2;
    const viewCenterY = cam.height / 2;
    const dx = screenX - viewCenterX;
    const dy = screenY - viewCenterY;
    
    // Changing the zoom scales the scene around the center of the camera.
    // To keep a specific screen coordinate visually "pinned" to the same world point,
    // we must offset the scrollX/Y by the difference in logical size caused by the zoom change.
    const worldShiftX = (dx / oldZoom) - (dx / nextZoom);
    const worldShiftY = (dy / oldZoom) - (dy / nextZoom);
    
    cam.setZoom(nextZoom);
    cam.scrollX += worldShiftX;
    cam.scrollY += worldShiftY;
    
    (this as any).clampCameraToWorld?.();
    this.syncCameraAfterZoom();
  }

  applyZoomToViewportCenter(nextZoom: number) {
    const cam = this.cameras.main;
    this.applyZoomToScreenPoint(nextZoom, cam.width / 2, cam.height / 2);
  }

  centerCameraOnWorldPoint(worldX: number, worldY: number, smooth = true) {
    const cam = this.cameras.main;
    this.cameraCenterTween?.remove();
    this.cameraFocusWorldX = worldX;
    this.cameraFocusWorldY = worldY;
    const startX = cam.scrollX;
    const startY = cam.scrollY;
    const next = this.getCameraScrollForCenterWorld(worldX, worldY);
    const targetX = next.scrollX;
    const targetY = next.scrollY;
    if (!smooth || (Math.abs(targetX - startX) < 1 && Math.abs(targetY - startY) < 1)) {
      cam.scrollX = targetX;
      cam.scrollY = targetY;
      (this as any).clampCameraToWorld?.();
      return;
    }
    cam.scrollX = startX;
    cam.scrollY = startY;
    this.cameraCenterTween = this.tweens.add({
      targets: cam,
      scrollX: targetX,
      scrollY: targetY,
      duration: 180,
      ease: "Quad.easeOut",
      onUpdate: () => {
        (this as any).clampCameraToWorld?.();
      },
      onComplete: () => {
        (this as any).clampCameraToWorld?.();
        this.cameraCenterTween = null;
      },
    });
  }

  centerCameraOnScreenPoint(screenX: number, screenY: number, smooth = true) {
    const world = this.screenToWorldPoint(screenX, screenY);
    this.centerCameraOnWorldPoint(world.x, world.y, smooth);
  }

  isOuterWallTile(gx: number, gy: number, width: number, height: number) {
    return gx === 0 || gy === 0 || gx === width - 1 || gy === height - 1;
  }

  getInteriorWallTextureKey(gx: number, gy: number) {
    const hash = Math.abs((gx * 73856093) ^ (gy * 19349663));
    const baseKey = RTS_BLOCK_TEXTURE_KEYS[hash % RTS_BLOCK_TEXTURE_KEYS.length];
    return getTieredTextureKey(baseKey, this.getGraphicsProfile().worldTier);
  }

  createWallTile(gx: number, gy: number, width: number, height: number) {
    const worldX = gx * TILE_SIZE + TILE_SIZE / 2;
    const worldY = gy * TILE_SIZE + TILE_SIZE / 2;
    let tile: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image;
    if (this.isOuterWallTile(gx, gy, width, height)) {
      tile = this.add.rectangle(worldX, worldY, TILE_SIZE * 0.95, TILE_SIZE * 0.95, 0x666666).setStrokeStyle(2, 0xffffff);
    } else {
      tile = this.add.image(worldX, worldY, this.getInteriorWallTextureKey(gx, gy))
        .setDisplaySize(TILE_SIZE * RTS_INTERIOR_WALL_VISUAL_SCALE, TILE_SIZE * RTS_INTERIOR_WALL_VISUAL_SCALE);
    }
    this.applyWorldDepth(tile, worldY, WORLD_DEPTH_TILE_OFFSET);
    return tile;
  }

  createWallTileShadow(gx: number, gy: number, width: number, height: number) {
    if (this.isOuterWallTile(gx, gy, width, height)) return undefined;
    const shadow = this.getWallShadowSpec(gx, gy);
    const worldY = gy * TILE_SIZE + TILE_SIZE / 2;
    return this.syncGroundShadow(
      undefined,
      shadow.x,
      shadow.y,
      shadow.width,
      shadow.height,
      shadow.y,
      worldY,
      WORLD_DEPTH_TILE_OFFSET,
      RTS_TILE_SHADOW_ALPHA,
    );
  }

  getStructureArtSpec(type: string) {
    if (type === "ore_refinery") {
      return {
        key: RTS_BUILDING_TEXTURE_KEYS.ore_refinery,
        textureKey: this.getBuildingTextureKey(RTS_BUILDING_TEXTURE_KEYS.ore_refinery),
        size: TILE_SIZE * 4.2,
        originY: 0.74,
        pickRadius: TILE_SIZE * 2.2,
        labelY: TILE_SIZE * 0.46,
      };
    }
    if (type === "solar_panel") {
      return {
        key: RTS_BUILDING_TEXTURE_KEYS.solar_panel,
        textureKey: this.getBuildingTextureKey(RTS_BUILDING_TEXTURE_KEYS.solar_panel),
        size: TILE_SIZE * 3.4,
        originY: 0.7,
        pickRadius: TILE_SIZE * 1.9,
        labelY: TILE_SIZE * 0.4,
      };
    }
    if (type === "barracks") {
      return {
        key: RTS_BUILDING_TEXTURE_KEYS.barracks,
        textureKey: this.getBuildingTextureKey(RTS_BUILDING_TEXTURE_KEYS.barracks),
        size: TILE_SIZE * 3.8,
        originY: 0.68,
        pickRadius: TILE_SIZE * 2.0,
        labelY: TILE_SIZE * 0.44,
      };
    }
    if (type === "war_factory" || type === "factory") {
      return {
        key: RTS_BUILDING_TEXTURE_KEYS.war_factory,
        textureKey: this.getBuildingTextureKey(RTS_BUILDING_TEXTURE_KEYS.war_factory),
        size: TILE_SIZE * 4.1,
        originY: 0.73,
        pickRadius: TILE_SIZE * 2.15,
        labelY: TILE_SIZE * 0.44,
      };
    }
    return null;
  }

  getStructurePickRadius(type: string) {
    return this.getStructureArtSpec(type)?.pickRadius ?? TILE_SIZE * 0.8;
  }

  getWorldDepth(sortY: number, offset = 0) {
    return WORLD_DEPTH_BASE + sortY * WORLD_DEPTH_PER_PIXEL + offset;
  }

  applyWorldDepth(target: { setDepth: (depth: number) => unknown }, sortY: number, offset = 0) {
    target.setDepth(this.getWorldDepth(sortY, offset));
  }

  syncGroundShadow(
    shadow: Phaser.GameObjects.Ellipse | undefined,
    x: number,
    y: number,
    width: number,
    height: number,
    _sortY: number,
    depthSortY: number,
    objectDepthOffset: number,
    alpha: number,
  ) {
    const safeWidth = Math.max(6, width);
    const safeHeight = Math.max(4, height);
    const next = shadow ?? this.add.ellipse(x, y, safeWidth, safeHeight, 0x000000, alpha);
    next.setPosition(x, y);
    next.setSize(safeWidth, safeHeight);
    next.setDisplaySize(safeWidth, safeHeight);
    next.setFillStyle(0x000000, alpha);
    next.setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.applyWorldDepth(next, depthSortY, objectDepthOffset - WORLD_DEPTH_SHADOW_GAP);
    next.setVisible(true);
    return next;
  }

  getWallShadowSpec(gx: number, gy: number) {
    const worldX = gx * TILE_SIZE + TILE_SIZE / 2;
    const worldY = gy * TILE_SIZE + TILE_SIZE / 2;
    return {
      x: worldX + TILE_SIZE * 0.08,
      y: worldY + TILE_SIZE * 0.32,
      width: TILE_SIZE * 1.3,
      height: TILE_SIZE * 0.45,
    };
  }

  getOverlayScreenPointFromClient(clientX: number, clientY: number) {
    const rect = this.getOverlayHostEl().getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  isActionPanelScreenPoint(screenX: number, screenY: number) {
    if (this.phaserHudEnabled && this.buildPanelBg) return this.pointInRect(screenX, screenY, this.buildPanelBg);
    if (!this.actionPanelRootEl) return false;
    const hostRect = this.getOverlayHostEl().getBoundingClientRect();
    const clientX = hostRect.left + screenX;
    const clientY = hostRect.top + screenY;
    const rect = this.actionPanelRootEl.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  ensureBuildGhost() {
    if (!this.buildGhost) {
      this.buildGhost = this.add.rectangle(0, 0, TILE_SIZE * 0.9, TILE_SIZE * 0.9, 0x77bbff, 0.45)
        .setStrokeStyle(2, 0xffffff, 0.8)
        .setDepth(210);
    }
    if (!this.buildGhostText) {
      this.buildGhostText = this.add.text(0, 0, "", {
        fontSize: "11px",
        color: "#ffffff",
        fontFamily: "Arial",
        backgroundColor: "#00000088",
      }).setPadding(3, 1, 3, 1).setOrigin(0.5, 1).setDepth(211);
    }
  }

  updateBuildGhostAtScreen(screenX: number, screenY: number) {
    if (!this.draggingBuildType || !this.buildGhost || !this.buildGhostText) return;
    const world = this.screenToWorldPoint(screenX, screenY);
    const gx = Math.floor(world.x / TILE_SIZE);
    const gy = Math.floor(world.y / TILE_SIZE);
    const footprint = this.getStructureFootprint(this.draggingBuildType);
    const wx = gx * TILE_SIZE + TILE_SIZE / 2;
    const wy = gy * TILE_SIZE + TILE_SIZE / 2;
    const canPlace = this.canPlaceBuildAt(this.draggingBuildType, gx, gy);
    this.buildGhost.x = wx;
    this.buildGhost.y = wy;
    this.buildGhost.setDisplaySize(footprint.width * TILE_SIZE * 0.92, footprint.height * TILE_SIZE * 0.92);
    this.buildGhost.setFillStyle(canPlace ? 0x66b8ff : 0xcc5555, 0.45);
    this.buildGhost.setStrokeStyle(2, canPlace ? 0xffffff : 0xff9999, 0.85);
    this.buildGhostText.setText(
      `${this.buildLabel(this.draggingBuildType)} ${footprint.width}x${footprint.height}${canPlace ? "" : "\nINVALID"}`,
    );
    this.buildGhostText.setPosition(wx, wy - (footprint.height * TILE_SIZE) * 0.5 - 4);
  }

  completeBuildDragAtScreen(screenX: number, screenY: number) {
    if (!this.draggingBuildType) return;
    const buildType = this.draggingBuildType;
    const me = this.room.state.players.get ? this.room.state.players.get(this.currentPlayerId) : this.room.state.players?.[this.currentPlayerId];
    const droppedOnPanel = this.isActionPanelScreenPoint(screenX, screenY);
    if (me?.isAlive && (me.isCoreAnchored || me.devMode) && !droppedOnPanel) {
      const world = this.screenToWorldPoint(screenX, screenY);
      const gx = Math.floor(world.x / TILE_SIZE);
      const gy = Math.floor(world.y / TILE_SIZE);
      if (this.canPlaceBuildAt(buildType, gx, gy)) {
        this.selectedBuild = buildType;
        this.room.send("build_structure", { type: buildType, gridX: gx, gridY: gy });
      } else {
        const reason = this.getBuildBlockedReason(buildType) || "invalid location";
        this.showNotice(`Cannot build: ${reason}`, "#ffb080");
      }
    }
    this.stopBuildDrag();
  }

  unbindDomBuildDragListeners() {
    if (this.domBuildDragMoveHandler) {
      window.removeEventListener("pointermove", this.domBuildDragMoveHandler);
      this.domBuildDragMoveHandler = null;
    }
    if (this.domBuildDragEndHandler) {
      window.removeEventListener("pointerup", this.domBuildDragEndHandler);
      window.removeEventListener("pointercancel", this.domBuildDragEndHandler);
      this.domBuildDragEndHandler = null;
    }
    this.domBuildDragPointerId = null;
  }

  tileAt(gx: number, gy: number) {
    const st = this.room.state;
    if (!st || gx < 0 || gy < 0 || gx >= st.mapWidth || gy >= st.mapHeight) return 1;
    return st.map[gy * st.mapWidth + gx] ?? 1;
  }

  getStructureFootprint(type: string) {
    if (
      type === "ore_refinery"
      || type === "solar_panel"
      || type === "barracks"
      || type === "war_factory"
      || type === "factory"
    ) {
      return { width: 3, height: 3 };
    }
    return { width: 1, height: 1 };
  }

  forEachStructureFootprintCell(
    centerGX: number,
    centerGY: number,
    type: string,
    visitor: (gx: number, gy: number) => boolean | void,
  ) {
    const footprint = this.getStructureFootprint(type);
    const halfW = Math.floor(footprint.width / 2);
    const halfH = Math.floor(footprint.height / 2);
    for (let gy = centerGY - halfH; gy <= centerGY + halfH; gy++) {
      for (let gx = centerGX - halfW; gx <= centerGX + halfW; gx++) {
        if (visitor(gx, gy)) return;
      }
    }
  }

  hasStructureAt(gx: number, gy: number) {
    if (!this.obstacleGrid) return false;
    if (gx < 0 || gx >= this.gridW || gy < 0 || gy >= this.gridH) return false;
    return this.obstacleGrid[gy * this.gridW + gx] === 1;
  }

  hasCoreAt(gx: number, gy: number) {
    const cores = this.room.state?.cores;
    if (!cores?.forEach) return false;
    let found = false;
    cores.forEach((c: any) => {
      if (found) return;
      if (Math.floor(c.x / TILE_SIZE) === gx && Math.floor(c.y / TILE_SIZE) === gy) found = true;
    });
    return found;
  }

  hasResourceAt(gx: number, gy: number) {
    const resources = this.room.state?.resources;
    if (!resources?.forEach) return false;
    let found = false;
    resources.forEach((r: any) => {
      if (found) return;
      if (Math.floor(r.x / TILE_SIZE) === gx && Math.floor(r.y / TILE_SIZE) === gy) found = true;
    });
    return found;
  }

  angleToDir8(angleRad: number) {
    const a = Phaser.Math.Angle.Wrap(angleRad);
    const idx = Math.round(a / (Math.PI / 4));
    return (idx + 8) % 8;
  }

  myStructureCount(type: string) {
    const state = this.room?.state;
    if (!state?.structures?.forEach) return 0;
    let count = 0;
    state.structures.forEach((s: any) => {
      if (s.ownerId === this.currentPlayerId && s.type === type && (s.hp ?? 1) > 0) count += 1;
    });
    return count;
  }

  mapItemCount(map: any) {
    if (!map) return 0;
    if (typeof map.length === "number") return map.length;
    if (typeof map.forEach === "function") {
      let count = 0;
      map.forEach(() => count++);
      return count;
    }
    if (typeof map.entries === "function") {
      let count = 0;
      for (const _ of map.entries()) count++;
      return count;
    }
    return 0;
  }

  hasHydratedStateCollection(collection: any) {
    return !!collection
      && (
        typeof collection.get === "function"
        || typeof collection.forEach === "function"
        || typeof collection.entries === "function"
        || typeof collection.length === "number"
      );
  }

  getStatePlayer(state: any, playerId: string) {
    const players = state?.players;
    if (!players) return null;
    if (typeof players.get === "function") return players.get(playerId) ?? null;
    return players?.[playerId] ?? null;
  }

  getOwnPlayer() {
    return this.getStatePlayer(this.room?.state, this.currentPlayerId);
  }

  hasReadyWorldState(state: any) {
    return !!state
      && Number(state.mapWidth || 0) > 0
      && Number(state.mapHeight || 0) > 0
      && this.mapItemCount(state.map) > 0
      && this.hasHydratedStateCollection(state.players)
      && this.hasHydratedStateCollection(state.cores)
      && this.hasHydratedStateCollection(state.resources)
      && this.hasHydratedStateCollection(state.structures)
      && this.hasHydratedStateCollection(state.units);
  }

  buildLabel(type: string) {
    if (type === "ore_refinery") return "Ore Refinery";
    if (type === "solar_panel") return "Solar Panel";
    if (type === "barracks") return "Barracks";
    if (type === "war_factory") return "War Factory";
    return type;
  }

  canStartBuildType(type: "ore_refinery" | "solar_panel" | "barracks" | "war_factory") {
    return this.getBuildBlockedReason(type) === null;
  }

  getBuildBlockedReason(type: "ore_refinery" | "solar_panel" | "barracks" | "war_factory") {
    if (!this.room?.state) return "Initializing";
    const me = this.getOwnPlayer();
    if (!me?.isAlive) return "Player dead";
    if (me.devMode) return null;
    if (!me.isCoreAnchored) return "Anchor base first";
    const now = Date.now();
    const buildCdLeft = Math.ceil((Number(me.buildCooldownUntil || 0) - now) / 1000);
    if (buildCdLeft > 0) return `Build cooldown ${buildCdLeft}s`;
    let hasConstruction = false;
    this.room.state.structures?.forEach?.((s: any) => {
      if (hasConstruction) return;
      if (s.ownerId !== this.currentPlayerId) return;
      if ((s.hp ?? 0) <= 0) return;
      if (Number(s.buildStartedAt || 0) > 0 && now < Number(s.buildCompleteAt || 0)) hasConstruction = true;
    });
    if (hasConstruction) return "Construction in progress";

    const hasOre = this.myStructureCount("ore_refinery") > 0;
    const hasSolar = this.myStructureCount("solar_panel") > 0;
    const hasBarracks = this.myStructureCount("barracks") > 0;
    if (type === "solar_panel" && !hasOre) return "Need Ore Refinery first";
    if (type === "barracks" && (!hasOre || !hasSolar)) return "Need Ore + Solar first";
    if (type === "war_factory" && (!hasOre || !hasSolar || !hasBarracks)) return "Need Ore + Solar + Barracks";

    const baseCost = type === "ore_refinery" ? 55 : type === "solar_panel" ? 40 : type === "barracks" ? 80 : 130;
    const battleSurcharge = this.room.state.phase === "battle" ? 10 : 0;
    const totalCost = baseCost + battleSurcharge;
    const res = Number(me.resources || 0);
    if (res < totalCost) return `Need ${totalCost} resources`;
    return null;
  }

  getUnitProduceBlockedReason() {
    if (!this.room?.state) return "Initializing";
    const me = this.getOwnPlayer();
    if (!me?.isAlive) return "Player dead";
    if (me.devMode) return null;
    if (!me.isCoreAnchored) return "Anchor base first";
    if (Number(me.powerProduced || 0) < Number(me.powerUsed || 0)) return "Low power";
    const now = Date.now();

    let totalBarracks = 0;
    let readyBarracks = 0;
    this.room.state.structures?.forEach?.((s: any) => {
      if (s.ownerId !== this.currentPlayerId || s.type !== "barracks") return;
      if ((s.hp ?? 0) <= 0) return;
      if (Number(s.buildCompleteAt || 0) > now) return;
      totalBarracks += 1;
      if (Number(s.produceCooldownUntil || 0) <= now) readyBarracks += 1;
    });
    if (totalBarracks <= 0) return "Need Barracks";
    if (readyBarracks <= 0) return "All Barracks busy";
    if (Number(me.resources || 0) < 35) return "Need 35 resources";
    return null;
  }

  getFactoryProduceBlockedReason(kind: "tank" | "harvester") {
    if (!this.room?.state) return "Initializing";
    const me = this.getOwnPlayer();
    if (!me?.isAlive) return "Player dead";
    if (me.devMode) return null;
    if (!me.isCoreAnchored) return "Anchor base first";
    if (Number(me.powerProduced || 0) < Number(me.powerUsed || 0)) return "Low power";
    const now = Date.now();
    let totalFactories = 0;
    let readyFactories = 0;
    this.room.state.structures?.forEach?.((s: any) => {
      if (s.ownerId !== this.currentPlayerId || s.type !== "war_factory") return;
      if ((s.hp ?? 0) <= 0) return;
      if (Number(s.buildCompleteAt || 0) > now) return;
      totalFactories += 1;
      if (Number(s.produceCooldownUntil || 0) <= now) readyFactories += 1;
    });
    if (totalFactories <= 0) return "Need War Factory";
    if (readyFactories <= 0) return "All War Factories busy";
    const need = kind === "tank" ? 90 : 70;
    if (Number(me.resources || 0) < need) return `Need ${need} resources`;
    return null;
  }

  canPlaceBuildAt(type: string, gx: number, gy: number) {
    const me = this.getOwnPlayer();
    if (!me?.isAlive) return false;
    if (!this.canStartBuildType(type as "ore_refinery" | "solar_panel" | "barracks" | "war_factory")) return false;
    let blocked = false;
    this.forEachStructureFootprintCell(gx, gy, type, (cx, cy) => {
      if (cx < 0 || cy < 0 || cx >= this.room.state.mapWidth || cy >= this.room.state.mapHeight) {
        blocked = true;
        return true;
      }
      if (this.tileAt(cx, cy) !== 0 || this.hasStructureAt(cx, cy) || this.hasCoreAt(cx, cy) || this.hasResourceAt(cx, cy)) {
        blocked = true;
        return true;
      }
      return false;
    });
    if (blocked) return false;
    if (me.devMode) return true;
    if (!me.isCoreAnchored) return false;
    const coreGX = Math.floor((me.coreX ?? me.x) / TILE_SIZE);
    const coreGY = Math.floor((me.coreY ?? me.y) / TILE_SIZE);
    const buildDist = Math.abs(coreGX - gx) + Math.abs(coreGY - gy);
    return buildDist <= 8;
  }

  createRtsPremiumHud() {
    if (this.mobileHudButtons.length > 0) return;
    
    const defs = [
      { id: "anchor", label: "ANCHOR", row: 0, col: 0 },
      { id: "build", label: "MAP", row: 0, col: 1 },
      { id: "dev", label: "DEV", row: 0, col: 2 },
      { id: "full", label: "FULL", row: 0, col: 3 },
      { id: "ore", label: "ORE", row: 1, col: 0 },
      { id: "sol", label: "SOL", row: 1, col: 1 },
      { id: "bar", label: "BAR", row: 1, col: 2 },
      { id: "wf", label: "WF", row: 1, col: 3 },
      { id: "soldier", label: "SOLD", row: 2, col: 0 },
      { id: "tank", label: "TANK", row: 2, col: 1 }
    ];

    for (const def of defs) {
      const btnImg = this.add.image(0, 0, this.getUiButtonTextureKey(false)).setInteractive().setScrollFactor(0).setDepth(1000);
      const btnText = this.add.text(0, 0, def.label, {
        font: "700 14px Arial",
        color: "#ffffff"
      }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);

      btnImg.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (def.id === "anchor") this.room?.send("anchor_base");
        else if (def.id === "dev") this.room?.send("toggle_dev_mode");
        else if (def.id === "full") this.toggleFullscreen();
        else if (def.id === "build") this.actionMode = this.actionMode === "build" ? "move" : "build";
        else if (def.id === "ore") {
          this.selectedBuild = "ore_refinery";
          if (this.canStartBuildType("ore_refinery")) this.startBuildDrag("ore_refinery", pointer);
          else this.showNotice(`Cannot build: ${this.getBuildBlockedReason("ore_refinery")}`, "#ffb080");
        } else if (def.id === "sol") {
          this.selectedBuild = "solar_panel";
          if (this.canStartBuildType("solar_panel")) this.startBuildDrag("solar_panel", pointer);
          else this.showNotice(`Cannot build: ${this.getBuildBlockedReason("solar_panel")}`, "#ffb080");
        } else if (def.id === "bar") {
          this.selectedBuild = "barracks";
          if (this.canStartBuildType("barracks")) this.startBuildDrag("barracks", pointer);
          else this.showNotice(`Cannot build: ${this.getBuildBlockedReason("barracks")}`, "#ffb080");
        } else if (def.id === "wf") {
          this.selectedBuild = "war_factory";
          if (this.canStartBuildType("war_factory")) this.startBuildDrag("war_factory", pointer);
          else this.showNotice(`Cannot build: ${this.getBuildBlockedReason("war_factory")}`, "#ffb080");
        }
        else if (def.id === "soldier") this.room?.send("produce_unit");
        else if (def.id === "tank") this.room?.send("produce_tank");
        
        this.updatePremiumHudButtons();
      });

      this.mobileHudButtons.push({ mode: def.id as any, rect: btnImg as any, text: btnText as any });
    }
  }

  layoutRtsPremiumGrid() {
    this.createRtsPremiumHud();
    const viewH = this.cameras.main.height;
    
    const btnW = 92;
    const btnH = 44;
    const gap = 8;
    const startX = 20 + btnW * 0.5;
    const startY = viewH - (btnH * 3) - (gap * 2) - 20 + btnH * 0.5;

    const defs = [
      { id: "anchor", row: 0, col: 0 }, { id: "build", row: 0, col: 1 }, { id: "dev", row: 0, col: 2 }, { id: "full", row: 0, col: 3 },
      { id: "ore", row: 1, col: 0 }, { id: "sol", row: 1, col: 1 }, { id: "bar", row: 1, col: 2 }, { id: "wf", row: 1, col: 3 },
      { id: "soldier", row: 2, col: 0 }, { id: "tank", row: 2, col: 1 }
    ];

    for (const def of defs) {
      const btn = this.mobileHudButtons.find(b => b.mode === def.id);
      if (!btn) continue;
      const x = startX + def.col * (btnW + gap);
      const y = startY + def.row * (btnH + gap);
      if (btn.rect instanceof Phaser.GameObjects.Image || btn.rect instanceof Phaser.GameObjects.Rectangle) {
        btn.rect.setPosition(x, y);
        if (btn.rect instanceof Phaser.GameObjects.Image) {
          (btn.rect as Phaser.GameObjects.Image).setDisplaySize(btnW, btnH);
        } else {
          (btn.rect as Phaser.GameObjects.Rectangle).setSize(btnW, btnH);
        }
      }
      btn.text.setPosition(x, y);
    }
    this.updatePremiumHudButtons();
  }

  updatePremiumHudButtons() {
    for (const btn of this.mobileHudButtons) {
      const img = btn.rect as unknown as Phaser.GameObjects.Image;
      let active = false;
      if (btn.mode === "build" && this.actionMode === "build") active = true;
      if (btn.mode === "ore" && this.selectedBuild === "ore_refinery") active = true;
      if (btn.mode === "sol" && this.selectedBuild === "solar_panel") active = true;
      if (btn.mode === "bar" && this.selectedBuild === "barracks") active = true;
      if (btn.mode === "wf" && this.selectedBuild === "war_factory") active = true;
      if (btn.mode === "dev") {
          const me = this.room?.state?.players?.get ? this.room.state.players.get(this.currentPlayerId) : this.room?.state?.players?.[this.currentPlayerId];
          if (me?.devMode) active = true;
      }
      
      img.setTexture(this.getUiButtonTextureKey(active));
    }
  }

  handleViewportResize(_gameSize: Phaser.Structs.Size) {
    // Build 110: Absolute Scroll Preservation
    if (this.cameras?.main) {
        this.preResizeScrollX = this.cameras.main.scrollX;
        this.preResizeScrollY = this.cameras.main.scrollY;
    }
    if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
    this.resizeTimeout = setTimeout(() => {
      this.executeViewportResize();
    }, 250);
  }

  executeViewportResize() {
    if (!this.cameras?.main) return;
    const cam = this.cameras.main;
    
    // Build 115: Removed cam.setBounds to prevent phantom 0,0 resets.
    // Manual clamping is already handled by clampCameraToWorld().
    
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.scale.updateBounds();
    cam.setViewport(0, 0, width, height);
    cam.setSize(width, height);
    
    // Build 107: Robust Zoom Locking for mobile stability
    if (!this.hasInitialZoomSet) {
        cam.setZoom(1.6);
        this.hasInitialZoomSet = true;
    }
    // Note: Subsequent resizes strictly PRESERVE current cam.zoom
    
    // Build 116: Use LIVE cam scroll, not preResizeScroll (which defaults to 0,0).
    // The cam already holds its current scroll position through resize.
    
    this.layoutBaseDefenseHud();
    this.scale.refresh();
    this.lastFogCamX = Number.NaN;
    this.lastFogCamY = Number.NaN;
    this.lastFogZoom = Number.NaN;
    this.lastWorldFogDrawAt = 0;
    
    // Ensure the new aspect ratio / viewport size hasn't exposed the out-of-bounds void
    (this as any).clampCameraToWorld?.();
  }

  layoutBaseDefenseHud() {
    if (!this.phaserHudEnabled) return;
    const viewW = this.cameras.main.width;
    const viewH = this.cameras.main.height;

    this.placeHudObject(this.statusText, viewW * 0.5, 20);
    this.layoutClientClock();
    this.placeHudObject(this.noticeText, viewW * 0.5, 64);
    
    // Premium RTS Grid Layout
    this.layoutRtsPremiumGrid();

    const panelHeight = 116;
    const panelY = viewH - panelHeight * 0.5 - 8;
    const panelW = Math.max(280, Math.min(viewW - 12, 1260));
    this.placeHudRect(this.buildPanelBg, viewW * 0.5, panelY, panelW, panelHeight);
    this.buildPanelBg?.setSize(panelW, panelHeight);
    this.placeHudObject(this.buildPanelStatsText, 12, panelY - panelHeight * 0.5 + 8);
    this.placeHudObject(this.buildMenuText, 20, viewH - 118);
  }

  ensureSelectionBoxDom() {
    if (this.selectionBoxRootEl) return this.selectionBoxRootEl;
    const root = document.createElement("div");
    root.style.position = "absolute";
    root.style.left = "0";
    root.style.top = "0";
    root.style.width = "0";
    root.style.height = "0";
    root.style.border = "2px solid rgba(0,255,204,0.95)";
    root.style.background = "rgba(0,255,204,0.15)";
    root.style.boxSizing = "border-box";
    root.style.pointerEvents = "none";
    root.style.userSelect = "none";
    root.style.zIndex = "9998";
    root.style.display = "none";
    this.getOverlayHostEl().appendChild(root);
    this.selectionBoxRootEl = root;
    return root;
  }

  renderSelectionBoxDom(x1: number, y1: number, x2: number, y2: number) {
    const root = this.ensureSelectionBoxDom();
    const rx = Math.min(x1, x2);
    const ry = Math.min(y1, y2);
    const rw = Math.abs(x2 - x1);
    const rh = Math.abs(y2 - y1);
    root.style.display = "block";
    root.style.left = `${rx}px`;
    root.style.top = `${ry}px`;
    root.style.width = `${rw}px`;
    root.style.height = `${rh}px`;
  }

  hideSelectionBoxDom() {
    if (!this.selectionBoxRootEl) return;
    this.selectionBoxRootEl.style.display = "none";
  }

  getActionButtonBlockedReason(id: string, me = this.getOwnPlayer()) {
    if (!me) return "Initializing";
    const anchored = !!me.isCoreAnchored || !!me.devMode;
    if (!anchored) {
      return id === "anchor" ? "" : "Anchor first";
    }
    if (id === "anchor") return "Anchored";
    if (id === "build" || id === "dev" || id === "full") return "";
    if (id === "soldier") return this.getUnitProduceBlockedReason() || "";
    if (id === "tank") return this.getFactoryProduceBlockedReason("tank") || "";
    if (id === "ore_refinery" || id === "solar_panel" || id === "barracks" || id === "war_factory") {
      return this.getBuildBlockedReason(id as "ore_refinery" | "solar_panel" | "barracks" | "war_factory") || "";
    }
    return "";
  }

  shouldShowActionButton(id: string, me = this.getOwnPlayer()) {
    const anchored = !!me?.isCoreAnchored || !!me?.devMode;
    if (!anchored) return id === "anchor";
    if (id === "anchor") return false;
    if (id === "soldier") return !!me?.devMode || this.myStructureCount("barracks") > 0;
    if (id === "tank") return !!me?.devMode || this.myStructureCount("war_factory") > 0;
    return true;
  }

  layoutClientClock() {
    if (!this.clientClockText) return;
    const centerY = this.cameras.main.height * 0.5 + 68;
    this.placeHudObject(this.clientClockText, this.cameras.main.width * 0.5, centerY);
  }

  placeHudObject(obj: Phaser.GameObjects.GameObject | null | undefined, screenX: number, screenY: number) {
    if (!obj) return;
    const invZoom = 1 / Math.max(0.001, this.cameras.main.zoom);
    (obj as any).setPosition(screenX * invZoom, screenY * invZoom);
    (obj as any).setScale(invZoom);
  }

  placeHudRect(rect: Phaser.GameObjects.Rectangle | null | undefined, screenX: number, screenY: number, width: number, height: number) {
    if (!rect) return;
    rect.setSize(width, height);
    this.placeHudObject(rect, screenX, screenY);
  }

  updateMobileHudButtons() {
    if (!this.phaserHudEnabled) return;
    for (const [id, btn] of this.mobileHudDomButtons.entries()) {
      const selected = (id === "select" || id === "move" || id === "attack") && this.mobileCommandMode === id;
      btn.style.background = selected ? "#2d7458" : "#223348";
      btn.style.borderColor = selected ? "#99ffd0" : "#8fb8da";
      btn.style.color = selected ? "#cffff0" : "#ffffff";
    }
    for (const b of this.mobileHudButtons) {
      const selected = (b.mode === "select" || b.mode === "move" || b.mode === "attack")
        && this.mobileCommandMode === b.mode;
      if (b.rect instanceof Phaser.GameObjects.Rectangle) {
        b.rect.setFillStyle(selected ? 0x2d7458 : 0x223348, 0.94);
        b.rect.setStrokeStyle(2, selected ? 0x99ffd0 : 0x8fb8da, 0.95);
      }
      b.text.setColor(selected ? "#cffff0" : "#ffffff");
    }
  }

  handleMobileHudPointer(pointer: Phaser.Input.Pointer) {
    if (!this.phaserHudEnabled) return false;
    for (const b of this.mobileHudButtons) {
      if (!this.pointInRect(pointer.x, pointer.y, b.rect)) continue;
      if (b.mode === "anchor") {
        this.room?.send("anchor_base");
      } else if (b.mode === "dev") {
        this.room?.send("toggle_dev_mode");
      } else if (b.mode === "full") {
        this.toggleFullscreen();
      } else if (b.mode === "zoom_in") {
        this.adjustMobileZoom(0.18);
      } else if (b.mode === "zoom_out") {
        this.adjustMobileZoom(-0.18);
      } else {
        if (b.mode === "select" || b.mode === "move" || b.mode === "attack") {
          this.mobileCommandMode = b.mode;
        }
        this.updateMobileHudButtons();
        this.updatePremiumHudButtons();
      }
      return true;
    }
    return false;
  }

  toggleFullscreen() {
    const host = this.getOverlayHostEl();
    if (document.fullscreenElement === host) {
      void document.exitFullscreen?.();
    } else if (host.requestFullscreen) {
      void host.requestFullscreen();
    } else if (this.scale.isFullscreen) {
      this.scale.stopFullscreen();
    } else {
      this.scale.startFullscreen();
    }
    this.time.delayedCall(60, () => {
      this.scale.updateBounds();
      this.handleViewportResize(this.scale.gameSize);
    });
  }

  adjustMobileZoom(delta: number) {
    const cam = this.cameras.main;
    const nextZoom = Phaser.Math.Clamp(cam.zoom + delta, this.getMinCameraZoom(), MAX_CAMERA_ZOOM);
    if (Math.abs(nextZoom - cam.zoom) < 0.001) return;
    this.applyZoomToViewportCenter(nextZoom);
    this.layoutBaseDefenseHud();
  }

  getMinCameraZoom() {
    if (!this.room?.state) return MIN_CAMERA_ZOOM;
    const cam = this.cameras.main;
    const worldW = Math.max(1, Number(this.room.state.mapWidth || 1) * TILE_SIZE);
    const worldH = Math.max(1, Number(this.room.state.mapHeight || 1) * TILE_SIZE);
    const fitByWidth = window.innerWidth / worldW;
    const fitByHeight = window.innerHeight / worldH;
    return Phaser.Math.Clamp(Math.max(MIN_CAMERA_ZOOM, fitByWidth, fitByHeight), MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM);
  }

  worldToScreenPoint(worldX: number, worldY: number) {
    const cam = this.cameras.main;
    cam.preRender();
    return {
      x: (worldX - cam.worldView.x) * cam.zoom,
      y: (worldY - cam.worldView.y) * cam.zoom,
    };
  }

  getActiveTouchPointers() {
    return this.input.manager.pointers.filter((p) => p && p.isDown && this.activeTouchIds.has(p.id));
  }

  getMyTeam() {
    const me = this.room?.state?.players?.get
      ? this.room.state.players.get(this.currentPlayerId)
      : this.room?.state?.players?.[this.currentPlayerId];
    return me?.team;
  }

  pointInRect(px: number, py: number, rect: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image) {
    const zoom = Math.max(0.001, this.cameras.main.zoom);
    const cx = rect.x * zoom;
    const cy = rect.y * zoom;
    const hw = (rect.displayWidth * zoom) / 2;
    const hh = (rect.displayHeight * zoom) / 2;
    return px >= cx - hw && px <= cx + hw && py >= cy - hh && py <= cy + hh;
  }

  startBuildDrag(type: "ore_refinery" | "solar_panel" | "barracks" | "war_factory", pointer?: Phaser.Input.Pointer) {
    this.draggingBuildType = type;
    this.selectedBuild = type;
    this.ensureBuildGhost();
    if (pointer) this.updateBuildGhost(pointer);
    this.buildGhost!.setVisible(true);
    this.buildGhostText!.setVisible(true);
  }

  updateBuildGhost(pointer: Phaser.Input.Pointer) {
    this.updateBuildGhostAtScreen(pointer.x, pointer.y);
  }

  stopBuildDrag() {
    this.draggingBuildType = null;
    this.unbindDomBuildDragListeners();
    this.buildGhost?.setVisible(false);
    this.buildGhostText?.setVisible(false);
  }

  showNotice(message: string, color = "#ffcc88") {
    if (!this.phaserHudEnabled) return;
    if (!this.noticeText) return;
    this.noticeText.setText(message);
    this.noticeText.setColor(color);
    this.noticeText.setVisible(true);
    if (this.noticeTimer) this.noticeTimer.remove(false);
    this.noticeTimer = this.time.delayedCall(2200, () => {
      this.noticeText?.setVisible(false);
    });
  }

}

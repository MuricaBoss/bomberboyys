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
import { BaseDefenseScene_Input } from "./BaseDefenseInput";

export class BaseDefenseScene_Hud extends BaseDefenseScene_Input {
  toggleDetailedPaths() {}

  createSafetyBorders() {
    for (const b of this.safetyBorders) b.destroy();
    this.safetyBorders = [];
    // Build 315: Create 4 black rectangles for the safety frame (5px)
    // Depth 20002 keeps them above fog and most UI, but below highest HUD texts if needed.
    const colors = 0x000000;
    const depth = 20002;
    this.safetyBorders = [
        this.add.rectangle(0, 0, 100, 5, colors).setOrigin(0).setScrollFactor(1).setDepth(depth), // Top
        this.add.rectangle(0, 0, 100, 5, colors).setOrigin(0).setScrollFactor(1).setDepth(depth), // Bottom
        this.add.rectangle(0, 0, 5, 100, colors).setOrigin(0).setScrollFactor(1).setDepth(depth), // Left
        this.add.rectangle(0, 0, 5, 100, colors).setOrigin(0).setScrollFactor(1).setDepth(depth), // Right
    ];
    this.layoutSafetyBorders();
  }

  layoutSafetyBorders() {
    const cam = this.cameras.main;
    if (this.safetyBorders.length < 4) return;

    // Build 316: Position exactly at world corners and use inverse-zoom thickness
    const tl = cam.getWorldPoint(0, 0);
    const br = cam.getWorldPoint(cam.width, cam.height);
    const worldW = br.x - tl.x;
    const worldH = br.y - tl.y;
    const worldThick = 5 / cam.zoom;
    
    // Top
    this.safetyBorders[0].setPosition(tl.x, tl.y).setSize(worldW, worldThick);
    // Bottom
    this.safetyBorders[1].setPosition(tl.x, br.y - worldThick).setSize(worldW, worldThick);
    // Left
    this.safetyBorders[2].setPosition(tl.x, tl.y).setSize(worldThick, worldH);
    // Right
    this.safetyBorders[3].setPosition(br.x - worldThick, tl.y).setSize(worldThick, worldH);
  }

  setupBaseDefenseRuntimeUi() {
    this.fpsText = this.add.text(10, 5, "FPS: --", {
      fontSize: "12px",
      color: "#00ff00",
      fontFamily: "monospace",
      backgroundColor: "#00000088"
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(20000).setPadding(2, 1, 2, 1).setVisible(false);
    this.uiText = this.add.text(20, 30, "", {
      fontSize: "18px",
      color: "#fff",
      fontFamily: "Arial",
      backgroundColor: "#00000088",
    }).setPadding(8).setScrollFactor(0).setDepth(100).setVisible(false);
    this.statusText = this.add.text(this.cameras.main.centerX, 20, "", {
      fontSize: "22px",
      color: "#aaffaa",
      fontFamily: "Arial",
      backgroundColor: "#00000088",
    }).setPadding(8).setScrollFactor(0).setDepth(100).setOrigin(0.5, 0);
    this.noticeText = this.add.text(this.cameras.main.centerX, 64, "", {
      fontSize: "18px",
      color: "#ffcc88",
      fontFamily: "Arial",
      backgroundColor: "#00000088",
      fontStyle: "bold",
    }).setPadding(6).setScrollFactor(0).setDepth(110).setOrigin(0.5, 0).setVisible(false);
    this.buildMenuText = this.add.text(20, this.cameras.main.height - 118, "", {
      fontSize: "15px",
      color: "#e8f7ff",
      fontFamily: "Arial",
      backgroundColor: "#00000088",
    }).setPadding(8).setScrollFactor(0).setDepth(100);
    this.createSafetyBorders();
    this.createBuildPanel();
    this.createMobileHud();
    this.keyP = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.P) || null;
    this.hidePhaserHud();
    this.createActionPanelDom();
    this.updateActionPanelDom();
    this.layoutBaseDefenseHud();
    this.layoutSafetyBorders();
    this.handleViewportResize(this.scale.gameSize); // Build 111: No force snap

    this.scale.on("resize", this.handleViewportResize, this);
    const syncViewportToScale = () => {
      this.scale.updateBounds();
      this.handleViewportResize(this.scale.gameSize); // Build 111: No snap on fullscreen transition
    };
    this.scale.on("enterfullscreen", syncViewportToScale);
    this.scale.on("leavefullscreen", syncViewportToScale);
    this.fullscreenSyncHandler = syncViewportToScale;
    document.addEventListener("fullscreenchange", syncViewportToScale);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", this.handleViewportResize, this);
      this.scale.off("enterfullscreen", syncViewportToScale);
      this.scale.off("leavefullscreen", syncViewportToScale);
      if (this.fullscreenSyncHandler) {
        document.removeEventListener("fullscreenchange", this.fullscreenSyncHandler);
        this.fullscreenSyncHandler = null;
      }
      this.destroyActionPanelDom();
      this.destroyMobileHudDom();
      this.destroyClientClockDom();
      this.destroySelectionBoxDom();
      if (this.gestureBlockHandler) {
        window.removeEventListener("gesturestart", this.gestureBlockHandler as EventListener);
        window.removeEventListener("gesturechange", this.gestureBlockHandler as EventListener);
        window.removeEventListener("gestureend", this.gestureBlockHandler as EventListener);
        this.gestureBlockHandler = null;
      }
    });
  }

  startDomBuildDrag(type: "ore_refinery" | "solar_panel" | "barracks" | "war_factory" | "vaina", event: PointerEvent) {
    this.clearCommandSelectionState();
    this.selectedBuild = type;
    const reason = this.getBuildBlockedReason(type);
    if (reason) {
      this.showNotice(`Cannot build: ${reason}`, "#ffb080");
      this.updateActionPanelDom();
      return;
    }
    this.startBuildDrag(type);
    const point = this.getOverlayScreenPointFromClient(event.clientX, event.clientY);
    this.updateBuildGhostAtScreen(point.x, point.y);
    this.domBuildDragPointerId = event.pointerId;
    this.domBuildDragMoveHandler = (moveEvent: PointerEvent) => {
      if (!this.draggingBuildType) return;
      if (this.domBuildDragPointerId !== null && moveEvent.pointerId !== this.domBuildDragPointerId) return;
      const movePoint = this.getOverlayScreenPointFromClient(moveEvent.clientX, moveEvent.clientY);
      this.updateBuildGhostAtScreen(movePoint.x, movePoint.y);
    };
    this.domBuildDragEndHandler = (endEvent: PointerEvent) => {
      if (!this.draggingBuildType) {
        this.unbindDomBuildDragListeners();
        return;
      }
      if (this.domBuildDragPointerId !== null && endEvent.pointerId !== this.domBuildDragPointerId) return;
      const endPoint = this.getOverlayScreenPointFromClient(endEvent.clientX, endEvent.clientY);
      this.completeBuildDragAtScreen(endPoint.x, endPoint.y);
    };
    window.addEventListener("pointermove", this.domBuildDragMoveHandler, { passive: true });
    window.addEventListener("pointerup", this.domBuildDragEndHandler, { passive: true });
    window.addEventListener("pointercancel", this.domBuildDragEndHandler, { passive: true });
    this.updateActionPanelDom();
  }

  createBuildPanel() {
    const y = this.cameras.main.height - 64;
    this.buildPanelBg = this.add.rectangle(660, y, 1260, 116, 0x0c1118, 0.78)
      .setStrokeStyle(2, 0x2f4b66)
      .setScrollFactor(0)
      .setDepth(105);

    const defs: Array<{ type: "ore_refinery" | "solar_panel" | "barracks" | "war_factory" | "vaina"; label: string; cost: number; buildMs: number; x: number }> = [
      { type: "ore_refinery", label: "Ore Refinery", cost: 55, buildMs: 5000, x: 170 },
      { type: "solar_panel", label: "Solar Panel", cost: 40, buildMs: 3500, x: 360 },
      { type: "barracks", label: "Barracks", cost: 80, buildMs: 6500, x: 550 },
      { type: "war_factory", label: "War Factory", cost: 130, buildMs: 7000, x: 740 },
      { type: "vaina", label: "Vaina", cost: 20, buildMs: 4500, x: 930 },
    ];

    this.buildButtons = defs.map((d) => {
      const rect = this.add.rectangle(d.x, y, 170, 84, 0x233242, 0.92)
        .setStrokeStyle(2, 0x90b7d9)
        .setScrollFactor(0)
        .setDepth(106);
      const title = this.add.text(d.x, y - 16, d.label, {
        fontSize: "14px",
        color: "#ffffff",
        fontFamily: "Arial",
        fontStyle: "bold",
      }).setOrigin(0.5).setScrollFactor(0).setDepth(107);
      const meta = this.add.text(d.x, y + 11, `Cost: ${d.cost} | ${Math.round(d.buildMs / 1000)}s`, {
        fontSize: "12px",
        color: "#d8ecff",
        fontFamily: "Arial",
      }).setOrigin(0.5).setScrollFactor(0).setDepth(107);
      return { type: d.type, cost: d.cost, buildMs: d.buildMs, rect, title, meta };
    });

    this.buildPanelStatsText = this.add.text(20, y - 46, "", {
      fontSize: "14px",
      color: "#d7efff",
      fontFamily: "Arial",
      backgroundColor: "#00000088",
    }).setPadding(6, 4, 6, 4).setScrollFactor(0).setDepth(108);

    const unitDefs: Array<{ action: "soldier" | "tank" | "harvester"; title: string; meta: string; x: number }> = [
      { action: "soldier", title: "Soldier [Q]", meta: "Barracks | 35", x: 940 },
      { action: "tank", title: "Tank [T]", meta: "War Factory | 90", x: 1090 },
      { action: "harvester", title: "Harvester [H]", meta: "War Factory | 70", x: 1240 },
    ];
    this.unitButtons = unitDefs.map((d) => {
      const rect = this.add.rectangle(d.x, y, 130, 84, 0x2a2a2a, 0.92)
        .setStrokeStyle(2, 0x666666)
        .setScrollFactor(0)
        .setDepth(106);
      const title = this.add.text(d.x, y - 16, d.title, {
        fontSize: "13px",
        color: "#ffffff",
        fontFamily: "Arial",
        fontStyle: "bold",
      }).setOrigin(0.5).setScrollFactor(0).setDepth(107);
      const meta = this.add.text(d.x, y + 11, d.meta, {
        fontSize: "12px",
        color: "#d8ecff",
        fontFamily: "Arial",
      }).setOrigin(0.5).setScrollFactor(0).setDepth(107);
      return { action: d.action, rect, title, meta };
    });
  }

  createMobileHud() {
    this.mobileHudButtons = [];
  }

  createMobileHudDom() {
    this.destroyMobileHudDom();
  }

  destroyMobileHudDom() {
    this.mobileHudDomButtons.clear();
    if (!this.mobileHudRootEl) return;
    this.mobileHudRootEl.remove();
    this.mobileHudRootEl = null;
  }

  layoutMobileHud() {
    if (!this.phaserHudEnabled) return;
    if (!this.mobileHudRootEl) return;
    const compactMobile = this.cameras.main.width < 460;
    this.mobileHudRootEl.style.gap = compactMobile ? "6px" : "8px";
    this.mobileHudRootEl.style.left = compactMobile ? "8px" : "10px";
    this.mobileHudRootEl.style.right = compactMobile ? "8px" : "10px";
    for (const btn of this.mobileHudDomButtons.values()) {
      btn.style.height = compactMobile ? "34px" : "38px";
      btn.style.fontSize = compactMobile ? "11px" : "12px";
    }
  }

  createClientClockDom() {
    this.destroyClientClockDom();
    this.createClientVersionDom();
    const root = document.createElement("div");
    root.style.position = "absolute";
    root.style.right = "12px";
    root.style.top = "max(10px, env(safe-area-inset-top))";
    root.style.padding = "4px 8px";
    root.style.borderRadius = "8px";
    root.style.background = "rgba(0,0,0,0.48)";
    root.style.color = "#ffffff";
    root.style.font = "700 12px Arial, sans-serif";
    root.style.letterSpacing = "0.03em";
    root.style.zIndex = "10000";
    root.style.pointerEvents = "none";
    root.style.userSelect = "none";
    this.getOverlayHostEl().appendChild(root);
    this.clientClockRootEl = root;
    const updateClock = () => {
      if (!this.clientClockRootEl) return;
      const elapsedSec = Math.max(0, Math.floor((Date.now() - this.clientClockStartedAt) / 1000));
      const mins = Math.floor(elapsedSec / 60);
      const secs = elapsedSec % 60;
      const beat = Math.floor(Date.now() / 500) % 2 === 0 ? "●" : "○";
      this.clientClockRootEl.textContent = `CLIENT ${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")} ${beat}`;
    };
    updateClock();
    this.clientClockTimer = window.setInterval(updateClock, 250);
  }

  destroyClientClockDom() {
    if (this.clientClockTimer) {
      window.clearInterval(this.clientClockTimer);
      this.clientClockTimer = 0;
    }
    if (!this.clientClockRootEl) return;
    this.clientClockRootEl.remove();
    this.clientClockRootEl = null;
    this.destroyClientVersionDom();
  }

  createClientVersionDom() {
    this.destroyClientVersionDom();
    const root = document.createElement("div");
    root.style.position = "absolute";
    root.style.left = "50%";
    root.style.top = "max(10px, env(safe-area-inset-top))";
    root.style.transform = "translateX(-50%)";
    root.style.padding = "6px 10px";
    root.style.borderRadius = "8px";
    root.style.background = "rgba(0,0,0,0.52)";
    root.style.color = "#d9efff";
    root.style.font = "700 12px Arial, sans-serif";
    root.style.letterSpacing = "0.04em";
    root.style.zIndex = "10002";
    root.style.pointerEvents = "none";
    root.style.userSelect = "none";
    root.textContent = `BUILD ${DISPLAY_BUILD_NUMBER} · [SOTILAAT: 0 | TANKIT: 0] · [RYHMAT: 0 | SEURAAJAT: 0 | KOKO: 0] · ${activeClientBuildId || CLIENT_BUNDLE_VERSION} · FPS --`;
    this.getOverlayHostEl().appendChild(root);
    this.clientVersionRootEl = root;
  }

  updateClientVersionDom(fps?: number, zoom?: number) {
    if (!this.clientVersionRootEl) return;
    const fpsLabel = Number.isFinite(fps) ? Math.round(Number(fps)) : "--";
    const zoomLabel = Number.isFinite(zoom) ? `${zoom!.toFixed(2)}x` : "--";
    const unitStats = `[SOTILAAT: ${this.soldierCount} | TANKIT: ${this.tankCount}]`;
    const squadStats = `[RYHMAT: ${this.activeSquadCount}]`;
    const groupStats = `[POLUT: ${this.lastMoveLeaderCount} | YKS: ${this.lastMoveFollowerCount}]`;
    this.clientVersionRootEl.textContent = `BUILD ${DISPLAY_BUILD_NUMBER} · ${unitStats} · ${squadStats} · ${groupStats} · ${activeClientBuildId || CLIENT_BUNDLE_VERSION} · ZOOM ${zoomLabel} · FPS ${fpsLabel}`;
  }

  destroyClientVersionDom() {
    if (!this.clientVersionRootEl) return;
    this.clientVersionRootEl.remove();
    this.clientVersionRootEl = null;
  }

  destroySelectionBoxDom() {
    if (!this.selectionBoxRootEl) return;
    this.selectionBoxRootEl.remove();
    this.selectionBoxRootEl = null;
  }

  createActionPanelDom() {
    this.destroyActionPanelDom();
    const root = document.createElement("div");
    root.style.position = "absolute";
    root.style.left = "12px";
    root.style.right = "12px";
    root.style.bottom = "max(12px, env(safe-area-inset-bottom))";
    root.style.display = "grid";
    root.style.gridTemplateColumns = "repeat(auto-fit, minmax(78px, 1fr))";
    root.style.gap = "6px";
    root.style.zIndex = "10001";
    root.style.pointerEvents = "auto";

    const defs: Array<{ id: string; label: string }> = [
      { id: "anchor", label: "ANCHOR" },
      { id: "build", label: "MAP" },
      { id: "fog", label: "FOG" },
      { id: "dev", label: "DEV" },
      { id: "full", label: "FULL" },
      { id: "ore_refinery", label: "ORE" },
      { id: "solar_panel", label: "SOL" },
      { id: "barracks", label: "BAR" },
      { id: "war_factory", label: "WF" },
      { id: "vaina", label: "VAN" },
      { id: "soldier", label: "SOLD" },
      { id: "tank", label: "TANK" },
      { id: "paths", label: "PATHS" },
      { id: "profile", label: "PROF" },
    ];

    for (const def of defs) {
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.justifyContent = "flex-end";
      wrap.style.gap = "4px";
      wrap.style.minHeight = "64px";

      const reason = document.createElement("div");
      reason.style.minHeight = "16px";
      reason.style.padding = "0 2px";
      reason.style.font = "700 10px Arial, sans-serif";
      reason.style.lineHeight = "1.15";
      reason.style.textAlign = "center";
      reason.style.color = "#ffb3b3";
      reason.style.textShadow = "0 1px 2px rgba(0,0,0,0.55)";
      reason.style.pointerEvents = "none";
      reason.style.userSelect = "none";
      reason.style.visibility = "hidden";
      wrap.appendChild(reason);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = def.label;
      btn.style.height = "42px";
      btn.style.border = "2px solid #8fb8da";
      btn.style.borderRadius = "8px";
      btn.style.background = "#223348";
      btn.style.color = "#fff";
      btn.style.font = "700 12px Arial, sans-serif";
      btn.style.webkitAppearance = "none";
      btn.style.appearance = "none";
      btn.style.touchAction = "manipulation";
      if (def.id === "ore_refinery" || def.id === "solar_panel" || def.id === "barracks" || def.id === "war_factory" || def.id === "vaina") {
        btn.style.touchAction = "none";
        btn.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.startDomBuildDrag(def.id as any, event);
        });
        btn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
      } else {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        this.clearCommandSelectionState();
        if (def.id === "anchor") {
          this.room.send("anchor_base");
        } else if (def.id === "fog") {
          this.fogEnabled = !this.fogEnabled;
          this.lastFogCamX = Number.NaN;
          this.lastFogCamY = Number.NaN;
          this.lastWorldFogDrawAt = 0;
        } else if (def.id === "dev") {
          this.room.send("toggle_dev_mode");
        } else if (def.id === "full") {
          this.toggleFullscreen();
        } else if (def.id === "soldier") {
          this.room.send("produce_unit");
        } else if (def.id === "tank") {
          this.room.send("produce_tank");
        } else if (def.id === "build") {
          this.actionMode = this.actionMode === "build" ? "move" : "build";
        } else if (def.id === "paths") {
          this.toggleDetailedPaths();
        } else if (def.id === "profile") {
          this.toggleProfiling();
        }
        this.updateActionPanelDom();
      });
      }
      wrap.appendChild(btn);
      root.appendChild(wrap);
      this.actionPanelButtons.set(def.id, btn);
      this.actionPanelReasonLabels.set(def.id, reason);
    }

    this.getOverlayHostEl().appendChild(root);
    this.actionPanelRootEl = root;
  }

  destroyActionPanelDom() {
    this.unbindDomBuildDragListeners();
    this.actionPanelButtons.clear();
    this.actionPanelReasonLabels.clear();
    if (!this.actionPanelRootEl) return;
    this.actionPanelRootEl.remove();
    this.actionPanelRootEl = null;
  }

  updateActionPanelDom() {
    if (!this.room?.state) {
      for (const [id, btn] of this.actionPanelButtons.entries()) {
        const reason = this.actionPanelReasonLabels.get(id);
        const wrap = btn.parentElement as HTMLDivElement | null;
        const selected = (id === "build" && this.actionMode === "build") || (id === "fog" && this.fogEnabled) || id === this.selectedBuild;
        if (wrap) wrap.style.display = id === "anchor" ? "flex" : "none";
        btn.style.background = selected ? "#2d7458" : "#223348";
        btn.style.borderColor = selected ? "#99ffd0" : "#8fb8da";
        btn.style.color = selected ? "#cffff0" : "#ffffff";
        btn.disabled = true;
        btn.title = "";
        btn.style.opacity = "0.45";
        btn.style.cursor = "not-allowed";
        if (reason) {
          reason.textContent = "";
          reason.style.visibility = "hidden";
        }
      }
      return;
    }
    const me = this.getOwnPlayer();
    for (const [id, btn] of this.actionPanelButtons.entries()) {
      const reasonLabel = this.actionPanelReasonLabels.get(id);
      const wrap = btn.parentElement as HTMLDivElement | null;
      const visible = this.shouldShowActionButton(id, me);
      if (wrap) wrap.style.display = visible ? "flex" : "none";
      if (!visible) {
        btn.disabled = true;
        btn.title = "";
        if (reasonLabel) {
          reasonLabel.textContent = "";
          reasonLabel.style.visibility = "hidden";
        }
        continue;
      }
      const selected = (id === "build" && this.actionMode === "build")
        || (id === "fog" && this.fogEnabled)
        || (id === "dev" && !!me?.devMode)
        || (id === "paths" && this.showDetailedPaths)
        || (id === "profile" && this.profilingActive)
        || id === this.selectedBuild;
      const disabledReason = this.getActionButtonBlockedReason(id, me);
      const enabled = !disabledReason;
      btn.style.background = selected && enabled ? "#2d7458" : "#223348";
      btn.style.borderColor = selected && enabled ? "#99ffd0" : (enabled ? "#8fb8da" : "#5b7287");
      btn.style.color = selected && enabled ? "#cffff0" : (enabled ? "#ffffff" : "#d5dbe1");
      btn.disabled = !enabled;
      btn.title = disabledReason;
      btn.style.opacity = enabled ? "1" : "0.5";
      btn.style.cursor = enabled ? "pointer" : "not-allowed";
      if (reasonLabel) {
        reasonLabel.textContent = disabledReason;
        reasonLabel.style.visibility = disabledReason ? "visible" : "hidden";
      }
    }
  }

  hidePhaserHud() {
    this.statusText?.setVisible(false);
    this.noticeText?.setVisible(false);
    this.buildMenuText?.setVisible(false);
    this.buildPanelBg?.setVisible(false);
    this.buildPanelStatsText?.setVisible(false);
    for (const b of this.buildButtons) {
      b.rect.setVisible(false);
      b.title.setVisible(false);
      b.meta.setVisible(false);
    }
    for (const b of this.unitButtons) {
      b.rect.setVisible(false);
      b.title.setVisible(false);
      b.meta.setVisible(false);
    }
    for (const b of this.mobileHudButtons) {
      b.rect.setVisible(false);
      b.text.setVisible(false);
    }
    this.mobileHudRootEl?.remove();
    this.mobileHudRootEl = null;
    this.mobileHudDomButtons.clear();
  }

  updateBuildPanel(me: any) {
    if (!this.phaserHudEnabled) return;
    const anchored = !!me?.isCoreAnchored || !!me?.devMode;
    this.buildPanelBg.setVisible(anchored);
    this.buildPanelStatsText.setVisible(anchored);
    for (const b of this.buildButtons) {
      b.rect.setVisible(anchored);
      b.title.setVisible(anchored);
      b.meta.setVisible(anchored);
    }
    for (const b of this.unitButtons) {
      b.rect.setVisible(anchored);
      b.title.setVisible(anchored);
      b.meta.setVisible(anchored);
    }
    if (!anchored) return;

    const powerNet = Number(me.powerProduced || 0) - Number(me.powerUsed || 0);
    this.buildPanelStatsText.setText(
      `Credits: ${Number(me.resources || 0)}  |  Power: ${Number(me.powerProduced || 0)}/${Number(me.powerUsed || 0)} (net ${powerNet})`
    );

    for (const b of this.buildButtons) {
      const reason = this.getBuildBlockedReason(b.type);
      const selected = this.selectedBuild === b.type;
      const canBuild = !reason;
      b.rect.setFillStyle(
        selected ? (canBuild ? 0x2d5a88 : 0x50423b) : (canBuild ? 0x233242 : 0x2a2a2a),
        0.92
      );
      b.rect.setStrokeStyle(2, selected ? 0xffffff : (canBuild ? 0x90b7d9 : 0x666666));
      b.meta.setText(reason ? reason : `Cost: ${b.cost} | ${Math.round(b.buildMs / 1000)}s`);
      b.meta.setColor(canBuild ? "#d8ecff" : "#ffb3b3");
    }

    for (const b of this.unitButtons) {
      const reason = b.action === "soldier"
        ? this.getUnitProduceBlockedReason()
        : this.getFactoryProduceBlockedReason(b.action);
      const can = !reason;
      const okColor = b.action === "soldier" ? 0x364225 : 0x2b3547;
      const okStroke = b.action === "soldier" ? 0xaddb95 : 0x9cc6ff;
      b.rect.setFillStyle(can ? okColor : 0x2a2a2a, 0.92);
      b.rect.setStrokeStyle(2, can ? okStroke : 0x666666);
      if (reason) {
        b.meta.setText(reason);
        b.meta.setColor("#ffb3b3");
      } else if (b.action === "soldier") {
        b.meta.setText("Barracks | 35");
        b.meta.setColor("#e3f5d5");
      } else if (b.action === "tank") {
        b.meta.setText("War Factory | 90");
        b.meta.setColor("#d8ecff");
      } else {
        b.meta.setText("War Factory | 70");
        b.meta.setColor("#d8ecff");
      }
    }
  }

}

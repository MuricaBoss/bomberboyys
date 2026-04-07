import Phaser from "phaser";
import { Client, Room } from "colyseus.js";

const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
const wsEndpoint = `${wsProtocol}://${location.hostname}:2567`;
const httpProtocol = location.protocol === "https:" ? "https" : "http";
const httpEndpoint = `${httpProtocol}://${location.hostname}:2567`;
const client = new Client(wsEndpoint);
const TILE_SIZE = 32;
const FOG_CELL_SIZE = 6;
const FOG_UPDATE_MS = 110;
const VERSION_POLL_MS = 15000;
let activeClientBuildId = "";
let versionPollTimer = 0;
const ENABLE_VERSION_POLLING = false;
const DISPLAY_BUILD_NUMBER = 49;
const MIN_CAMERA_ZOOM = 0.28;
const MAX_CAMERA_ZOOM = 2.2;

function getViewportSize() {
  const vv = window.visualViewport;
  const width = Math.max(
    1,
    Math.round(vv?.width || 0),
    Math.round(window.innerWidth || 0),
    Math.round(document.documentElement?.clientWidth || 0),
  );
  const height = Math.max(
    1,
    Math.round(vv?.height || 0),
    Math.round(window.innerHeight || 0),
    Math.round(document.documentElement?.clientHeight || 0),
  );
  return { width, height };
}
const CLIENT_BUNDLE_VERSION = (() => {
  try {
    const fileName = new URL(import.meta.url).pathname.split("/").pop() || "";
    if (fileName.startsWith("index-") && fileName.endsWith(".js")) {
      return fileName.slice("index-".length, -".js".length);
    }
    return fileName || "dev";
  } catch {
    return "unknown";
  }
})();

async function fetchClientBuildId() {
  const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return "";
  const data = await res.json() as { id?: string };
  return String(data?.id || "");
}

async function pollClientVersion() {
  try {
    const nextId = await fetchClientBuildId();
    if (!nextId) return;
    if (!activeClientBuildId) {
      activeClientBuildId = nextId;
      return;
    }
    if (nextId !== activeClientBuildId) {
      window.location.reload();
    }
  } catch {
    // Ignore transient network errors.
  }
}

function startClientVersionPolling() {
  if (!ENABLE_VERSION_POLLING) return;
  if (versionPollTimer) return;
  void pollClientVersion();
  versionPollTimer = window.setInterval(() => {
    void pollClientVersion();
  }, VERSION_POLL_MS);
}


class MenuScene extends Phaser.Scene {
  serverReady = false;
  hasStarted = false;
  selectedMode: "bomber_room" | "base_defense_room" = "base_defense_room";
  statusText: Phaser.GameObjects.Text | null = null;
  modeText: Phaser.GameObjects.Text | null = null;
  probeTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super("MenuScene");
  }
  preload() {
    this.load.svg('player', '/player.svg', { width: TILE_SIZE, height: TILE_SIZE });
    this.load.svg('wall', '/wall.svg', { width: TILE_SIZE, height: TILE_SIZE });
    this.load.svg('box', '/box.svg', { width: TILE_SIZE, height: TILE_SIZE });
    this.load.svg('bomb', '/bomb.svg', { width: TILE_SIZE, height: TILE_SIZE });
  }
  create() {
    this.add.rectangle(0, 0, this.cameras.main.width*2, this.cameras.main.height*2, 0x111111);
    this.add.text(this.cameras.main.centerX, this.cameras.main.centerY - 50, "BOMBER BOYS", { fontSize: '80px', color: '#00ff00', fontStyle: 'bold', fontFamily: 'Arial' }).setOrigin(0.5);
    const instruction = this.add.text(this.cameras.main.centerX, this.cameras.main.centerY + 50, "Click or Tap to Join", { fontSize: '36px', color: '#ffffff', fontFamily: 'Arial' }).setOrigin(0.5);
    this.statusText = this.add.text(this.cameras.main.centerX, this.cameras.main.centerY + 102, "Server: connecting...", { fontSize: '22px', color: '#ffcc66', fontFamily: 'Arial' }).setOrigin(0.5);
    const modeLabel = this.selectedMode === "base_defense_room" ? "Base Defense" : "Bomber";
    this.modeText = this.add.text(this.cameras.main.centerX, this.cameras.main.centerY + 145, `Mode: Bomber (1) | Base Defense (2)  [selected: ${modeLabel}]`, { fontSize: "20px", color: "#9fe6ff", fontFamily: "Arial" }).setOrigin(0.5);
    
    this.tweens.add({
      targets: instruction, alpha: 0.2, duration: 800, yoyo: true, repeat: -1
    });

    const probeServer = async () => {
      try {
        const res = await fetch(`${httpEndpoint}/healthz`, { method: "GET", cache: "no-store", mode: "cors" });
        this.serverReady = res.ok;
        if (this.statusText) this.statusText.setText(this.serverReady ? "Server: ready" : "Server: connecting...").setColor(this.serverReady ? "#66ff66" : "#ffcc66");
      } catch {
        this.serverReady = false;
        if (this.statusText) this.statusText.setText("Server: connecting...").setColor("#ffcc66");
      }
    };
    void probeServer();
    this.probeTimer = this.time.addEvent({ delay: 1500, loop: true, callback: () => { void probeServer(); } });

    this.input.keyboard!.on("keydown-ONE", () => {
      this.selectedMode = "bomber_room";
      if (this.modeText) this.modeText.setText("Mode: Bomber (1) | Base Defense (2)  [selected: Bomber]");
    });
    this.input.keyboard!.on("keydown-TWO", () => {
      this.selectedMode = "base_defense_room";
      if (this.modeText) this.modeText.setText("Mode: Bomber (1) | Base Defense (2)  [selected: Base Defense]");
    });

    const startSelectedMode = () => {
      if (this.hasStarted) return;
      if (this.selectedMode !== "base_defense_room" && !this.serverReady) return;
      this.hasStarted = true;
      if (this.probeTimer) {
        this.probeTimer.destroy();
        this.probeTimer = null;
      }
      if (this.selectedMode === "base_defense_room") this.scene.start("BaseDefenseScene_Advanced");
      else this.scene.start("GameScene");
    };

    this.input.keyboard!.on("keydown-SPACE", startSelectedMode);
    this.input.on("pointerdown", startSelectedMode);
  }

  shutdown() {
    if (this.probeTimer) {
      this.probeTimer.destroy();
      this.probeTimer = null;
    }
  }
}

export class BaseDefenseUiScene extends Phaser.Scene {
  buttons: Array<{
    id: "select" | "move" | "attack" | "anchor" | "dev" | "full" | "zoom_in" | "zoom_out";
    rect: Phaser.GameObjects.Rectangle;
    text: Phaser.GameObjects.Text;
  }> = [];
  bottomBg: Phaser.GameObjects.Rectangle | null = null;
  bottomStatsText: Phaser.GameObjects.Text | null = null;
  bottomBuildButtons: Array<{
    type: "ore_refinery" | "solar_panel" | "barracks" | "war_factory";
    rect: Phaser.GameObjects.Rectangle;
    title: Phaser.GameObjects.Text;
    meta: Phaser.GameObjects.Text;
  }> = [];
  bottomUnitButtons: Array<{
    action: "soldier" | "tank" | "harvester";
    rect: Phaser.GameObjects.Rectangle;
    title: Phaser.GameObjects.Text;
    meta: Phaser.GameObjects.Text;
  }> = [];

  constructor() {
    super("BaseDefenseUiScene");
  }

  create() {
    this.cameras.main.setBackgroundColor("rgba(0,0,0,0)");
    this.layoutButtons();
    this.scale.on("resize", this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", this.handleResize, this);
    });

    /*
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      const world = this.scene.get("BaseDefenseScene") as BaseDefenseScene;
      if (!world) return;

      for (const b of this.bottomBuildButtons) {
        if (!b.rect.visible) continue;
        if (!this.pointInRect(pointer.x, pointer.y, b.rect)) continue;
        (world as any).selectedBuild = b.type;
        (world as any).actionMode = "build";
        const reason = (world as any).getBuildBlockedReason(b.type);
        if (reason) (world as any).showNotice(`Cannot build: ${reason}`, "#ffb080");
        else (world as any).showNotice(`Tap map to place ${(world as any).buildLabel(b.type)}`, "#9fe8ff");
        return;
      }

      for (const b of this.bottomUnitButtons) {
        if (!b.rect.visible) continue;
        if (!this.pointInRect(pointer.x, pointer.y, b.rect)) continue;
        if (b.action === "soldier") {
          const reason = (world as any).getUnitProduceBlockedReason();
          if (reason) (world as any).showNotice(`Cannot produce: ${reason}`, "#ffb080");
          else world.room?.send("produce_unit");
        } else if (b.action === "tank") {
          const reason = (world as any).getFactoryProduceBlockedReason("tank");
          if (reason) (world as any).showNotice(`Cannot produce: ${reason}`, "#ffb080");
          else world.room?.send("produce_tank");
        } else {
          const reason = (world as any).getFactoryProduceBlockedReason("harvester");
          if (reason) (world as any).showNotice(`Cannot produce: ${reason}`, "#ffb080");
          else world.room?.send("produce_harvester");
        }
        return;
      }

      for (const b of this.buttons) {
        if (!b.rect.visible) continue;
        if (!this.pointInRect(pointer.x, pointer.y, b.rect)) continue;
        if (b.id === "anchor") world.room?.send("anchor_base");
        else if (b.id === "dev") world.room?.send("toggle_dev_mode");
        else if (b.id === "full") (world as any).toggleFullscreen();
        else if (b.id === "zoom_in") (world as any).adjustMobileZoom(0.18);
        else if (b.id === "zoom_out") (world as any).adjustMobileZoom(-0.18);
        else (world as any).mobileCommandMode = b.id;
        return;
      }
    });
    */
  }

  handleResize() {
    this.layoutButtons();
  }

  layoutButtons() {
    const defs: Array<{ id: "select" | "move" | "attack" | "anchor" | "dev" | "full" | "zoom_in" | "zoom_out"; label: string }> = [
      { id: "select", label: "SELECT" },
      { id: "move", label: "MOVE" },
      { id: "attack", label: "ATTACK" },
      { id: "anchor", label: "ANCHOR" },
      { id: "dev", label: "DEV" },
      { id: "full", label: "FULL" },
      { id: "zoom_out", label: "-" },
      { id: "zoom_in", label: "+" },
    ];
    const width = this.scale.width;
    const compact = width < 460;
    const cols = 3;
    const gap = compact ? 6 : 8;
    const margin = compact ? 8 : 10;
    const buttonW = Math.max(84, Math.floor((width - margin * 2 - gap * (cols - 1)) / cols));
    const buttonH = compact ? 34 : 38;
    const topY = compact ? 58 : 68;
    if (this.buttons.length === 0) {
      this.buttons = defs.map((d) => {
        const rect = this.add.rectangle(0, 0, buttonW, buttonH, 0x223348, 0.94)
          .setStrokeStyle(2, 0x8fb8da, 0.95)
          .setScrollFactor(0)
          .setDepth(1000);
        const text = this.add.text(0, 0, d.label, {
          fontSize: compact ? "11px" : "12px",
          color: "#ffffff",
          fontFamily: "Arial",
          fontStyle: "bold",
        }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);
        return { id: d.id, rect, text };
      });
    }
    this.buttons.forEach((b, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = margin + buttonW * 0.5 + col * (buttonW + gap);
      const y = topY + row * (buttonH + gap);
      b.rect.setPosition(x, y).setSize(buttonW, buttonH);
      b.text.setPosition(x, y).setFontSize(compact ? "11px" : "12px");
    });

    this.layoutBottomPanel();
  }

  ensureBottomPanel() {
    if (!this.bottomBg) {
      this.bottomBg = this.add.rectangle(0, 0, 100, 100, 0x0c1118, 0.9)
        .setStrokeStyle(2, 0x2f4b66)
        .setScrollFactor(0)
        .setDepth(1000);
    }
    if (!this.bottomStatsText) {
      this.bottomStatsText = this.add.text(0, 0, "", {
        fontSize: "13px",
        color: "#d7efff",
        fontFamily: "Arial",
        backgroundColor: "#00000088",
      }).setPadding(6, 4, 6, 4).setOrigin(0, 0).setScrollFactor(0).setDepth(1001);
    }
    if (this.bottomBuildButtons.length === 0) {
      const defs: Array<{ type: "ore_refinery" | "solar_panel" | "barracks" | "war_factory"; label: string; cost: number; buildMs: number }> = [
        { type: "ore_refinery", label: "Ore Refinery", cost: 55, buildMs: 5000 },
        { type: "solar_panel", label: "Solar Panel", cost: 40, buildMs: 3500 },
        { type: "barracks", label: "Barracks", cost: 80, buildMs: 6500 },
        { type: "war_factory", label: "War Factory", cost: 130, buildMs: 7000 },
      ];
      this.bottomBuildButtons = defs.map((d) => {
        const rect = this.add.rectangle(0, 0, 100, 50, 0x233242, 0.92)
          .setStrokeStyle(2, 0x90b7d9)
          .setScrollFactor(0)
          .setDepth(1001);
        const title = this.add.text(0, 0, d.label, {
          fontSize: "11px",
          color: "#ffffff",
          fontFamily: "Arial",
          fontStyle: "bold",
          align: "center",
          wordWrap: { width: 120, useAdvancedWrap: true },
        }).setOrigin(0.5).setScrollFactor(0).setDepth(1002);
        const meta = this.add.text(0, 0, `Cost: ${d.cost} | ${Math.round(d.buildMs / 1000)}s`, {
          fontSize: "10px",
          color: "#d8ecff",
          fontFamily: "Arial",
          align: "center",
        }).setOrigin(0.5).setScrollFactor(0).setDepth(1002);
        return { type: d.type, rect, title, meta };
      });
    }
    if (this.bottomUnitButtons.length === 0) {
      const defs: Array<{ action: "soldier" | "tank" | "harvester"; title: string; meta: string }> = [
        { action: "soldier", title: "Soldier [Q]", meta: "Barracks | 35" },
        { action: "tank", title: "Tank [T]", meta: "War Factory | 90" },
        { action: "harvester", title: "Harvester [H]", meta: "War Factory | 70" },
      ];
      this.bottomUnitButtons = defs.map((d) => {
        const rect = this.add.rectangle(0, 0, 100, 54, 0x2a2a2a, 0.92)
          .setStrokeStyle(2, 0x666666)
          .setScrollFactor(0)
          .setDepth(1001);
        const title = this.add.text(0, 0, d.title, {
          fontSize: "11px",
          color: "#ffffff",
          fontFamily: "Arial",
          fontStyle: "bold",
          align: "center",
        }).setOrigin(0.5).setScrollFactor(0).setDepth(1002);
        const meta = this.add.text(0, 0, d.meta, {
          fontSize: "10px",
          color: "#d8ecff",
          fontFamily: "Arial",
          align: "center",
        }).setOrigin(0.5).setScrollFactor(0).setDepth(1002);
        return { action: d.action, rect, title, meta };
      });
    }
  }

  layoutBottomPanel() {
    this.ensureBottomPanel();
    const width = this.scale.width;
    const height = this.scale.height;
    const compact = width < 460;
    const narrow = width < 390;
    const marginX = compact ? 8 : 10;
    const panelW = Math.max(280, width - marginX * 2);
    const panelH = narrow ? 206 : (compact ? 188 : 174);
    const panelY = height - panelH * 0.5 - 8;
    const statsTop = panelY - panelH * 0.5 + 8;
    const gap = compact ? 6 : 8;
    const buildCols = narrow ? 2 : 4;
    const buildW = Math.floor((panelW - 16 - gap * (buildCols - 1)) / buildCols);
    const buildH = narrow ? 50 : 54;
    const unitW = Math.floor((panelW - 16 - gap * 2) / 3);
    const unitY = panelY + (narrow ? 54 : 46);
    const left = width * 0.5 - panelW * 0.5 + 8;

    this.bottomBg!.setPosition(width * 0.5, panelY).setSize(panelW, panelH);
    this.bottomStatsText!.setPosition(left, statsTop).setFontSize(compact ? "12px" : "13px");

    this.bottomBuildButtons.forEach((b, idx) => {
      const col = idx % buildCols;
      const row = Math.floor(idx / buildCols);
      const x = left + buildW * 0.5 + col * (buildW + gap);
      const y = statsTop + 44 + row * (buildH + 8);
      b.rect.setPosition(x, y).setSize(buildW, buildH);
      b.title.setPosition(x, y - 10).setFontSize(compact ? "10px" : "11px");
      b.meta.setPosition(x, y + 9).setFontSize("10px");
      b.title.setWordWrapWidth(buildW - 10, true);
    });

    this.bottomUnitButtons.forEach((b, idx) => {
      const x = left + unitW * 0.5 + idx * (unitW + gap);
      b.rect.setPosition(x, unitY).setSize(unitW, 54);
      b.title.setPosition(x, unitY - 12).setFontSize(compact ? "10px" : "11px");
      b.meta.setPosition(x, unitY + 10).setFontSize("10px");
    });
  }

  pointInRect(px: number, py: number, rect: Phaser.GameObjects.Rectangle) {
    const hw = rect.width / 2;
    const hh = rect.height / 2;
    return px >= rect.x - hw && px <= rect.x + hw && py >= rect.y - hh && py <= rect.y + hh;
  }

  update() {
    // UI disabled for Bomberman clone test
  }
}

class GameScene extends Phaser.Scene {
  room!: Room<any>;
  playerEntities: { [sessionId: string]: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle } = {};
  playerLabels: { [sessionId: string]: Phaser.GameObjects.Text } = {};
  remotePlayerTargets: { [sessionId: string]: { x: number; y: number } } = {};
  bombEntities: { [bombId: string]: Phaser.GameObjects.Sprite | Phaser.GameObjects.Arc } = {};
  powerupEntities: { [puId: string]: Phaser.GameObjects.Arc } = {};
  tileEntities: (Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle)[] = [];
  mapCache: number[] = [];
  
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  spaceKey!: Phaser.Input.Keyboard.Key;
  wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  currentPlayerId: string = "";
  uiText!: Phaser.GameObjects.Text;
  scoreText!: Phaser.GameObjects.Text;
  timerText!: Phaser.GameObjects.Text;
  startTime: number = 0;
  gameOverText: Phaser.GameObjects.Text | null = null;
  canPlaceBomb = false;
  hasInitializedState = false;
  deathHideTimers: { [sessionId: string]: Phaser.Time.TimerEvent } = {};
  aliveCache: { [sessionId: string]: boolean } = {};
  isNamePromptOpen = false;
  lastNamePromptAt = 0;
  lastMoveSentAt = 0;
  nameModalEl: HTMLDivElement | null = null;
  nameInputEl: HTMLInputElement | null = null;
  durationModalEl: HTMLDivElement | null = null;
  durationInputEl: HTMLInputElement | null = null;
  lastMoveDirX = 0;
  lastMoveDirY = 0;
  loadingText: Phaser.GameObjects.Text | null = null;

  constructor() {
    super("GameScene");
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

  clearLoadingText() {
    if (!this.loadingText) return;
    this.loadingText.destroy();
    this.loadingText = null;
  }

  async create() {
    this.cameras.main.setBackgroundColor(0x0e0e0e);
    this.loadingText = this.add.text(
      this.cameras.main.centerX,
      this.cameras.main.centerY,
      "Joining server...",
      { fontSize: "28px", color: "#ffffff", fontFamily: "Arial" }
    ).setOrigin(0.5).setDepth(200).setScrollFactor(0);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.wasd = this.input.keyboard!.addKeys("W,A,S,D") as { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
    this.input.keyboard!.on("keydown-N", () => this.openNamePrompt());
    this.input.keyboard!.on("keydown-M", () => this.openDurationPrompt());
    this.ensureNameModal();
    this.ensureDurationModal();

    try {
      this.room = await this.withTimeout(client.joinOrCreate("bomber_room"), 8000, "joinOrCreate");
      console.log("Joined successfully, session ID:", this.room.sessionId);
      this.currentPlayerId = this.room.sessionId;

      this.uiText = this.add.text(20, 20, "Connecting...", { fontSize: '24px', color: '#fff', fontFamily: 'Arial', backgroundColor: '#00000088' })
        .setPadding(10)
        .setScrollFactor(0)
        .setDepth(100);
      this.scoreText = this.add.text(this.cameras.main.width - 20, 20, "", { fontSize: "18px", color: "#fff", fontFamily: "Arial", backgroundColor: "#00000088", align: "right" })
        .setPadding(10)
        .setScrollFactor(0)
        .setDepth(100)
        .setOrigin(1, 0);
      this.timerText = this.add.text(this.cameras.main.centerX, 20, "", {
        fontSize: "28px",
        color: "#ffffaa",
        fontFamily: "Arial",
        backgroundColor: "#00000088",
      }).setPadding(10).setScrollFactor(0).setDepth(100).setOrigin(0.5, 0);

      const savedName = localStorage.getItem("bb_name");
      if (savedName && savedName.trim()) {
        this.room.send("set_name", { name: savedName.trim().slice(0, 16) });
      }

      setTimeout(() => this.canPlaceBomb = true, 1000);

      const initializeIfReady = () => {
        const state = this.room.state;
        if (!this.hasInitializedState && state.mapWidth > 0 && state.mapHeight > 0 && this.mapItemCount(state.map) > 0) {
          this.initializeWorld(state);
          this.clearLoadingText();
        }
      };

      this.room.onStateChange(() => {
        initializeIfReady();
      });
      initializeIfReady();
      this.time.delayedCall(2200, initializeIfReady);

      this.room.onMessage("explosion", (tiles: {x: number, y: number}[]) => {
        tiles.forEach(t => {
          const rect = this.add.rectangle(
            t.x * TILE_SIZE + TILE_SIZE / 2, 
            t.y * TILE_SIZE + TILE_SIZE / 2, 
            TILE_SIZE, TILE_SIZE, 0xff8c00
          );
          rect.setDepth(8);
          this.tweens.add({ targets: rect, alpha: 0, duration: 300, onComplete: () => rect.destroy() });
        });
      });

      this.room.onMessage("player_died", (data: {id: string}) => {
        if (data.id === this.currentPlayerId) {
          const deathText = this.add.text(this.cameras.main.centerX, this.cameras.main.centerY, "YOU DIED", { fontSize: '80px', color: '#ff0000', fontStyle: 'bold', fontFamily: 'Arial' });
          deathText.setOrigin(0.5).setScrollFactor(0).setDepth(100);
          this.time.delayedCall(1800, () => deathText.destroy());
        }
      });

      this.room.onMessage("player_respawned", (data: {id: string}) => {
        if (data.id === this.currentPlayerId) {
          const t = this.add.text(this.cameras.main.centerX, this.cameras.main.centerY, "RESPAWNED", { fontSize: "52px", color: "#66ff66", fontStyle: "bold", fontFamily: "Arial" });
          t.setOrigin(0.5).setScrollFactor(0).setDepth(100);
          this.time.delayedCall(1000, () => t.destroy());
        }
      });

      this.room.onMessage("game_over", (data?: { winnerName?: string; score?: number }) => {
        if (this.gameOverText) {
          this.gameOverText.destroy();
        }
        const winner = data?.winnerName ? `${data.winnerName} wins` : "GAME OVER";
        const score = typeof data?.score === "number" ? ` (${data.score} pts)` : "";
        this.gameOverText = this.add.text(this.cameras.main.centerX, this.cameras.main.centerY - 100, `${winner}${score}`, { fontSize: '64px', color: '#ffff00', fontStyle: 'bold', fontFamily: 'Arial' });
        this.gameOverText.setOrigin(0.5).setScrollFactor(0).setDepth(100);
      });

    } catch (e) {
      console.error("JOIN ERROR", e);
      this.clearLoadingText();
      this.add.text(
        this.cameras.main.centerX,
        this.cameras.main.centerY,
        "Connection failed.\nPress SPACE to retry",
        { fontSize: "36px", color: "#ff4444", align: "center", fontFamily: "Arial" }
      ).setOrigin(0.5).setDepth(200);
      this.input.keyboard!.once("keydown-SPACE", () => this.scene.restart());
    }
  }

  initializeWorld(state: any) {
    this.hasInitializedState = true;
    this.clearLoadingText();
    this.drawMap(state);
    this.mapCache = Array.from(state.map as number[]);
    this.cameras.main.setBounds(0, 0, state.mapWidth * TILE_SIZE, state.mapHeight * TILE_SIZE);
    const hydrateExistingEntries = (
      collection: any,
      onEntry: (value: any, key: string) => void
    ) => {
      if (!collection) return;

      if (typeof collection.forEach === "function") {
        collection.forEach((value: any, key: string) => onEntry(value, key));
        return;
      }

      if (typeof collection.entries === "function") {
        for (const [key, value] of collection.entries()) {
          onEntry(value, key);
        }
        return;
      }

      if (typeof collection.keys === "function" && typeof collection.get === "function") {
        for (const key of collection.keys()) {
          onEntry(collection.get(key), key);
        }
        return;
      }

      for (const key of Object.keys(collection)) {
        const value = typeof collection.get === "function" ? collection.get(key) : collection[key];
        if (value !== undefined) {
          onEntry(value, key);
        }
      }
    };

    if (state.map && typeof (state.map as any).onChange === "function") {
      (state.map as any).onChange((item: number, index: number) => {
        if (this.tileEntities[index] && item === 0) {
          this.tileEntities[index].destroy();
        }
      });
    }

    const addPlayerEntity = (player: any, sessionId: string) => {
      if (this.playerEntities[sessionId]) return;

      const entity = this.textures.exists("player")
        ? this.add.sprite(player.x, player.y, "player")
        : this.add.rectangle(player.x, player.y, TILE_SIZE * 0.72, TILE_SIZE * 0.72, 0xffe066, 1).setStrokeStyle(2, 0x000000, 1);
      if (sessionId !== this.currentPlayerId) {
        if ("setTint" in entity) entity.setTint(0xff5555);
        else entity.setFillStyle(0xff5555, 1);
      }
      entity.setDepth(-10);
      this.playerEntities[sessionId] = entity;

      if (sessionId === this.currentPlayerId) {
        this.cameras.main.centerOn(player.x, player.y);
      }
      this.ensurePlayerLabel(sessionId, player);
      this.applyLifeVisual(sessionId, player);
    };

    if (state.players && typeof state.players.onAdd === "function") {
      state.players.onAdd(addPlayerEntity);
    }
    if (state.players && typeof (state.players as any).onChange === "function") {
      (state.players as any).onChange((player: any, sessionId: string) => {
        if (sessionId !== this.currentPlayerId) {
          this.remotePlayerTargets[sessionId] = { x: player.x, y: player.y };
        }
        this.ensurePlayerLabel(sessionId, player);
        this.applyLifeVisual(sessionId, player);
      });
    }
    hydrateExistingEntries(state.players, addPlayerEntity);

    if (state.players && typeof state.players.onRemove === "function") {
      state.players.onRemove((_player: any, sessionId: string) => {
        if (this.playerEntities[sessionId]) {
          this.playerEntities[sessionId].destroy();
          delete this.playerEntities[sessionId];
        }
        if (this.playerLabels[sessionId]) {
          this.playerLabels[sessionId].destroy();
          delete this.playerLabels[sessionId];
        }
        if (this.deathHideTimers[sessionId]) {
          this.deathHideTimers[sessionId].remove(false);
          delete this.deathHideTimers[sessionId];
        }
        delete this.remotePlayerTargets[sessionId];
        delete this.aliveCache[sessionId];
      });
    }

    const addBombEntity = (bomb: any, bombId: string) => {
      if (this.bombEntities[bombId]) return;
      const entity = this.textures.exists("bomb")
        ? this.add.sprite(bomb.x, bomb.y, "bomb")
        : this.add.circle(bomb.x, bomb.y, TILE_SIZE * 0.36, 0x222222, 1).setStrokeStyle(2, 0xffffff, 1);
      entity.setDepth(15);
      this.bombEntities[bombId] = entity;
      
      this.tweens.add({
        targets: entity, scaleX: 1.2, scaleY: 1.2, duration: 300, yoyo: true, repeat: -1
      });
    };
    if (state.bombs && typeof state.bombs.onAdd === "function") {
      state.bombs.onAdd(addBombEntity);
    }
    hydrateExistingEntries(state.bombs, addBombEntity);

    if (state.bombs && typeof state.bombs.onRemove === "function") {
      state.bombs.onRemove((_bomb: any, bombId: string) => {
        if (this.bombEntities[bombId]) {
          this.bombEntities[bombId].destroy();
          delete this.bombEntities[bombId];
        }
      });
    }

    const addPowerupEntity = (pu: any, puId: string) => {
      if (this.powerupEntities[puId]) return;
      let color = 0xffffff;
      if (pu.type === 1) color = 0xffff00;
      else if (pu.type === 2) color = 0xff0000;
      else if (pu.type === 3) color = 0x00aaff;

      const entity = this.add.circle(pu.x, pu.y, TILE_SIZE * 0.35, color);
      entity.setStrokeStyle(2, 0xffffff);
      entity.setDepth(12);
      this.powerupEntities[puId] = entity;
    };
    if (state.powerups && typeof state.powerups.onAdd === "function") {
      state.powerups.onAdd(addPowerupEntity);
    }
    hydrateExistingEntries(state.powerups, addPowerupEntity);

    if (state.powerups && typeof state.powerups.onRemove === "function") {
      state.powerups.onRemove((_pu: any, puId: string) => {
        if (this.powerupEntities[puId]) {
          this.powerupEntities[puId].destroy();
          delete this.powerupEntities[puId];
        }
      });
    }
  }

  drawMap(state: any) {
    const width = state.mapWidth;
    const height = state.mapHeight;
    const map = state.map;

    this.add.rectangle(width*TILE_SIZE/2, height*TILE_SIZE/2, width*TILE_SIZE, height*TILE_SIZE, 0x228B22).setDepth(-10); // Nurmi

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = map[y * width + x];
        const screenX = x * TILE_SIZE;
        const screenY = y * TILE_SIZE;

        let entity: Phaser.GameObjects.Sprite | null = null;
        if (tile === 1) {
          entity = this.add.sprite(screenX + TILE_SIZE/2, screenY + TILE_SIZE/2, 'wall');
        } else if (tile === 2) {
          entity = this.add.sprite(screenX + TILE_SIZE/2, screenY + TILE_SIZE/2, 'box');
        }

        if (entity) {
          this.tileEntities[y * width + x] = entity;
        } else {
          this.tileEntities[y * width + x] = undefined as unknown as Phaser.GameObjects.Sprite;
        }
      }
    }
  }

  syncMapVisuals() {
    if (!this.room?.state) return;
    const width = this.room.state.mapWidth;
    const height = this.room.state.mapHeight;
    const map = this.room.state.map;
    const total = width * height;

    for (let index = 0; index < total; index++) {
      const tile = map[index] ?? 0;
      const prev = this.mapCache[index];
      if (prev === tile) continue;

      const existing = this.tileEntities[index];
      if (existing) {
        existing.destroy();
        this.tileEntities[index] = undefined as unknown as Phaser.GameObjects.Sprite;
      }

      if (tile === 1 || tile === 2) {
        const x = index % width;
        const y = Math.floor(index / width);
        const key = tile === 1 ? "wall" : "box";
        this.tileEntities[index] = this.add.sprite(
          x * TILE_SIZE + TILE_SIZE / 2,
          y * TILE_SIZE + TILE_SIZE / 2,
          key
        );
      }

      this.mapCache[index] = tile;
    }
  }

  ensurePlayerLabel(sessionId: string, player?: any) {
    let label = this.playerLabels[sessionId];
    if (!label) {
      const baseName = (player?.name && String(player.name).trim()) || `P-${sessionId.slice(0, 4)}`;
      const text = sessionId === this.currentPlayerId ? `${baseName} (YOU)` : baseName;
      label = this.add.text(0, 0, text, {
        fontSize: "14px",
        color: "#ffffff",
        fontFamily: "Arial",
        backgroundColor: "#00000088",
      }).setOrigin(0.5, 1).setDepth(40).setPadding(4, 2, 4, 2);
      this.playerLabels[sessionId] = label;
    } else if (player) {
      const baseName = (player.name && String(player.name).trim()) || `P-${sessionId.slice(0, 4)}`;
      const nextText = sessionId === this.currentPlayerId ? `${baseName} (YOU)` : baseName;
      if (label.text !== nextText) {
        label.setText(nextText);
      }
    }
    return label;
  }

  updateScoreboard() {
    if (!this.room?.state?.players || !this.scoreText) return;
    const rows: { name: string; score: number; kills: number; deaths: number; alive: boolean }[] = [];
    const players = this.room.state.players;
    if (players.forEach) {
      players.forEach((p: any) => {
        rows.push({
          name: (p.name && String(p.name).trim()) || "Player",
          score: p.score ?? 0,
          kills: p.kills ?? 0,
          deaths: p.deaths ?? 0,
          alive: !!p.isAlive,
        });
      });
    }
    rows.sort((a, b) => b.score - a.score || b.kills - a.kills);
    const lines = rows.slice(0, 8).map((r, i) => `${i + 1}. ${r.name} ${r.score}p (${r.kills}/${r.deaths}) ${r.alive ? "" : " DEAD"}`);
    this.scoreText.setText(["SCORE", ...lines].join("\n"));
  }

  updateTimerUI() {
    if (!this.room?.state || !this.timerText) return;
    const state = this.room.state;
    const duration = Math.max(0, Math.floor(state.matchDurationSec || 0));
    const leftMs = state.roundActive ? Math.max(0, state.matchEndsAt - Date.now()) : 0;
    const leftSec = Math.ceil(leftMs / 1000);
    const mm = String(Math.floor(leftSec / 60)).padStart(2, "0");
    const ss = String(leftSec % 60).padStart(2, "0");
    const hostMark = state.hostId === this.currentPlayerId ? " | HOST [M]" : "";
    const status = state.roundActive ? `${mm}:${ss}` : "Round break";
    this.timerText.setText(`${status} | Match ${duration}s${hostMark}`);
    if (state.roundActive && this.gameOverText) {
      this.gameOverText.destroy();
      this.gameOverText = null;
    }
  }

  applyLifeVisual(sessionId: string, player: any) {
    const entity = this.playerEntities[sessionId];
    const label = this.playerLabels[sessionId];
    if (!entity) return;

    const wasAlive = this.aliveCache[sessionId] ?? true;
    const isAlive = !!player.isAlive;
    this.aliveCache[sessionId] = isAlive;

    if (!isAlive) {
      if ("setTint" in entity) entity.setTint(0x222222);
      else entity.setFillStyle(0x222222, 1);
      entity.setAlpha(0.95);
      entity.setVisible(true);
      if (label) label.setVisible(true);

      if (wasAlive && !this.deathHideTimers[sessionId]) {
        this.deathHideTimers[sessionId] = this.time.delayedCall(300, () => {
          entity.setVisible(false);
          if (label) label.setVisible(false);
          delete this.deathHideTimers[sessionId];
        });
      }
      return;
    }

    if (this.deathHideTimers[sessionId]) {
      this.deathHideTimers[sessionId].remove(false);
      delete this.deathHideTimers[sessionId];
    }
    entity.setVisible(true);
    if (label) label.setVisible(true);
    if ("clearTint" in entity) entity.clearTint();
    else if (sessionId !== this.currentPlayerId) entity.setFillStyle(0xff5555, 1);
    const shielded = typeof player.invulnerableUntil === "number" && player.invulnerableUntil > Date.now();
    entity.setAlpha(shielded ? 0.65 : 1);
  }

  openNamePrompt() {
    const now = Date.now();
    if (this.isNamePromptOpen || now - this.lastNamePromptAt < 400) return;
    if (!this.room) return;
    this.ensureNameModal();
    if (!this.nameModalEl || !this.nameInputEl) return;

    this.isNamePromptOpen = true;
    this.lastNamePromptAt = now;

    const me = this.room.state?.players?.get
      ? this.room.state.players.get(this.currentPlayerId)
      : this.room.state?.players?.[this.currentPlayerId];
    const currentName = (me?.name && String(me.name)) || localStorage.getItem("bb_name") || "";
    this.nameInputEl.value = currentName;
    this.nameModalEl.style.display = "flex";
    this.scene.pause();
    this.nameInputEl.focus();
    this.nameInputEl.select();
  }

  openDurationPrompt() {
    if (!this.room?.state) return;
    if (this.room.state.hostId !== this.currentPlayerId) return;
    this.ensureDurationModal();
    if (!this.durationModalEl || !this.durationInputEl) return;
    if (this.isNamePromptOpen) return;

    this.isNamePromptOpen = true;
    this.scene.pause();
    this.durationInputEl.value = String(this.room.state.matchDurationSec || 180);
    this.durationModalEl.style.display = "flex";
    this.durationInputEl.focus();
    this.durationInputEl.select();
  }

  ensureNameModal() {
    if (this.nameModalEl && this.nameInputEl) return;

    const modal = document.createElement("div");
    modal.style.position = "fixed";
    modal.style.inset = "0";
    modal.style.display = "none";
    modal.style.alignItems = "center";
    modal.style.justifyContent = "center";
    modal.style.background = "rgba(0,0,0,0.65)";
    modal.style.zIndex = "9999";

    const card = document.createElement("div");
    card.style.background = "#101010";
    card.style.border = "1px solid #444";
    card.style.borderRadius = "10px";
    card.style.padding = "16px";
    card.style.minWidth = "320px";
    card.style.color = "#fff";
    card.style.fontFamily = "Arial, sans-serif";

    const title = document.createElement("div");
    title.textContent = "Change Name";
    title.style.fontSize = "18px";
    title.style.fontWeight = "700";
    title.style.marginBottom = "10px";

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 16;
    input.placeholder = "Player name";
    input.style.width = "100%";
    input.style.boxSizing = "border-box";
    input.style.padding = "10px";
    input.style.borderRadius = "6px";
    input.style.border = "1px solid #666";
    input.style.background = "#1f1f1f";
    input.style.color = "#fff";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    actions.style.marginTop = "12px";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.padding = "8px 12px";

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save";
    saveBtn.style.padding = "8px 12px";

    const closeModal = () => {
      modal.style.display = "none";
      this.isNamePromptOpen = false;
      this.lastNamePromptAt = Date.now();
      this.scene.resume();
    };

    const saveName = () => {
      const nextName = input.value.trim().slice(0, 16);
      if (nextName && this.room) {
        localStorage.setItem("bb_name", nextName);
        this.room.send("set_name", { name: nextName });
      }
      closeModal();
    };

    cancelBtn.addEventListener("click", closeModal);
    saveBtn.addEventListener("click", saveName);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveName();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      }
    });

    actions.append(cancelBtn, saveBtn);
    card.append(title, input, actions);
    modal.append(card);
    document.body.append(modal);

    this.nameModalEl = modal;
    this.nameInputEl = input;
  }

  ensureDurationModal() {
    if (this.durationModalEl && this.durationInputEl) return;

    const modal = document.createElement("div");
    modal.style.position = "fixed";
    modal.style.inset = "0";
    modal.style.display = "none";
    modal.style.alignItems = "center";
    modal.style.justifyContent = "center";
    modal.style.background = "rgba(0,0,0,0.65)";
    modal.style.zIndex = "9999";

    const card = document.createElement("div");
    card.style.background = "#101010";
    card.style.border = "1px solid #444";
    card.style.borderRadius = "10px";
    card.style.padding = "16px";
    card.style.minWidth = "320px";
    card.style.color = "#fff";
    card.style.fontFamily = "Arial, sans-serif";

    const title = document.createElement("div");
    title.textContent = "Match Duration (seconds)";
    title.style.fontSize = "18px";
    title.style.fontWeight = "700";
    title.style.marginBottom = "10px";

    const input = document.createElement("input");
    input.type = "number";
    input.min = "60";
    input.max = "900";
    input.step = "10";
    input.style.width = "100%";
    input.style.boxSizing = "border-box";
    input.style.padding = "10px";
    input.style.borderRadius = "6px";
    input.style.border = "1px solid #666";
    input.style.background = "#1f1f1f";
    input.style.color = "#fff";

    const hint = document.createElement("div");
    hint.textContent = "Allowed range: 60-900";
    hint.style.marginTop = "8px";
    hint.style.opacity = "0.8";
    hint.style.fontSize = "12px";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    actions.style.marginTop = "12px";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.padding = "8px 12px";

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Apply";
    saveBtn.style.padding = "8px 12px";

    const closeModal = () => {
      modal.style.display = "none";
      this.isNamePromptOpen = false;
      this.scene.resume();
    };

    const saveDuration = () => {
      if (!this.room?.state || this.room.state.hostId !== this.currentPlayerId) {
        closeModal();
        return;
      }
      const next = Number(input.value);
      if (Number.isFinite(next)) {
        const safeSeconds = Math.max(60, Math.min(900, Math.floor(next)));
        this.room.send("set_match_duration", { seconds: safeSeconds });
      }
      closeModal();
    };

    cancelBtn.addEventListener("click", closeModal);
    saveBtn.addEventListener("click", saveDuration);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveDuration();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      }
    });

    actions.append(cancelBtn, saveBtn);
    card.append(title, input, hint, actions);
    modal.append(card);
    document.body.append(modal);

    this.durationModalEl = modal;
    this.durationInputEl = input;
  }

  tileAt(gridX: number, gridY: number) {
    if (!this.room?.state) return 1;
    if (gridX < 0 || gridY < 0 || gridX >= this.room.state.mapWidth || gridY >= this.room.state.mapHeight) return 1;
    return this.room.state.map[gridY * this.room.state.mapWidth + gridX] ?? 1;
  }

  canOccupy(worldX: number, worldY: number, radius: number) {
    const samples = [
      { x: worldX, y: worldY },
      { x: worldX - radius, y: worldY - radius },
      { x: worldX + radius, y: worldY - radius },
      { x: worldX - radius, y: worldY + radius },
      { x: worldX + radius, y: worldY + radius },
    ];

    for (const p of samples) {
      const gx = Math.floor(p.x / TILE_SIZE);
      const gy = Math.floor(p.y / TILE_SIZE);
      const tile = this.tileAt(gx, gy);
      if (tile === 1 || tile === 2) {
        return false;
      }
    }
    return true;
  }

  hasDynamicBlockAt(gridX: number, gridY: number, options?: { ignoreOwnBombOnGrid?: { x: number; y: number } }) {
    if (!this.room?.state) return false;

    let blocked = false;
    const checkSameGrid = (x: number, y: number) => Math.floor(x / TILE_SIZE) === gridX && Math.floor(y / TILE_SIZE) === gridY;

    const bombs = this.room.state.bombs;
    if (bombs?.forEach) {
      bombs.forEach((b: any) => {
        if (!checkSameGrid(b.x, b.y)) return;
        if (options?.ignoreOwnBombOnGrid && b.ownerId === this.currentPlayerId) {
          const bx = Math.floor(b.x / TILE_SIZE);
          const by = Math.floor(b.y / TILE_SIZE);
          if (bx === options.ignoreOwnBombOnGrid.x && by === options.ignoreOwnBombOnGrid.y) return;
        }
        blocked = true;
      });
    } else if (bombs?.entries) {
      for (const [, b] of bombs.entries()) {
        if (!checkSameGrid(b.x, b.y)) continue;
        if (options?.ignoreOwnBombOnGrid && b.ownerId === this.currentPlayerId) {
          const bx = Math.floor(b.x / TILE_SIZE);
          const by = Math.floor(b.y / TILE_SIZE);
          if (bx === options.ignoreOwnBombOnGrid.x && by === options.ignoreOwnBombOnGrid.y) continue;
        }
        if (checkSameGrid(b.x, b.y)) {
          blocked = true;
          break;
        }
      }
    }
    if (blocked) return true;

    const players = this.room.state.players;
    if (players?.forEach) {
      players.forEach((p: any, id: string) => {
        if (id === this.currentPlayerId || !p?.isAlive) return;
        if (checkSameGrid(p.x, p.y)) blocked = true;
      });
    } else if (players?.entries) {
      for (const [id, p] of players.entries()) {
        if (id === this.currentPlayerId || !p?.isAlive) continue;
        if (checkSameGrid(p.x, p.y)) {
          blocked = true;
          break;
        }
      }
    }

    return blocked;
  }

  isDirectionBlocked(entity: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle, dirX: number, dirY: number) {
    const gridX = Math.floor(entity.x / TILE_SIZE);
    const gridY = Math.floor(entity.y / TILE_SIZE);
    const nextX = gridX + dirX;
    const nextY = gridY + dirY;

    if (this.tileAt(nextX, nextY) !== 0) return true;
    if (this.hasDynamicBlockAt(nextX, nextY, { ignoreOwnBombOnGrid: { x: gridX, y: gridY } })) return true;
    return false;
  }

  isDiagonalCornerBlocked(entity: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle, dirX: number, dirY: number) {
    if (dirX === 0 || dirY === 0) return false;
    const gridX = Math.floor(entity.x / TILE_SIZE);
    const gridY = Math.floor(entity.y / TILE_SIZE);
    const cornerX = gridX + (dirX > 0 ? 1 : -1);
    const cornerY = gridY + (dirY > 0 ? 1 : -1);
    if (this.tileAt(cornerX, cornerY) !== 0) return true;
    if (this.hasDynamicBlockAt(cornerX, cornerY, { ignoreOwnBombOnGrid: { x: gridX, y: gridY } })) return true;
    return false;
  }

  shouldCenterToGrid(entity: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle, moveDx: number, moveDy: number) {
    const gridX = Math.floor(entity.x / TILE_SIZE);
    const gridY = Math.floor(entity.y / TILE_SIZE);

    if (moveDx !== 0) {
      const nextX = gridX + (moveDx > 0 ? 1 : -1);
      if (this.tileAt(nextX, gridY) !== 0 || this.hasDynamicBlockAt(nextX, gridY, { ignoreOwnBombOnGrid: { x: gridX, y: gridY } })) return true;
    }
    if (moveDy !== 0) {
      const nextY = gridY + (moveDy > 0 ? 1 : -1);
      if (this.tileAt(gridX, nextY) !== 0 || this.hasDynamicBlockAt(gridX, nextY, { ignoreOwnBombOnGrid: { x: gridX, y: gridY } })) return true;
    }

    return false;
  }

  centerToCurrentGrid(entity: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle, amount: number) {
    const gx = Math.floor(entity.x / TILE_SIZE);
    const gy = Math.floor(entity.y / TILE_SIZE);
    const centerX = gx * TILE_SIZE + TILE_SIZE / 2;
    const centerY = gy * TILE_SIZE + TILE_SIZE / 2;
    entity.x = Phaser.Math.Linear(entity.x, centerX, amount);
    entity.y = Phaser.Math.Linear(entity.y, centerY, amount);
  }

  hasBlockedCorner(entity: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle, radius: number) {
    const probe = radius * 0.88;
    const currentGridX = Math.floor(entity.x / TILE_SIZE);
    const currentGridY = Math.floor(entity.y / TILE_SIZE);
    const corners = [
      { x: entity.x - probe, y: entity.y - probe },
      { x: entity.x + probe, y: entity.y - probe },
      { x: entity.x - probe, y: entity.y + probe },
      { x: entity.x + probe, y: entity.y + probe },
    ];

    let blockedCount = 0;
    for (const c of corners) {
      const gx = Math.floor(c.x / TILE_SIZE);
      const gy = Math.floor(c.y / TILE_SIZE);
      if (this.tileAt(gx, gy) !== 0) {
        blockedCount += 1;
      } else if (this.hasDynamicBlockAt(gx, gy, { ignoreOwnBombOnGrid: { x: currentGridX, y: currentGridY } })) {
        blockedCount += 1;
      }
    }

    return blockedCount >= 2;
  }

  applyCornerAssist(
    entity: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle,
    dx: number,
    dy: number,
    speed: number,
    radius: number,
    nextX: number,
    nextY: number
  ) {
    if (dx !== 0 && dy === 0) {
      const targetY = Math.floor(entity.y / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2;
      const pull = Phaser.Math.Clamp((targetY - entity.y) * 0.5, -speed * 0.9, speed * 0.9);
      const candidateY = entity.y + pull;
      if (this.canOccupy(entity.x, candidateY, radius)) {
        entity.y = candidateY;
      }
      if (this.canOccupy(nextX, entity.y, radius)) {
        entity.x = nextX;
        return true;
      }
    }

    if (dy !== 0 && dx === 0) {
      const targetX = Math.floor(entity.x / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2;
      const pull = Phaser.Math.Clamp((targetX - entity.x) * 0.5, -speed * 0.9, speed * 0.9);
      const candidateX = entity.x + pull;
      if (this.canOccupy(candidateX, entity.y, radius)) {
        entity.x = candidateX;
      }
      if (this.canOccupy(entity.x, nextY, radius)) {
        entity.y = nextY;
        return true;
      }
    }

    return false;
  }

  applyTurnAssist(
    entity: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle,
    dx: number,
    dy: number,
    speed: number,
    radius: number
  ) {
    const gridX = Math.floor(entity.x / TILE_SIZE);
    const gridY = Math.floor(entity.y / TILE_SIZE);
    const ignoreOwnBombOnGrid = { x: gridX, y: gridY };

    // Vertical turn: pull sideways toward nearest open lane in the next row.
    if (dy !== 0 && dx === 0) {
      const nextRow = gridY + (dy > 0 ? 1 : -1);
      const candidates: number[] = [];
      for (const col of [gridX - 2, gridX - 1, gridX, gridX + 1, gridX + 2]) {
        if (this.tileAt(col, gridY) !== 0) continue;
        if (this.tileAt(col, nextRow) !== 0) continue;
        if (this.hasDynamicBlockAt(col, nextRow, { ignoreOwnBombOnGrid })) continue;
        const cx = col * TILE_SIZE + TILE_SIZE / 2;
        if (!this.canOccupy(cx, entity.y, radius)) continue;
        candidates.push(cx);
      }
      if (candidates.length === 0) return false;
      let targetX = candidates[0];
      let minDist = Math.abs(entity.x - targetX);
      for (let i = 1; i < candidates.length; i++) {
        const d = Math.abs(entity.x - candidates[i]);
        if (d < minDist) {
          minDist = d;
          targetX = candidates[i];
          continue;
        }
        if (d === minDist && this.lastMoveDirX !== 0) {
          const currSide = Math.sign(candidates[i] - entity.x);
          const prevSide = Math.sign(targetX - entity.x);
          if (currSide === this.lastMoveDirX && prevSide !== this.lastMoveDirX) {
            targetX = candidates[i];
          }
        }
      }
      const pullX = Phaser.Math.Clamp((targetX - entity.x) * 0.55, -speed, speed);
      if (Math.abs(pullX) > 0.01 && this.canOccupy(entity.x + pullX, entity.y, radius)) {
        entity.x += pullX;
        return true;
      }
      return false;
    }

    // Horizontal turn: pull vertically toward nearest open lane in the next column.
    if (dx !== 0 && dy === 0) {
      const nextCol = gridX + (dx > 0 ? 1 : -1);
      const candidates: number[] = [];
      for (const row of [gridY - 2, gridY - 1, gridY, gridY + 1, gridY + 2]) {
        if (this.tileAt(gridX, row) !== 0) continue;
        if (this.tileAt(nextCol, row) !== 0) continue;
        if (this.hasDynamicBlockAt(nextCol, row, { ignoreOwnBombOnGrid })) continue;
        const cy = row * TILE_SIZE + TILE_SIZE / 2;
        if (!this.canOccupy(entity.x, cy, radius)) continue;
        candidates.push(cy);
      }
      if (candidates.length === 0) return false;
      let targetY = candidates[0];
      let minDist = Math.abs(entity.y - targetY);
      for (let i = 1; i < candidates.length; i++) {
        const d = Math.abs(entity.y - candidates[i]);
        if (d < minDist) {
          minDist = d;
          targetY = candidates[i];
          continue;
        }
        if (d === minDist && this.lastMoveDirY !== 0) {
          const currSide = Math.sign(candidates[i] - entity.y);
          const prevSide = Math.sign(targetY - entity.y);
          if (currSide === this.lastMoveDirY && prevSide !== this.lastMoveDirY) {
            targetY = candidates[i];
          }
        }
      }
      const pullY = Phaser.Math.Clamp((targetY - entity.y) * 0.55, -speed, speed);
      if (Math.abs(pullY) > 0.01 && this.canOccupy(entity.x, entity.y + pullY, radius)) {
        entity.y += pullY;
        return true;
      }
      return false;
    }

    return false;
  }

  // Sensor-based corner steering:
  // when forward move is blocked, compare two perpendicular probes and steer
  // toward the freer side to enter an open corridor smoothly.
  applySideSensorSteer(
    entity: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle,
    dx: number,
    dy: number,
    speed: number,
    radius: number
  ) {
    const steerStep = speed * 0.95;
    const sideOffset = Math.max(radius * 1.15, TILE_SIZE * 0.4);
    const probeAhead = Math.max(radius * 1.8, TILE_SIZE * 0.65);
    const currentGridX = Math.floor(entity.x / TILE_SIZE);
    const currentGridY = Math.floor(entity.y / TILE_SIZE);
    const ignoreOwnBombOnGrid = { x: currentGridX, y: currentGridY };

    const blockedAt = (x: number, y: number) => {
      const gx = Math.floor(x / TILE_SIZE);
      const gy = Math.floor(y / TILE_SIZE);
      if (this.tileAt(gx, gy) !== 0) return true;
      if (this.hasDynamicBlockAt(gx, gy, { ignoreOwnBombOnGrid })) return true;
      return false;
    };

    const clearanceForHorizontal = (sideSign: -1 | 1) => {
      const sampleY = entity.y + sideSign * sideOffset;
      const aheadX = entity.x + Math.sign(dx) * probeAhead;
      let score = 0;
      const span = radius * 0.75;
      const samples = [
        { x: aheadX, y: sampleY - span },
        { x: aheadX, y: sampleY },
        { x: aheadX, y: sampleY + span },
      ];
      for (const s of samples) {
        if (!blockedAt(s.x, s.y)) score += 1;
      }
      return score;
    };

    const clearanceForVertical = (sideSign: -1 | 1) => {
      const sampleX = entity.x + sideSign * sideOffset;
      const aheadY = entity.y + Math.sign(dy) * probeAhead;
      let score = 0;
      const span = radius * 0.75;
      const samples = [
        { x: sampleX - span, y: aheadY },
        { x: sampleX, y: aheadY },
        { x: sampleX + span, y: aheadY },
      ];
      for (const s of samples) {
        if (!blockedAt(s.x, s.y)) score += 1;
      }
      return score;
    };

    const isMostlyBlockedHorizontal = (sideSign: -1 | 1) => {
      const sampleY = entity.y + sideSign * sideOffset;
      const aheadX = entity.x + Math.sign(dx) * (radius * 1.05);
      let blocked = 0;
      const span = radius * 0.65;
      const samples = [
        { x: aheadX, y: sampleY - span },
        { x: aheadX, y: sampleY },
        { x: aheadX, y: sampleY + span },
      ];
      for (const s of samples) {
        if (blockedAt(s.x, s.y)) blocked += 1;
      }
      return blocked >= 2;
    };

    const isMostlyBlockedVertical = (sideSign: -1 | 1) => {
      const sampleX = entity.x + sideSign * sideOffset;
      const aheadY = entity.y + Math.sign(dy) * (radius * 1.05);
      let blocked = 0;
      const span = radius * 0.65;
      const samples = [
        { x: sampleX - span, y: aheadY },
        { x: sampleX, y: aheadY },
        { x: sampleX + span, y: aheadY },
      ];
      for (const s of samples) {
        if (blockedAt(s.x, s.y)) blocked += 1;
      }
      return blocked >= 2;
    };

    if (dx !== 0 && dy === 0) {
      const upHardBlocked = isMostlyBlockedHorizontal(-1);
      const downHardBlocked = isMostlyBlockedHorizontal(1);
      if (upHardBlocked !== downHardBlocked) {
        const steerY = upHardBlocked ? 1 : -1;
        const candidateY = entity.y + steerY * steerStep;
        if (this.canOccupy(entity.x, candidateY, radius)) {
          entity.y = candidateY;
          return true;
        }
      }

      const upScore = clearanceForHorizontal(-1);
      const downScore = clearanceForHorizontal(1);
      if (upScore === downScore || Math.abs(upScore - downScore) < 2) return false;
      const steerY = upScore > downScore ? -1 : 1;
      const candidateY = entity.y + steerY * steerStep;
      if (this.canOccupy(entity.x, candidateY, radius)) {
        entity.y = candidateY;
        return true;
      }
      return false;
    }

    if (dy !== 0 && dx === 0) {
      const leftHardBlocked = isMostlyBlockedVertical(-1);
      const rightHardBlocked = isMostlyBlockedVertical(1);
      if (leftHardBlocked !== rightHardBlocked) {
        const steerX = leftHardBlocked ? 1 : -1;
        const candidateX = entity.x + steerX * steerStep;
        if (this.canOccupy(candidateX, entity.y, radius)) {
          entity.x = candidateX;
          return true;
        }
      }

      const leftScore = clearanceForVertical(-1);
      const rightScore = clearanceForVertical(1);
      if (leftScore === rightScore || Math.abs(leftScore - rightScore) < 2) return false;
      const steerX = leftScore > rightScore ? -1 : 1;
      const candidateX = entity.x + steerX * steerStep;
      if (this.canOccupy(candidateX, entity.y, radius)) {
        entity.x = candidateX;
        return true;
      }
      return false;
    }

    return false;
  }

  applyCorridorCentering(entity: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle, moveDx: number, moveDy: number) {
    const gridX = Math.floor(entity.x / TILE_SIZE);
    const gridY = Math.floor(entity.y / TILE_SIZE);

    if (moveDx !== 0) {
      const blockedUp = this.tileAt(gridX, gridY - 1) !== 0;
      const blockedDown = this.tileAt(gridX, gridY + 1) !== 0;
      if (blockedUp && blockedDown) {
        const targetY = gridY * TILE_SIZE + TILE_SIZE / 2;
        entity.y = Phaser.Math.Linear(entity.y, targetY, 0.28);
      }
    }

    if (moveDy !== 0) {
      const blockedLeft = this.tileAt(gridX - 1, gridY) !== 0;
      const blockedRight = this.tileAt(gridX + 1, gridY) !== 0;
      if (blockedLeft && blockedRight) {
        const targetX = gridX * TILE_SIZE + TILE_SIZE / 2;
        entity.x = Phaser.Math.Linear(entity.x, targetX, 0.28);
      }
    }
  }

  update(_time: number, delta: number) {
    if (!this.room || !this.currentPlayerId || !this.room.state || !this.room.state.players) return;
    this.syncMapVisuals();
    this.updateScoreboard();
    this.updateTimerUI();

    const leftDown = this.cursors.left.isDown || this.wasd.A.isDown;
    const rightDown = this.cursors.right.isDown || this.wasd.D.isDown;
    const upDown = this.cursors.up.isDown || this.wasd.W.isDown;
    const downDown = this.cursors.down.isDown || this.wasd.S.isDown;
    let dx = 0;
    let dy = 0;
    if (leftDown) dx -= 1;
    if (rightDown) dx += 1;
    if (upDown) dy -= 1;
    if (downDown) dy += 1;
    const isMovingInput = leftDown || rightDown || upDown || downDown;

    let me: any = null;
    if (this.room.state.players?.get) me = this.room.state.players.get(this.currentPlayerId);
    else me = this.room.state.players?.[this.currentPlayerId];
    
    if (me) {
      this.clearLoadingText();
      this.uiText.setText(`Name: ${me.name || "Player"} | Bombs: ${me.bombs} | Fire: ${me.bombRadius} | Speed: ${Math.floor(me.speed)}\n[N] Change Name`);

      if (!this.playerEntities[this.currentPlayerId]) {
        const localEntity = this.textures.exists("player")
          ? this.add.sprite(me.x, me.y, "player")
          : this.add.rectangle(me.x, me.y, TILE_SIZE * 0.72, TILE_SIZE * 0.72, 0xffe066, 1).setStrokeStyle(2, 0x000000, 1);
        localEntity.setDepth(-10);
        this.playerEntities[this.currentPlayerId] = localEntity;
        this.ensurePlayerLabel(this.currentPlayerId, me);
        this.cameras.main.centerOn(localEntity.x, localEntity.y);
      }

      const ownEntity = this.playerEntities[this.currentPlayerId];
      if (ownEntity) {
        const drift = Phaser.Math.Distance.Between(ownEntity.x, ownEntity.y, me.x, me.y);
        if (drift > 120) {
          ownEntity.x = me.x;
          ownEntity.y = me.y;
        }
      }
    }

    const seenBombIds = new Set<string>();
    const syncBomb = (bomb: any, bombId: string) => {
      seenBombIds.add(bombId);
      let entity = this.bombEntities[bombId];
      if (!entity) {
        entity = this.textures.exists("bomb")
          ? this.add.sprite(bomb.x, bomb.y, "bomb")
          : this.add.circle(bomb.x, bomb.y, TILE_SIZE * 0.36, 0x222222, 1).setStrokeStyle(2, 0xffffff, 1);
        entity.setDepth(15);
        this.bombEntities[bombId] = entity;
      }
      entity.x = bomb.x;
      entity.y = bomb.y;
    };
    if (this.room.state.bombs?.forEach) {
      this.room.state.bombs.forEach((bomb: any, bombId: string) => syncBomb(bomb, bombId));
    } else if (this.room.state.bombs?.entries) {
      for (const [bombId, bomb] of this.room.state.bombs.entries()) {
        syncBomb(bomb, bombId);
      }
    }
    for (const bombId of Object.keys(this.bombEntities)) {
      if (!seenBombIds.has(bombId)) {
        this.bombEntities[bombId].destroy();
        delete this.bombEntities[bombId];
      }
    }

    const seenPowerupIds = new Set<string>();
    const syncPowerup = (pu: any, puId: string) => {
      seenPowerupIds.add(puId);
      let entity = this.powerupEntities[puId];
      if (!entity) {
        let color = 0xffffff;
        if (pu.type === 1) color = 0xffff00;
        else if (pu.type === 2) color = 0xff0000;
        else if (pu.type === 3) color = 0x00aaff;
        entity = this.add.circle(pu.x, pu.y, TILE_SIZE * 0.35, color);
        entity.setStrokeStyle(2, 0xffffff);
        entity.setDepth(12);
        this.powerupEntities[puId] = entity;
      }
      entity.x = pu.x;
      entity.y = pu.y;
    };
    if (this.room.state.powerups?.forEach) {
      this.room.state.powerups.forEach((pu: any, puId: string) => syncPowerup(pu, puId));
    } else if (this.room.state.powerups?.entries) {
      for (const [puId, pu] of this.room.state.powerups.entries()) {
        syncPowerup(pu, puId);
      }
    }
    for (const puId of Object.keys(this.powerupEntities)) {
      if (!seenPowerupIds.has(puId)) {
        this.powerupEntities[puId].destroy();
        delete this.powerupEntities[puId];
      }
    }

    const seenPlayerIds = new Set<string>();
    const syncPlayer = (player: any, sessionId: string) => {
      seenPlayerIds.add(sessionId);
      let entity = this.playerEntities[sessionId];
      if (!entity) {
        entity = this.textures.exists("player")
          ? this.add.sprite(player.x, player.y, "player")
          : this.add.rectangle(player.x, player.y, TILE_SIZE * 0.72, TILE_SIZE * 0.72, 0xffe066, 1).setStrokeStyle(2, 0x000000, 1);
        if (sessionId !== this.currentPlayerId) {
          if ("setTint" in entity) entity.setTint(0xff5555);
          else entity.setFillStyle(0xff5555, 1);
        }
        entity.setDepth(-10);
        this.playerEntities[sessionId] = entity;
        this.ensurePlayerLabel(sessionId, player);
      }

      if (sessionId !== this.currentPlayerId) {
        this.remotePlayerTargets[sessionId] = { x: player.x, y: player.y };
      }
      this.ensurePlayerLabel(sessionId, player);
      this.applyLifeVisual(sessionId, player);
    };
    if (this.room.state.players?.forEach) {
      this.room.state.players.forEach((player: any, sessionId: string) => syncPlayer(player, sessionId));
    } else if (this.room.state.players?.entries) {
      for (const [sessionId, player] of this.room.state.players.entries()) {
        syncPlayer(player, sessionId);
      }
    }
    for (const sessionId of Object.keys(this.playerEntities)) {
      if (!seenPlayerIds.has(sessionId)) {
        this.playerEntities[sessionId].destroy();
        delete this.playerEntities[sessionId];
        if (this.playerLabels[sessionId]) {
          this.playerLabels[sessionId].destroy();
          delete this.playerLabels[sessionId];
        }
        if (this.deathHideTimers[sessionId]) {
          this.deathHideTimers[sessionId].remove(false);
          delete this.deathHideTimers[sessionId];
        }
        delete this.remotePlayerTargets[sessionId];
        delete this.aliveCache[sessionId];
      }
    }

    const smoothFactor = 1 - Math.exp(-delta * 0.02);
    for (const [sessionId, target] of Object.entries(this.remotePlayerTargets)) {
      const entity = this.playerEntities[sessionId];
      if (!entity || sessionId === this.currentPlayerId) continue;
      entity.x = Phaser.Math.Linear(entity.x, target.x, smoothFactor);
      entity.y = Phaser.Math.Linear(entity.y, target.y, smoothFactor);
    }
    for (const [sessionId, entity] of Object.entries(this.playerEntities)) {
      const player = this.room.state.players.get ? this.room.state.players.get(sessionId) : this.room.state.players[sessionId];
      const label = this.ensurePlayerLabel(sessionId, player);
      label.setPosition(entity.x, entity.y - TILE_SIZE * 0.55);
    }

    if (me && !me.isAlive) return;

    if (this.canPlaceBomb && Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.room.send("place_bomb");
    }

    const now = Date.now();
    const entity = this.playerEntities[this.currentPlayerId];
    if (entity && isMovingInput) {
      if (dx < 0 && this.isDirectionBlocked(entity, -1, 0)) dx = 0;
      if (dx > 0 && this.isDirectionBlocked(entity, 1, 0)) dx = 0;
      if (dy < 0 && this.isDirectionBlocked(entity, 0, -1)) dy = 0;
      if (dy > 0 && this.isDirectionBlocked(entity, 0, 1)) dy = 0;
      if (dx !== 0 && dy !== 0 && this.isDiagonalCornerBlocked(entity, dx, dy)) {
        const canX = !this.isDirectionBlocked(entity, dx, 0);
        const canY = !this.isDirectionBlocked(entity, 0, dy);
        if (canX && !canY) dy = 0;
        else if (!canX && canY) dx = 0;
        else if (!canX && !canY) {
          dx = 0;
          dy = 0;
        } else {
          dy = 0;
        }
      }
      if (dx === 0 && dy === 0) {
        this.centerToCurrentGrid(entity, 0.34);
        if (now - this.lastMoveSentAt >= 45) {
          this.room.send("move", { x: entity.x, y: entity.y });
          this.lastMoveSentAt = now;
        }
        if (entity) this.cameras.main.centerOn(entity.x, entity.y);
        return;
      }

      if (dx !== 0 && dy !== 0) {
        dx *= 0.7071;
        dy *= 0.7071;
      }

      const speed = (me?.speed || 150) * (delta / 1000);
      const nextX = entity.x + dx * speed;
      const nextY = entity.y + dy * speed;
      const radius = TILE_SIZE * 0.3;

      if (this.canOccupy(nextX, nextY, radius)) {
        entity.x = nextX;
        entity.y = nextY;
        this.lastMoveDirX = Math.sign(dx);
        this.lastMoveDirY = Math.sign(dy);
      } else {
        let moved = false;
        if (this.applyTurnAssist(entity, dx, dy, speed, radius)) {
          const retryX = entity.x + dx * speed;
          const retryY = entity.y + dy * speed;
          if (this.canOccupy(retryX, retryY, radius)) {
            entity.x = retryX;
            entity.y = retryY;
            moved = true;
            this.lastMoveDirX = Math.sign(dx);
            this.lastMoveDirY = Math.sign(dy);
          }
        }
        if (!moved && this.applySideSensorSteer(entity, dx, dy, speed, radius)) {
          const retryX = entity.x + dx * speed;
          const retryY = entity.y + dy * speed;
          if (this.canOccupy(retryX, retryY, radius)) {
            entity.x = retryX;
            entity.y = retryY;
            moved = true;
            this.lastMoveDirX = Math.sign(dx);
            this.lastMoveDirY = Math.sign(dy);
          }
        }
        if (this.canOccupy(nextX, entity.y, radius)) {
          entity.x = nextX;
          moved = true;
          this.lastMoveDirX = Math.sign(dx);
        }
        if (this.canOccupy(entity.x, nextY, radius)) {
          entity.y = nextY;
          moved = true;
          this.lastMoveDirY = Math.sign(dy);
        }
        if (!moved) {
          this.applyCornerAssist(entity, dx, dy, speed, radius, nextX, nextY);
        }
      }

      this.applyCorridorCentering(entity, dx, dy);
      if (this.shouldCenterToGrid(entity, dx, dy)) {
        this.centerToCurrentGrid(entity, 0.28);
      }
      if (this.hasBlockedCorner(entity, radius)) {
        this.centerToCurrentGrid(entity, 0.34);
      }

      if (now - this.lastMoveSentAt >= 45) {
        this.room.send("move", { x: entity.x, y: entity.y });
        this.lastMoveSentAt = now;
      }
    }

    if (entity) this.cameras.main.centerOn(entity.x, entity.y);
  }
}

class BaseDefenseScene extends Phaser.Scene {
  room!: any;
  currentPlayerId: string = "";
  unitEntities: { [id: string]: Phaser.GameObjects.GameObject } = {};
  playerEntities: { [id: string]: Phaser.GameObjects.GameObject } = {};
  selectedUnitIds = new Set<string>();
  hasInitializedState = false;
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  wasd!: any;
  uiText!: Phaser.GameObjects.Text;
  loadingText: Phaser.GameObjects.Text | null = null;
  timerText!: Phaser.GameObjects.Text;
  startTime: number = 0;
  coreEntities: { [id: string]: Phaser.GameObjects.Rectangle } = {};
  structureEntities: { [id: string]: Phaser.GameObjects.Rectangle } = {};
  structureTexts: { [id: string]: Phaser.GameObjects.Text } = {};
  buildButtons: Array<any> = [];
  selectedBuild: string = "ore_refinery";

  constructor() {
    super("BaseDefenseScene");
  }

  preload() {
    this.load.spritesheet("tank_ready", "/assets/tanks/tank_spritesheet_ready.png", { 
        frameWidth: 249, 
        frameHeight: 249 
    });
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

  clearLoadingText() {
    if (this.loadingText) {
      this.loadingText.destroy();
      this.loadingText = null;
    }
  }

  async create() {
    this.cameras.main.setBackgroundColor(0x18361d);
    this.loadingText = this.add.text(
      this.cameras.main.centerX,
      this.cameras.main.centerY,
      "Joining Base Defense...",
      { fontSize: "28px", color: "#ffffff", fontFamily: "Arial" }
    ).setOrigin(0.5).setDepth(200).setScrollFactor(0);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys("W,A,S,D") as any;

    try {
      this.room = await this.withTimeout(client.joinOrCreate("base_defense_room"), 8000, "joinOrCreate");
      this.currentPlayerId = this.room.sessionId;
      console.log("JOINED AS", this.currentPlayerId);
      this.clearLoadingText();

      this.uiText = this.add.text(20, 20, "Connected", { fontSize: '20px', color: '#fff', fontFamily: 'Arial', backgroundColor: '#00000088' })
        .setPadding(8).setScrollFactor(0).setDepth(100);

      this.startTime = Date.now();
      this.timerText = this.add.text(20, 60, "Live: 0s", { fontSize: '20px', color: '#00ff00', fontFamily: 'Arial', backgroundColor: '#00000088' })
        .setPadding(8).setScrollFactor(0).setDepth(100);

      this.room.onStateChange(() => {
        if (!this.hasInitializedState && this.room.state) {
          this.initializeBaseDefenseWorld(this.room.state);
        }
      });

      this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (pointer.rightButtonDown()) {
          const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          const unitIdsToMove = this.selectedUnitIds.size > 0 
            ? Array.from(this.selectedUnitIds)
            : Object.keys(this.unitEntities);

          this.room.send("move_unit", {
            unitIds: unitIdsToMove,
            x: worldPoint.x,
            y: worldPoint.y
          });
        }
      });

    } catch (e) {
      console.error("JOIN ERROR", e);
      this.clearLoadingText();
      this.add.text(this.cameras.main.centerX, this.cameras.main.centerY, "Connection failed.\nPress SPACE to retry", { fontSize: "36px", color: "#ff4444", align: "center" }).setOrigin(0.5);
      this.input.keyboard!.once("keydown-SPACE", () => this.scene.restart());
    }
  }

  initializeBaseDefenseWorld(state: any) {
    this.hasInitializedState = true;
    console.log("INITIALIZING WORLD", state.mapWidth, state.mapHeight);
    console.log("INITIAL CORES:", state.cores.size);
    console.log("INITIAL UNITS:", state.units.size);
    
    this.drawMap(state);
    this.cameras.main.setBounds(0, 0, state.mapWidth * 64 * 3, state.mapHeight * 64 * 3);
    
    // Manual iteration for initial entities
    state.units.forEach((unit: any, id: string) => {
      this.addUnitEntity(unit, id);
    });
    state.units.onAdd((unit: any, id: string) => {
      this.addUnitEntity(unit, id);
    });
    state.units.onRemove((_unit: any, id: string) => {
      if (this.unitEntities[id]) {
        this.unitEntities[id].destroy();
        delete this.unitEntities[id];
      }
    });

    state.cores.forEach((core: any, id: string) => {
      this.addCoreEntity(core, id);
    });
    state.cores.onAdd((core: any, id: string) => {
      this.addCoreEntity(core, id);
    });

    state.structures.onAdd((s: any, id: string) => {
      const entity = this.add.rectangle(s.x, s.y, 48, 48, 0xaaaaaa).setStrokeStyle(2, 0xffffff);
      this.playerEntities[id] = entity;
    });
  }

  addCoreEntity(core: any, id: string) {
    if (this.playerEntities[id]) return;
    console.log("CORE ADDED", id, core.x, core.y);
    const entity = this.add.rectangle(core.x, core.y, 64, 64, 0x5555ff, 1).setStrokeStyle(4, 0xffffff).setDepth(10);
    this.add.text(core.x, core.y - 45, `CORE (${core.team})`, { fontSize: "14px", color: "#fff" }).setOrigin(0.5).setDepth(11);
    this.playerEntities[id] = entity;
  }

  addUnitEntity(unit: any, id: string) {
    if (this.unitEntities[id]) return;
    const isTank = unit.type === "tank";
    let entity: Phaser.GameObjects.GameObject;

    if (isTank) {
      entity = this.add.sprite(unit.x, unit.y, "tank_ready").setScale(0.15);
    } else {
      entity = this.add.circle(unit.x, unit.y, 10, 0xededed).setStrokeStyle(2, 0x333333);
    }

    this.unitEntities[id] = entity;
    console.log("UNIT ADDED", id, "at", unit.x, unit.y, "owner:", unit.ownerId);
    
    if (unit.ownerId === this.currentPlayerId) {
        console.log("CENTERING CAMERA ON OWN UNIT", unit.x, unit.y);
        this.cameras.main.centerOn(unit.x, unit.y);
    }

    unit.onChange(() => {
        if (this.unitEntities[id]) {
            (this.unitEntities[id] as any).x = unit.x;
            (this.unitEntities[id] as any).y = unit.y;
        }
    });
  }

  update() {
    if (!this.room) return;

    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    if (this.timerText) this.timerText.setText(`Live: ${elapsed}s`);

    const camSpeed = 10;
    if (this.cursors.left.isDown || (this.wasd && this.wasd.A.isDown)) this.cameras.main.scrollX -= camSpeed;
    if (this.cursors.right.isDown || (this.wasd && this.wasd.D.isDown)) this.cameras.main.scrollX += camSpeed;
    if (this.cursors.up.isDown || (this.wasd && this.wasd.W.isDown)) this.cameras.main.scrollY -= camSpeed;
    if (this.cursors.down.isDown || (this.wasd && this.wasd.S.isDown)) this.cameras.main.scrollY += camSpeed;
  }

  drawMap(state: any) {
    const width = state.mapWidth;
    const height = state.mapHeight;
    this.add.rectangle(width * 64 / 2, height * 64 / 2, width * 64 * 3, height * 64 * 3, 0x1a3a1f).setDepth(-10);
  }
}

class BaseDefenseScene_Advanced extends Phaser.Scene {
  phaserHudEnabled = false;
  localOnly = true;
  desktopMobileFallback = false;
  room!: Room<any>;
  currentPlayerId = "";
  playerEntities: { [id: string]: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle } = {};
  playerLabels: { [id: string]: Phaser.GameObjects.Text } = {};
  unitEntities: { [id: string]: Phaser.GameObjects.Arc | Phaser.GameObjects.Image } = {};
  unitFacing = new Map<string, number>();
  unitSelectionRings: { [id: string]: Phaser.GameObjects.Arc } = {};
  unitHpTexts: { [id: string]: Phaser.GameObjects.Text } = {};
  structureEntities: { [id: string]: Phaser.GameObjects.Rectangle } = {};
  structureTexts: { [id: string]: Phaser.GameObjects.Text } = {};
  structureHpTexts: { [id: string]: Phaser.GameObjects.Text } = {};
  resourceEntities: { [id: string]: Phaser.GameObjects.Arc } = {};
  coreEntities: { [id: string]: Phaser.GameObjects.Rectangle } = {};
  coreTexts: { [id: string]: Phaser.GameObjects.Text } = {};
  tileEntities: (Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle)[] = [];
  mapCache: number[] = [];
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
  tankShotEffects: Array<{ line: Phaser.GameObjects.Line; glow: Phaser.GameObjects.Arc; expiresAt: number }> = [];
  attackCursorGraphics: Phaser.GameObjects.Graphics | null = null;
  lastAvoidIntentSentAt = 0;
  unitClientPathCache = new Map<string, { goalGX: number; goalGY: number; cells: { x: number; y: number }[]; idx: number; updatedAt: number }>();
  localUnitRenderState = new Map<string, { x: number; y: number; vx: number; vy: number; lastAt: number; jamRefX?: number; jamRefY?: number }>();
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
  minimapBorder: Phaser.GameObjects.Rectangle | null = null;
  minimapX = 0;
  minimapY = 0;
  minimapW = 0;
  minimapH = 0;
  minimapScaleX = 1;
  minimapScaleY = 1;
  worldFogGraphics: Phaser.GameObjects.Graphics | null = null;
  lastWorldFogDrawAt = 0;
  fogCols = 0;
  fogRows = 0;
  fogSeenAt: Float32Array | null = null;
  lastFogCamX = Number.NaN;
  lastFogCamY = Number.NaN;
  fogClockSec = 0;
  lastFogTickAt = 0;
  camVelX = 0;
  camVelY = 0;
  mobileHudButtons: Array<{
    mode: "select" | "move" | "attack" | "anchor" | "dev" | "full" | "zoom_in" | "zoom_out";
    rect: Phaser.GameObjects.Rectangle;
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
  cameraCenterTween: Phaser.Tweens.Tween | null = null;
  cameraFocusWorldX = 0;
  cameraFocusWorldY = 0;

  isTouchPointer(pointer: Phaser.Input.Pointer) {
    const event = pointer.event as PointerEvent | TouchEvent | MouseEvent | undefined;
    const pointerType = "pointerType" in (event || {}) ? (event as PointerEvent).pointerType : "";
    return pointerType === "touch" || String(event?.type || "").startsWith("touch");
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

  constructor() {
    super("BaseDefenseScene_Advanced");
  }

  init(data?: { localOnly?: boolean }) {
    this.localOnly = data?.localOnly ?? true;
  }

  preload() {
    this.load.spritesheet("tank_ready", "/assets/tanks/tank_spritesheet_ready.png", { frameWidth: 249, frameHeight: 249 });
  }

  setupBaseDefenseRuntimeUi() {
    this.uiText = this.add.text(20, 20, "", {
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
    this.createBuildPanel();
    this.createMobileHud();
    this.hidePhaserHud();
    this.createActionPanelDom();
    this.updateActionPanelDom();
    this.layoutBaseDefenseHud();
    this.handleViewportResize(this.scale.gameSize);
    this.scale.on("resize", this.handleViewportResize, this);
    const syncViewportToScale = () => {
      this.scale.updateBounds();
      this.handleViewportResize(this.scale.gameSize);
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

  createLocalBaseDefenseRoom() {
    const state: any = {
      mode: "base_defense",
      mapWidth: 35,
      mapHeight: 35,
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

  findLocalUnitSpawnPoint(state: any, centerX: number, centerY: number, radius: number) {
    const baseGX = Math.floor(centerX / TILE_SIZE);
    const baseGY = Math.floor(centerY / TILE_SIZE);
    for (let ring = 1; ring <= 6; ring++) {
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

  spawnLocalProducedUnit(state: any, me: any, type: "soldier" | "tank" | "harvester") {
    const now = Date.now();
    const producerType = type === "soldier" ? "barracks" : "war_factory";
    const producer = this.findOwnedReadyStructure(state, producerType, now);
    const anchorX = Number(producer?.x ?? me.coreX ?? me.x);
    const anchorY = Number(producer?.y ?? me.coreY ?? me.y);
    const radius = this.localUnitBodyRadius({ type });
    const spawn = this.findLocalUnitSpawnPoint(state, anchorX, anchorY, radius);
    if (!spawn) return false;

    if (producer) producer.produceCooldownUntil = now + (type === "soldier" ? 800 : 1100);

    const stats = type === "tank"
      ? { hp: 140, speed: 92 }
      : type === "harvester"
        ? { hp: 110, speed: 76 }
        : { hp: 70, speed: 118 };

    const id = this.nextLocalId("unit");
    state.units.set(id, {
      id,
      ownerId: this.currentPlayerId,
      team: me.team,
      type,
      x: spawn.x,
      y: spawn.y,
      targetX: spawn.x,
      targetY: spawn.y,
      hp: stats.hp,
      maxHp: stats.hp,
      speed: stats.speed,
      dir: 0,
    });
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
      if (!this.canPlaceSelectedBuildAt(gridX, gridY)) return;
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
        const unitId = String(pose?.unitId || "");
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

  async create() {
    this.clientClockStartedAt = Date.now();
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
    this.input.on("wheel", (pointer: Phaser.Input.Pointer, _gameObjects: any, _deltaX: number, deltaY: number) => {
      const zoomDelta = deltaY > 0 ? -0.12 : 0.12;
      const world = this.getPointerWorld(pointer);
      this.touchWorldFocusX = world.x;
      this.touchWorldFocusY = world.y;
      this.adjustMobileZoom(zoomDelta);
    });

    this.currentPlayerId = "local-player";
    this.cameras.main.setBackgroundColor(0x1f5f1f);
    this.setupBaseDefenseRuntimeUi();
    this.room = this.createLocalBaseDefenseRoom();
    this.initializeWorld();
    loading.destroy();
    preInitDebug.destroy();

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
      const gx = Math.floor(world.x / TILE_SIZE);
      const gy = Math.floor(world.y / TILE_SIZE);

      if (pointer.rightButtonDown()) {
        if (this.actionMode === "build") {
          this.room.send("build_structure", { type: this.selectedBuild, gridX: gx, gridY: gy });
        } else if (this.selectedUnitIds.size > 0) {
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
          if (this.canPlaceSelectedBuildAt(gx, gy)) {
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
            if (u.x >= minX && u.x <= maxX && u.y >= minY && u.y <= maxY) selected.add(id);
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
          if (me?.isAlive && me.isCoreAnchored && this.actionMode === "build") {
            const gx = Math.floor(world.x / TILE_SIZE);
            const gy = Math.floor(world.y / TILE_SIZE);
            if (this.canPlaceSelectedBuildAt(gx, gy)) {
              this.room.send("build_structure", { type: this.selectedBuild, gridX: gx, gridY: gy });
            }
            this.moveTarget = null;
            this.movePath = [];
          } else if (me?.isAlive && !me.isCoreAnchored && this.actionMode === "move") {
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
    this.drawMap(state);
    this.mapCache = Array.from(state.map as number[]);
    if (!this.worldFogGraphics) {
      this.worldFogGraphics = this.add.graphics().setDepth(90);
    }
    this.worldFogGraphics.clear();
    this.worldFogGraphics.setVisible(true);
    this.cameras.main.removeBounds();
    const me = state.players?.get ? state.players.get(this.currentPlayerId) : state.players?.[this.currentPlayerId];
    if (me) {
      this.setCameraCenterWorld(Number(me.x), Number(me.y));
      this.clampCameraToWorld();
      this.cameraHasInitialFocus = true;
    }
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

  clampCameraToWorld() {
    this.syncCameraFocusToView();
  }

  syncCameraAfterZoom() {
    const cam = this.cameras.main;
    cam.preRender();
    this.clampCameraToWorld();
    cam.preRender();
  }

  applyZoomToViewportCenter(nextZoom: number) {
    const cam = this.cameras.main;
    cam.preRender();
    const centerX = cam.midPoint.x;
    const centerY = cam.midPoint.y;
    cam.setZoom(nextZoom);
    cam.preRender();
    cam.setScroll(centerX - cam.displayWidth * 0.5, centerY - cam.displayHeight * 0.5);
    this.syncCameraAfterZoom();
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
      this.clampCameraToWorld();
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
        this.clampCameraToWorld();
      },
      onComplete: () => {
        this.clampCameraToWorld();
        this.cameraCenterTween = null;
      },
    });
  }

  centerCameraOnScreenPoint(screenX: number, screenY: number, smooth = true) {
    const cam = this.cameras.main;
    cam.preRender();
    const targetX = cam.midPoint.x + (screenX - cam.width * 0.5) / cam.zoom;
    const targetY = cam.midPoint.y + (screenY - cam.height * 0.5) / cam.zoom;
    this.centerCameraOnWorldPoint(targetX, targetY, smooth);
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

  updateRtsCamera(_delta: number) {
    if (!this.room?.state) return;
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
    this.clampCameraToWorld();
  }

  drawMap(state: any) {
    const width = state.mapWidth;
    const height = state.mapHeight;
    this.add.rectangle(width * TILE_SIZE / 2, height * TILE_SIZE / 2, width * TILE_SIZE, height * TILE_SIZE, 0x1f5f1f).setDepth(-20);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = state.map[y * width + x];
        if (tile === 1) {
          const e = this.add.rectangle(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE * 0.95, TILE_SIZE * 0.95, 0x666666).setStrokeStyle(2, 0xffffff);
          this.tileEntities[y * width + x] = e;
        } else {
          this.tileEntities[y * width + x] = undefined as unknown as Phaser.GameObjects.Rectangle;
        }
      }
    }
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
        this.tileEntities[i] = undefined as unknown as Phaser.GameObjects.Rectangle;
      }
      if (tile === 1) {
        const x = i % width;
        const y = Math.floor(i / width);
        this.tileEntities[i] = this.add.rectangle(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE * 0.95, TILE_SIZE * 0.95, 0x666666).setStrokeStyle(2, 0xffffff);
      }
      this.mapCache[i] = tile;
    }
  }

  tileAt(gx: number, gy: number) {
    const st = this.room.state;
    if (!st || gx < 0 || gy < 0 || gx >= st.mapWidth || gy >= st.mapHeight) return 1;
    return st.map[gy * st.mapWidth + gx] ?? 1;
  }

  hasStructureAt(gx: number, gy: number) {
    const structures = this.room.state?.structures;
    if (!structures?.forEach) return false;
    let found = false;
    structures.forEach((s: any) => {
      if (found) return;
      if (Math.floor(s.x / TILE_SIZE) === gx && Math.floor(s.y / TILE_SIZE) === gy) found = true;
    });
    return found;
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
    if (t === "tank") return TILE_SIZE * 0.34;
    if (t === "harvester") return TILE_SIZE * 0.29;
    return TILE_SIZE * 0.25;
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

    const radius = String(u?.type || "") === "tank"
      ? TILE_SIZE * 0.31
      : String(u?.type || "") === "harvester"
        ? TILE_SIZE * 0.27
        : TILE_SIZE * 0.24;

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
    const byGridDist = this.shouldYieldByGridDistance(selfId, otherId);
    if (byGridDist !== null) return byGridDist;
    return this.pairLockShouldYield(selfId, otherId);
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

  isPathWalkable(gx: number, gy: number) {
    if (this.tileAt(gx, gy) !== 0) return false;
    if (this.hasStructureAt(gx, gy)) return false;
    if (this.hasCoreAt(gx, gy)) return false;
    return true;
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
    const me = this.room.state.players.get ? this.room.state.players.get(this.currentPlayerId) : this.room.state.players?.[this.currentPlayerId];
    if (me?.isAlive) addSource(Number(me.x), Number(me.y), 7.5);
    this.room.state.units?.forEach?.((u: any) => {
      if (u.team !== myTeam || (u.hp ?? 0) <= 0) return;
      const t = String(u.type || "");
      const tiles = t === "tank" ? 7.2 : t === "harvester" ? 5.4 : 6.4;
      addSource(Number(u.x), Number(u.y), tiles);
    });
    this.room.state.structures?.forEach?.((s: any) => {
      if (s.team !== myTeam || (s.hp ?? 0) <= 0) return;
      const t = String(s.type || "");
      const tiles = t === "base" ? 9.2 : t === "turret" ? 7.4 : 5.8;
      addSource(Number(s.x), Number(s.y), tiles);
    });
  }

  isVisibleToTeam(worldX: number, worldY: number) {
    for (const v of this.visionSources) {
      const dx = worldX - v.x;
      const dy = worldY - v.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > v.r2) continue;
      if (d2 <= (TILE_SIZE * 2.25) * (TILE_SIZE * 2.25)) return true;
      if (this.lineOfSightClear(v.x, v.y, worldX, worldY)) return true;
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

  findPath(startGX: number, startGY: number, goalGX: number, goalGY: number, _avoidUnits = false, _movingUnitId?: string) {
    if (!this.room?.state) return null;
    if (!this.isPathWalkable(goalGX, goalGY)) return null;

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
          if (!this.isPathWalkable(current.x + d.dx, current.y)) continue;
          if (!this.isPathWalkable(current.x, current.y + d.dy)) continue;
        }
        if (!inBounds(nx, ny)) continue;
        if (!this.isPathWalkable(nx, ny)) continue;
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

  getClientUnitWaypoint(unitId: string, unit: any, now: number) {
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
      const cells = this.findPath(startGX, startGY, goalGX, goalGY, false, unitId);
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
      const dx = u.x - x;
      const dy = u.y - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > TILE_SIZE * 0.55) return;
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
      if (d > TILE_SIZE * 0.7) return;
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
      const d = Math.hypot(u.x - x, u.y - y);
      if (d > TILE_SIZE * 0.65) return;
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
      if (d > TILE_SIZE * 0.8) return;
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

  ensureTankTextures() {
  }

  angleToDir8(angleRad: number) {
    const a = Phaser.Math.Angle.Wrap(angleRad);
    const idx = Math.round(a / (Math.PI / 4));
    return (idx + 8) % 8;
  }

  pickAnyAttackTargetAtWorld(x: number, y: number) {
    let best: any = null;
    if (this.room?.state?.units?.forEach) {
      this.room.state.units.forEach((u: any, id: string) => {
        if ((u.hp ?? 0) <= 0) return;
        const d = Math.hypot(u.x - x, u.y - y);
        if (d > TILE_SIZE * 0.7) return;
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

      // Stand-and-fight: if close enough to target, stop moving to prevent oscillation
      const fightRange = TILE_SIZE * 4.5;
      const nearTarget = toTLen < fightRange && toTLen > 0;
      const moving = !nearTarget && toTLen > TILE_SIZE * 0.16 && speed > 1;
      const desiredVX = moving ? (toTX / toTLen) * speed : 0;
      const desiredVY = moving ? (toTY / toTLen) * speed : 0;

      const accel = moving ? 14 : 8;
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
    const wp = this.getClientUnitWaypoint(id, { x: s.x, y: s.y, targetX: tx, targetY: ty }, nowMs);
    let navX = Number(wp?.x ?? tx);
    let navY = Number(wp?.y ?? ty);

    // If jammed, try a perpendicular detour to get around blocking units
    const jamTicks = this.localUnitJamTicks.get(id) ?? 0;
    if (jamTicks > 30) {
      const toNavX = navX - s.x;
      const toNavY = navY - s.y;
      const toNavLen = Math.hypot(toNavX, toNavY);
      if (toNavLen > 1) {
        const perpX = -toNavY / toNavLen;
        const perpY = toNavX / toNavLen;
        const detourMag = Math.min(TILE_SIZE * 2, (jamTicks - 30) * 0.8);
        const side = (jamTicks % 60 < 30) ? 1 : -1;
        navX += perpX * detourMag * side;
        navY += perpY * detourMag * side;
      }
    }

    const toTX = navX - s.x;
    const toTY = navY - s.y;
    const toTLen = Math.hypot(toTX, toTY);
    const speed = Number(u.speed || 0);
    const isAutoEngaged = this.autoEngagedUnitIds.has(id);
    const moving = toTLen > TILE_SIZE * 0.16 && speed > 1 && !isAutoEngaged;
    const desiredVX = moving ? (toTX / toTLen) * speed : 0;
    const desiredVY = moving ? (toTY / toTLen) * speed : 0;

    const accel = moving ? 16 : 10;
    const blend = 1 - Math.exp(-accel * dt);
    s.vx += (desiredVX - s.vx) * blend;
    s.vy += (desiredVY - s.vy) * blend;
    const r = String(u?.type || "") === "tank"
      ? TILE_SIZE * 0.31
      : String(u?.type || "") === "harvester"
        ? TILE_SIZE * 0.27
        : TILE_SIZE * 0.24;
    const stepX = s.vx * dt;
    const stepY = s.vy * dt;
    const nx = s.x + stepX;
    const ny = s.y + stepY;
    const uid = String(id);
    const isGhost = this.localUnitGhostMode?.has(uid) ?? false;
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
        } else {
          const ticks = (this.localUnitJamTicks.get(uid) ?? 0) + 1;
          this.localUnitJamTicks.set(uid, ticks);
          if (ticks > 120) {
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
    const unitR = String(u?.type || "") === "tank" ? TILE_SIZE * 0.31
      : String(u?.type || "") === "harvester" ? TILE_SIZE * 0.27 : TILE_SIZE * 0.24;
    if (!hasOverride && err > TILE_SIZE * 1.15) {
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
      const myRadius = String(u?.type || "") === "tank" ? TILE_SIZE * 0.31
        : String(u?.type || "") === "harvester" ? TILE_SIZE * 0.27 : TILE_SIZE * 0.24;
      let pushX = 0;
      let pushY = 0;
      this.room.state.units.forEach((ou: any, oid: string) => {
        if (oid === id) return;
        if ((ou.hp ?? 0) <= 0) return;
        if (myTeam && ou.team !== myTeam) return;
        const ors = this.localUnitRenderState.get(oid);
        const ox = Number(ors?.x ?? ou.x);
        const oy = Number(ors?.y ?? ou.y);
        const oRadius = this.localUnitBodyRadius(ou);
        const minDist = myRadius + oRadius;
        const dx = s.x - ox;
        const dy = s.y - oy;
        const dist = Math.hypot(dx, dy);
        if (dist < minDist && dist > 0.01) {
          const overlap = minDist - dist;
          const pushStr = overlap * 0.6;
          pushX += (dx / dist) * pushStr;
          pushY += (dy / dist) * pushStr;
        }
      });
      if (Math.hypot(pushX, pushY) > 0.01) {
        const newX = s.x + pushX;
        const newY = s.y + pushY;
        // Only apply push if result doesn't end up inside a wall/building
        if (this.canOccupyLocalUnit(newX, newY, myRadius, id)) {
          s.x = newX;
          s.y = newY;
        }
      }
    }

    // Wall repulsion — ALWAYS active for all units to prevent sticking to buildings
    // Bypassed if in Ghost Mode
    if (!isGhost) {
      const wallCheckR = TILE_SIZE * 0.85;
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

  autoEngageUnits(now: number) {
    if (!this.room?.state?.units?.forEach) return;
    if (now - this.lastAutoEngageAt < 500) return;
    this.lastAutoEngageAt = now;

    const me = this.room.state.players?.get
      ? this.room.state.players.get(this.currentPlayerId)
      : this.room.state.players?.[this.currentPlayerId];
    const myTeam = me?.team;
    if (!myTeam) return;

    // Collect visible enemy positions
    const enemies: Array<{ id: string; x: number; y: number; type: string }> = [];
    this.room.state.units.forEach((u: any, id: string) => {
      if ((u.hp ?? 0) <= 0) return;
      if (u.team === myTeam) return;
      const ux = Number(u.x);
      const uy = Number(u.y);
      if (!this.isVisibleToTeam(ux, uy)) return;
      enemies.push({ id, x: ux, y: uy, type: String(u.type || "") });
    });
    if (enemies.length === 0) {
      this.autoEngagedUnitIds.clear();
      return;
    }

    // For each owned combat unit that is idle (arrived at slot or standing still),
    // find the nearest visible enemy and engage
    const engageRange = TILE_SIZE * 12;
    const unitsToEngage: Array<{ unitId: string; enemyId: string; enemyX: number; enemyY: number }> = [];

    this.room.state.units.forEach((u: any, id: string) => {
      if ((u.hp ?? 0) <= 0) return;
      if (u.team !== myTeam) return;
      if (String(u.ownerId || "") !== this.currentPlayerId) return;
      const uType = String(u.type || "");
      if (uType !== "tank" && uType !== "soldier") return;

      // Already auto-engaged — let it keep fighting
      if (this.autoEngagedUnitIds.has(id)) return;

      const rs = this.localUnitRenderState.get(id);
      const ux = Number(rs?.x ?? u.x);
      const uy = Number(rs?.y ?? u.y);

      // Don't auto-engage units that are actively moving to a manual command
      const override = this.localUnitTargetOverride.get(id);
      if (override) {
        const distToSlot = Math.hypot(override.x - ux, override.y - uy);
        if (distToSlot > TILE_SIZE * 0.7) return;
      }

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

      if (nearestEnemy) {
        unitsToEngage.push({ unitId: id, enemyId: nearestEnemy.id, enemyX: nearestEnemy.x, enemyY: nearestEnemy.y });
      }
    });

    if (unitsToEngage.length === 0) return;

    for (const engage of unitsToEngage) {
      this.autoEngagedUnitIds.add(engage.unitId);
      this.unitAttackTarget.set(engage.unitId, engage.enemyId);
      // We rely completely on the server-driven positions and collision.
      // updateUnitRenderPos will detect autoEngagedUnitIds and zero out local velocity prediction.
    }

    // (Removed manual command_attack broadcast to let the server's AI handle combat cleanly)

    // Clean up auto-engaged units that no longer exist or have no visible enemies nearby
    for (const id of this.autoEngagedUnitIds) {
      const u = this.room.state.units.get ? this.room.state.units.get(id) : this.room.state.units?.[id];
      if (!u || (u.hp ?? 0) <= 0) {
        this.autoEngagedUnitIds.delete(id);
        continue;
      }
      const rs = this.localUnitRenderState.get(id);
      const ux = Number(rs?.x ?? u.x);
      const uy = Number(rs?.y ?? u.y);
      let hasNearby = false;
      for (const e of enemies) {
        if (Math.hypot(e.x - ux, e.y - uy) < engageRange * 1.6) {
          hasNearby = true;
          break;
        }
      }
      if (!hasNearby) {
        this.autoEngagedUnitIds.delete(id);
        this.unitAttackTarget.delete(id);
      }
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
      if (u.type !== "tank" && u.type !== "soldier") return;
      // Do not send poses for units in combat! Let the server AI handle collision and spreading.
      if (this.autoEngagedUnitIds.has(id)) return;
      const s = this.localUnitRenderState.get(id);
      if (!s) return;
      const tx = Number(u.targetX ?? u.x);
      const ty = Number(u.targetY ?? u.y);
      const vx = Number(s.vx || 0);
      const vy = Number(s.vy || 0);
      const speedNow = Math.hypot(vx, vy);
      const movingNow = speedNow > 10 || Math.hypot(tx - s.x, ty - s.y) > TILE_SIZE * 0.2;
      if (movingNow) hasMoving = true;
      const dir = Math.hypot(vx, vy) > 0.1
        ? this.angleToDir8(Math.atan2(vy, vx))
        : (this.unitFacing.get(id) ?? 0);
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

  localFormationRadiusForUnit(unit: any) {
    const t = String(unit?.type || "");
    if (t === "tank") return TILE_SIZE * 0.55;
    if (t === "harvester") return TILE_SIZE * 0.45;
    return TILE_SIZE * 0.35;
  }

  localFormationSpacingForIds(unitIds: string[]) {
    if (!this.room?.state?.units) return TILE_SIZE * 0.8;
    let maxRadius = TILE_SIZE * 0.42;
    for (const id of unitIds) {
      const unit = this.room.state.units.get ? this.room.state.units.get(id) : this.room.state.units?.[id];
      if (!unit || (unit.hp ?? 0) <= 0) continue;
      maxRadius = Math.max(maxRadius, this.localFormationRadiusForUnit(unit));
    }
    return Math.max(TILE_SIZE * 0.8, maxRadius * 2 + 2);
  }

  localFormationSlot(centerX: number, centerY: number, gridIndex: number, _totalUnits: number, spacing: number) {
    const sp = Math.max(TILE_SIZE * 0.8, spacing);
    
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

  issueLocalUnitMoveCommand(targetX: number, targetY: number) {
    if (!this.room?.state || this.selectedUnitIds.size <= 0) return;
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
              const vx = Number(otherS?.vx ?? 0);
              const vy = Number(otherS?.vy ?? 0);
              // Only avoid stationary units
              if (Math.hypot(vx, vy) < 5) {
                if (Math.hypot(base.x - ox, base.y - oy) < unitRadius + oRad + 2) {
                  occupied = true;
                  break;
                }
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

  isClickOnOwnPlayer(x: number, y: number) {
    const meEntity = this.playerEntities[this.currentPlayerId];
    if (!meEntity) return false;
    const dx = meEntity.x - x;
    const dy = meEntity.y - y;
    return Math.sqrt(dx * dx + dy * dy) <= TILE_SIZE * 0.55;
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
    const me = this.room.state.players.get ? this.room.state.players.get(this.currentPlayerId) : this.room.state.players?.[this.currentPlayerId];
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
    const me = this.room.state.players.get ? this.room.state.players.get(this.currentPlayerId) : this.room.state.players?.[this.currentPlayerId];
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
    const me = this.room.state.players.get ? this.room.state.players.get(this.currentPlayerId) : this.room.state.players?.[this.currentPlayerId];
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

  canPlaceSelectedBuildAt(gx: number, gy: number) {
    const me = this.room.state.players.get ? this.room.state.players.get(this.currentPlayerId) : this.room.state.players?.[this.currentPlayerId];
    if (!me?.isAlive) return false;
    if (!this.canStartBuildType(this.selectedBuild)) return false;
    if (gx < 0 || gy < 0 || gx >= this.room.state.mapWidth || gy >= this.room.state.mapHeight) return false;
    if (this.tileAt(gx, gy) !== 0) return false;
    if (this.hasStructureAt(gx, gy)) return false;
    if (this.hasCoreAt(gx, gy)) return false;
    if (this.hasResourceAt(gx, gy)) return false;
    if (me.devMode) return true;
    if (!me.isCoreAnchored) return false;
    const coreGX = Math.floor((me.coreX ?? me.x) / TILE_SIZE);
    const coreGY = Math.floor((me.coreY ?? me.y) / TILE_SIZE);
    const buildDist = Math.abs(coreGX - gx) + Math.abs(coreGY - gy);
    return buildDist <= 8;
  }

  createBuildPanel() {
    const y = this.cameras.main.height - 64;
    this.buildPanelBg = this.add.rectangle(660, y, 1260, 116, 0x0c1118, 0.78)
      .setStrokeStyle(2, 0x2f4b66)
      .setScrollFactor(0)
      .setDepth(105);

    const defs: Array<{ type: "ore_refinery" | "solar_panel" | "barracks" | "war_factory"; label: string; cost: number; buildMs: number; x: number }> = [
      { type: "ore_refinery", label: "Ore Refinery", cost: 55, buildMs: 5000, x: 170 },
      { type: "solar_panel", label: "Solar Panel", cost: 40, buildMs: 3500, x: 360 },
      { type: "barracks", label: "Barracks", cost: 80, buildMs: 6500, x: 550 },
      { type: "war_factory", label: "War Factory", cost: 130, buildMs: 7000, x: 740 },
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
    const root = document.createElement("div");
    root.style.position = "fixed";
    root.style.top = "max(10px, env(safe-area-inset-top))";
    root.style.left = "10px";
    root.style.right = "10px";
    root.style.display = "grid";
    root.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
    root.style.gap = "6px";
    root.style.zIndex = "9999";
    root.style.pointerEvents = "auto";

    const defs: Array<{ id: string; label: string }> = [
      { id: "select", label: "SELECT" },
      { id: "move", label: "MOVE" },
      { id: "attack", label: "ATTACK" },
      { id: "anchor", label: "ANCHOR" },
      { id: "dev", label: "DEV" },
      { id: "full", label: "FULL" },
      { id: "zoom_out", label: "-" },
      { id: "zoom_in", label: "+" },
    ];

    for (const def of defs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = def.label;
      btn.style.height = "38px";
      btn.style.border = "2px solid #8fb8da";
      btn.style.borderRadius = "8px";
      btn.style.background = "#223348";
      btn.style.color = "#fff";
      btn.style.font = "700 12px Arial, sans-serif";
      btn.style.webkitAppearance = "none";
      btn.style.appearance = "none";
      btn.style.touchAction = "manipulation";
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        if (def.id === "anchor") this.room?.send("anchor_base");
        else if (def.id === "dev") this.room?.send("toggle_dev_mode");
        else if (def.id === "full") this.toggleFullscreen();
        else if (def.id === "zoom_in") this.adjustMobileZoom(0.18);
        else if (def.id === "zoom_out") this.adjustMobileZoom(-0.18);
        else {
          this.mobileCommandMode = def.id as "select" | "move" | "attack";
          this.updateMobileHudButtons();
        }
      });
      root.appendChild(btn);
      this.mobileHudDomButtons.set(def.id, btn);
    }

    document.body.appendChild(root);
    this.mobileHudRootEl = root;
  }

  destroyMobileHudDom() {
    this.mobileHudDomButtons.clear();
    if (!this.mobileHudRootEl) return;
    this.mobileHudRootEl.remove();
    this.mobileHudRootEl = null;
  }

  handleViewportResize(gameSize: Phaser.Structs.Size) {
    const viewport = getViewportSize();
    const width = Number(viewport.width || gameSize?.width || this.cameras.main.width);
    const height = Number(viewport.height || gameSize?.height || this.cameras.main.height);
    this.scale.updateBounds();
    this.cameras.main.setViewport(0, 0, width, height);
    this.cameras.main.setSize(width, height);
    const minZoom = this.getMinCameraZoom();
    if (this.cameras.main.zoom < minZoom) this.cameras.main.setZoom(minZoom);
    this.layoutBaseDefenseHud();
    this.clampCameraToWorld();
  }

  layoutBaseDefenseHud() {
    if (!this.phaserHudEnabled) return;
    const viewW = this.cameras.main.width;
    const viewH = this.cameras.main.height;

    this.placeHudObject(this.statusText, viewW * 0.5, 20);
    this.layoutClientClock();
    this.placeHudObject(this.noticeText, viewW * 0.5, 64);
    this.layoutMobileHud();
    const panelHeight = 116;
    const panelY = viewH - panelHeight * 0.5 - 8;
    const panelW = Math.max(280, Math.min(viewW - 12, 1260));
    this.placeHudRect(this.buildPanelBg, viewW * 0.5, panelY, panelW, panelHeight);
    this.buildPanelBg?.setSize(panelW, panelHeight);
    this.placeHudObject(this.buildPanelStatsText, 12, panelY - panelHeight * 0.5 + 8);
    this.placeHudObject(this.buildMenuText, 20, viewH - 118);
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
    root.textContent = `BUILD ${DISPLAY_BUILD_NUMBER} · ${activeClientBuildId || CLIENT_BUNDLE_VERSION}`;
    this.getOverlayHostEl().appendChild(root);
    this.clientVersionRootEl = root;
  }

  destroyClientVersionDom() {
    if (!this.clientVersionRootEl) return;
    this.clientVersionRootEl.remove();
    this.clientVersionRootEl = null;
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
    root.style.gridTemplateColumns = "repeat(auto-fit, minmax(72px, 1fr))";
    root.style.gap = "6px";
    root.style.zIndex = "10001";
    root.style.pointerEvents = "auto";

    const defs: Array<{ id: string; label: string }> = [
      { id: "anchor", label: "ANCHOR" },
      { id: "move", label: "MOVE" },
      { id: "build", label: "BUILD" },
      { id: "dev", label: "DEV" },
      { id: "full", label: "FULL" },
      { id: "ore_refinery", label: "ORE" },
      { id: "solar_panel", label: "SOL" },
      { id: "barracks", label: "BAR" },
      { id: "war_factory", label: "WF" },
      { id: "tank", label: "TANK" },
    ];

    for (const def of defs) {
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
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        this.clearCommandSelectionState();
        if (def.id === "anchor") {
          this.room.send("anchor_base");
        } else if (def.id === "dev") {
          this.room.send("toggle_dev_mode");
        } else if (def.id === "full") {
          this.toggleFullscreen();
        } else if (def.id === "tank") {
          this.room.send("produce_tank");
        } else if (def.id === "move") {
          this.actionMode = "move";
        } else if (def.id === "build") {
          this.actionMode = "build";
        } else {
          this.selectedBuild = def.id as any;
          this.actionMode = "build";
        }
        this.updateActionPanelDom();
      });
      root.appendChild(btn);
      this.actionPanelButtons.set(def.id, btn);
    }

    this.getOverlayHostEl().appendChild(root);
    this.actionPanelRootEl = root;
  }

  destroyActionPanelDom() {
    this.actionPanelButtons.clear();
    if (!this.actionPanelRootEl) return;
    this.actionPanelRootEl.remove();
    this.actionPanelRootEl = null;
  }

  updateActionPanelDom() {
    if (!this.room?.state) {
      for (const [id, btn] of this.actionPanelButtons.entries()) {
        const selected = (id === "move" && this.actionMode === "move")
          || (id === "build" && this.actionMode === "build")
          || (id === this.selectedBuild && this.actionMode === "build");
        btn.style.background = selected ? "#2d7458" : "#223348";
        btn.style.borderColor = selected ? "#99ffd0" : "#8fb8da";
        btn.style.color = selected ? "#cffff0" : "#ffffff";
        btn.disabled = false;
        btn.title = "";
        btn.style.opacity = "1";
        btn.style.cursor = "pointer";
      }
      return;
    }
    const me = this.room?.state?.players?.get
      ? this.room.state.players.get(this.currentPlayerId)
      : this.room?.state?.players?.[this.currentPlayerId];
    for (const [id, btn] of this.actionPanelButtons.entries()) {
      const selected = (id === "move" && this.actionMode === "move")
        || (id === "build" && this.actionMode === "build")
        || (id === "dev" && !!me?.devMode)
        || (id === this.selectedBuild && this.actionMode === "build");
      let disabledReason = "";
      if (id === "anchor" && me?.isCoreAnchored) disabledReason = "Base anchored";
      else if (id === "tank") disabledReason = this.getFactoryProduceBlockedReason("tank") || "";
      else if (id === "ore_refinery" || id === "solar_panel" || id === "barracks" || id === "war_factory") {
        disabledReason = this.getBuildBlockedReason(id as "ore_refinery" | "solar_panel" | "barracks" | "war_factory") || "";
      }
      btn.style.background = selected ? "#2d7458" : "#223348";
      btn.style.borderColor = selected ? "#99ffd0" : "#8fb8da";
      btn.style.color = selected ? "#cffff0" : "#ffffff";
      btn.disabled = false;
      btn.title = disabledReason;
      btn.style.opacity = disabledReason ? "0.55" : "1";
      btn.style.cursor = "pointer";
      if (id === "anchor" && me?.isCoreAnchored) {
        btn.style.opacity = "0.45";
      }
    }
  }

  layoutClientClock() {
    if (!this.clientClockText) return;
    const centerY = this.cameras.main.height * 0.5 + 68;
    this.placeHudObject(this.clientClockText, this.cameras.main.width * 0.5, centerY);
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
      b.rect.setFillStyle(selected ? 0x2d7458 : 0x223348, 0.94);
      b.rect.setStrokeStyle(2, selected ? 0x99ffd0 : 0x8fb8da, 0.95);
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
        this.mobileCommandMode = b.mode;
        this.updateMobileHudButtons();
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
    const fitByWidth = cam.width / worldW;
    const fitByHeight = cam.height / worldH;
    return Phaser.Math.Clamp(Math.max(MIN_CAMERA_ZOOM, fitByWidth, fitByHeight), MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM);
  }

  getPointerWorld(pointer: Phaser.Input.Pointer) {
    const cam = this.cameras.main;
    cam.preRender();
    pointer.updateWorldPoint(cam);
    return new Phaser.Math.Vector2(pointer.worldX, pointer.worldY);
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

  beginTouchPinch() {
    const pointers = this.getActiveTouchPointers();
    if (pointers.length < 2) return false;
    const [a, b] = pointers;
    this.cameraCenterTween?.remove();
    this.cameraCenterTween = null;
    this.syncCameraFocusToView();
    this.touchPinching = true;
    this.touchPinchStartDist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    this.touchPinchStartZoom = this.cameras.main.zoom;
    const midX = (a.x + b.x) * 0.5;
    const midY = (a.y + b.y) * 0.5;
    this.touchWorldFocusX = this.cameraFocusWorldX;
    this.touchWorldFocusY = this.cameraFocusWorldY;
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
    cam.scrollX = this.touchPinchLockedScrollX;
    cam.scrollY = this.touchPinchLockedScrollY;
    this.syncCameraAfterZoom();
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
    this.clearSelectionDragState();
    this.touchPinchCooldownUntil = Date.now() + 80;
  }

  handleMobilePointerDown(pointer: Phaser.Input.Pointer) {
    this.activeTouchIds.add(pointer.id);
    if (this.touchPinching && this.getActiveTouchPointers().length < 2) this.endTouchPinch();
    if (Date.now() < this.touchPinchCooldownUntil) return true;
    if (this.touchPinching) return true;
    if (this.getActiveTouchPointers().length >= 2) {
      this.beginTouchPinch();
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
    if (this.touchPinching) {
      if (this.updateTouchPinch()) return true;
      if (this.getActiveTouchPointers().length < 2) this.endTouchPinch();
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

  getMyTeam() {
    const me = this.room?.state?.players?.get
      ? this.room.state.players.get(this.currentPlayerId)
      : this.room?.state?.players?.[this.currentPlayerId];
    return me?.team;
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
    const world = this.selectionStart
      ? { x: this.selectionStart.x, y: this.selectionStart.y }
      : this.screenToWorldPoint(releaseX, releaseY);
    const pressDurationMs = Math.max(0, Date.now() - this.touchPointerStartedAt);
    const isTap = !this.touchMoved || (pressDurationMs < 250 && Math.hypot(pointer.x - this.touchPointerStartX, pointer.y - this.touchPointerStartY) < 24);
    const me = this.room.state.players.get ? this.room.state.players.get(this.currentPlayerId) : this.room.state.players?.[this.currentPlayerId];

    if (me?.isAlive && !me.isCoreAnchored && isTap && this.mobileCommandMode !== "select") {
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
      return true;
    }

    if (this.actionMode === "build" && !this.touchMoved) {
      this.cameraDragging = false;
      this.touchPanMaybe = false;
      if (me?.isAlive && (me.isCoreAnchored || me.devMode)) {
        const gx = Math.floor(world.x / TILE_SIZE);
        const gy = Math.floor(world.y / TILE_SIZE);
        if (this.canPlaceSelectedBuildAt(gx, gy)) {
          this.room.send("build_structure", { type: this.selectedBuild, gridX: gx, gridY: gy });
        } else {
          const reason = this.getBuildBlockedReason(this.selectedBuild) || "invalid location";
          this.showNotice(`Cannot build: ${reason}`, "#ffb080");
        }
      }
      return true;
    }
    if (this.cameraDragging && this.touchPanMaybe) {
      this.cameraDragging = false;
      this.touchPanMaybe = false;
      return true;
    }
    if (this.draggingBuildType) {
      const world = this.getPointerWorld(pointer);
      const me = this.room.state.players.get ? this.room.state.players.get(this.currentPlayerId) : this.room.state.players?.[this.currentPlayerId];
      const droppedOnPanel = this.pointInRect(pointer.x, pointer.y, this.buildPanelBg);
      if (me?.isAlive && me.isCoreAnchored && !droppedOnPanel) {
        const gx = Math.floor(world.x / TILE_SIZE);
        const gy = Math.floor(world.y / TILE_SIZE);
        if (this.canPlaceSelectedBuildAt(gx, gy)) {
          this.selectedBuild = this.draggingBuildType;
          this.room.send("build_structure", { type: this.draggingBuildType, gridX: gx, gridY: gy });
        }
      }
      this.stopBuildDrag();
      return true;
    }
    const myTeam = me?.team;

    if (this.mobileCommandMode === "select" && this.selectionStart) {
      if (this.isDraggingSelection) {
        const minX = Math.min(this.selectionStart.x, world.x);
        const maxX = Math.max(this.selectionStart.x, world.x);
        const minY = Math.min(this.selectionStart.y, world.y);
        const maxY = Math.max(this.selectionStart.y, world.y);
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
        const clickedUnitId = this.findFriendlyUnitAtWorld(world.x, world.y, myTeam);
        const clickedStructureId = this.findFriendlyStructureAtWorld(world.x, world.y, myTeam);
        if (clickedUnitId) {
          this.selectedUnitIds = new Set<string>([clickedUnitId]);
          this.selectedStructureId = null;
        } else if (clickedStructureId) {
          this.selectedUnitIds.clear();
          this.selectedStructureId = clickedStructureId;
        } else {
          this.selectedStructureId = null;
          if (this.selectedUnitIds.size > 0) {
            this.issueLocalUnitMoveCommand(world.x, world.y);
          } else if (me?.isAlive && !me.isCoreAnchored) {
            this.selectedUnitIds.clear();
            this.moveTarget = { x: world.x, y: world.y };
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
      this.issueMobileAttackOrMove(world.x, world.y);
      return true;
    }
    return true;
  }

  pointInRect(px: number, py: number, rect: Phaser.GameObjects.Rectangle) {
    const zoom = Math.max(0.001, this.cameras.main.zoom);
    const cx = rect.x * zoom;
    const cy = rect.y * zoom;
    const hw = (rect.displayWidth * zoom) / 2;
    const hh = (rect.displayHeight * zoom) / 2;
    return px >= cx - hw && px <= cx + hw && py >= cy - hh && py <= cy + hh;
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
      this.actionMode = "build";
      if (!this.canStartBuildType(b.type)) return true;
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

  startBuildDrag(type: "ore_refinery" | "solar_panel" | "barracks" | "war_factory", pointer: Phaser.Input.Pointer) {
    this.draggingBuildType = type;
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
    this.updateBuildGhost(pointer);
    this.buildGhost.setVisible(true);
    this.buildGhostText.setVisible(true);
  }

  updateBuildGhost(pointer: Phaser.Input.Pointer) {
    if (!this.draggingBuildType || !this.buildGhost || !this.buildGhostText) return;
    const world = this.getPointerWorld(pointer);
    const gx = Math.floor(world.x / TILE_SIZE);
    const gy = Math.floor(world.y / TILE_SIZE);
    const wx = gx * TILE_SIZE + TILE_SIZE / 2;
    const wy = gy * TILE_SIZE + TILE_SIZE / 2;
    const canPlace = this.canPlaceSelectedBuildAt(gx, gy);
    this.buildGhost.x = wx;
    this.buildGhost.y = wy;
    this.buildGhost.setFillStyle(canPlace ? 0x66b8ff : 0xcc5555, 0.45);
    this.buildGhost.setStrokeStyle(2, canPlace ? 0xffffff : 0xff9999, 0.85);
    this.buildGhostText.setText(this.buildLabel(this.draggingBuildType));
    this.buildGhostText.setPosition(wx, wy - TILE_SIZE * 0.55);
  }

  stopBuildDrag() {
    this.draggingBuildType = null;
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

  reflowFormationAssignments(now: number) {
    if (now > this.formationPreviewUntil) {
      this.formationPreviewSlots = [];
      this.formationPreviewAssignments.clear();
      this.formationPreviewCenter = null;
      this.formationPreviewUntil = 0;
    }
  }

  drawFormationPreview(now: number) {
    if (!this.phaserHudEnabled) {
      if (this.formationPreviewGraphics) this.formationPreviewGraphics.clear().setVisible(false);
      return;
    }
    if (!this.formationPreviewGraphics) {
      this.formationPreviewGraphics = this.add.graphics().setDepth(19);
    }
    const g = this.formationPreviewGraphics;
    g.clear();

    this.reflowFormationAssignments(now);

    if (this.formationPreviewSlots.length === 0 || now > this.formationPreviewUntil) return;

    // Fade out in the last 1.5s
    const fadeStart = this.formationPreviewUntil - 1500;
    const alpha = now > fadeStart ? Math.max(0, (this.formationPreviewUntil - now) / 1500) : 1;

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

  update(_time: number, delta: number) {
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
    this.syncMap();
    const state = this.room.state;
    const players = state.players;
    const me = players?.get ? players.get(this.currentPlayerId) : players?.[this.currentPlayerId];
    if (me) {
      const phase = String(state.phase || "build");
      const phaseLeft = phase === "build" ? Math.max(0, Math.ceil((Number(state.phaseEndsAt || 0) - Date.now()) / 1000)) : 0;
      if (!me.isCoreAnchored && !me.devMode) {
        this.buildMenuText.setText("ANCHOR CORE: [F]  |  MOVE: WASD/Arrows/Left Click  |  [F10] DEV");
      } else {
        const active = this.actionMode === "build" ? "BUILD MODE" : "MOVE MODE";
        this.buildMenuText.setText(
          `${active}\n[1] ORE (55) [2] SOLAR (40) [3] BARRACKS (80) [4] WAR FACTORY (130)\n[Q] SOLDIER 35 | [T] TANK 90 | [H] HARVESTER 70`
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
    }
    if (!me) this.updateBuildPanel(null);
    this.updateRtsCamera(delta);
    const nowMs = Date.now();
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
    // Disabled for now: keep movement rules minimal.

    const myTeam = me?.team;
    const seenPlayers = new Set<string>();
    if (players?.forEach) {
      this.refreshVisionSources(myTeam);
      players.forEach((p: any, id: string) => {
        seenPlayers.add(id);
        let e = this.playerEntities[id];
        const isFriendly = !!me && p.team === me.team;
        const visible = isFriendly || id === this.currentPlayerId || this.isVisibleToTeamWithFogMemory(Number(p.x), Number(p.y));
        const playerColor = isFriendly ? 0x6fd8ff : 0xff5f5f;
        if (!e) {
          e = this.add.rectangle(p.x, p.y, TILE_SIZE * 0.72, TILE_SIZE * 0.72, playerColor).setStrokeStyle(2, 0x000000);
          this.playerEntities[id] = e;
          const lbl = this.add.text(p.x, p.y - TILE_SIZE * 0.52, p.name || id.slice(0, 4), { fontSize: "13px", color: "#fff", fontFamily: "Arial", backgroundColor: "#00000077" }).setPadding(3, 1, 3, 1).setOrigin(0.5, 1);
          this.playerLabels[id] = lbl;
        }
        e.x = Phaser.Math.Linear(e.x, p.x, 1 - Math.exp(-delta * 0.02));
        e.y = Phaser.Math.Linear(e.y, p.y, 1 - Math.exp(-delta * 0.02));
        if ("setFillStyle" in e) e.setFillStyle(playerColor, 1);
        e.setVisible(!!p.isAlive && visible);
        const label = this.playerLabels[id];
        label.setPosition(e.x, e.y - TILE_SIZE * 0.52);
        label.setText((p.name || `P-${id.slice(0, 4)}`) + (id === this.currentPlayerId ? " (YOU)" : "") + ` HP:${p.coreHp ?? 0}`);
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

    const seenUnits = new Set<string>();
    const seenUnitHp = new Set<string>();
    if (state.units?.forEach) {
      state.units.forEach((u: any, id: string) => {
        seenUnits.add(id);
        let e = this.unitEntities[id];
        const isTank = u.type === "tank";
        const isHarvester = u.type === "harvester";
        const isFriendly = !!myTeam && u.team === myTeam;
        const isLocalOwned = isFriendly && String(u.ownerId || "") === this.currentPlayerId;
        const visible = isFriendly || this.isVisibleToTeamWithFogMemory(Number(u.x), Number(u.y));
        const baseColor = isHarvester
          ? (isFriendly ? 0xe3c44a : 0xd4873c)
          : isTank
            ? (isFriendly ? 0x8ea7bf : 0xc76f57)
            : (isFriendly ? 0x6ec4ff : 0xff8a6a);
        const radius = isHarvester ? TILE_SIZE * 0.18 : isTank ? TILE_SIZE * 0.3 : TILE_SIZE * 0.22;
        if (!e || (isTank && !(e instanceof Phaser.GameObjects.Image)) || (!isTank && (e instanceof Phaser.GameObjects.Image))) {
          if (e) e.destroy();
          if (isTank) {
            e = this.add.sprite(u.x, u.y, "tank_ready").setDepth(16);
          } else {
            e = this.add.circle(u.x, u.y, radius, baseColor).setStrokeStyle(2, isHarvester ? 0x5a4a12 : 0x111111).setDepth(16);
          }
          this.unitEntities[id] = e;
        }
        if (isTank) {
          let dir = this.unitFacing.get(id) ?? 0;
          const rs = this.localUnitRenderState.get(id);

          // Priority 1: face the attack target if we have one
          const atkTargetId = this.unitAttackTarget.get(id);
          const atkTarget = atkTargetId
            ? (this.room?.state?.units?.get ? this.room.state.units.get(atkTargetId) : this.room?.state?.units?.[atkTargetId])
            : null;
          // Priority 0: use recent shot direction (most accurate)
          const lastShot = this.unitLastShotDir.get(id);
          if (lastShot && (Date.now() - lastShot.at) < 800) {
            dir = lastShot.dir;
          } else if (atkTarget && (atkTarget.hp ?? 0) > 0) {
            // Priority 1: face the attack target if we have one
            const atkX = Number(atkTarget.x) - Number(rs?.x ?? u.x);
            const atkY = Number(atkTarget.y) - Number(rs?.y ?? u.y);
            if (Math.hypot(atkX, atkY) > 0.5) {
              dir = this.angleToDir8(Math.atan2(atkY, atkX));
            }
          } else {
            // No attack target — use velocity / movement direction
            if (atkTargetId) this.unitAttackTarget.delete(id);
            let dxRot = Number(rs?.vx ?? 0);
            let dyRot = Number(rs?.vy ?? 0);
            if (Math.hypot(dxRot, dyRot) > 0.05) {
              dir = this.angleToDir8(Math.atan2(dyRot, dxRot));
            } else {
              const tx = Number(u.targetX ?? u.x);
              const ty = Number(u.targetY ?? u.y);
              const srcX = Number(rs?.x ?? u.x);
              const srcY = Number(rs?.y ?? u.y);
              dxRot = tx - srcX;
              dyRot = ty - srcY;
              if (Math.hypot(dxRot, dyRot) > 0.24) dir = this.angleToDir8(Math.atan2(dyRot, dxRot));
            }
          }
          this.unitFacing.set(id, dir);
          if ((e as Phaser.GameObjects.Sprite).texture?.key !== "tank_ready") (e as Phaser.GameObjects.Sprite).setTexture("tank_ready");
          const frameByDir = [6, 7, 0, 1, 2, 3, 4, 5];
          const frameIndex = frameByDir[dir] ?? 0;
          (e as Phaser.GameObjects.Sprite).setFrame(frameIndex);
          if (u.hp <= 0) (e as Phaser.GameObjects.Sprite).setTint(0x444444);
          else if (isFriendly) (e as Phaser.GameObjects.Sprite).clearTint();
          else (e as Phaser.GameObjects.Sprite).setTint(0xffc8c8);
          (e as Phaser.GameObjects.Sprite).setDisplaySize(Math.max(TILE_SIZE * 1.18, 56), Math.max(TILE_SIZE * 1.18, 56));
        } else if ("setRadius" in e) {
          (e as Phaser.GameObjects.Arc).setRadius(radius);
          (e as Phaser.GameObjects.Arc).setFillStyle(u.hp <= 0 ? 0x444444 : baseColor, 1);
        }
        this.updateUnitRenderPos(id, e as any, u, delta, isLocalOwned, isTank);
        e.setVisible(visible);

        const shouldShowRing = !!myTeam && u.team === myTeam && this.selectedUnitIds.has(id);
        let ring = this.unitSelectionRings[id];
        const showHp = visible && (!isFriendly || shouldShowRing) && u.hp > 0;
        if (shouldShowRing && u.hp > 0) {
          if (!ring) {
            ring = this.add.circle(e.x, e.y, TILE_SIZE * 0.34, 0x00ffcc, 0).setStrokeStyle(2, 0x00ffcc).setDepth(15);
            this.unitSelectionRings[id] = ring;
          }
          ring.x = e.x;
          ring.y = e.y;
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
          hp.setPosition(e.x, e.y - TILE_SIZE * 0.46);
          hp.setVisible(true);
          seenUnitHp.add(id);
        }
      });
    }
    for (const id of Object.keys(this.unitEntities)) {
      if (!seenUnits.has(id)) {
        this.unitEntities[id].destroy();
        delete this.unitEntities[id];
        this.unitFacing.delete(id);
        this.unitClientPathCache.delete(id);
        this.localUnitRenderState.delete(id);
        this.lastUnitPoseState.delete(id);
        this.localUnitJamTicks.delete(id);
        this.localUnitTargetOverride.delete(id);
        this.localUnitMovePriority.delete(id);
        this.unitSelectionRings[id]?.destroy();
        delete this.unitSelectionRings[id];
        this.unitHpTexts[id]?.destroy();
        delete this.unitHpTexts[id];
        this.selectedUnitIds.delete(id);
      }
    }
    for (const id of Object.keys(this.unitHpTexts)) {
      if (!seenUnitHp.has(id)) {
        this.unitHpTexts[id].destroy();
        delete this.unitHpTexts[id];
      }
    }

    const seenStructures = new Set<string>();
    const seenStructureHp = new Set<string>();
    if (state.structures?.forEach) {
      state.structures.forEach((s: any, id: string) => {
        seenStructures.add(id);
        let e = this.structureEntities[id];
        let t = this.structureTexts[id];
        const isFriendly = !!myTeam && s.team === myTeam;
        const visible = isFriendly || this.isVisibleToTeamWithFogMemory(Number(s.x), Number(s.y));
        let fill = isFriendly ? 0x2a6fd1 : 0x9b2f2f;
        let stroke = 0xffffff;
        let label = s.type?.toUpperCase?.() || "ST";
        if (s.type === "ore_refinery") {
          fill = isFriendly ? 0x9a7d31 : 0x8b4a2b;
          stroke = 0xf4de91;
          label = "ORE";
        } else if (s.type === "solar_panel") {
          fill = isFriendly ? 0x376f96 : 0x7a3f3f;
          stroke = 0x8fd4ff;
          label = "SOL";
        } else if (s.type === "barracks") {
          fill = isFriendly ? 0x5a7b5d : 0x854848;
          stroke = 0xb6e0b8;
          label = "BAR";
        } else if (s.type === "base") {
          fill = isFriendly ? 0x1f4f91 : 0x8d2b2b;
          stroke = 0xfff59d;
          label = "CORE";
        } else if (s.type === "turret") {
          fill = isFriendly ? 0x365c88 : 0x8a3f3f;
          stroke = 0xffff66;
          label = "TUR";
        } else if (s.type === "war_factory" || s.type === "factory") {
          fill = isFriendly ? 0x446f95 : 0x8e4242;
          stroke = 0xffcc99;
          label = "WF";
        } else if (s.type === "wall") {
          fill = isFriendly ? 0x6a6a6a : 0x8a5a5a;
          stroke = 0xffffff;
          label = "W";
        }
        if (!e) {
          e = this.add.rectangle(s.x, s.y, TILE_SIZE * 0.9, TILE_SIZE * 0.9, fill, 0.92).setStrokeStyle(2, stroke);
          e.setDepth(12);
          this.structureEntities[id] = e;
          t = this.add.text(s.x, s.y, label, {
            fontSize: "10px",
            color: "#ffffff",
            fontFamily: "Arial",
            fontStyle: "bold",
            backgroundColor: "#00000066",
          }).setOrigin(0.5).setDepth(13).setPadding(2, 1, 2, 1);
          this.structureTexts[id] = t;
        }
        e.x = s.x;
        e.y = s.y;
        e.setFillStyle(fill, 0.92);
        e.setStrokeStyle(2, stroke);
        e.setVisible(visible);
        if (t) {
          const timeLeft = Math.max(0, Math.ceil((Number(s.buildCompleteAt || 0) - Date.now()) / 1000));
          const isBuilding = timeLeft > 0;
          t.setPosition(s.x, s.y);
          t.setText(isBuilding ? `${label}\n${timeLeft}s` : label);
          t.setVisible(visible);
        }
        const isSelectedStructure = this.selectedStructureId === id;
        const showHp = visible && (!isFriendly || isSelectedStructure);
        if (isSelectedStructure) {
          e.setStrokeStyle(3, 0x00ffcc);
        }
        if (showHp) {
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
          const timeLeft = Math.max(0, Math.ceil((Number(s.buildCompleteAt || 0) - Date.now()) / 1000));
          hp.setText(timeLeft > 0
            ? `${Math.max(0, Math.floor(s.hp || 0))}/${Math.max(1, Math.floor(s.maxHp || 1))} (${timeLeft}s)`
            : `${Math.max(0, Math.floor(s.hp || 0))}/${Math.max(1, Math.floor(s.maxHp || 1))}`);
          hp.setPosition(s.x, s.y - TILE_SIZE * 0.58);
          hp.setVisible(true);
          seenStructureHp.add(id);
        }
      });
    }
    for (const id of Object.keys(this.structureEntities)) {
      if (!seenStructures.has(id)) {
        this.structureEntities[id].destroy();
        delete this.structureEntities[id];
        this.structureTexts[id]?.destroy();
        delete this.structureTexts[id];
        this.structureHpTexts[id]?.destroy();
        delete this.structureHpTexts[id];
        if (this.selectedStructureId === id) this.selectedStructureId = null;
      }
    }
    for (const id of Object.keys(this.structureHpTexts)) {
      if (!seenStructureHp.has(id)) {
        this.structureHpTexts[id].destroy();
        delete this.structureHpTexts[id];
      }
    }

    const seenResources = new Set<string>();
    if (state.resources?.forEach) {
      state.resources.forEach((r: any, id: string) => {
        seenResources.add(id);
        let e = this.resourceEntities[id];
        const visible = this.isVisibleToTeamWithFogMemory(Number(r.x), Number(r.y));
        if (!e) {
          e = this.add.circle(r.x, r.y, TILE_SIZE * 0.26, 0x44ddaa).setStrokeStyle(2, 0xffffff).setDepth(11);
          this.resourceEntities[id] = e;
        }
        e.x = r.x;
        e.y = r.y;
        e.setVisible(visible);
      });
    }
    for (const id of Object.keys(this.resourceEntities)) {
      if (!seenResources.has(id)) {
        this.resourceEntities[id].destroy();
        delete this.resourceEntities[id];
      }
    }
    this.sendClientUnitPoses(Date.now());
    this.autoEngageUnits(Date.now());
    this.updateWorldFog(Date.now());

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

    // Core is represented by the player entity in this mode; no separate core visuals.
    for (const id of Object.keys(this.coreEntities)) {
      this.coreEntities[id].destroy();
      delete this.coreEntities[id];
      this.coreTexts[id]?.destroy();
      delete this.coreTexts[id];
    }

    if (me?.isAlive && state.roundActive && !me.isCoreAnchored) {
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
    } else {
      this.moveTarget = null;
      this.movePath = [];
    }

    const meEntity = this.playerEntities[this.currentPlayerId];
    if (meEntity && !this.cameraHasInitialFocus) {
      this.setCameraCenterWorld(meEntity.x, meEntity.y);
      this.clampCameraToWorld();
      this.cameraHasInitialFocus = true;
    }
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: getViewportSize().width,
  height: getViewportSize().height,
  parent: "game-container",
  fullscreenTarget: "game-container",
  scene: [MenuScene, GameScene, BaseDefenseScene, BaseDefenseScene_Advanced]
};


const game = new Phaser.Game(config);

window.addEventListener("resize", () => {
  if (game && game.scale) {
    const viewport = getViewportSize();
    game.scale.resize(viewport.width, viewport.height);
  }
});

window.addEventListener("orientationchange", () => {
  if (game && game.scale) {
    window.setTimeout(() => {
      const viewport = getViewportSize();
      game.scale.resize(viewport.width, viewport.height);
    }, 60);
  }
});

window.visualViewport?.addEventListener("resize", () => {
  if (game && game.scale) {
    const viewport = getViewportSize();
    game.scale.resize(viewport.width, viewport.height);
  }
});

startClientVersionPolling();
// BUILD_TS: Sun Apr  5 04:50:18 EEST 2026

import Phaser from "phaser";
import { Room } from "colyseus.js";
import { client } from "./network";
import { TILE_SIZE } from "./constants";

export class GameScene extends Phaser.Scene {
  room!: Room<any>;
  playerEntities: { [sessionId: string]: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle } = {};
  playerLabels: { [sessionId: string]: Phaser.GameObjects.Text } = {};
  remotePlayerTargets: { [sessionId: string]: { x: number; y: number } } = {};
  bombEntities: { [bombId: string]: Phaser.GameObjects.Sprite | Phaser.GameObjects.Arc } = {};
  powerupEntities: { [puId: string]: Phaser.GameObjects.Arc } = {};
  tileEntities: (Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle)[] = [];
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
    // Build 116: Removed legacy setBounds
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
        // Build 111: Stripped initial centerOn
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
        if (now - this.lastMoveSentAt >= 45) {
          this.room.send("move", { x: entity.x, y: entity.y });
          this.lastMoveSentAt = now;
        }
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

    // Build 112: Stripped final centerOn
  }
}


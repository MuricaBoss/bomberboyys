import Phaser from "phaser";
import { client } from "./network";


export class BaseDefenseScene extends Phaser.Scene {
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
  structureEntities: { [id: string]: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image } = {};
  structureTexts: { [id: string]: Phaser.GameObjects.Text } = {};
  buildButtons: Array<any> = [];
  selectedBuild: string = "ore_refinery";

  constructor() {
    super("BaseDefenseScene");
  }

  preload() {
    this.load.spritesheet("tank_ready", "/assets/tanks/tank_spritesheet_ready.webp", { 
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
        // Build 111: Stripped initial centerOn
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

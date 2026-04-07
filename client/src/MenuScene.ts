import Phaser from "phaser";
import { httpEndpoint } from "./network";
import { TILE_SIZE } from "./constants";

export class MenuScene extends Phaser.Scene {
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

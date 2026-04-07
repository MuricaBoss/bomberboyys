import Phaser from "phaser";

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

  pointInRect(px: number, py: number, rect: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image) {
    const hw = rect.displayWidth / 2;
    const hh = rect.displayHeight / 2;
    return px >= rect.x - hw && px <= rect.x + hw && py >= rect.y - hh && py <= rect.y + hh;
  }

  update() {
    // UI disabled for Bomberman clone test
  }
}

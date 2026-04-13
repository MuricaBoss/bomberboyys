import Phaser from "phaser";
import { startClientVersionPolling } from "./network";
import { MenuScene } from "./MenuScene";
import { GameScene } from "./GameScene";
import { BaseDefenseScene } from "./BaseDefenseScene";
import { BaseDefenseScene_Advanced } from "./BaseDefenseAdvanced";
import {
  getGraphicsQuality,
  shouldRoundPixels,
  shouldAntialias,
  getTargetFps,
  getBatchSize,
} from "./graphicsQuality";

const graphicsQuality = getGraphicsQuality();
const roundPixels = shouldRoundPixels(graphicsQuality);
const antialias = shouldAntialias(graphicsQuality);
const targetFps = getTargetFps(graphicsQuality);
const batchSize = getBatchSize(graphicsQuality);
const dpr = Math.min(window.devicePixelRatio || 1, 2);

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL,
  backgroundColor: "#000000",
  autoRound: roundPixels,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // zoom = DPR makes the canvas buffer DPR× the CSS size.
    // Phaser's Scale Manager handles the relationship internally:
    // the game's logical coordinate space remains 1:1 with CSS pixels,
    // so the existing camera zoom controls and UI positions are unaffected.
    zoom: dpr,
  },
  parent: "game-container",
  fullscreenTarget: "game-container",
  render: {
    pixelArt: roundPixels,
    antialias,
    roundPixels,
    batchSize,
    powerPreference: "high-performance",
  },
  fps: {
    target: targetFps,
    forceSetTimeOut: false,
  },
  scene: [MenuScene, GameScene, BaseDefenseScene, BaseDefenseScene_Advanced],
};

new Phaser.Game(config);

startClientVersionPolling();

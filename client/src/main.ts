import Phaser from "phaser";
import { startClientVersionPolling } from "./network";
import { MenuScene } from "./MenuScene";
import { GameScene } from "./GameScene";
import { BaseDefenseScene } from "./BaseDefenseScene";
import { BaseDefenseScene_Advanced } from "./BaseDefenseAdvanced";
import {
  getGraphicsQuality,
  getGraphicsResolution,
  shouldRoundPixels,
  shouldAntialias,
  getTargetFps,
  getBatchSize,
} from "./graphicsQuality";

const graphicsQuality = getGraphicsQuality();
const renderResolution = getGraphicsResolution(graphicsQuality);
const roundPixels = shouldRoundPixels(graphicsQuality);
const antialias = shouldAntialias(graphicsQuality);
const targetFps = getTargetFps(graphicsQuality);
const batchSize = getBatchSize(graphicsQuality);

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  autoRound: roundPixels,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  parent: "game-container",
  fullscreenTarget: "game-container",
  render: {
    // Low uses pixel-art mode (nearest-neighbor) since textures are 1:1 pixel-art.
    // Medium+ use bilinear filtering — photorealistic assets look terrible with
    // nearest-neighbor when downscaled from their source resolution.
    pixelArt: roundPixels,
    antialias,
    roundPixels,
    batchSize,
  },
  fps: {
    target: targetFps,
    // Low: use setTimeout to guarantee 30fps cap on weak devices.
    // Medium+: use requestAnimationFrame for smooth 60fps without jitter.
    forceSetTimeOut: graphicsQuality === "low",
  },
  scene: [MenuScene, GameScene, BaseDefenseScene, BaseDefenseScene_Advanced],
};

(config as Phaser.Types.Core.GameConfig & { resolution: number }).resolution = renderResolution;

new Phaser.Game(config);

startClientVersionPolling();

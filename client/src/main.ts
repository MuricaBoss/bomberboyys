import Phaser from "phaser";
import { startClientVersionPolling } from "./network";
import { MenuScene } from "./MenuScene";
import { GameScene } from "./GameScene";
import { BaseDefenseScene } from "./BaseDefenseScene";
import { BaseDefenseScene_Advanced } from "./BaseDefenseAdvanced";
import { getGraphicsQuality, getGraphicsResolution, shouldRoundPixels } from "./graphicsQuality";

const graphicsQuality = getGraphicsQuality();
const renderResolution = getGraphicsResolution(graphicsQuality);
const roundPixels = shouldRoundPixels(graphicsQuality);

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
    pixelArt: roundPixels,
    antialias: graphicsQuality === "ultra" || graphicsQuality === "high",
    roundPixels,
    batchSize: 4096,
  },
  fps: {
    target: 30,
    forceSetTimeOut: true,
  },
  scene: [MenuScene, GameScene, BaseDefenseScene, BaseDefenseScene_Advanced]
};

(config as Phaser.Types.Core.GameConfig & { resolution: number }).resolution = renderResolution;

new Phaser.Game(config);

startClientVersionPolling();

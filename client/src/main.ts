import Phaser from "phaser";
import { startClientVersionPolling } from "./network";
import { MenuScene } from "./MenuScene";
import { GameScene } from "./GameScene";
import { BaseDefenseScene } from "./BaseDefenseScene";
import { BaseDefenseScene_Advanced } from "./BaseDefenseAdvanced";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL,
  width: window.innerWidth,
  height: window.innerHeight,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  parent: "game-container",
  fullscreenTarget: "game-container",
  render: {
    pixelArt: true,
    antialias: false,
    roundPixels: true,
    batchSize: 4096,
  },
  fps: {
    target: 30,
    forceSetTimeOut: true,
  },
  scene: [MenuScene, GameScene, BaseDefenseScene, BaseDefenseScene_Advanced]
};

new Phaser.Game(config);

startClientVersionPolling();

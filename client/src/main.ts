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

// ─── Device Pixel Ratio handling ─────────────────────────────────────────────
// On Retina / HiDPI displays, the browser's devicePixelRatio is typically 2
// (MacBook, modern phones) or even 3 (some Android flagships).
//
// Without DPR correction, Phaser renders a 1× canvas and the GPU stretches it
// to fill the physical screen — causing blur or pixelation depending on the
// browser's upscale filter.
//
// The Phaser 3 RESIZE scale mode supports a `zoom` parameter.  When zoom = DPR:
//   • canvas buffer = DPR × window.innerWidth/Height  (physical pixels)
//   • canvas CSS    = window.innerWidth/Height          (logical pixels)
//   • Game coordinate system stays in logical pixels   (nothing else changes)
//   • Camera zoom / zoom-in-out controls are unaffected
//   • Result: each game pixel maps to DPR physical pixels → native sharpness
//
// Low quality stays at zoom 1 — pixel-art mode, DPR correction is irrelevant.
const dpr = graphicsQuality === "low" ? 1 : Math.min(Math.round(window.devicePixelRatio || 1), 3);

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
    // pixelArt=true  → NEAREST-NEIGHBOR filter  (crisp pixel-art edges)
    // pixelArt=false → LINEAR filter (smooth bilinear for photorealistic assets)
    pixelArt: roundPixels,
    antialias,
    roundPixels,
    batchSize,
    powerPreference: graphicsQuality === "ultra" ? "high-performance" : "default",
  },
  fps: {
    target: targetFps,
    // Low: setTimeout guarantees the 30fps cap on weak devices.
    // Medium+: requestAnimationFrame for smooth frame delivery.
    forceSetTimeOut: graphicsQuality === "low",
  },
  scene: [MenuScene, GameScene, BaseDefenseScene, BaseDefenseScene_Advanced],
};

new Phaser.Game(config);

startClientVersionPolling();

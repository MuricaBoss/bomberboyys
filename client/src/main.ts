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
const roundPixels = shouldRoundPixels(graphicsQuality);
const antialias = shouldAntialias(graphicsQuality);
const targetFps = getTargetFps(graphicsQuality);
const batchSize = getBatchSize(graphicsQuality);

// For Medium/High/Ultra: render at devicePixelRatio so Retina displays
// get sharp, physically-dense pixel output instead of a 1× canvas being
// stretched by the GPU (which causes blurriness or pixelation depending
// on the browser's upscale algorithm).
//
// Low stays at 1.0 — pixel-art mode, DPR scaling is irrelevant.
const dpr = graphicsQuality === "low" ? 1 : Math.round(window.devicePixelRatio || 1);

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL,
  width: window.innerWidth,
  height: window.innerHeight,
  autoRound: roundPixels,
  backgroundColor: "#000000",
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // Zoom counter: we use DPR-enlarged canvas. When DPR=2, Phaser would
    // think the world is 2× smaller. zoom:1 keeps the game world size
    // correct because we'll resize the canvas manually in the ready event.
  },
  parent: "game-container",
  fullscreenTarget: "game-container",
  render: {
    // pixelArt=true → NEAREST neighbor filter (crisp pixel edges)
    // pixelArt=false → LINEAR filter (smooth bilinear for photorealistic assets)
    pixelArt: roundPixels,
    antialias,
    roundPixels,
    batchSize,
    // Power preference helps GPU pick performance mode for high-quality tiers.
    powerPreference: graphicsQuality === "ultra" ? "high-performance" : "default",
  },
  fps: {
    target: targetFps,
    // Low: setTimeout cap keeps 30fps guaranteed on weak devices.
    // Medium+: requestAnimationFrame for smooth frame delivery.
    forceSetTimeOut: graphicsQuality === "low",
  },
  scene: [MenuScene, GameScene, BaseDefenseScene, BaseDefenseScene_Advanced],
};

const game = new Phaser.Game(config);

// ─── DPR canvas correction ────────────────────────────────────────────────────
// Phaser RESIZE mode sets canvas.width/height to the logical (CSS) pixel count.
// On a 2× Retina display the GPU then stretches this 1× canvas to fill 2×
// physical pixels — producing blur or jagged edges depending on the browser.
//
// Fix: once Phaser has initialised its canvas, set the canvas buffer to
// DPR × logical size and correct the CSS size back to logical. Then tell the
// WebGL renderer to update its viewport/projection to the new larger buffer.
// We repeat this on every resize event so orientation changes don't revert it.
//
// Only applied on Medium+ because Low is pixel-art and DPR doesn't matter.
if (dpr > 1) {
  const applyDPR = () => {
    const canvas = game.canvas;
    if (!canvas) return;

    const logW = game.scale.width;
    const logH = game.scale.height;
    if (logW <= 0 || logH <= 0) return;

    const targetW = Math.round(logW * dpr);
    const targetH = Math.round(logH * dpr);

    // Only update if canvas is at logical resolution (not yet DPR-corrected).
    if (canvas.width === targetW && canvas.height === targetH) return;

    canvas.width = targetW;
    canvas.height = targetH;
    canvas.style.width = logW + "px";
    canvas.style.height = logH + "px";

    // Update the WebGL renderer viewport and projection matrix.
    const renderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    if (renderer && typeof renderer.resize === "function") {
      renderer.resize(targetW, targetH);
    }

    // Resize all active scene cameras to the new buffer dimensions.
    // Without this, cameras would use the old logical dimensions and the game
    // would only render in the top-left 1/DPR fraction of the canvas.
    for (const scene of game.scene.scenes) {
      if (scene.cameras?.main) {
        scene.cameras.main.setSize(targetW, targetH);
      }
    }
  };

  game.events.once(Phaser.Core.Events.READY, () => {
    applyDPR();
    game.scale.on(Phaser.Scale.Events.RESIZE, applyDPR);
  });
}

startClientVersionPolling();

import Phaser from "phaser";
import { RTS_TANK_DISPLAY_SIZE, RTS_TANK_ORIGIN_Y, WORLD_DEPTH_SHADOW_GAP, WORLD_DEPTH_UNIT_OFFSET } from "./constants";
import { getUnitAnimationLod, shouldProcessUnitVisual, shouldRenderTankShadow } from "./BaseDefenseUnitVisualLod";

type TankVisualArgs = {
  camView: Phaser.Geom.Rectangle;
  dir: number;
  entity: Phaser.GameObjects.Image;
  id: string;
  isDead: boolean;
  isFriendly: boolean;
  isSelected: boolean;
  unit: any;
  visible: boolean;
};

export function updateTankVisual(scene: any, args: TankVisualArgs) {
  const { camView, dir, entity, id, isDead, isFriendly, isSelected, unit, visible } = args;
  const tank = entity;
  const tState = (tank as any)._rState || {};
  const lod = getUnitAnimationLod(scene, tank.x, tank.y, isSelected);
  const shouldTick = shouldProcessUnitVisual(scene, id, isSelected || lod === "full");
  const needsInitialSync = tState.key === undefined || tState.dir === undefined || tState.dead === undefined || tState.lod === undefined;

  if (shouldTick || needsInitialSync || tState.dir !== dir || tState.dead !== isDead || tState.lod !== lod) {
    const texKey = scene.getTankTextureKeyByDir(dir);
    if (tState.key !== texKey) {
      tank.setTexture(texKey);
      tank.setDisplaySize(RTS_TANK_DISPLAY_SIZE, RTS_TANK_DISPLAY_SIZE);
      tState.key = texKey;
    }
    if (tState.dead !== isDead) {
      if (isDead) tank.setTint(0x444444);
      else tank.clearTint();
      tState.dead = isDead;
    }
    tState.dir = dir;
    tState.lod = lod;
    (tank as any)._rState = tState;
  }

  const shadowPos = scene.getTankShadowPosition(tank, dir);
  const shadowVisible = visible && shouldRenderTankShadow(scene, tank.x, tank.y, isSelected);
  let shadow = scene.tankShadowEntities[id];
  if (!shadow && shadowVisible) {
    const shadowKey = scene.getTankShadowTextureKey(dir);
    shadow = scene.add.image(shadowPos.x, shadowPos.y, shadowKey)
      .setOrigin(0.5, RTS_TANK_ORIGIN_Y)
      .setAlpha(0.45)
      .setTint(0x000000)
      .setDisplaySize(RTS_TANK_DISPLAY_SIZE, RTS_TANK_DISPLAY_SIZE);
    scene.tankShadowEntities[id] = shadow;
    (shadow as any)._rState = { key: shadowKey };
  }

  if (shadow) {
    const sState = (shadow as any)._rState || {};
    if (sState.vis !== shadowVisible) {
      shadow.setVisible(shadowVisible);
      sState.vis = shadowVisible;
    }
    if (shadowVisible) {
      // Build 289: Throttle tank shadow position/depth updates to every 4th frame.
      if (scene.game.loop.frame % 4 === 0) {
        shadow.setPosition(shadowPos.x, shadowPos.y);
        if (shouldTick || sState.dir === undefined || sState.lod !== lod) {
          const shadowKey = scene.getTankShadowTextureKey(dir);
          if (sState.key !== shadowKey) {
            shadow.setTexture(shadowKey);
            shadow.setDisplaySize(RTS_TANK_DISPLAY_SIZE, RTS_TANK_DISPLAY_SIZE);
            sState.key = shadowKey;
          }
          sState.dir = dir;
        }
        sState.lod = lod;
        
        // Build 288 Fix: Use a dedicated depth range for ALL shadows to ensure batching.
        // Shadows are now separated from bodies in the Z-buffer, allowing 40 draw calls to merge into 2-16.
        const shadowDepth = WORLD_DEPTH_UNIT_OFFSET - 2.0; // Force well below any possible body
        scene.applyWorldDepth(shadow, tank.y, shadowDepth);
      }
    }
    (shadow as any)._rState = sState;
  }

  if (visible && camView.contains(tank.x, tank.y) && (shouldTick || isSelected || lod === "full")) {
    scene.maybeFireUnitProjectile(id, unit, tank, isFriendly, visible, dir, true);
  }
}

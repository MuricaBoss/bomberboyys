import Phaser from "phaser";
import { RTS_TANK_DISPLAY_SIZE, RTS_TANK_ORIGIN_Y, WORLD_DEPTH_SHADOW_GAP, WORLD_DEPTH_UNIT_OFFSET } from "./constants";
import { shouldProcessUnitVisual } from "./BaseDefenseUnitVisualLod";

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
  const shouldTick = shouldProcessUnitVisual(scene, id, isSelected);
  const needsInitialSync = tState.key === undefined || tState.dir === undefined || tState.dead === undefined;

  if (shouldTick || needsInitialSync || tState.dir !== dir || tState.dead !== isDead) {
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
    (tank as any)._rState = tState;
  }

  const shadowPos = scene.getTankShadowPosition(tank, dir);
  let shadow = scene.tankShadowEntities[id];
  if (!shadow && visible) {
    const shadowKey = scene.getTankShadowTextureKey(dir);
    shadow = scene.add.image(shadowPos.x, shadowPos.y, shadowKey)
      .setOrigin(0.5, RTS_TANK_ORIGIN_Y)
      .setAlpha(0.4)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setTint(0x000000)
      .setDisplaySize(RTS_TANK_DISPLAY_SIZE, RTS_TANK_DISPLAY_SIZE);
    scene.tankShadowEntities[id] = shadow;
    (shadow as any)._rState = { key: shadowKey };
  }

  if (shadow) {
    const sState = (shadow as any)._rState || {};
    if (sState.vis !== visible) {
      shadow.setVisible(visible);
      sState.vis = visible;
    }
    if (visible) {
      shadow.setPosition(shadowPos.x, shadowPos.y);
      if (shouldTick || sState.dir === undefined) {
        const shadowKey = scene.getTankShadowTextureKey(dir);
        if (sState.key !== shadowKey) {
          shadow.setTexture(shadowKey);
          shadow.setDisplaySize(RTS_TANK_DISPLAY_SIZE, RTS_TANK_DISPLAY_SIZE);
          sState.key = shadowKey;
        }
        sState.dir = dir;
      }
      scene.applyWorldDepth(shadow, tank.y, WORLD_DEPTH_UNIT_OFFSET - WORLD_DEPTH_SHADOW_GAP);
    }
    (shadow as any)._rState = sState;
  }

  if (visible && camView.contains(tank.x, tank.y)) {
    scene.maybeFireUnitProjectile(id, unit, tank, isFriendly, visible, dir, true);
  }
}

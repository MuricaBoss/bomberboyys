import Phaser from "phaser";
import { shouldProcessUnitVisual } from "./BaseDefenseUnitVisualLod";

type SoldierVisualArgs = {
  camView: Phaser.Geom.Rectangle;
  dir: number;
  entity: Phaser.GameObjects.Sprite;
  id: string;
  isDead: boolean;
  isFriendly: boolean;
  isSelected: boolean;
  renderState: { x: number; y: number; vx: number; vy: number; lastAt: number } | null | undefined;
  unit: any;
  visible: boolean;
};

export function updateSoldierVisual(scene: any, args: SoldierVisualArgs) {
  const { camView, dir, entity, id, isDead, isFriendly, isSelected, renderState, unit, visible } = args;
  const soldier = entity;
  const sState = (soldier as any)._rState || {};
  const shouldTick = shouldProcessUnitVisual(scene, id, isSelected);
  const needsInitialSync = sState.dead === undefined || sState.isIdle === undefined;
  const moving = (renderState && Math.hypot(renderState.vx, renderState.vy) > 10)
    || (unit.aiState === "walking" && !scene.hasLocalUnitManualCommand(id));

  if (shouldTick || needsInitialSync || sState.dead !== isDead || sState.idleDir !== dir) {
    if (moving) {
      const runKey = scene.getSoldierAnimKey("run", dir);
      if (sState.animKey !== runKey) {
        soldier.anims.play(runKey, true);
        sState.animKey = runKey;
      }
      sState.isIdle = false;
      sState.idleDir = dir;
    } else if (!sState.isIdle || sState.idleDir !== dir) {
      soldier.anims.stop();
      soldier.setTexture(scene.getSoldierSheetTextureKey("run"), scene.getSoldierIdleFrame(dir));
      sState.animKey = "";
      sState.isIdle = true;
      sState.idleDir = dir;
    }

    if (sState.dead !== isDead) {
      if (isDead) soldier.setTint(0x444444);
      else soldier.clearTint();
      sState.dead = isDead;
    }
    (soldier as any)._rState = sState;
  }

  if (visible && scene.unitShadowGraphics && camView.contains(soldier.x, soldier.y)) {
    const shadow = scene.getSoldierShadowSpec(soldier);
    scene.unitShadowGraphics.fillStyle(0x000000, 0.45);
    scene.unitShadowGraphics.fillEllipse(shadow.x, shadow.y, shadow.width, shadow.height);
  }

  if (visible && camView.contains(soldier.x, soldier.y)) {
    scene.maybeFireUnitProjectile(id, unit, soldier, isFriendly, visible, dir, false);
  }
}

import Phaser from "phaser";
import { RTS_SOLDIER_IDLE_FRAME, RTS_SOLDIER_RUN_FRAME_COLS } from "./constants";
import { getUnitAnimationLod, getUnitVisualFrameSlotNumber, shouldProcessUnitVisual } from "./BaseDefenseUnitVisualLod";

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
  const lod = getUnitAnimationLod(scene, soldier.x, soldier.y, isSelected);
  const shouldTick = shouldProcessUnitVisual(scene, id, isSelected || lod === "full");
  const needsInitialSync = sState.dead === undefined || sState.isIdle === undefined || sState.lod === undefined;
  const moving = (renderState && Math.hypot(renderState.vx, renderState.vy) > 10)
    || (unit.aiState === "walking" && !scene.hasLocalUnitManualCommand(id));

  if (shouldTick || needsInitialSync || sState.dead !== isDead || sState.idleDir !== dir || sState.moving !== moving || sState.lod !== lod) {
    if (moving) {
      if (lod === "full") {
        const runKey = scene.getSoldierAnimKey("run", dir);
        if (sState.animKey !== runKey || !soldier.anims.isPlaying) {
          soldier.anims.play(runKey, true);
          sState.animKey = runKey;
        }
      } else {
        soldier.anims.stop();
        if (lod === "reduced" && (shouldTick || typeof sState.manualFrameOffset !== "number")) {
          const previous = typeof sState.manualFrameOffset === "number" ? sState.manualFrameOffset : RTS_SOLDIER_IDLE_FRAME;
          let next = (previous + 1) % RTS_SOLDIER_RUN_FRAME_COLS;
          if (next === RTS_SOLDIER_IDLE_FRAME) next = (next + 1) % RTS_SOLDIER_RUN_FRAME_COLS;
          sState.manualFrameOffset = next;
        }
        const frameOffset = lod === "static"
          ? ((getUnitVisualFrameSlotNumber(id) + 1) % RTS_SOLDIER_RUN_FRAME_COLS)
          : (typeof sState.manualFrameOffset === "number" ? sState.manualFrameOffset : 0);
        const rowStart = scene.getSoldierSheetRowByDir(dir) * RTS_SOLDIER_RUN_FRAME_COLS;
        soldier.setTexture(scene.getSoldierSheetTextureKey("run"), rowStart + frameOffset);
        sState.animKey = "";
      }
      sState.isIdle = false;
      sState.idleDir = dir;
    } else if (!sState.isIdle || sState.idleDir !== dir) {
      soldier.anims.stop();
      soldier.setTexture(scene.getSoldierSheetTextureKey("run"), scene.getSoldierIdleFrame(dir));
      sState.animKey = "";
      sState.isIdle = true;
      sState.idleDir = dir;
      sState.manualFrameOffset = RTS_SOLDIER_IDLE_FRAME;
    }

    if (sState.dead !== isDead) {
      if (isDead) soldier.setTint(0x444444);
      else soldier.clearTint();
      sState.dead = isDead;
    }
    sState.lod = lod;
    sState.moving = moving;
    (soldier as any)._rState = sState;
  }

  if (visible && scene.unitShadowGraphics && camView.contains(soldier.x, soldier.y) && lod !== "static") {
    const shadow = scene.getSoldierShadowSpec(soldier);
    scene.unitShadowGraphics.fillStyle(0x000000, 0.45);
    scene.unitShadowGraphics.fillEllipse(shadow.x, shadow.y, shadow.width, shadow.height);
  }

  if (visible && camView.contains(soldier.x, soldier.y) && (shouldTick || isSelected || lod === "full")) {
    scene.maybeFireUnitProjectile(id, unit, soldier, isFriendly, visible, dir, false);
  }
}

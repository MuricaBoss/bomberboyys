import Phaser from "phaser";
import { RTS_SOLDIER_DISPLAY_SIZE, RTS_SOLDIER_ORIGIN_Y } from "./constants";
import { updateSoldierVisual } from "./BaseDefenseSoldierVisuals";

type SoldierRuntimeArgs = {
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

export function ensureSoldierEntity(scene: any, current: unknown, x: number, y: number) {
  if (current instanceof Phaser.GameObjects.Sprite) return current;
  if (current && typeof (current as { destroy?: () => void }).destroy === "function") {
    (current as { destroy: () => void }).destroy();
  }
  return scene.add.sprite(x, y, scene.getSoldierSheetTextureKey("run"), 0)
    .setOrigin(0.5, RTS_SOLDIER_ORIGIN_Y)
    .setDisplaySize(RTS_SOLDIER_DISPLAY_SIZE, RTS_SOLDIER_DISPLAY_SIZE);
}

export function syncSoldierRuntime(scene: any, args: SoldierRuntimeArgs) {
  updateSoldierVisual(scene, args);
}

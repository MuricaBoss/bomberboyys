import Phaser from "phaser";
import { RTS_TANK_DISPLAY_SIZE, RTS_TANK_ORIGIN_Y } from "./constants";
import { updateTankVisual } from "./BaseDefenseTankVisuals";

type TankRuntimeArgs = {
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

export function ensureTankEntity(scene: any, current: unknown, x: number, y: number, dir: number) {
  if (current instanceof Phaser.GameObjects.Image) return current;
  if (current && typeof (current as { destroy?: () => void }).destroy === "function") {
    (current as { destroy: () => void }).destroy();
  }
  
  // Build 292: Check pool first
  const pooled = scene.tankPool?.pop();
  if (pooled) {
    return pooled
      .setPosition(x, y)
      .setTexture(scene.getTankBodyTextureKey(), scene.getTankFrameByDir(dir))
      .clearTint()
      .setVisible(true)
      .setActive(true);
  }

  return scene.add.image(x, y, scene.getTankBodyTextureKey(), scene.getTankFrameByDir(dir))
    .setOrigin(0.5, RTS_TANK_ORIGIN_Y)
    .setDisplaySize(RTS_TANK_DISPLAY_SIZE, RTS_TANK_DISPLAY_SIZE);
}

export function syncTankRuntime(scene: any, args: TankRuntimeArgs) {
  updateTankVisual(scene, args);
}

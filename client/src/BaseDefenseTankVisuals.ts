import Phaser from "phaser";
import { RTS_TANK_DISPLAY_SIZE, RTS_TANK_ORIGIN_Y, WORLD_DEPTH_UNIT_OFFSET } from "./constants";
import { getUnitAnimationLod, shouldProcessUnitVisual } from "./BaseDefenseUnitVisualLod";

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

  // Build 443: Sprite Debounce (0.1s)
  // Prevent direction/state flipping by requiring 100ms of consistent request.
  const now = scene.time.now;
  if (tState.targetDir !== dir) {
    tState.targetDir = dir;
    tState.targetDirAt = now;
  }
  
  const debounceReady = (now - (tState.targetDirAt ?? 0)) > 100;
  const activeDir = debounceReady ? dir : (tState.dir ?? dir);

  if (shouldTick || needsInitialSync || tState.dir !== activeDir || tState.dead !== isDead || tState.lod !== lod) {
    const texKey = scene.getTankBodyTextureKey();
    const frame = scene.getTankFrameByDir(activeDir);
    if (tState.key !== texKey) {
      tank.setTexture(texKey, frame);
      tank.setDisplaySize(RTS_TANK_DISPLAY_SIZE, RTS_TANK_DISPLAY_SIZE);
      tState.key = texKey;
    }
    if (tState.frame !== frame) {
      tank.setFrame(frame);
      tState.frame = frame;
    }
    if (tState.dead !== isDead) {
      if (isDead) tank.setTint(0x444444);
      else tank.clearTint();
      tState.dead = isDead;
    }
    tState.dir = activeDir;
    tState.lod = lod;
    (tank as any)._rState = tState;
  }

  let shadow = scene.tankShadowEntities[id];
  if (shadow) {
    shadow.setVisible(false).setActive(false);
    delete scene.tankShadowEntities[id];
    scene.tankShadowPool?.push(shadow);
  }

  const atkTargetId = scene.unitAttackTarget?.get?.(id) ?? scene.unitAttackTarget?.get(id);
  const atkTarget = atkTargetId
    ? (scene.room?.state?.units?.get ? scene.room.state.units.get(atkTargetId) : scene.room?.state?.units?.[atkTargetId])
      || (scene.room?.state?.structures?.get ? scene.room.state.structures.get(atkTargetId) : scene.room?.state?.structures?.[atkTargetId])
      || (scene.room?.state?.cores?.get ? scene.room.state.cores.get(atkTargetId) : scene.room?.state?.cores?.[atkTargetId])
    : null;
  const aimX = Number(atkTarget?.x ?? unit?.targetX ?? tank.x);
  const aimY = Number(atkTarget?.y ?? unit?.targetY ?? tank.y);
  const aimDir = Math.atan2(aimY - tank.y, aimX - tank.x);
  const aimDir8 = scene.angleToDir8(aimDir);
  let turret = scene.tankTurretEntities[id];
  if (!turret) {
    const pooled = scene.tankTurretPool?.pop();
    turret = pooled
      ? pooled
        .setPosition(tank.x, tank.y)
        .setTexture(scene.getTankTurretTextureKey(), scene.getTankFrameByDir(aimDir8))
        .clearTint()
        .setVisible(true)
        .setActive(true)
      : scene.add.image(tank.x, tank.y, scene.getTankTurretTextureKey(), scene.getTankFrameByDir(aimDir8))
        .setOrigin(0.5, RTS_TANK_ORIGIN_Y)
        .setDisplaySize(RTS_TANK_DISPLAY_SIZE, RTS_TANK_DISPLAY_SIZE);
    scene.tankTurretEntities[id] = turret;
  }
  const turretState = (turret as any)._rState || {};
  if (turretState.frame !== scene.getTankFrameByDir(aimDir8) || turretState.dead !== isDead) {
    turret.setTexture(scene.getTankTurretTextureKey(), scene.getTankFrameByDir(aimDir8));
    if (isDead) turret.setTint(0x444444);
    else turret.clearTint();
    turretState.frame = scene.getTankFrameByDir(aimDir8);
    turretState.dead = isDead;
    (turret as any)._rState = turretState;
  }
  turret.setPosition(tank.x, tank.y).setVisible(visible);
  scene.applyWorldDepth(turret, tank.y, WORLD_DEPTH_UNIT_OFFSET + 0.003);

  if (visible && camView.contains(tank.x, tank.y) && (shouldTick || isSelected || lod === "full")) {
    scene.maybeFireUnitProjectile(id, unit, tank, isFriendly, visible, dir, true);
  }
}

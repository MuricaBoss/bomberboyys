export const RTS_TANK_SPRITE_META = {
  tank_ready_e: { centerX: 0.498, centerY: 0.5254, rearX: 0.0878, rearY: 0.5844, trailHalfGap: 0.13 },
  tank_ready_ne: { centerX: 0.4434, centerY: 0.5713, rearX: 0.1943, rearY: 0.7982, trailHalfGap: 0.14 },
  tank_ready_n: { centerX: 0.501, centerY: 0.5293, rearX: 0.5053, rearY: 0.8945, trailHalfGap: 0.12 },
  tank_ready_nw: { centerX: 0.5537, centerY: 0.5723, rearX: 0.8071, rearY: 0.7929, trailHalfGap: 0.14 },
  tank_ready_w: { centerX: 0.5, centerY: 0.4961, rearX: 0.9104, rearY: 0.5781, trailHalfGap: 0.13 },
  tank_ready_sw: { centerX: 0.5557, centerY: 0.5059, rearX: 0.8171, rearY: 0.3536, trailHalfGap: 0.15 },
  tank_ready_s: { centerX: 0.4971, centerY: 0.4785, rearX: 0.5313, rearY: 0.1986, trailHalfGap: 0.12 },
  tank_ready_se: { centerX: 0.4443, centerY: 0.5078, rearX: 0.1778, rearY: 0.3585, trailHalfGap: 0.15 },
} as const;

export type TankSpriteMetaKey = keyof typeof RTS_TANK_SPRITE_META;

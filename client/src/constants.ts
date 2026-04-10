export const TILE_SIZE = 32;
export const RTS_GROUND_TILE_SCALE = 0.25;
export const RTS_BLOCK_TEXTURE_KEYS = ["block_1", "block_2", "block_3", "block_4"] as const;
export const RTS_INTERIOR_WALL_VISUAL_SCALE = 1.5;
export const RTS_BUILDING_TEXTURE_KEYS = {
  constructor: "building_constructor",
  ore_refinery: "building_ore_refinery",
  solar_panel: "building_solar_panel",
  barracks: "building_barracks",
  war_factory: "building_war_factory",
} as const;
export const RTS_UI_TEXTURE_KEYS = {
  move_target_marker: "ui_move_target_marker",
} as const;
export const RTS_TANK_TEXTURE_KEYS = {
  n: "tank_ready_n",
  ne: "tank_ready_ne",
  e: "tank_ready_e",
  se: "tank_ready_se",
  s: "tank_ready_s",
  sw: "tank_ready_sw",
  w: "tank_ready_w",
  nw: "tank_ready_nw",
} as const;
export const RTS_TANK_TEXTURE_BY_DIR = [
  RTS_TANK_TEXTURE_KEYS.e,
  RTS_TANK_TEXTURE_KEYS.se,
  RTS_TANK_TEXTURE_KEYS.s,
  RTS_TANK_TEXTURE_KEYS.sw,
  RTS_TANK_TEXTURE_KEYS.w,
  RTS_TANK_TEXTURE_KEYS.nw,
  RTS_TANK_TEXTURE_KEYS.n,
  RTS_TANK_TEXTURE_KEYS.ne,
] as const;
export const RTS_SOLDIER_SPRITESHEET_KEYS = {
  run: "soldier_run_sheet",
  shoot: "soldier_shoot_sheet",
} as const;
export const RTS_SOLDIER_RUN_FRAME_SIZE = 32;
export const RTS_SOLDIER_RUN_FRAME_COLS = 16;
export const RTS_SOLDIER_SHOOT_FRAME_SIZE = 32;
export const RTS_SOLDIER_SHOOT_FRAME_COLS = 8;
export const RTS_SOLDIER_FRAME_SIZE = RTS_SOLDIER_RUN_FRAME_SIZE;
export const RTS_SOLDIER_FRAME_COLS = RTS_SOLDIER_RUN_FRAME_COLS;
export const RTS_SOLDIER_ROW_BY_DIR = [4, 3, 2, 1, 0, 7, 6, 5] as const;
export const RTS_SOLDIER_IDLE_FRAME = 1;
export const RTS_SOLDIER_IDLE_FRAMES = [RTS_SOLDIER_IDLE_FRAME] as const;
export const RTS_SOLDIER_PROJECTILE_RANGE = TILE_SIZE * 5.7;
export const RTS_TANK_PROJECTILE_RANGE = TILE_SIZE * 7.7;
export const RTS_SOLDIER_PROJECTILE_INTERVAL_MS = 420;
export const RTS_SOLDIER_PROJECTILE_SPEED = 420;
export const RTS_SOLDIER_PROJECTILE_RADIUS = 2.4;
export const RTS_TANK_PROJECTILE_SPEED = 300;
export const RTS_TANK_PROJECTILE_RADIUS = 5.0;
export const RTS_TANK_PROJECTILE_INTERVAL_MS = 1400;
export const RTS_MOVE_CLICK_MARKER_LIFETIME_MS = 1200;
export const RTS_TANK_DISPLAY_SIZE = 64;
export const RTS_TANK_ORIGIN_Y = 406 / 420;
export const RTS_SOLDIER_DISPLAY_SIZE = 25;
export const RTS_SOLDIER_ORIGIN_Y = 0.84;
export const RTS_PLAYER_SOLDIER_DISPLAY_SIZE = 28;
export const RTS_PLAYER_CONSTRUCTOR_DISPLAY_SIZE = TILE_SIZE * 2.8;
export const RTS_PLAYER_CONSTRUCTOR_ORIGIN_Y = 0.74;
export const RTS_TANK_SELECTION_BOX_SIZE_SCALE = 0.68;
export const RTS_TANK_SELECTION_CENTER_Y = 0.6;
export const RTS_TANK_SELECTION_SIDE_Y_OFFSET = 3;
export const RTS_TANK_HP_BOTTOM_OFFSET = 4;
export const RTS_TANK_TRAIL_SEGMENT_LENGTH = 16;
export const RTS_TANK_TRAIL_SEGMENT_WIDTH = 5;
export const RTS_TANK_TRAIL_GAP = 12;
export const RTS_TANK_TRAIL_BACK_OFFSET = 8;
export const RTS_TANK_TRAIL_SPAWN_DISTANCE = 6;
export const RTS_TANK_TRAIL_LIFETIME_MS = 2200;
export const RTS_TANK_TRAIL_ALPHA = 0.58;
export const RTS_IMAGE_SHADOW_ALPHA = 0.24;
export const RTS_TILE_SHADOW_ALPHA = 0.24;
export const WORLD_DEPTH_BASE = 10;
export const WORLD_DEPTH_PER_PIXEL = 0.05;
export const WORLD_DEPTH_TILE_OFFSET = 0.0;
export const WORLD_DEPTH_TRAIL_OFFSET = 0.005;
export const WORLD_DEPTH_RESOURCE_OFFSET = 0.01;
export const WORLD_DEPTH_STRUCTURE_OFFSET = 0.02;
export const WORLD_DEPTH_PLAYER_OFFSET = 0.03;
export const WORLD_DEPTH_UNIT_OFFSET = 0.04;
export const WORLD_DEPTH_PROJECTILE_OFFSET = 0.05;
export const WORLD_DEPTH_SHADOW_GAP = 0.015;
export const WORLD_DEPTH_SELECTION_OFFSET = -0.02;
export const WORLD_DEPTH_LABEL_OFFSET = 0.35;
export const WORLD_DEPTH_HP_OFFSET = 0.45;
export const PRODUCED_UNIT_EXIT_GRACE_MS = 1500;
export const FOG_CELL_SIZE = 6;
export const FOG_UPDATE_MS = 110;
export const MIN_CAMERA_ZOOM = 0.28;
export const MAX_CAMERA_ZOOM = 2.2;

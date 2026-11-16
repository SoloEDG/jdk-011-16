import type { Stance, Vec3 } from "./document";

/** Collision half-width of the character, in blocks. */
export const PLAYER_RADIUS = 0.28;
/** Collision height of the standing character, in blocks. */
export const STANDING_HEIGHT = 1.65;
/** Collision height while crouching: a one block high passage fits. */
export const CROUCHING_HEIGHT = 0.9;
/** Highest ledge crossed without a jump. */
export const STEP_HEIGHT = 1;

/** Inclusive ranges of whole cells touched by a volume, border-exclusive. */
const EPS = 1e-7;
export const cellRange = (min: number, max: number) =>
  [Math.floor(min + EPS), Math.floor(max - EPS)] as const;

export const bodyHeight = (stance: Stance) =>
  stance === "crouch" ? CROUCHING_HEIGHT : STANDING_HEIGHT;

/** Cell range covered by a player volume at `p`. */
export function bodyCells(
  p: Vec3,
  height = STANDING_HEIGHT,
  radius = PLAYER_RADIUS,
) {
  return {
    x: cellRange(p.x - radius, p.x + radius),
    y: cellRange(p.y, p.y + height),
    z: cellRange(p.z - radius, p.z + radius),
  };
}

/** Horizontal bounds of the world the character may stand in. */
export const WORLD_MIN = -16;
export const WORLD_MAX = 16;
export const WORLD_TOP = 20;

/** True when the character's feet are inside the horizontal world bounds. */
export const insideWorld = (p: Vec3) =>
  Number.isFinite(p.x) &&
  Number.isFinite(p.y) &&
  Number.isFinite(p.z) &&
  p.x >= WORLD_MIN + PLAYER_RADIUS &&
  p.x <= WORLD_MAX - PLAYER_RADIUS &&
  p.z >= WORLD_MIN + PLAYER_RADIUS &&
  p.z <= WORLD_MAX - PLAYER_RADIUS;

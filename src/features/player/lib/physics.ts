import type { Stance, Vec3, Workspace } from "../../../shared/document";
import {
  CROUCHING_HEIGHT,
  PLAYER_RADIUS,
  STANDING_HEIGHT,
  STEP_HEIGHT,
  WORLD_TOP,
  insideWorld,
} from "../../../shared/body";
import { collides, supportBelow } from "./collision";
import { resolvePlayerPosition } from "./spawn";

export interface Motion {
  vertical: number;
  grounded: boolean;
}

/** Horizontal speeds in blocks per second. */
export const WALK_SPEED = 4;
export const SPRINT_SPEED = 6.6;
export const CROUCH_SPEED = 2.1;
export const JUMP_SPEED = 6;
export const GRAVITY = 18;
const MAX_FALL = 30;
/** No movement step may exceed this, so nothing is tunnelled through. */
const SWEEP = 0.2;
/** Vertical tolerance when snapping onto a block top. */
const SNAP = 0.08;

// C only: Ctrl combinations such as Ctrl+W are browser shortcuts and cannot be
// reliably intercepted while walking.
export const crouchHeld = (keys: Set<string>) => keys.has("KeyC");
export const sprintHeld = (keys: Set<string>) =>
  keys.has("ShiftLeft") || keys.has("ShiftRight");

const heightOf = (stance: Stance) =>
  stance === "crouch" ? CROUCHING_HEIGHT : STANDING_HEIGHT;

/** True when the character fits upright at `p`. */
export const canStand = (doc: Workspace["doc"], p: Vec3) =>
  !collides(doc, p, STANDING_HEIGHT);

/**
 * One horizontal sub-step along a single axis. When the way is blocked and the
 * character is on the ground, a ledge whose top is exactly one block up is
 * climbed. Taller obstacles keep blocking, so they still require a jump.
 */
function sweepAxis(
  s: Workspace,
  motion: Motion,
  axis: "x" | "z",
  amount: number,
  height: number,
) {
  const p = s.doc.player;
  const steps = Math.max(1, Math.ceil(Math.abs(amount) / SWEEP));
  const step = amount / steps;
  for (let i = 0; i < steps; i++) {
    const next: Vec3 = { ...p, [axis]: p[axis] + step };
    if (insideWorld(next) && !collides(s.doc, next, height)) {
      p[axis] = next[axis];
      continue;
    }
    if (!motion.grounded || p.y + STEP_HEIGHT > WORLD_TOP) break;
    // Lift before moving horizontally: first the column above the body must be
    // free, then the raised destination must be free too. Checking both stops a
    // diagonal from cutting through the corner between two walls.
    const lifted: Vec3 = { ...p, y: p.y + STEP_HEIGHT };
    const raised: Vec3 = { ...next, y: p.y + STEP_HEIGHT };
    if (
      insideWorld(lifted) &&
      !collides(s.doc, lifted, height) &&
      insideWorld(raised) &&
      !collides(s.doc, raised, height) &&
      supportBelow(s.doc, raised, PLAYER_RADIUS, SNAP) !== null
    ) {
      p.y = lifted.y;
      p[axis] = raised[axis];
      continue;
    }
    break;
  }
}

/**
 * Walk down a single step without free-falling off every stair. Only used when
 * the character was grounded before moving; larger drops fall under gravity.
 */
function settleStep(s: Workspace, motion: Motion, height: number) {
  if (!motion.grounded) return;
  const p = s.doc.player;
  if (supportBelow(s.doc, p, PLAYER_RADIUS, SNAP) !== null) return;
  const landing = supportBelow(s.doc, p, PLAYER_RADIUS, STEP_HEIGHT + SNAP);
  if (landing === null || p.y - landing > STEP_HEIGHT + SNAP) {
    motion.grounded = false;
    return;
  }
  const candidate = { ...p, y: landing };
  if (collides(s.doc, candidate, height)) {
    motion.grounded = false;
    return;
  }
  p.y = landing;
}

/**
 * Resolve posture before moving. Crouching shrinks the volume; releasing the
 * crouch key only stands up again when the full body fits, so a low ceiling
 * cannot push the head into a block.
 */
function updateStance(s: Workspace, keys: Set<string>): Stance {
  const desired: Stance =
    s.mode === "walk" && crouchHeld(keys) ? "crouch" : "stand";
  const stance: Stance =
    desired === "stand" && !canStand(s.doc, s.doc.player)
      ? "crouch"
      : desired;
  s.stance = stance;
  return stance;
}

/**
 * Horizontal movement, posture changes and vertical falling are all resolved
 * against the same volume, so a crouch, a step and a landing agree about where
 * the body is allowed to be.
 */
export function stepPlayer(
  s: Workspace,
  keys: Set<string>,
  motion: Motion,
  dt: number,
) {
  const p = s.doc.player;
  const start = { x: p.x, y: p.y, z: p.z, stance: s.stance };
  const stance = updateStance(s, keys);
  const height = heightOf(stance);
  const walking = s.mode === "walk";
  if (!walking) {
    // Build mode is a free camera: gravity and movement are suspended, but the
    // posture still follows the space the character is standing in so leaving
    // walk mode under a low roof does not make the avatar stand through it.
    if (s.stance !== start.stance) s.dirty = true;
    return;
  }

  let dx = walking ? Number(keys.has("KeyD")) - Number(keys.has("KeyA")) : 0;
  let dz = walking ? Number(keys.has("KeyS")) - Number(keys.has("KeyW")) : 0;
  if (dx || dz) {
    const len = Math.hypot(dx, dz);
    dx /= len;
    dz /= len;
    const speed =
      stance === "crouch"
        ? CROUCH_SPEED
        : sprintHeld(keys)
          ? SPRINT_SPEED
          : WALK_SPEED;
    sweepAxis(s, motion, "x", dx * speed * dt, height);
    sweepAxis(s, motion, "z", dz * speed * dt, height);
    settleStep(s, motion, height);
  }

  if (walking && keys.has("Space") && motion.grounded) {
    motion.vertical = JUMP_SPEED;
    motion.grounded = false;
  }
  // Stepping up moves the feet directly; the resulting motion is still governed
  // by the same gravity sweep, so a climb never floats and a fall never stalls.
  motion.vertical = Math.max(motion.vertical - GRAVITY * dt, -MAX_FALL);
  let remaining = motion.vertical * dt;
  while (Math.abs(remaining) > 1e-9) {
    const step = Math.sign(remaining) * Math.min(Math.abs(remaining), SWEEP);
    remaining -= step;
    const next = { ...p, y: p.y + step };
    if (!collides(s.doc, next, height)) {
      p.y = next.y;
      if (step < 0) motion.grounded = false;
      continue;
    }
    if (step < 0) {
      const landing = supportBelow(
        s.doc,
        p,
        PLAYER_RADIUS,
        Math.abs(step) + 0.02,
      );
      if (landing !== null) {
        p.y = landing;
        motion.vertical = 0;
        motion.grounded = true;
      } else {
        motion.vertical = 0;
        motion.grounded = false;
      }
    } else {
      motion.vertical = 0;
    }
    break;
  }

  if (p.y < -5) {
    const safe = resolvePlayerPosition(s.doc, { x: 0, y: 12, z: 9 }, "跌出世界");
    p.x = safe.position.x;
    p.y = safe.position.y;
    p.z = safe.position.z;
    s.stance = safe.stance;
    motion.vertical = 0;
    motion.grounded = false;
    s.message = safe.reason;
  }
  // Only a real change (including a posture change) marks the world dirty, so
  // idle frames do not make the save indicator flicker.
  if (
    s.stance !== start.stance ||
    Math.abs(p.x - start.x) > 1e-6 ||
    Math.abs(p.y - start.y) > 1e-6 ||
    Math.abs(p.z - start.z) > 1e-6
  )
    s.dirty = true;
}

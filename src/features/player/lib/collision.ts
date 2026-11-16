import { key, type Vec3 } from "../../../shared/document";
import {
  PLAYER_RADIUS,
  STANDING_HEIGHT,
  bodyCells,
} from "../../../shared/body";

/** The only part of a document collision needs, so partial data also works. */
export interface SolidWorld {
  blocks: Record<string, Vec3>;
}

/** True when the character volume at `p` overlaps at least one block. */
export function collides(
  doc: SolidWorld,
  p: Vec3,
  height: number = STANDING_HEIGHT,
  radius: number = PLAYER_RADIUS,
) {
  const r = bodyCells(p, height, radius);
  for (let x = r.x[0]; x <= r.x[1]; x++)
    for (let z = r.z[0]; z <= r.z[1]; z++)
      for (let y = r.y[0]; y <= r.y[1]; y++)
        if (doc.blocks[key({ x, y, z })]) return true;
  return false;
}

/**
 * Highest block top directly under the feet, within `maxDrop` below them. The
 * tolerance lets a body that just stepped onto a ledge settle instead of
 * jittering between "on the ground" and "falling".
 */
export function supportBelow(
  doc: SolidWorld,
  p: Vec3,
  radius: number = PLAYER_RADIUS,
  maxDrop = 0.08,
): number | null {
  if (!Number.isFinite(maxDrop) || maxDrop < 0) return null;
  const tolerance = 1e-6;
  const r = bodyCells(p, 0, radius);
  const minY = Math.floor(p.y - maxDrop - 1 + tolerance);
  const maxY = Math.floor(p.y + tolerance);
  let best: number | null = null;
  for (let x = r.x[0]; x <= r.x[1]; x++)
    for (let z = r.z[0]; z <= r.z[1]; z++)
      for (let y = minY; y <= maxY; y++) {
        if (!doc.blocks[key({ x, y, z })]) continue;
        const top = y + 1;
        if (top > p.y + tolerance || top < p.y - maxDrop - tolerance) continue;
        if (best === null || top > best) best = top;
      }
  return best;
}

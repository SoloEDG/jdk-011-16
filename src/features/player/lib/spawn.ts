import {
  PLAYER_RADIUS,
  STANDING_HEIGHT,
  WORLD_MAX,
  WORLD_MIN,
  WORLD_TOP,
  bodyHeight,
  insideWorld,
} from "../../../shared/body";
import type { Stance, Vec3 } from "../../../shared/document";
import { collides, supportBelow, type SolidWorld } from "./collision";

export interface SafeSpawn {
  position: Vec3;
  stance: Stance;
  /** Why the saved point was not usable (empty when it was used verbatim). */
  reason: string;
  moved: boolean;
}

export const SPAWN: Vec3 = { x: 0, y: 3, z: 9 };
const SEARCH_RADIUS = 6;
const SNAP = 0.08;

/** True when a body of `height` has solid ground and room at `p`. */
function standsAt(doc: SolidWorld, p: Vec3, height: number) {
  return (
    insideWorld(p) &&
    !collides(doc, p, height, PLAYER_RADIUS) &&
    supportBelow(doc, p, PLAYER_RADIUS, SNAP) !== null
  );
}

/** The first stance that fits at `p`, preferring upright. */
function stanceAt(doc: SolidWorld, p: Vec3): Stance | null {
  for (const stance of ["stand", "crouch"] as Stance[])
    if (standsAt(doc, p, bodyHeight(stance))) return stance;
  return null;
}

/** Block tops of every column, indexed once so a load stays cheap. */
type TopIndex = Map<string, number[]>;

const columnKey = (x: number, z: number) => `${x},${z}`;

function indexTops(doc: SolidWorld): TopIndex {
  const index: TopIndex = new Map();
  for (const b of Object.values(doc.blocks)) {
    if (b.y + 1 < 0 || b.y + 1 >= WORLD_TOP) continue;
    const k = columnKey(b.x, b.z);
    const list = index.get(k);
    if (list) {
      if (!list.includes(b.y + 1)) list.push(b.y + 1);
    } else index.set(k, [b.y + 1]);
  }
  return index;
}

/** Block tops inside one column, ordered by distance to `preferY`. */
function columnTops(index: TopIndex, x: number, z: number, preferY: number) {
  const tops = index.get(columnKey(x, z));
  if (!tops) return [];
  return [...tops].sort((a, b) => Math.abs(a - preferY) - Math.abs(b - preferY));
}

const clampCell = (n: number) =>
  Number.isFinite(n)
    ? Math.min(WORLD_MAX - 1, Math.max(WORLD_MIN, Math.floor(n)))
    : 0;

const inBounds = (x: number, z: number) =>
  x >= WORLD_MIN && x < WORLD_MAX && z >= WORLD_MIN && z < WORLD_MAX;

function pickInColumn(
  doc: SolidWorld,
  topsIndex: TopIndex,
  cellX: number,
  cellZ: number,
  preferY: number,
): SafeSpawn | null {
  const x = cellX + 0.5;
  const z = cellZ + 0.5;
  for (const stance of ["stand", "crouch"] as Stance[])
    for (const top of columnTops(topsIndex, cellX, cellZ, preferY)) {
      const position = { x, y: top, z };
      if (standsAt(doc, position, bodyHeight(stance)))
        return { position, stance, reason: "", moved: true };
    }
  return null;
}

/** Nearest standable column around `raw`, preferring small vertical change. */
function searchNearby(
  doc: SolidWorld,
  topsIndex: TopIndex,
  raw: Vec3,
): SafeSpawn | null {
  const baseX = clampCell(raw.x);
  const baseZ = clampCell(raw.z);
  const columns: { x: number; z: number; d: number }[] = [];
  for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++)
    for (let dz = -SEARCH_RADIUS; dz <= SEARCH_RADIUS; dz++) {
      const x = baseX + dx;
      const z = baseZ + dz;
      if (inBounds(x, z)) columns.push({ x, z, d: Math.hypot(dx, dz) });
    }
  columns.sort((a, b) => a.d - b.d);

  let best: SafeSpawn | null = null;
  let bestCost = Infinity;
  for (const col of columns) {
    const spot = pickInColumn(doc, topsIndex, col.x, col.z, raw.y);
    if (!spot) continue;
    // Horizontal distance dominates, so a block next door always wins over a
    // platform high up, while ties are broken by the closest floor height.
    const cost = col.d * 2 + Math.abs(spot.position.y - raw.y);
    if (cost < bestCost) {
      best = spot;
      bestCost = cost;
    }
  }
  return best;
}

function blockedReason(doc: SolidWorld, p: Vec3) {
  if (!insideWorld(p)) return "坐标超出世界边界";
  if (collides(doc, p, STANDING_HEIGHT, PLAYER_RADIUS))
    return "站立体积与方块重叠";
  if (supportBelow(doc, p, PLAYER_RADIUS, SNAP) === null)
    return "脚下没有支撑";
  return "站立空间不足";
}

/**
 * Validate or repair a saved character position against the current volume.
 * Pure: the caller decides whether to install the result, so a failed restore
 * never destroys the loaded world.
 */
export function resolvePlayerPosition(
  doc: SolidWorld,
  saved: Vec3,
  reasonPrefix = "存档位置不安全",
): SafeSpawn {
  const raw: Vec3 = {
    x: Number.isFinite(saved.x) ? saved.x : SPAWN.x,
    y: Number.isFinite(saved.y) ? saved.y : SPAWN.y,
    z: Number.isFinite(saved.z) ? saved.z : SPAWN.z,
  };

  if (insideWorld(raw)) {
    const stance = stanceAt(doc, raw);
    if (stance)
      return {
        position: { ...raw },
        stance,
        reason:
          stance === "crouch" ? `${reasonPrefix}：已改用蹲姿恢复` : "",
        moved: false,
      };
  }

  const reason = blockedReason(doc, raw);
  const tops = indexTops(doc);
  const columnX = clampCell(raw.x);
  const columnZ = clampCell(raw.z);

  // Keep the saved horizontal spot and settle onto a floor in that column.
  const column = inBounds(columnX, columnZ)
    ? pickInColumn(doc, tops, columnX, columnZ, raw.y)
    : null;
  if (column)
    return {
      position: column.position,
      stance: column.stance,
      reason: `${reasonPrefix}：${reason}，已在该位置重新落地`,
      moved: true,
    };

  const nearby = searchNearby(doc, tops, raw);
  if (nearby)
    return {
      position: nearby.position,
      stance: nearby.stance,
      reason: `${reasonPrefix}：${reason}，已移动到附近可站立的位置`,
      moved: true,
    };

  const fallback =
    pickInColumn(doc, tops, clampCell(SPAWN.x), clampCell(SPAWN.z), SPAWN.y) ?? {
      position: { ...SPAWN },
      stance: "stand" as Stance,
    };
  return {
    position: fallback.position,
    stance: fallback.stance,
    reason: `${reasonPrefix}：${reason}，附近没有空位，已回到出生点`,
    moved: true,
  };
}

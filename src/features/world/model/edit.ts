import {
  inside,
  key,
  type Workspace,
  type Vec3,
  type Block,
} from "../../../shared/document";
import {
  PLAYER_RADIUS,
  STANDING_HEIGHT,
  bodyCells,
} from "../../../shared/body";
import type { EditResult } from "../../../shared/commands";

/** True when a block at `cell` would intersect the character's body. */
function hitsBody(cell: Vec3, player: Vec3, height: number) {
  const r = bodyCells(player, height, PLAYER_RADIUS);
  return (
    cell.x >= r.x[0] &&
    cell.x <= r.x[1] &&
    cell.y >= r.y[0] &&
    cell.y <= r.y[1] &&
    cell.z >= r.z[0] &&
    cell.z <= r.z[1]
  );
}

export function editCells(
  s: Workspace,
  cells: Vec3[],
  remove = false,
): EditResult {
  const unique = [...new Map(cells.map((p) => [key(p), p])).values()];
  const changed: Block[] = [];
  for (const p of unique) {
    const old = s.doc.blocks[key(p)];
    if (!inside(p) || (!remove && old) || (remove && (!old || p.y === 0)))
      continue;
    // Building beside a moving character is fine, but a block that would occupy
    // its body is refused. The standing envelope is checked even while crouched:
    // a crouch-height-only check would let a block be placed over the head and
    // trap the character the moment it released the crouch key.
    if (!remove && hitsBody(p, s.doc.player, STANDING_HEIGHT))
      return {
        ok: false,
        message: "无法建造：新方块会与角色身体重叠",
        changed: [],
      };
    changed.push(remove ? old! : { ...p, material: s.material });
  }
  if (!remove && s.doc.inventory[s.material] < changed.length)
    return { ok: false, message: "物品数量不足，未进行建造", changed: [] };
  for (const b of changed) {
    if (remove) {
      delete s.doc.blocks[key(b)];
      s.doc.inventory[b.material]++;
    } else {
      s.doc.blocks[key(b)] = b;
      s.doc.inventory[b.material]--;
    }
  }
  if (changed.length) {
    s.doc.revision++;
    s.dirty = true;
  }
  return {
    ok: true,
    message: changed.length
      ? `${remove ? "拆除" : "放置"}了 ${changed.length} 个方块`
      : "没有可修改的方块",
    changed,
  };
}

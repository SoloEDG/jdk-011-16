import type { WorldDocument, Vec3 } from "../../../shared/document";
import { key } from "../../../shared/document";
import type { WorldSummary } from "../../../shared/commands";
export const at = (doc: WorldDocument, p: Vec3) => doc.blocks[key(p)];
export function summarize(doc: WorldDocument): WorldSummary {
  const b = Object.values(doc.blocks);
  return {
    total: b.length,
    highest: Math.max(0, ...b.map((v) => v.y)) + 1,
    materials: new Set(b.map((v) => v.material)).size,
  };
}

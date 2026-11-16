import type { Workspace, WorldDocument } from "../../../shared/document";
import { resolvePlayerPosition } from "../../player/lib/spawn";
import { writeWorld, readWorld, downloadWorld } from "../lib/storage";
import { decode } from "../lib/codec";
export function installWorld(s: Workspace, doc: WorldDocument) {
  // Restoring an older save must respect the current, larger player volume.
  // Validation happens before the world is swapped in, so a bad position can
  // never leave the workspace half-loaded.
  const spawn = resolvePlayerPosition(doc, doc.player);
  const revision = s.doc.revision + 1;
  s.doc = doc;
  s.doc.player = { ...spawn.position };
  s.doc.revision = revision;
  s.dirty = false;
  s.mode = "build";
  s.stance = spawn.stance;
  s.savedAt = null;
  s.message = spawn.reason
    ? `世界已载入；${spawn.reason}`
    : "世界已载入";
}
export function save(s: Workspace) {
  try {
    s.savedAt = writeWorld(s.doc);
    s.dirty = false;
    s.message = "世界已保存到此浏览器";
  } catch {
    s.message = "保存失败，请导出备份";
  }
}
export function load(s: Workspace) {
  try {
    installWorld(s, readWorld());
  } catch (e) {
    s.message = (e as Error).message;
  }
}
export function exportWorld(s: Workspace) {
  downloadWorld(s.doc);
  s.message = "世界文件已导出";
}
export async function importWorld(s: Workspace, file: File) {
  try {
    installWorld(s, decode(await file.text()));
  } catch (e) {
    s.message = (e as Error).message;
  }
}

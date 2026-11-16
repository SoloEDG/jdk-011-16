/**
 * Headless checks for the character controller. Run with:
 *   npx tsx scripts/player-check.ts
 * Kept outside src so it never ships in the app bundle.
 */
import assert from "node:assert/strict";
import { createWorld } from "../src/features/world/lib/terrain";
import { stepPlayer, type Motion } from "../src/features/player/lib/physics";
import { resolvePlayerPosition } from "../src/features/player/lib/spawn";
import { collides, supportBelow } from "../src/features/player/lib/collision";
import { editCells } from "../src/features/world/model/edit";
import { installWorld } from "../src/features/archive/model/archive";
import type { Block, Workspace, WorldDocument } from "../src/shared/document";
import { key } from "../src/shared/document";

function flat(extra: (put: (x: number, y: number, z: number) => void) => void = () => {}) {
  const blocks: Record<string, Block> = {};
  const put = (x: number, y: number, z: number, material: Block["material"] = "stone") => {
    blocks[key({ x, y, z })] = { x, y, z, material };
  };
  for (let x = -16; x < 16; x++) for (let z = -16; z < 16; z++) put(x, 0, z, "soil");
  extra(put);
  return blocks;
}

function workspace(blocks: Record<string, Block>, player = { x: 0.5, y: 1, z: 0.5 }): Workspace {
  const doc: WorldDocument = {
    version: 1,
    name: "test",
    blocks,
    inventory: {
      grass: 99, soil: 99, stone: 99, wood: 99, sand: 99, brick: 99, glass: 99, leaf: 99,
    },
    player,
    revision: 0,
  };
  return {
    doc,
    material: "stone",
    tool: "place",
    region: null,
    anchor: null,
    message: "",
    dirty: false,
    mode: "walk",
    stance: "stand",
    savedAt: null,
  };
}

const keysOf = (...codes: string[]) => new Set(codes);
const frames = (s: Workspace, motion: Motion, keys: Set<string>, count: number, dt = 1 / 60) => {
  for (let i = 0; i < count; i++) stepPlayer(s, keys, motion, dt);
};

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

check("walking on flat ground stays grounded", () => {
  const s = workspace(flat());
  const m: Motion = { vertical: 0, grounded: true };
  frames(s, m, keysOf("KeyD"), 60);
  assert.equal(s.doc.player.y, 1);
  assert.ok(s.doc.player.x > 1);
  assert.equal(m.grounded, true);
});

check("crouching fits under a one block ceiling, standing does not", () => {
  const s = workspace(flat((put) => { for (let x = -2; x < 4; x++) put(x, 2, 0); }), { x: 0.5, y: 1, z: 0.5 });
  const m: Motion = { vertical: 0, grounded: true };
  frames(s, m, keysOf("KeyD", "KeyC"), 60);
  assert.equal(s.stance, "crouch");
  assert.ok(s.doc.player.x > 1, "crouching character should pass under the ceiling");
  assert.equal(collides(s.doc, s.doc.player, 0.9), false);
});

check("releasing crouch under a ceiling does not push the head into the block", () => {
  const s = workspace(flat((put) => { for (let x = -2; x < 4; x++) put(x, 2, 0); }), { x: 0.5, y: 1, z: 0.5 });
  const m: Motion = { vertical: 0, grounded: true };
  frames(s, m, keysOf("KeyD", "KeyC"), 30);
  const x = s.doc.player.x;
  assert.ok(x > 1.2);
  frames(s, m, keysOf("KeyD"), 30); // release C while still under the ceiling
  assert.equal(s.stance, "crouch", "should stay crouched while the ceiling is overhead");
  assert.ok(s.doc.player.y >= 1);
  assert.equal(collides(s.doc, s.doc.player, 0.9), false, "crouched body must stay clear");
  assert.equal(collides(s.doc, s.doc.player, 1.65), true, "scene should confirm standing would clip");
});

check("standing up resumes once clear of the ceiling", () => {
  const s = workspace(flat((put) => { for (let x = -2; x < 4; x++) put(x, 2, 0); }), { x: 0.5, y: 1, z: 0.5 });
  const m: Motion = { vertical: 0, grounded: true };
  frames(s, m, keysOf("KeyD", "KeyC"), 20);
  frames(s, m, keysOf("KeyD"), 200); // keep going past the end of the ceiling
  assert.equal(s.stance, "stand");
});

check("sprinting is faster than walking", () => {
  const walk = workspace(flat());
  const run = workspace(flat());
  const m1: Motion = { vertical: 0, grounded: true };
  const m2: Motion = { vertical: 0, grounded: true };
  frames(walk, m1, keysOf("KeyD"), 30);
  frames(run, m2, keysOf("KeyD", "ShiftLeft"), 30);
  assert.ok(run.doc.player.x > walk.doc.player.x + 0.3);
});

check("a one block step is climbed while walking", () => {
  const s = workspace(flat((put) => { for (let z = -3; z <= 3; z++) put(2, 1, z); }), { x: 0.5, y: 1, z: 0.5 });
  const m: Motion = { vertical: 0, grounded: true };
  let climbed = false;
  let crossed = false;
  for (let i = 0; i < 60; i++) {
    stepPlayer(s, keysOf("KeyD"), m, 1 / 60);
    if (s.doc.player.y === 2) climbed = true;
    if (s.doc.player.x > 2.7) crossed = true;
  }
  assert.ok(crossed, `expected to cross the step, x=${s.doc.player.x}`);
  assert.ok(climbed, "expected the character to stand on top of the step");
  // Walking off the far side steps back down instead of free falling.
  assert.equal(m.grounded, true);
});

check("a two block wall is not climbed", () => {
  const s = workspace(flat((put) => { for (let z = -3; z <= 3; z++) { put(2, 1, z); put(2, 2, z); } }), { x: 0.5, y: 1, z: 0.5 });
  const m: Motion = { vertical: 0, grounded: true };
  frames(s, m, keysOf("KeyD"), 120);
  assert.equal(s.doc.player.y, 1);
  assert.ok(s.doc.player.x < 2, `expected to be blocked, x=${s.doc.player.x}`);
});

check("a three block wall stays unclimbable even after jumping", () => {
  const s = workspace(flat((put) => { for (let z = -3; z <= 3; z++) { put(2, 1, z); put(2, 2, z); put(2, 3, z); } }), { x: 0.5, y: 1, z: 0.5 });
  const m: Motion = { vertical: 0, grounded: true };
  frames(s, m, keysOf("KeyD", "Space"), 120);
  assert.ok(s.doc.player.x < 2, `expected to stay clear, x=${s.doc.player.x}`);
  assert.ok(s.doc.player.y < 3);
});

check("descending a single step does not free fall", () => {
  const s = workspace(
    flat((put) => {
      for (let x = -1; x <= 1; x++) for (let z = -3; z <= 3; z++) put(x, 1, z);
    }),
    { x: 0.5, y: 2, z: 0.5 },
  );
  const m: Motion = { vertical: 0, grounded: true };
  frames(s, m, keysOf("KeyD"), 30);
  assert.equal(s.doc.player.y, 1);
  assert.equal(m.grounded, true);
});

check("a diagonal sprint cannot pass through the corner of two walls", () => {
  const s = workspace(
    flat((put) => {
      // Wall along +x at z = 2 and wall along +z at x = 2, leaving a gap at the
      // diagonal corner between them.
      for (let y = 1; y <= 3; y++) {
        for (let x = -4; x <= 4; x++) put(x, y, 2);
        for (let z = -4; z <= 4; z++) put(2, y, z);
      }
    }),
    { x: 0.5, y: 1, z: 0.5 },
  );
  const m: Motion = { vertical: 0, grounded: true };
  for (let i = 0; i < 300; i++) {
    stepPlayer(s, keysOf("KeyD", "KeyS", "ShiftLeft"), m, 1 / 60);
    const p = s.doc.player;
    // Never inside the walls, and never up on top of them.
    assert.ok(p.x < 2 || p.z < 2, `crossed the wall corner at ${p.x},${p.z}`);
    assert.ok(p.y <= 1.001, `climbed the wall at y=${p.y}`);
  }
});

check("diagonal movement keeps axis order independent of wall direction", () => {
  const s = workspace(
    flat((put) => {
      for (let y = 1; y <= 3; y++) for (let z = -16; z < 16; z++) put(2, y, z);
    }),
    { x: 0.5, y: 1, z: 0.5 },
  );
  const m: Motion = { vertical: 0, grounded: true };
  frames(s, m, keysOf("KeyD", "KeyS", "ShiftLeft"), 200);
  assert.ok(s.doc.player.x < 2, "should be stopped by the wall");
  assert.ok(s.doc.player.z > 0.5, "should still slide along the wall");
});

check("removing the block under the feet makes the character fall", () => {
  const s = workspace(
    flat((put) => { for (let z = -2; z <= 2; z++) put(0, 1, z); }),
    { x: 0.5, y: 2, z: 0.5 },
  );
  const m: Motion = { vertical: 0, grounded: true };
  frames(s, m, keysOf(), 2);
  editCells(s, [{ x: 0, y: 1, z: 0 }], true);
  frames(s, m, keysOf(), 15);
  assert.ok(s.doc.player.y < 1.95, `expected to fall, y=${s.doc.player.y}`);
  assert.equal(m.grounded, false);
  frames(s, m, keysOf(), 60);
  assert.equal(s.doc.player.y, 1, "should land on the ground below");
});

check("placing a block that overlaps the body is refused", () => {
  const s = workspace(flat(), { x: 0.5, y: 1, z: 0.5 });
  const before = Object.keys(s.doc.blocks).length;
  const r = editCells(s, [{ x: 0, y: 1, z: 0 }]);
  assert.equal(r.ok, false);
  assert.match(r.message, /重叠/);
  assert.equal(Object.keys(s.doc.blocks).length, before);
});

check("placing a block beside the body while walking is allowed", () => {
  const s = workspace(flat(), { x: 0.5, y: 1, z: 0.5 });
  const r = editCells(s, [{ x: 2, y: 1, z: 0 }]);
  assert.equal(r.ok, true);
  assert.ok(s.doc.blocks[key({ x: 2, y: 1, z: 0 })]);
});

check("a crouched character cannot be sealed in by a block above it", () => {
  const s = workspace(flat(), { x: 0.5, y: 1, z: 0.5 });
  s.stance = "crouch";
  // y=2 clears the crouched body but not the standing envelope; refusing it
  // keeps releasing the crouch key safe.
  assert.equal(editCells(s, [{ x: 0, y: 2, z: 0 }]).ok, false);
  assert.equal(editCells(s, [{ x: 0, y: 1, z: 0 }]).ok, false);
  assert.equal(editCells(s, [{ x: 0, y: 3, z: 0 }]).ok, true);
});

check("saved position overlapping the new volume is repaired nearby", () => {
  const blocks = flat((put) => { for (let y = 1; y <= 2; y++) put(0, y, 0); });
  const spawn = resolvePlayerPosition({ blocks }, { x: 0.5, y: 1, z: 0.5 });
  assert.equal(spawn.moved, true);
  assert.match(spawn.reason, /重叠|落地|附近/);
  assert.ok(!collides({ blocks }, spawn.position, 1.65));
  assert.ok(Math.hypot(spawn.position.x - 0.5, spawn.position.z - 0.5) <= 7);
});

check("saved position floating in the air settles onto the floor", () => {
  const blocks = flat();
  const spawn = resolvePlayerPosition({ blocks }, { x: 0.5, y: 7, z: 0.5 });
  assert.equal(spawn.moved, true);
  assert.equal(spawn.position.y, 1);
});

check("saved position outside the world is moved inside", () => {
  const blocks = flat();
  const spawn = resolvePlayerPosition({ blocks }, { x: 500, y: 1, z: 500 });
  assert.ok(Math.abs(spawn.position.x) < 16 && Math.abs(spawn.position.z) < 16);
  assert.match(spawn.reason, /边界|附近/);
});

check("a sealed saved position is lifted onto a nearby roof", () => {
  const blocks = flat((put) => {
    // The saved cell and all eight neighbours are capped by a roof.
    for (let x = -1; x <= 1; x++)
      for (let z = -1; z <= 1; z++) put(x, 1, z);
  });
  const spawn = resolvePlayerPosition({ blocks }, { x: 0.5, y: 1, z: 0.5 });
  assert.ok(spawn.moved);
  assert.ok(Math.hypot(spawn.position.x - 0.5, spawn.position.z - 0.5) <= 2);
  assert.equal(supportBelow({ blocks }, spawn.position) !== null, true);
  assert.equal(collides({ blocks }, spawn.position, 1.65), false);
});

check("stepping up under a low ceiling is refused rather than clipping", () => {
  const s = workspace(
    flat((put) => {
      for (let z = -3; z <= 3; z++) put(2, 1, z); // step
      for (let x = -1; x <= 4; x++) for (let z = -3; z <= 3; z++) put(x, 3, z); // low roof
    }),
    { x: 0.5, y: 1, z: 0.5 },
  );
  const m: Motion = { vertical: 0, grounded: true };
  frames(s, m, keysOf("KeyD", "KeyC"), 120);
  assert.equal(collides(s.doc, s.doc.player, 0.9), false);
});

check("jumping into a ceiling stops the rise without clipping", () => {
  const s = workspace(flat((put) => { for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) put(x, 4, z); }), { x: 0.5, y: 1, z: 0.5 });
  const m: Motion = { vertical: 0, grounded: true };
  let maxY = 1;
  for (let i = 0; i < 120; i++) {
    stepPlayer(s, keysOf("Space"), m, 1 / 60);
    maxY = Math.max(maxY, s.doc.player.y);
    assert.equal(collides(s.doc, s.doc.player, 1.65), false);
  }
  assert.ok(maxY <= 4 - 1.65 + 1e-6, `head passed through the ceiling, maxY=${maxY}`);
});

check("the default world loads without moving the player", () => {
  const doc = createWorld();
  const spawn = resolvePlayerPosition(doc, doc.player);
  assert.equal(spawn.moved, false, spawn.reason);
});

check("a low doorway needs a crouch and then releases it", () => {
  const s = workspace(
    flat((put) => {
      // A one block high tunnel along x: roof at y=2 across z=-1..1, with
      // walls either side, leaving only the z=0 lane open at body height.
      for (let x = 1; x <= 6; x++) {
        for (let z = -1; z <= 1; z++) put(x, 2, z);
        put(x, 1, -1);
        put(x, 1, 1);
      }
    }),
    { x: 0.5, y: 1, z: 0.5 },
  );
  const m: Motion = { vertical: 0, grounded: true };
  frames(s, m, keysOf("KeyD"), 90);
  assert.ok(s.doc.player.x < 1.8, "walking upright must be blocked by the doorway");
  frames(s, m, keysOf("KeyD", "KeyC"), 240);
  assert.ok(s.doc.player.x > 5, `crouching should pass, x=${s.doc.player.x}`);
  assert.equal(collides(s.doc, s.doc.player, 0.9), false);
  assert.equal(s.stance, "crouch", "still under the tunnel roof");
});

check("loading an old save repairs the position but keeps the world", () => {
  const s = workspace(flat(), { x: 0.5, y: 1, z: 0.5 });
  const old = {
    version: 1 as const,
    name: "旧存档",
    blocks: flat((put) => {
      for (let y = 1; y <= 2; y++) put(0, y, 0); // saved point now buried
    }),
    inventory: s.doc.inventory,
    player: { x: 0.5, y: 1, z: 0.5 },
    revision: 4,
  };
  const blockCount = Object.keys(old.blocks).length;
  installWorld(s, old);
  assert.equal(s.doc.name, "旧存档", "the loaded world must be installed");
  assert.equal(Object.keys(s.doc.blocks).length, blockCount, "no world reset");
  assert.ok(!collides(s.doc, s.doc.player, 1.65), "repaired position is clear");
  assert.match(s.message, /世界已载入；/, "the reason is shown to the player");
  assert.equal(s.mode, "build");
});

console.log(`\n${passed} checks passed`);

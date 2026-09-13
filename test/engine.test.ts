/**
 * Engine tests. No framework — just assertions, run with `npm test`.
 *
 * The physics here is load-bearing for the generator, so these check the actual
 * reflection tables against the thesis rules rather than just "it did something".
 */
import { Chan, Dir, Level, Tile, WHITE, idx } from "../src/engine/types";
import { simulate, evaluate } from "../src/engine/simulate";
import { solve } from "../src/engine/solver";
import { generateLevel, generateCampaignLevel, campaignDifficulty } from "../src/engine/generate";

let passed = 0;
let failed = 0;
const fails: string[] = [];

function ok(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; }
  else { failed++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

/** Build a blank w*h level with a moon firing down column `col`. */
function board(w: number, h: number, col = 0, light = WHITE): Level {
  return {
    id: "t", name: "t", w, h,
    tiles: Array.from({ length: w * h }, () => ({ kind: "empty" } as Tile)),
    emitters: [{ x: col, y: 0, dir: Dir.Down, light }],
    inventory: [],
  };
}
const put = (l: Level, x: number, y: number, t: Tile) => { l.tiles[idx(l, x, y)] = t; };

// ---------------------------------------------------------------- physics

{
  // Straight through an empty column, and out the bottom.
  const l = board(5, 5, 2);
  const r = simulate(l);
  eq("empty grid: beam crosses every row", r.segments.length, 5);
  ok("empty grid: nothing satisfied", r.satisfied.size === 0);
}

{
  // Thesis: mirror1 ("\", NW-SE) sends a beam from above to the right.
  const l = board(5, 5, 1);
  put(l, 1, 2, { kind: "mirrorB" });
  put(l, 4, 2, { kind: "receptor", mask: WHITE });
  const r = simulate(l);
  ok("mirrorB turns Down -> Right", r.satisfied.size === 1);
}

{
  // Thesis: mirror2 ("/", SW-NE) sends a beam from above to the left.
  const l = board(5, 5, 3);
  put(l, 3, 2, { kind: "mirrorA" });
  put(l, 0, 2, { kind: "receptor", mask: WHITE });
  const r = simulate(l);
  ok("mirrorA turns Down -> Left", r.satisfied.size === 1);
}

{
  // Mirrors are reversible — the same tile that bends light in also bends it
  // back out — so a ring of mirrors fed from outside always leaks. This is a
  // real property of the physics, and worth pinning down.
  const l = board(5, 5, 1);
  put(l, 1, 1, { kind: "mirrorB" }); // Down -> Right, and Up -> Left back out
  put(l, 3, 1, { kind: "mirrorB" });
  put(l, 3, 3, { kind: "mirrorA" });
  put(l, 1, 3, { kind: "mirrorB" });
  const r = simulate(l);
  ok("a mirror ring leaks rather than trapping light", !r.exhausted);
}

{
  // A splitter is *not* reversible — it discards the straight-through
  // direction — so it can trap light. The visited set must stop it.
  const l = board(5, 5, 1);
  put(l, 1, 1, { kind: "splitter" });
  put(l, 3, 1, { kind: "mirrorB" });
  put(l, 3, 3, { kind: "mirrorA" });
  put(l, 1, 3, { kind: "mirrorB" });
  const r = simulate(l);
  ok("splitter loop is detected and terminated", r.exhausted, `segments=${r.segments.length}`);
  ok("splitter loop does not run away", r.segments.length < 60, `segments=${r.segments.length}`);
}

{
  // Diamond splits sideways, never straight on.
  const l = board(5, 5, 2);
  put(l, 2, 2, { kind: "splitter" });
  put(l, 0, 2, { kind: "receptor", mask: WHITE });
  put(l, 4, 2, { kind: "receptor", mask: WHITE });
  const r = simulate(l);
  eq("splitter satisfies both sides", r.satisfied.size, 2);
  ok("splitter emits nothing downward", ![...r.segments].some((s) => s.y0 === 2 && s.y1 === 3));
}

{
  // Prism separates white into three channels on three sides.
  const l = board(5, 5, 2);
  put(l, 2, 2, { kind: "prism" });
  put(l, 4, 2, { kind: "receptor", mask: Chan.R });
  put(l, 2, 4, { kind: "receptor", mask: Chan.G });
  put(l, 0, 2, { kind: "receptor", mask: Chan.B });
  const r = simulate(l);
  eq("prism separates R/G/B on three sides", r.satisfied.size, 3);
}

{
  // A coloured beam passes a prism untouched (thesis rule).
  const l = board(5, 5, 2, Chan.R);
  put(l, 2, 2, { kind: "prism" });
  put(l, 2, 4, { kind: "receptor", mask: Chan.R });
  ok("prism ignores already-separated light", simulate(l).satisfied.size === 1);
}

{
  // Filters subtract. White through a red filter is red.
  const l = board(5, 5, 2);
  put(l, 2, 2, { kind: "filter", mask: Chan.R });
  put(l, 2, 4, { kind: "receptor", mask: Chan.R });
  ok("filter subtracts to red", simulate(l).satisfied.size === 1);
}

{
  // ...and a filter that passes nothing kills the beam.
  const l = board(5, 5, 2, Chan.R);
  put(l, 2, 2, { kind: "filter", mask: Chan.B });
  put(l, 2, 4, { kind: "receptor", mask: Chan.R });
  const r = simulate(l);
  ok("incompatible filter absorbs the beam", r.satisfied.size === 0);
}

{
  // Receptors match exactly, so over-lighting fails.
  const l = board(5, 5, 2);
  put(l, 2, 4, { kind: "receptor", mask: Chan.R });
  ok("white does not satisfy a red receptor", simulate(l).satisfied.size === 0);
}

{
  // Two beams combining additively *do* satisfy a compound receptor.
  // Prism at (2,1); red goes right, blue goes left; mirrors fold both down
  // into a single yellow... (R|B = magenta) receptor at the bottom.
  const l = board(5, 5, 2);
  put(l, 2, 1, { kind: "prism" });
  put(l, 4, 1, { kind: "mirrorA" });   // red travelling Right -> Up? check below
  const r = simulate(l);
  ok("prism produces three distinct colours", new Set(r.segments.map((s) => s.light)).size >= 3);
}

{
  // Walls absorb.
  const l = board(5, 5, 2);
  put(l, 2, 2, { kind: "wall" });
  put(l, 2, 4, { kind: "receptor", mask: WHITE });
  ok("wall absorbs the beam", simulate(l).satisfied.size === 0);
}

{
  // Stars are transparent and get banked.
  const l = board(5, 5, 2);
  put(l, 2, 2, { kind: "star" });
  put(l, 2, 4, { kind: "receptor", mask: WHITE });
  const out = evaluate(l);
  ok("star is transparent and collected", out.won && out.starsLit.size === 1);
}

{
  // Portals teleport, preserving direction.
  const l = board(5, 5, 0);
  put(l, 0, 1, { kind: "portal", pair: 1 });
  put(l, 4, 1, { kind: "portal", pair: 1 });
  put(l, 4, 4, { kind: "receptor", mask: WHITE });
  ok("portal preserves direction", simulate(l).satisfied.size === 1);
}

{
  // A moving wall changes the outcome tick to tick.
  const l = board(5, 5, 2);
  put(l, 2, 4, { kind: "receptor", mask: WHITE });
  put(l, 2, 2, { kind: "wall", track: [{ x: 2, y: 2 }, { x: 3, y: 2 }], phase: 0 });
  const t0 = simulate(l, 0).satisfied.size;
  const t1 = simulate(l, 1).satisfied.size;
  ok("moving wall blocks on one tick and not the other", t0 !== t1, `t0=${t0} t1=${t1}`);
  ok("evaluate() finds the open tick", evaluate(l).won);
}

// ---------------------------------------------------------------- solver

{
  // One mirror, one place it can go.
  const l = board(5, 5, 1);
  put(l, 4, 3, { kind: "receptor", mask: WHITE });
  l.inventory = [{ kind: "mirrorB", count: 1 }];
  const res = solve(l);
  ok("solver finds the single mirror placement", res.solved);
  eq("solver reports par 1", res.minPieces, 1);
  eq("solver puts it at (1,3)", res.solution[0]?.i, idx(l, 1, 3));
}

{
  // Unsolvable: no piece can reach a receptor walled off from the light.
  const l = board(5, 5, 1);
  put(l, 4, 3, { kind: "receptor", mask: WHITE });
  put(l, 1, 1, { kind: "wall" });
  l.inventory = [{ kind: "mirrorB", count: 1 }];
  const res = solve(l);
  ok("solver rejects a walled-off receptor", !res.solved && !res.truncated);
}

{
  // The solver must respect inventory counts.
  //
  // On an open board a single mirror reaches almost anywhere — put it in the
  // emitter's column at the target's row and the beam runs straight to it — so
  // forcing a two-mirror solution needs a wall blocking that one-turn route.
  const l = board(7, 7, 1);
  put(l, 5, 5, { kind: "receptor", mask: WHITE });
  put(l, 1, 5, { kind: "wall" }); // kills the single-turn answer
  l.inventory = [{ kind: "mirrorB", count: 1 }];
  ok("one mirror cannot make two turns", !solve(l).solved);
  l.inventory = [{ kind: "mirrorB", count: 2 }];
  const two = solve(l);
  ok("two mirrors can", two.solved);
  eq("and par is 2", two.minPieces, 2);
}

// ---------------------------------------------------------------- generator

{
  // Determinism: a seed is a level.
  const a = generateLevel(12345, { difficulty: 5 });
  const b = generateLevel(12345, { difficulty: 5 });
  eq("generation is deterministic per seed",
     JSON.stringify(a.level.tiles) + JSON.stringify(a.level.inventory),
     JSON.stringify(b.level.tiles) + JSON.stringify(b.level.inventory));
}

{
  // Every generated level must be solvable, across the whole difficulty range.
  //
  // The strong check is the stored solution: lay `level.solution` onto the
  // board and the level must win outright. That verifies the generator's own
  // claim exactly, rather than asking the solver to rediscover it — which at
  // high difficulty is precisely the expensive thing the design avoids.
  let badSolution = 0, noSolution = 0, checked = 0, totalMs = 0;
  const buckets: Record<number, number[]> = {};
  const pars: Record<number, number[]> = {};

  for (let d = 1; d <= 10; d++) {
    for (let s = 0; s < 15; s++) {
      const t0 = performance.now();
      const g = generateLevel(s * 7919 + d * 104729, { difficulty: d });
      totalMs += performance.now() - t0;
      checked++;

      const sol = g.level.solution;
      if (!sol || sol.length === 0) { noSolution++; continue; }

      const board: Level = { ...g.level, tiles: g.level.tiles.map((t) => ({ ...t })), inventory: [] };
      for (const p of sol) board.tiles[p.i] = { kind: p.kind, mask: p.mask };
      if (!evaluate(board).won) badSolution++;

      (buckets[d] ??= []).push(g.level.difficulty ?? 0);
      (pars[d] ??= []).push(g.level.par ?? 0);
    }
  }
  ok("every generated level ships a solution", noSolution === 0, `${noSolution}/${checked} without one`);
  ok("every shipped solution actually wins", badSolution === 0, `${badSolution}/${checked} invalid`);

  console.log(`\n  generated ${checked} levels in ${totalMs.toFixed(0)}ms ` +
              `(${(totalMs / checked).toFixed(0)}ms each)`);
  console.log("  target -> scored difficulty (mean), par:");
  let drift = 0;
  for (let d = 1; d <= 10; d++) {
    const xs = buckets[d] ?? [];
    if (!xs.length) continue;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const par = (pars[d] ?? []).reduce((a, b) => a + b, 0) / (pars[d] ?? [1]).length;
    const err = Math.abs(mean - d);
    if (err >= 1.8) drift++;
    console.log(`    ${String(d).padStart(2)} -> ${mean.toFixed(2)}  par ${par.toFixed(1)}  ${err < 1.8 ? "ok" : "DRIFT"}`);
  }
  ok("difficulty targeting tracks the request", drift <= 1, `${drift} bands drifted`);

  // And the solver must independently rediscover a solution on easy levels,
  // where doing so is cheap. This is what proves the two halves agree.
  let unsolved = 0;
  for (let d = 1; d <= 4; d++) {
    for (let s = 0; s < 5; s++) {
      const g = generateLevel(s * 313 + d * 7717, { difficulty: d });
      if (!solve(g.level, { firstOnly: true, nodeBudget: 60_000 }).solved) unsolved++;
    }
  }
  ok("solver independently solves easy generated levels", unsolved === 0, `${unsolved}/20 unsolved`);
}

{
  // Portals must always come in pairs. They were once losing a twin: the walk
  // could drop a portal on top of a piece it had already placed, and excavation
  // then cleared that cell believing it was lifting the piece.
  let odd = 0, withPortals = 0;
  for (const d of [8, 9, 10]) {
    for (let s = 0; s < 10; s++) {
      const g = generateLevel(s * 6151 + d * 911, { difficulty: d });
      const n = g.level.tiles.filter((t) => t.kind === "portal").length;
      if (n) withPortals++;
      if (n % 2 !== 0) odd++;
    }
  }
  ok("portals are always paired", odd === 0, `${odd} levels with an odd count`);
  ok("portals actually appear at high difficulty", withPortals > 0, `${withPortals}/30`);
}

{
  // Generated levels must have a real goal and a real tray.
  let noReceptor = 0, emptyTray = 0;
  for (let s = 0; s < 30; s++) {
    const g = generateLevel(s * 31337, { difficulty: 6 });
    if (!g.level.tiles.some((t) => t.kind === "receptor")) noReceptor++;
    if (g.level.inventory.reduce((a, b) => a + b.count, 0) === 0) emptyTray++;
  }
  ok("generated levels always have a receptor", noReceptor === 0);
  ok("generated levels always have pieces to place", emptyTray === 0);
}

{
  // The campaign ramp should be monotonic-ish and bounded.
  const ds = [1, 2, 3, 5, 10, 20, 50, 100].map(campaignDifficulty);
  ok("campaign difficulty is bounded 1..10", ds.every((d) => d >= 1 && d <= 10));
  ok("campaign difficulty rises overall", ds[7] > ds[0] + 3, ds.map((d) => d.toFixed(1)).join(" "));
  // Late campaign levels are deliberately beyond a quick blind search, so they
  // are verified against their shipped solution rather than by re-solving.
  for (const n of [5, 15, 40]) {
    const c = generateCampaignLevel(n);
    const b: Level = { ...c.level, tiles: c.level.tiles.map((t) => ({ ...t })), inventory: [] };
    for (const p of c.level.solution ?? []) b.tiles[p.i] = { kind: p.kind, mask: p.mask };
    ok(`campaign level ${n} is solvable`, (c.level.solution?.length ?? 0) > 0 && evaluate(b).won);
  }
}

// ---------------------------------------------------------------- report

console.log(`\n  ${passed} passed, ${failed} failed`);
if (fails.length) {
  console.log("\n  failures:");
  for (const f of fails) console.log(`    x ${f}`);
  process.exit(1);
}

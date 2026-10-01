/**
 * Shooting stars, rough terrain, and the campaign's planet phases.
 */
import { Dir, Level, Tile, WHITE, idx, tileFrom } from "../src/engine/types";
import { evaluate, simulate } from "../src/engine/simulate";
import { solve } from "../src/engine/solver";
import { contains, generateCampaignLevel } from "../src/engine/generate";
import { Feature, PHASES, nightDifficulty, phaseFor } from "../src/engine/phases";

let passed = 0;
let failed = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else { failed++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); }
}

function board(w: number, h: number, col: number): Level {
  return {
    id: "t", name: "t", w, h,
    tiles: Array.from({ length: w * h }, () => ({ kind: "empty" } as Tile)),
    emitters: [{ x: col, y: 0, dir: Dir.Down, light: WHITE }],
    inventory: [],
  };
}
const put = (l: Level, x: number, y: number, t: Tile) => { l.tiles[idx(l, x, y)] = t; };

// ---------------------------------------------------------------- shooting stars

{
  // Straight down a column through three pieces in order: all collected.
  const l = board(3, 6, 1);
  put(l, 1, 1, { kind: "comet", seq: 0 });
  put(l, 1, 2, { kind: "comet", seq: 1 });
  put(l, 1, 4, { kind: "comet", seq: 2 });
  put(l, 1, 5, { kind: "receptor", mask: WHITE });
  const r = simulate(l);
  ok("a shooting star crossed in order is collected", r.cometHits.length === 3 && r.cometTotal === 3);
  ok("pieces are collected in sequence", r.cometHits.map((h) => h.i).join() ===
     [idx(l, 1, 1), idx(l, 1, 2), idx(l, 1, 4)].join());
  ok("and the level is won", evaluate(l).won);
}

{
  // The same pieces with the sequence reversed: the light reaches piece 2
  // first, while it is not yet active, so the chain stops at the first piece.
  const l = board(3, 6, 1);
  put(l, 1, 1, { kind: "comet", seq: 2 });
  put(l, 1, 2, { kind: "comet", seq: 1 });
  put(l, 1, 4, { kind: "comet", seq: 0 });
  put(l, 1, 5, { kind: "receptor", mask: WHITE });
  const r = simulate(l);
  ok("light reaching a piece before its turn does not count", r.cometHits.length === 1, `${r.cometHits.length}`);
  ok("an unfinished shooting star means the night is not solved", !evaluate(l).won);
}

{
  // Light can come back for a piece later: a splitter sends light both ways,
  // and the later arrival at the second piece is the one that counts.
  const l = board(5, 3, 2);
  put(l, 2, 1, { kind: "comet", seq: 0 });
  put(l, 2, 2, { kind: "receptor", mask: WHITE });
  const r = simulate(l);
  ok("a single-piece shooting star works", r.cometHits.length === 1 && r.cometTotal === 1);
}

// ---------------------------------------------------------------- terrain

{
  const l = board(5, 5, 2);
  put(l, 2, 2, { kind: "terrain" });
  put(l, 2, 4, { kind: "receptor", mask: WHITE });
  ok("light crosses rough ground", simulate(l).satisfied.size === 1);
}

{
  // The one place a mirror could solve this is rough ground: unsolvable.
  const l = board(5, 5, 1);
  put(l, 4, 3, { kind: "receptor", mask: WHITE });
  put(l, 1, 3, { kind: "terrain" });
  l.inventory = [{ kind: "mirrorB", count: 1 }];
  ok("nothing can be built on rough ground", !solve(l).solved);
}

// ---------------------------------------------------------------- phases

{
  ok("phases run Earth, Venus, Mercury, Mars, Jupiter … to the black hole",
     PHASES.map((p) => p.key).join() === "earth,venus,mercury,mars,jupiter,saturn,uranus,neptune,blackhole");
  ok("night 1 is Earth", phaseFor(1).phase.key === "earth");
  ok("night 11 is Venus", phaseFor(11).phase.key === "venus");
  ok("night 41 is Jupiter", phaseFor(41).phase.key === "jupiter");
  ok("the black hole goes on forever", phaseFor(500).phase.key === "blackhole");
  ok("difficulty stays in range", [1, 10, 11, 50, 90, 400].every((n) => {
    const d = nightDifficulty(n); return d >= 1 && d <= 10;
  }));
  ok("each phase starts easier than the last one ended",
     nightDifficulty(11) < nightDifficulty(10) && nightDifficulty(41) < nightDifficulty(40));
}

{
  // Each phase introduces its elements on the right nights, one per night.
  const intro: [number, Feature][] = [];
  for (const p of PHASES) p.introduces.forEach((f, k) => intro.push([p.first + k, f]));
  for (const [n, f] of intro) {
    const l = generateCampaignLevel(n).level;
    ok(`night ${n} introduces ${f}`, contains(l, f));
  }
}

{
  // Nothing turns up before its phase, and every night stays solvable.
  const firstAllowed: Partial<Record<Feature, number>> = {};
  for (const p of PHASES) {
    for (const [k, v] of Object.entries(p.features)) {
      if (v && firstAllowed[k as Feature] === undefined) firstAllowed[k as Feature] = p.first;
    }
  }
  let early = 0, invalid = 0;
  const report: string[] = [];
  const nights = [1, 2, 3, 5, 8, 10, 12, 15, 19, 22, 25, 29, 32, 35, 38, 42, 45, 48, 52, 55, 58, 63, 72, 85];
  for (const n of nights) {
    const l = generateCampaignLevel(n).level;
    for (const f of Object.keys(firstAllowed) as Feature[]) {
      if (contains(l, f) && n < (firstAllowed[f] ?? 0)) { early++; report.push(`${f}@${n}`); }
    }
    const b: Level = { ...l, tiles: l.tiles.map((t) => ({ ...t })), inventory: [] };
    for (const p of l.solution ?? []) b.tiles[p.i] = tileFrom(p);
    if (!(l.solution?.length) || !evaluate(b).won) { invalid++; report.push(`invalid@${n}`); }
  }
  ok("no element appears before its phase", early === 0, report.join(" "));
  ok("every sampled campaign night is solvable", invalid === 0, report.join(" "));
}

{
  // Earth's opening nights are just mirrors and rings.
  let fancy = 0;
  for (const n of [1, 2, 3]) {
    const l = generateCampaignLevel(n).level;
    if (l.inventory.some((it) => it.kind !== "mirrorA" && it.kind !== "mirrorB")) fancy++;
  }
  ok("the first nights use only mirrors", fancy === 0, `${fancy}`);
}

console.log(`\n  phases: ${passed} passed, ${failed} failed`);
if (fails.length) {
  console.log("\n  failures:");
  for (const f of fails) console.log(`    x ${f}`);
  process.exit(1);
}

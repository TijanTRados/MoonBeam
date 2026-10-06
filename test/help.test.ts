/**
 * Getting unstuck: hints in two steps, counting misses, and what a hint costs.
 */
import { tileFrom } from "../src/engine/types";
import { generateCampaignLevel } from "../src/engine/generate";
import { Game } from "../src/game/state";
import { earned } from "../src/game/stardust";
import { constellationOf, medalCount, medalsFor, newMedals } from "../src/game/medals";

let passed = 0;
let failed = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else { failed++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); }
}

function play(g: Game) {
  g.start();
  for (let k = 0; k < 2000 && g.phase === "running"; k++) g.advance(1 / 60);
}

const gen = generateCampaignLevel(9);
const sol = gen.level.solution!;

{
  const g = new Game(gen.level);
  ok("a hint first says where", g.takeHint() === "where" && g.hint.has(sol[0].i));
  ok("…then what", g.takeHint() === "what" && g.openGhosts.get(sol[0].i)?.kind === sol[0].kind);
  ok("the ghost is exactly the right piece", JSON.stringify(g.openGhosts.get(sol[0].i)) === JSON.stringify(tileFrom(sol[0])));

  // Lay the first piece correctly: the next hint moves on to the next piece.
  g.board[sol[0].i] = tileFrom(sol[0], true);
  ok("a hint on a solved cell stops showing", !g.openHints.has(sol[0].i) && !g.openGhosts.has(sol[0].i));
  if (sol.length > 1) ok("the next hint follows the light to the next piece", g.takeHint() === "where" && g.hint.has(sol[1].i));

  g.reset();
  ok("Clear keeps the hints", g.hint.has(sol[0].i));
  ok("hints mark the solve as assisted", g.score().assisted && !g.score().firstTry);
}

{
  // With everything right there is nothing to hint.
  const g = new Game(gen.level);
  for (const p of sol) g.board[p.i] = tileFrom(p, true);
  ok("no hint when the board is already right", g.takeHint() === "none" && g.hintsUsed === 0);
}

{
  // Misses: only unsolved Shines count.
  const g = new Game(gen.level);
  play(g);
  play(g);
  ok("each failed Shine is a miss", g.misses === 2, `${g.misses}`);
  for (const p of sol) {
    g.board[p.i] = tileFrom(p, true);
    const slot = g.slotFor(p.kind, p.mask, p.from);
    if (slot) slot.used++;
  }
  play(g);
  ok("a solve is not a miss", g.phase === "won" && g.misses === 2, `${g.phase} ${g.misses}`);
  ok("a solve with no hints is not assisted", !g.score().assisted);

  g.load(gen.level);
  ok("a fresh level starts with no misses or hints", g.misses === 0 && g.hint.size === 0 && g.hintsUsed === 0);
}

// ---------------------------------------------------------------- boosters

{
  // Find a night with decoys in the tray, to exercise sweeping.
  let g: Game | null = null;
  for (let n = 1; n < 60; n++) {
    const cand = new Game(generateCampaignLevel(n).level);
    if (cand.decoys > 0 && (cand.level.solution?.length ?? 0) >= 2) { g = cand; break; }
  }
  ok("some night has decoys to sweep", !!g);
  if (g) {
    const s = g.level.solution!;
    // Put the first solution piece somewhere wrong first.
    const wrongCell = g.board.findIndex((t, i) => t.kind === "empty" && !s.some((p) => p.i === i) && !g!.noBuild.has(i));
    g.selected = g.tray.findIndex((t) => t.key === g!.slotFor(s[0].kind, s[0].mask, s[0].from)?.key);
    g.tap(wrongCell);
    const at = g.placeNext();
    ok("place-a-piece puts the next right piece down",
       at === s[0].i && JSON.stringify(g.board[at]) === JSON.stringify(tileFrom(s[0], true)));
    ok("…and marks the solve assisted", g.score().assisted && g.boostersUsed === 1);

    const before = g.decoys;
    ok("sweeping reports what it took", g.sweepDecoys() === before && g.decoys === 0);
    ok("…and leaves exactly what the solution needs", g.tray.reduce((n2, t) => n2 + t.total, 0) === s.length);
    while (g.nextPiece) if (g.placeNext() < 0) break;
    play(g);
    ok("after boosters the night still solves", g.phase === "won", g.phase);
  }
}

{
  // Perfect timing: with an asteroid in the way some moments fail, and the
  // booster finds one that works.
  let found = false;
  for (let n = 41; n < 70 && !found; n++) {
    const l = generateCampaignLevel(n).level;
    if (!l.tiles.some((t) => t.kind === "asteroid")) continue;
    const g = new Game(l);
    for (const p of l.solution!) {
      g.board[p.i] = tileFrom(p, true);
      const sl = g.slotFor(p.kind, p.mask, p.from);
      if (sl) sl.used++;
    }
    const t = g.nextWinningTick();
    if (t === null) continue;
    found = true;
    g.clock = t;
    play(g);
    ok("the winning moment it finds really wins", g.phase === "won", `night ${n} tick ${t}`);
  }
  ok("an asteroid night exists to test timing on", found);
}

ok("only a first solve earns stardust", earned({ first: false, points: 900, daily: true, streak: 9 }) === 0);
ok("a first solve earns some", earned({ first: true, points: 240, daily: false, streak: 0 }) === 5);
ok("the daily earns more with a streak, capped at a week",
   earned({ first: true, points: 0, daily: true, streak: 3 }) === 8 &&
   earned({ first: true, points: 0, daily: true, streak: 30 }) === earned({ first: true, points: 0, daily: true, streak: 7 }));

// ---------------------------------------------------------------- medals

ok("no medals for an unsolved night", medalsFor({ solved: false, used: 1, par: 1, firstTry: true }) === 0);
ok("all three for a clean, fewest solve", medalsFor({ solved: true, used: 2, par: 2, firstTry: true }) === 7);
ok("an extra piece misses the fewest medal", medalsFor({ solved: true, used: 3, par: 2, firstTry: true }) === 5);
ok("beating the fewest we found still counts", (medalsFor({ solved: true, used: 1, par: 2, firstTry: false }) & 2) === 2);
ok("new medals are only the ones not had before", newMedals(1, 7).map((m) => m.name).join() === "Fewest,Clean");
ok("medals are counted", medalCount(5) === 2 && medalCount(7) === 3);

{
  const l = generateCampaignLevel(9).level;
  const c = constellationOf(l);
  const goals = l.tiles.filter((t) => t.kind === "receptor" || t.kind === "star" || t.kind === "comet").length;
  const entry = l.emitters[0].y * l.w + l.emitters[0].x;
  const want = new Set([...l.tiles.flatMap((t, i) => (t.kind === "receptor" || t.kind === "star" || t.kind === "comet" ? [i] : [])),
    ...l.solution!.map((p) => p.i), entry]);
  ok("a rebuilt constellation runs from the moon through every piece and goal",
     c.pts[0] === entry && c.pts.length === want.size && goals > 0);
  ok("…on the right board", c.w === l.w && c.h === l.h);
}

console.log(`\n  help: ${passed} passed, ${failed} failed`);
if (fails.length) {
  console.log("\n  failures:");
  for (const f of fails) console.log(`    x ${f}`);
  process.exit(1);
}

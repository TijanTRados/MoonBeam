/**
 * Getting unstuck: hints in two steps, counting misses, and what a hint costs.
 */
import { tileFrom } from "../src/engine/types";
import { generateCampaignLevel } from "../src/engine/generate";
import { Game } from "../src/game/state";

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

console.log(`\n  help: ${passed} passed, ${failed} failed`);
if (fails.length) {
  console.log("\n  failures:");
  for (const f of fails) console.log(`    x ${f}`);
  process.exit(1);
}

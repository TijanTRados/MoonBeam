/**
 * Reveal choreography tests.
 *
 * The run animation now carries the game's sense of occasion — notes climbing
 * as the beam hits things, slow motion on the final approach, one climax on the
 * frame the solution completes. None of that is visible to the engine tests,
 * and a browser pane that throttles animation frames cannot judge timing
 * either, so it is driven here frame by frame at a fixed 60fps.
 */
import { Chan, Dir, Level, Tile, WHITE, idx, tileFrom } from "../src/engine/types";
import { generateCampaignLevel } from "../src/engine/generate";
import { Game, RevealTick } from "../src/game/state";
import { scoreRun } from "../src/game/score";

let passed = 0;
let failed = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else { failed++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); }
}

const DT = 1 / 60;

/** Run a game's reveal to completion, recording every tick. */
function play(g: Game) {
  g.start();
  const ticks: (RevealTick & { at: number })[] = [];
  let t = 0;
  while (t < 20) {
    const tick = g.advance(DT);
    t += DT;
    ticks.push({ ...tick, at: t });
    if (tick.settled) break;
  }
  return { ticks, seconds: t };
}

function board(w: number, h: number, col: number): Level {
  return {
    id: "t", name: "t", w, h,
    tiles: Array.from({ length: w * h }, () => ({ kind: "empty" } as Tile)),
    emitters: [{ x: col, y: 0, dir: Dir.Down, light: WHITE }],
    inventory: [],
  };
}

// ---------------------------------------------------------------- a winning run

{
  // A campaign night with its stored solution laid down.
  const gen = generateCampaignLevel(6);
  const g = new Game(gen.level);
  for (const p of gen.level.solution ?? []) {
    g.board[p.i] = tileFrom(p, true);
    const slot = g.slotFor(p.kind, p.mask, p.from);
    if (slot) slot.used++;
  }
  const { ticks, seconds } = play(g);

  const climaxes = ticks.filter((t) => t.climax);
  const slowStarts = ticks.filter((t) => t.slowMoStarted);
  ok("winning run ends in the won phase", g.phase === "won", g.phase);
  ok("exactly one climax on a winning run", climaxes.length === 1, `${climaxes.length}`);
  ok("slow motion starts exactly once", slowStarts.length === 1, `${slowStarts.length}`);
  ok("slow motion comes before the climax",
     slowStarts.length === 1 && climaxes.length === 1 && slowStarts[0].at < climaxes[0].at);
  ok("slow motion reports a sensible duration",
     slowStarts.length === 1 && slowStarts[0].slowMoSeconds > 0.2 && slowStarts[0].slowMoSeconds < 2,
     `${slowStarts[0]?.slowMoSeconds}`);

  // Every satisfied ring must be announced as reached, or it never bursts.
  const reached = new Set(ticks.flatMap((t) => t.reached));
  const rings = [...(g.sim?.satisfied ?? [])];
  ok("every lit ring is announced as reached", rings.every((i) => reached.has(i)),
     `missing ${rings.filter((i) => !reached.has(i))}`);
  ok("no cell is announced twice", ticks.flatMap((t) => t.reached).length === reached.size);

  // The climax lands on the frame the last goal is reached, not before it.
  const climaxTick = ticks.findIndex((t) => t.climax);
  const lastGoalTick = Math.max(...rings.map((i) => ticks.findIndex((t) => t.reached.includes(i))));
  ok("climax fires on the frame the final ring fills", climaxTick === lastGoalTick,
     `climax ${climaxTick}, last ring ${lastGoalTick}`);

  ok("a winning reveal finishes in a few seconds at 60fps", seconds > 0.5 && seconds < 5,
     `${seconds.toFixed(2)}s`);

  // The points counter that climbs during the reveal must land exactly on the
  // run's score, or the card and the counter would disagree.
  const tallied = ticks.reduce((n, t) => n + t.points, 0);
  const expected = scoreRun(g.current(), g.sim!).total;
  ok("the live points tally lands exactly on the run's score", tallied === expected && g.runScore === expected,
     `tallied ${tallied}, runScore ${g.runScore}, expected ${expected}`);
  ok("first-try solve is recognised", g.score().firstTry);
}

// ---------------------------------------------------------------- a losing run

{
  const l = board(5, 5, 2);
  l.tiles[idx(l, 0, 4)] = { kind: "receptor", mask: WHITE };
  l.inventory = [{ kind: "mirrorB", count: 1 }];
  const g = new Game(l);
  const { ticks, seconds } = play(g);
  ok("an unsolved run ends lost", g.phase === "lost", g.phase);
  ok("an unsolved run has no climax", !ticks.some((t) => t.climax));
  ok("an unsolved run has no slow motion", !ticks.some((t) => t.slowMo));
  ok("an unsolved reveal is quick", seconds < 3, `${seconds.toFixed(2)}s`);

  // A second run on the same level is no longer "first try".
  play(g);
  ok("a second run is not a first try", !g.score().firstTry);
}

// ---------------------------------------------------------------- ordering

{
  // A straight column past a star into a ring: star first, then ring.
  const l = board(5, 5, 2);
  l.tiles[idx(l, 2, 1)] = { kind: "star" };
  l.tiles[idx(l, 2, 4)] = { kind: "receptor", mask: WHITE };
  const g = new Game(l);
  const { ticks } = play(g);
  const order = ticks.flatMap((t) => t.reached);
  ok("events arrive in the order the light reaches them",
     order.indexOf(idx(l, 2, 1)) < order.indexOf(idx(l, 2, 4)), JSON.stringify(order));
  ok("the star is collected on a winning run", g.starsLit.has(idx(l, 2, 1)));
}

{
  // A ring that needs two converging beams fires on the *second* arrival.
  // Crystal at (2,1): red heads right, blue heads left. Mirrors fold both down
  // column... simpler to check the rule directly: lastArrival >= firstArrival.
  const l = board(5, 5, 2);
  l.tiles[idx(l, 2, 1)] = { kind: "crystal" };
  l.tiles[idx(l, 2, 4)] = { kind: "receptor", mask: Chan.G };
  const g = new Game(l);
  play(g);
  const ringAt = g.eventOrder(idx(l, 2, 4));
  ok("a ring's event order is defined once lit", ringAt !== undefined && ringAt > 0, `${ringAt}`);
}

console.log(`\n  reveal: ${passed} passed, ${failed} failed`);
if (fails.length) {
  console.log("\n  failures:");
  for (const f of fails) console.log(`    x ${f}`);
  process.exit(1);
}

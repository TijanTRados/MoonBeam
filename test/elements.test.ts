/**
 * Tests for warps, asteroids, satellites, galaxies, light speed and points.
 *
 * The interesting ones are about time. Light now takes time to cross the board,
 * so an asteroid that is out of the way when you fire can still be in the way
 * when the light arrives — and a satellite's delay can wait it out.
 */
import { Chan, Dir, Level, Tile, WHITE, idx } from "../src/engine/types";
import { HOPS_PER_TICK, evaluate, simulate } from "../src/engine/simulate";
import { POINTS, scoreRun, bonuses } from "../src/game/score";
import { generateLevel } from "../src/engine/generate";
import { tileFrom } from "../src/engine/types";

let passed = 0;
let failed = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else { failed++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); }
}

function board(w: number, h: number, col: number, light = WHITE): Level {
  return {
    id: "t", name: "t", w, h,
    tiles: Array.from({ length: w * h }, () => ({ kind: "empty" } as Tile)),
    emitters: [{ x: col, y: 0, dir: Dir.Down, light }],
    inventory: [],
  };
}
const put = (l: Level, x: number, y: number, t: Tile) => { l.tiles[idx(l, x, y)] = t; };

// ---------------------------------------------------------------- warps

{
  // A row warp: light leaving the left edge comes back in on the right.
  const l = board(5, 5, 0);
  put(l, 0, 1, { kind: "mirrorA" });                 // Down -> Left, off the board
  put(l, 3, 1, { kind: "receptor", mask: WHITE });
  ok("without a warp, light leaving the edge is gone", simulate(l).satisfied.size === 0);
  l.warps = [{ axis: "row", index: 1, hue: 0 }];
  const r = simulate(l);
  ok("a row warp carries light round to the far side", r.satisfied.size === 1);
  ok("the warp is drawn as a gate out and a gate in",
     r.segments.some((s) => s.gate === "out") && r.segments.some((s) => s.gate === "in"));
}

{
  // A column warp: out of the bottom, back in at the top.
  const l = board(5, 5, 0);
  put(l, 0, 1, { kind: "mirrorB" });                 // Down -> Right along row 1
  put(l, 3, 1, { kind: "mirrorB" });                 // Right -> Down, then off the bottom
  put(l, 4, 1, { kind: "receptor", mask: WHITE });
  ok("without the column warp the light falls off the bottom", simulate(l).satisfied.size === 0);
  l.warps = [{ axis: "col", index: 3, hue: 1 }];
  ok("a column warp brings it back in at the top, round to the ring", simulate(l).satisfied.size === 1);
}

{
  // A warp makes endless loops trivial to build — the simulation must stop.
  const l = board(5, 5, 2);
  l.warps = [{ axis: "col", index: 2, hue: 0 }];
  const r = simulate(l);
  ok("a warped empty column loops and is stopped", r.exhausted && r.segments.length < 40, `${r.segments.length}`);
}

{
  // Warps only join their own row: light leaving a different row is still lost.
  const l = board(5, 5, 0);
  put(l, 0, 2, { kind: "mirrorA" });
  put(l, 3, 2, { kind: "receptor", mask: WHITE });
  l.warps = [{ axis: "row", index: 1, hue: 0 }];
  ok("a warp on row 1 does nothing for row 2", simulate(l).satisfied.size === 0);
}

// ---------------------------------------------------------------- asteroids

{
  const l = board(5, 5, 2);
  put(l, 2, 4, { kind: "receptor", mask: WHITE });
  put(l, 2, 2, { kind: "asteroid", track: [{ x: 2, y: 2 }, { x: 3, y: 2 }], phase: 0 });
  const t0 = simulate(l, 0), t1 = simulate(l, 1);
  ok("an asteroid in the way breaks the beam", t0.satisfied.size === 0);
  ok("and the hit is recorded", t0.asteroidsHit.size === 1);
  ok("once it drifts off, the light gets through", t1.satisfied.size === 1 && t1.asteroidsHit.size === 0);
}

{
  // Light has a speed. This asteroid is out of the way at the moment of firing,
  // but by the time the light has travelled eight cells it has drifted in.
  const l = board(3, 12, 1);
  put(l, 1, 11, { kind: "receptor", mask: WHITE });
  put(l, 0, 8, { kind: "asteroid", track: [{ x: 0, y: 8 }, { x: 1, y: 8 }], phase: 0 });
  const fireNow = simulate(l, 0);
  const fireLater = simulate(l, 1);
  ok("light takes time: an asteroid that drifts in before the light arrives still blocks it",
     fireNow.satisfied.size === 0 && fireNow.asteroidsHit.size === 1,
     `hops/tick ${HOPS_PER_TICK}`);
  ok("fire a tick later and it has drifted out again by then", fireLater.satisfied.size === 1);
}

// ---------------------------------------------------------------- satellites

{
  const l = board(5, 3, 0);
  put(l, 0, 1, { kind: "satellite", pair: 1, delay: 1 });
  put(l, 4, 1, { kind: "dish", pair: 1 });
  put(l, 4, 2, { kind: "receptor", mask: WHITE });
  const r = simulate(l);
  ok("a satellite carries light to its dish", r.satisfied.size === 1);
  const carry = r.segments.find((s) => s.carry);
  ok("the carry takes as long as its delay", carry?.span === HOPS_PER_TICK, `${carry?.span}`);
  const after = r.segments.find((s) => s.x0 === 4 && s.y0 === 1 && !s.carry);
  ok("light leaves the dish later than a portal would let it",
     (after?.order ?? 0) >= 1 + HOPS_PER_TICK, `${after?.order}`);
}

{
  // The point of the delay: waiting out an asteroid.
  const make = (relay: "satellite" | "portal") => {
    const l = board(5, 6, 0);
    if (relay === "satellite") {
      put(l, 0, 1, { kind: "satellite", pair: 1, delay: 1 });
      put(l, 4, 1, { kind: "dish", pair: 1 });
    } else {
      put(l, 0, 1, { kind: "portal", pair: 1 });
      put(l, 4, 1, { kind: "portal", pair: 1 });
    }
    put(l, 4, 5, { kind: "receptor", mask: WHITE });
    put(l, 4, 3, { kind: "asteroid", track: [{ x: 4, y: 3 }, { x: 3, y: 3 }], phase: 0 });
    return simulate(l, 0);
  };
  ok("straight through a portal, the asteroid is still in the way", make("portal").satisfied.size === 0);
  ok("held by a satellite, the light arrives after it has passed", make("satellite").satisfied.size === 1);
}

{
  // A satellite with no dish swallows the light rather than passing it.
  const l = board(5, 5, 2);
  put(l, 2, 2, { kind: "satellite", pair: 9, delay: 1 });
  put(l, 2, 4, { kind: "receptor", mask: WHITE });
  ok("an unpaired satellite keeps its light", simulate(l).satisfied.size === 0);
}

// ---------------------------------------------------------------- one firing

{
  // Everything must happen in one firing now: the star one moment and the ring
  // another is not a solve, because the player can only fire once.
  const l = board(5, 5, 2);
  put(l, 3, 2, { kind: "star" });
  put(l, 2, 4, { kind: "receptor", mask: WHITE });
  put(l, 2, 2, { kind: "mirrorB", track: [{ x: 2, y: 2 }, { x: 1, y: 2 }], phase: 0 });
  const t0 = simulate(l, 0), t1 = simulate(l, 1);
  ok("setup: star only at one moment", t0.starsLit.size === 1 && t0.satisfied.size === 0);
  ok("setup: ring only at the other", t1.satisfied.size === 1 && t1.starsLit.size === 0);
  ok("a star now and a ring later does not count as solved", !evaluate(l).won);
}

// ---------------------------------------------------------------- points

{
  const l = board(5, 5, 2);
  put(l, 2, 4, { kind: "receptor", mask: WHITE });
  l.galaxy = [idx(l, 2, 1), idx(l, 2, 2)];
  const s = scoreRun(l, simulate(l));
  ok("galaxy cells pay more per hop", s.galaxyHops === 2 && s.hops === 2, JSON.stringify(s));
  ok("total adds hops, galaxy hops and the ring",
     s.total === 2 * POINTS.hop + 2 * POINTS.galaxyHop + POINTS.ring, `${s.total}`);
}

{
  const l = board(5, 5, 2);
  put(l, 2, 2, { kind: "asteroid" });
  const s = scoreRun(l, simulate(l));
  ok("hitting an asteroid costs points", s.asteroids === 1 && s.total < 0, JSON.stringify(s));
}

{
  ok("using the fewest pieces is rewarded",
     bonuses(5, 5, false).some((x) => x.label === "Fewest possible" && x.points === POINTS.fewest));
  ok("beating the fewest we found pays per piece",
     bonuses(3, 5, false).some((x) => x.points === 2 * POINTS.fewerThanFound));
  const over = bonuses(7, 5, false);
  ok("every extra piece costs points",
     over.length === 1 && over[0].points === 2 * POINTS.extraPiece && over[0].points < 0, JSON.stringify(over));
  ok("first try is a bonus", bonuses(5, 5, true).some((x) => x.label === "First try"));
}

{
  // Comets score per piece, plus a bonus for the whole thing.
  const l = board(3, 6, 1);
  put(l, 1, 1, { kind: "comet", seq: 0 });
  put(l, 1, 3, { kind: "comet", seq: 1 });
  put(l, 1, 5, { kind: "receptor", mask: WHITE });
  const s = scoreRun(l, simulate(l));
  ok("a caught shooting star scores per piece and for completion",
     s.comets === 2 && s.cometComplete &&
     s.total === 5 * POINTS.hop + POINTS.ring + 2 * POINTS.comet + POINTS.cometComplete, JSON.stringify(s));
}

// ---------------------------------------------------------------- the generator

{
  // New elements must turn up, and never at the cost of solvability.
  const seen = { warp: 0, asteroid: 0, satellite: 0, galaxy: 0 };
  let invalid = 0, checked = 0;
  for (const d of [4, 5, 6, 7, 8, 9, 10]) {
    for (let s = 0; s < 12; s++) {
      const g = generateLevel(s * 4099 + d * 373, { difficulty: d });
      const l = g.level;
      checked++;
      if (l.warps?.length) seen.warp++;
      if (l.galaxy?.length) seen.galaxy++;
      if (l.tiles.some((t) => t.kind === "asteroid")) seen.asteroid++;
      if (l.tiles.some((t) => t.kind === "satellite")) seen.satellite++;
      const b: Level = { ...l, tiles: l.tiles.map((t) => ({ ...t })), inventory: [] };
      for (const p of l.solution ?? []) b.tiles[p.i] = tileFrom(p);
      if (!(l.solution?.length) || !evaluate(b).won) invalid++;
      // Satellites must come with a dish, and warps must not sit on the moon's column.
      const sats = l.tiles.filter((t) => t.kind === "satellite").length;
      const dishes = l.tiles.filter((t) => t.kind === "dish").length;
      if (sats !== dishes) invalid++;
      if (l.warps?.some((w) => w.axis === "col" && w.index === l.emitters[0].x)) invalid++;
    }
  }
  ok("every generated level with new elements is still solvable", invalid === 0, `${invalid}/${checked}`);
  ok("warps appear", seen.warp > 0, JSON.stringify(seen));
  ok("galaxies appear", seen.galaxy > 0, JSON.stringify(seen));
  ok("asteroids appear", seen.asteroid > 0, JSON.stringify(seen));
  ok("satellites appear", seen.satellite > 0, JSON.stringify(seen));
  console.log(`\n  across ${checked} levels at difficulty 4-10: ${JSON.stringify(seen)}`);
}

{
  // Easy nights stay free of the timing mechanics.
  let timing = 0;
  for (let s = 0; s < 20; s++) {
    const l = generateLevel(s * 211, { difficulty: 2 }).level;
    if (l.tiles.some((t) => t.kind === "asteroid" || t.kind === "satellite")) timing++;
  }
  ok("no asteroids or satellites on easy nights", timing === 0, `${timing}`);
}

console.log(`\n  elements: ${passed} passed, ${failed} failed`);
if (fails.length) {
  console.log("\n  failures:");
  for (const f of fails) console.log(`    x ${f}`);
  process.exit(1);
}

void Chan;

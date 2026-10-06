/**
 * The Galaxy sandbox: placing anything, pairing things up by themselves, and
 * cycling a placed piece through its variants before it goes back.
 */
import { Chan, WHITE } from "../src/engine/types";
import { simulate } from "../src/engine/simulate";
import { Game } from "../src/game/state";
import { TOOLS, sandboxLevel, sandboxTap } from "../src/game/sandbox";

let passed = 0;
let failed = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else { failed++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); }
}

const tool = (key: string) => TOOLS.find((t) => t.key === key)!;
const at = (g: Game, x: number, y: number) => y * g.level.w + x;

// A blank Galaxy, so each test starts from nothing.
function blank(): Game {
  const l = sandboxLevel();
  l.tiles = l.tiles.map(() => ({ kind: "empty" as const }));
  l.galaxy = [];
  l.warps = [];
  const g = new Game(l);
  g.refresh();
  return g;
}

{
  const g = new Game(sandboxLevel());
  ok("the opening Galaxy simulates", simulate(g.current(), 0).segments.length > 0);
  ok("the opening Galaxy has something moving", g.moving && g.noBuild.size > 0);
  ok("every tool has a name", TOOLS.every((t) => t.name.length > 0));
}

{
  const g = blank();
  sandboxTap(g, at(g, 2, 2), tool("portal"));
  sandboxTap(g, at(g, 5, 5), tool("portal"));
  sandboxTap(g, at(g, 2, 5), tool("portal"));
  const ps = g.board.filter((t) => t.kind === "portal");
  ok("two portals pair up", ps[0].pair === ps[2].pair, JSON.stringify(ps.map((p) => p.pair)));
  ok("a third portal starts a new pair", ps[1].pair !== ps[0].pair);
}

{
  const g = blank();
  sandboxTap(g, at(g, 1, 2), tool("satellite"));
  sandboxTap(g, at(g, 6, 2), tool("dish"));
  const sat = g.board[at(g, 1, 2)], dish = g.board[at(g, 6, 2)];
  ok("satellite and dish pair up", sat.pair !== undefined && sat.pair === dish.pair);
  // Moon over column 1: the satellite should carry the light to its dish.
  const sim = simulate(g.current(), 0);
  ok("the paired satellite carries light", sim.segments.some((s) => s.carry));

  sandboxTap(g, at(g, 1, 2), tool("mirror"));
  ok("tapping a satellite lengthens its delay", g.board[at(g, 1, 2)].delay === 2);
  sandboxTap(g, at(g, 1, 2), tool("mirror"));
  sandboxTap(g, at(g, 1, 2), tool("mirror"));
  ok("…and eventually picks it up", g.board[at(g, 1, 2)].kind === "empty");
}

{
  const g = blank();
  sandboxTap(g, at(g, 1, 1), tool("comet"));
  sandboxTap(g, at(g, 1, 3), tool("comet"));
  sandboxTap(g, at(g, 1, 5), tool("comet"));
  ok("comet pieces number in placing order",
     [1, 3, 5].every((y, k) => g.board[at(g, 1, y)].seq === k));
  sandboxTap(g, at(g, 1, 3), tool("comet"));
  ok("removing a middle piece renumbers the rest",
     g.board[at(g, 1, 1)].seq === 0 && g.board[at(g, 1, 5)].seq === 1);
  const sim = simulate(g.current(), 0);
  ok("a straight run catches the renumbered star", sim.cometHits.length === 2 && sim.cometTotal === 2,
     `${sim.cometHits.length}/${sim.cometTotal}`);
}

{
  const g = blank();
  sandboxTap(g, at(g, 2, 2), tool("asteroid"));
  const a = g.board[at(g, 2, 2)];
  ok("an asteroid gets a lane to drift along", a.kind === "asteroid" && (a.track?.length ?? 0) >= 2);
  ok("its lane is off limits for building", g.noBuild.has(at(g, 3, 2)) && g.moving);
  sandboxTap(g, at(g, 3, 2), tool("mirror"));
  ok("tapping its lane picks the asteroid up", g.board[at(g, 2, 2)].kind === "empty" && g.noBuild.size === 0);
}

{
  const g = blank();
  sandboxTap(g, at(g, 3, 4), tool("warp"));
  ok("a warp tap warps the row", g.level.warps!.length === 1 && g.level.warps![0].axis === "row");
  sandboxTap(g, at(g, 3, 4), tool("warp"));
  ok("again switches to the column", g.level.warps!.length === 1 && g.level.warps![0].axis === "col");
  sandboxTap(g, at(g, 3, 4), tool("warp"));
  ok("again removes it", g.level.warps!.length === 0);

  sandboxTap(g, at(g, 3, 4), tool("milkyway"));
  ok("the Milky Way paints on", g.level.galaxy!.includes(at(g, 3, 4)));
  sandboxTap(g, at(g, 3, 4), tool("milkyway"));
  ok("…and off", !g.level.galaxy!.includes(at(g, 3, 4)));

  sandboxTap(g, at(g, 5, 6), tool("moon"));
  ok("the moon moves over the tapped column", g.level.emitters[0].x === 5);
}

{
  const g = blank();
  sandboxTap(g, at(g, 1, 6), tool("receptor"));
  ok("a ring starts white", g.board[at(g, 1, 6)].mask === WHITE);
  sandboxTap(g, at(g, 1, 6), tool("receptor"));
  ok("tapping a ring changes its colour", g.board[at(g, 1, 6)].mask === Chan.R);
  sandboxTap(g, at(g, 4, 4), tool("tint"));
  const before = { ...g.board[at(g, 4, 4)] };
  sandboxTap(g, at(g, 4, 4), tool("tint"));
  const after = g.board[at(g, 4, 4)];
  ok("tapping a tint changes what it converts", after.kind === "tint" && (after.from !== before.from || after.mask !== before.mask));
}

{
  const g = blank();
  sandboxTap(g, at(g, 3, 4), tool("warp"));
  sandboxTap(g, at(g, 0, 0), tool("cube"));
  ok("the cube tool folds the Galaxy into a cube", !!g.level.cube && g.level.warps!.length === 0);
  // The same trick as the cube tests: a mirror sends light off the right
  // edge, its copy on the right face turns it down into a ring.
  sandboxTap(g, at(g, 1, 1), tool("mirror"));
  sandboxTap(g, at(g, 1, 4), tool("receptor"));
  ok("…and light goes round it", simulate(g.current(), 0).segments.some((sg) => (sg.face ?? 0) !== 0));
  sandboxTap(g, at(g, 0, 0), tool("cube"));
  ok("tapping again flattens it", !g.level.cube);
}

console.log(`\n  sandbox: ${passed} passed, ${failed} failed`);
if (fails.length) {
  console.log("\n  failures:");
  for (const f of fails) console.log(`    x ${f}`);
  process.exit(1);
}

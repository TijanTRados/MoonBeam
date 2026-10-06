/**
 * The leaderboard server: it must accept honest solves, score them exactly as
 * the game does, rank them sensibly — and refuse everything else.
 */
import { tileFrom } from "../src/engine/types";
import { evaluate, simulate } from "../src/engine/simulate";
import { bonuses, scoreRun } from "../src/game/score";
import { dailyNumber, levelHash } from "../src/game/daily";
import { Level } from "../src/engine/types";
import { Solve, Submission, checkSolve, cleanName, levelFor, rushLevelFor, verify } from "../server/verify";
import { Store } from "../server/store";
import { handle } from "../server/app";

let passed = 0;
let failed = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else { failed++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); }
}

const NOW = new Date(2026, 9, 2, 12);   // daily #2
const today = dailyNumber(NOW);

/** The stored solution of a level, fired at a moment it wins. */
function solveOf(l: Level): Solve {
  // With something moving, the solution only wins at some moments: fire at one.
  const tiles = l.tiles.map((t) => ({ ...t }));
  for (const p of l.solution ?? []) tiles[p.i] = tileFrom(p, true);
  return {
    fireTick: Math.max(0, evaluate({ ...l, tiles }).winTick),
    hash: levelHash(l),
    placements: (l.solution ?? []).map((p) => ({ i: p.i, kind: p.kind, mask: p.mask, from: p.from })),
  };
}

function honest(kind: "daily" | "night", id: number, player = "player-aaaa1111", name = "Luna"): Submission & Solve {
  return { player, name, kind, id, seconds: 90, ...solveOf(levelFor(kind, id)) };
}

// ---------------------------------------------------------------- verification

{
  const sub = honest("night", 9);
  const v = verify(sub, NOW);
  ok("an honest solve is accepted", v.ok, v.ok ? "" : v.reason);
  if (v.ok) {
    // The server's score is the game's own: run points plus the piece bonus.
    const l = levelFor("night", 9);
    const tiles = l.tiles.map((t) => ({ ...t }));
    for (const p of l.solution!) tiles[p.i] = tileFrom(p, true);
    const played = { ...l, tiles };
    const expect = scoreRun(played, simulate(played, 0)).total +
      bonuses(l.solution!.length, l.par!, false).reduce((s, b) => s + b.points, 0);
    ok("the server scores it exactly as the game does", v.result.points === expect, `${v.result.points} vs ${expect}`);
    ok("…and knows the piece counts", v.result.used === l.solution!.length && v.result.fewest === l.par);
  }
}

{
  const v = verify(honest("daily", today), NOW);
  ok("today's daily is open", v.ok, v.ok ? "" : v.reason);
  ok("yesterday's and tomorrow's are open too (time zones)", verify(honest("daily", today - 1), NOW).ok && verify(honest("daily", today + 1), NOW).ok);
  const old = verify(honest("daily", today - 3), NOW);
  ok("an old daily is closed", !old.ok && old.status === 409);
}

const refuse = (name: string, mutate: (s: Submission & Solve) => void, status?: number) => {
  const s = honest("night", 9);
  mutate(s);
  const v = verify(s, NOW);
  ok(`refuses ${name}`, !v.ok && (status === undefined || v.status === status), v.ok ? "accepted" : `${v.status} ${v.reason}`);
};
const sol = levelFor("night", 9).solution!;
refuse("an unsolved board", (s) => { s.placements = s.placements.slice(1); }, 422);
refuse("a piece the tray doesn't hold", (s) => { s.placements.push({ i: s.placements[0].i === 0 ? 1 : 0, kind: "crystal" }); });
refuse("a piece on level furniture", (s) => {
  const l = levelFor("night", 9);
  const i = l.tiles.findIndex((t) => t.kind !== "empty");
  s.placements[0] = { ...s.placements[0], i };
});
refuse("two pieces in one cell", (s) => { s.placements.push({ ...s.placements[0] }); });
refuse("a board from another version", (s) => { s.hash = "nope"; }, 409);
refuse("a made-up night", (s) => { s.id = 5000; });
refuse("a bad player id", (s) => { s.player = "x"; });
refuse("a bad name", (s) => { s.name = "<script>"; });
refuse("a cell off the board", (s) => { s.placements[0] = { ...s.placements[0], i: 9999 }; });
ok("the solution used in these tests is real", sol.length > 0);

ok("names are tidied", cleanName("  Moon   Child ") === "Moon Child");
ok("names have limits", cleanName("x") === null && cleanName("a".repeat(17)) === null && cleanName("Mia_99") === "Mia_99");

// ---------------------------------------------------------------- Moon Rush

{
  const run = (ks: number[]): Submission => ({
    player: "player-rush0001", name: "Rusher", kind: "rush", id: today,
    solves: ks.map((k) => ({ k, ...solveOf(rushLevelFor(today, k)) })),
  });
  const v = verify(run([1, 2, 4]), NOW);
  ok("an honest rush is accepted, skips and all", v.ok, v.ok ? "" : v.reason);
  if (v.ok) {
    const sum = [1, 2, 4].reduce((t, k) => {
      const c = checkSolve(rushLevelFor(today, k), solveOf(rushLevelFor(today, k)));
      return t + (c.ok ? c.points : 0);
    }, 0);
    ok("a rush scores the sum of its solves", v.result.points === sum && v.result.used === 3, `${v.result.points} vs ${sum}`);
  }
  const outOfOrder = verify(run([2, 1]), NOW);
  ok("refuses a rush out of order", !outOfOrder.ok);
  const twice = verify(run([1, 1]), NOW);
  ok("refuses the same puzzle twice", !twice.ok);
  const wrong = run([1, 2]);
  wrong.solves![1] = { ...wrong.solves![1], placements: [] };
  const w = verify(wrong, NOW);
  ok("refuses a rush with one bad solve", !w.ok && w.reason.startsWith("puzzle 2"), w.ok ? "" : w.reason);
  ok("refuses a rush on a closed day", !verify({ ...run([1]), id: today - 5 }, NOW).ok);
  ok("rush puzzles get harder", (rushLevelFor(today, 1).difficulty ?? 0) < (rushLevelFor(today, 12).difficulty ?? 0));

  const store = new Store(null);
  const r = (used: number, points: number) => ({ used, points, seconds: 0, fewest: 0 });
  store.submit("p-a-aaaaaa", "A", "rush", 2, r(5, 900), 1);
  store.submit("p-b-bbbbbb", "B", "rush", 2, r(7, 600), 2);
  store.submit("p-c-cccccc", "C", "rush", 2, r(7, 800), 3);
  ok("a rush ranks by puzzles solved, then points",
     store.board("rush", 2).rows.map((x) => x.name).join() === "C,B,A");
}

// ---------------------------------------------------------------- ranking

{
  const store = new Store(null);
  const r = (used: number, points: number, seconds = 0) => ({ used, points, seconds, fewest: 2 });
  store.submit("p-one-1111", "One", "daily", 2, r(3, 500), 1);
  store.submit("p-two-2222", "Two", "daily", 2, r(2, 300), 2);
  store.submit("p-three-33", "Three", "daily", 2, r(2, 300, 50), 3);
  store.submit("p-four-444", "Four", "daily", 2, r(2, 300, 50), 4);
  const b = store.board("daily", 2, "p-four-444");
  ok("fewer pieces beats more points", b.rows[b.rows.length - 1].name === "One");
  ok("then points, then time, then who was first",
     b.rows.map((x) => x.name).join() === "Two,Three,Four,One", b.rows.map((x) => x.name).join());
  ok("you are marked", b.you?.name === "Four" && b.you.rank === 3);
  ok("a worse result never replaces a best", !store.submit("p-two-2222", "Two", "daily", 2, r(4, 900), 5) &&
     store.board("daily", 2).rows[0].points === 300);
  ok("a better one does", store.submit("p-one-1111", "One", "daily", 2, r(1, 100), 6) &&
     store.board("daily", 2).rows[0].name === "One");

  store.submit("p-one-1111", "One", "night", 1, r(1, 100), 7);
  store.submit("p-one-1111", "One", "night", 2, r(1, 150), 8);
  store.submit("p-two-2222", "Two", "night", 1, r(1, 200), 9);
  const lad = store.ladder("p-two-2222");
  ok("the ladder sums best points over nights", lad.rows[0].name === "One" && lad.rows[0].points === 250 && lad.rows[0].nights === 2);
  ok("dailies don't count on the ladder", lad.total === 2);
  store.forget("p-one-1111");
  ok("forgetting a player removes them everywhere",
     store.board("daily", 2).rows.every((x) => x.name !== "One") && store.ladder().rows.every((x) => x.name !== "One"));
}

// ---------------------------------------------------------------- the API

{
  const store = new Store(null);
  const post = (url: string, body: unknown, ip = "1.1.1.1") => handle(store, { method: "POST", url, body, ip }, NOW);
  const get = (url: string) => handle(store, { method: "GET", url, ip: "1.1.1.1" }, NOW);

  ok("health", get("/api/health").status === 200);
  const res = post("/api/score", honest("daily", today));
  ok("a score comes back with a rank", res.status === 200 && (res.body as { rank: number }).rank === 1, JSON.stringify(res.body));
  const board = get(`/api/board/daily/${today}?player=player-aaaa1111`).body as { rows: { name: string }[]; you: { rank: number } };
  ok("the board shows it", board.rows[0].name === "Luna" && board.you.rank === 1);
  ok("player ids are never sent back", !JSON.stringify(board).includes("player-aaaa1111"));
  ok("renaming works", post("/api/name", { player: "player-aaaa1111", name: "Sol" }).status === 200 &&
     (get(`/api/board/daily/${today}`).body as { rows: { name: string }[] }).rows[0].name === "Sol");
  const lie = post("/api/score", { ...honest("night", 9), placements: [] });
  ok("a lie gets an error, not a rank", lie.status === 422);
  let throttled = false;
  for (let k = 0; k < 25; k++) if (post("/api/score", honest("night", 9), "9.9.9.9").status === 429) throttled = true;
  ok("one address can't flood it", throttled);
  ok("unknown routes are 404", get("/api/nope").status === 404);
}

console.log(`\n  leaderboard: ${passed} passed, ${failed} failed`);
if (fails.length) {
  console.log("\n  failures:");
  for (const f of fails) console.log(`    x ${f}`);
  process.exit(1);
}

/**
 * The cube: its geometry must be consistent everywhere, because every puzzle
 * on it is a promise that light behaves the same over every edge.
 */
import { DELTA, Dir, Level, Tile, WHITE, idx } from "../src/engine/types";
import { evaluate, simulate } from "../src/engine/simulate";
import { FACES, cubeExit } from "../src/engine/cube";

let passed = 0;
let failed = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else { failed++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); }
}

const N = 7;
const back = (d: Dir) => ((d + 2) % 4) as Dir;

// ---------------------------------------------------------------- geometry

{
  let all = true, reversible = true, otherFace = true;
  for (let f = 0; f < 6; f++) {
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) for (let d = 0; d < 4; d++) {
      const nx = x + DELTA[d].x, ny = y + DELTA[d].y;
      if (nx >= 0 && ny >= 0 && nx < N && ny < N) continue;   // not an edge crossing
      const s = cubeExit(N, f, x, y, d as Dir);
      if (!(s.x >= 0 && s.y >= 0 && s.x < N && s.y < N && Number.isInteger(s.x) && Number.isInteger(s.y) && s.dir >= 0)) all = false;
      if (s.face === f) otherFace = false;
      // Turn round and go back over the same edge: you arrive where you left.
      const r = cubeExit(N, s.face, s.x, s.y, back(s.dir));
      if (r.face !== f || r.x !== x || r.y !== y || r.dir !== back(d as Dir)) reversible = false;
    }
  }
  ok("every crossing lands inside a face", all);
  ok("every crossing changes face", otherFace);
  ok("every crossing can be retraced", reversible);
}

/** Walk straight on from a cell, across faces, for `steps` cells. */
function walk(face: number, x: number, y: number, dir: Dir, steps: number) {
  for (let k = 0; k < steps; k++) {
    const nx = x + DELTA[dir].x, ny = y + DELTA[dir].y;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) ({ face, x, y, dir } = cubeExit(N, face, x, y, dir));
    else { x = nx; y = ny; }
  }
  return { face, x, y, dir };
}

{
  const s = walk(0, 0, 3, Dir.Right, 4 * N);
  ok("four faces round the middle bring light home", s.face === 0 && s.x === 0 && s.y === 3 && s.dir === Dir.Right, JSON.stringify(s));
  const u = walk(0, 2, 0, Dir.Up, 4 * N);
  ok("…and the same going over the top", u.face === 0 && u.x === 2 && u.y === 0 && u.dir === Dir.Up, JSON.stringify(u));
  ok("right of the front is the right face", walk(0, N - 1, 3, Dir.Right, 1).face === 1);
  ok("above the front is the top face", walk(0, 3, 0, Dir.Up, 1).face === 4);
  ok("below the front is the bottom face", walk(0, 3, N - 1, Dir.Down, 1).face === 5);
  const seen = new Set<number>();
  // From each face, leave by the middle of each edge.
  const mid = (N - 1) / 2;
  const edge: [number, number][] = [[mid, N - 1], [N - 1, mid], [mid, 0], [0, mid]];   // Down, Right, Up, Left
  for (let f = 0; f < 6; f++) for (let d = 0; d < 4; d++) seen.add(cubeExit(N, f, edge[d][0], edge[d][1], d as Dir).face);
  ok("all six faces are reachable", seen.size === 6);
  ok("six faces, each a proper frame", FACES.length === 6);
}

// ---------------------------------------------------------------- light on a cube

function board(n: number, col: number): Level {
  return {
    id: "c", name: "c", w: n, h: n, cube: true,
    tiles: Array.from({ length: n * n }, () => ({ kind: "empty" } as Tile)),
    emitters: [{ x: col, y: 0, dir: Dir.Down, light: WHITE }],
    inventory: [],
  };
}

{
  // Down from the moon, a mirror turns the light right and off the edge. On
  // the right face the light meets the same mirror — it is a copy — from the
  // other side, turns down, and finds a ring the front never sees.
  const l = board(5, 1);
  l.tiles[idx(l, 1, 1)] = { kind: "mirrorB" };
  l.tiles[idx(l, 1, 3)] = { kind: "receptor", mask: WHITE };
  const r = simulate(l);
  ok("a ring is lit by light that went round the cube", r.satisfied.has(idx(l, 1, 3)));
  const hit = r.segments.find((sg) => sg.x1 === 1 && sg.y1 === 3);
  ok("…on the right face", hit?.face === 1, JSON.stringify(hit));
  ok("the crossing is drawn as an edge out and in",
     r.segments.some((sg) => sg.edge === "out" && (sg.face ?? 0) === 0) && r.segments.some((sg) => sg.edge === "in" && sg.face === 1));
  ok("without the cube, the light just leaves", !simulate({ ...l, cube: false }).satisfied.size);
  ok("so the level is won only on the cube", evaluate(l).won && !evaluate({ ...l, cube: false }).won);
}

{
  // An empty cube: light runs round and round, and the simulation still ends.
  const l = board(7, 3);
  const r = simulate(l);
  ok("light circling an empty cube terminates", r.segments.length > 7 && r.segments.length < 2000, `${r.segments.length}`);
  const faces = new Set(r.segments.map((sg) => sg.face ?? 0));
  ok("…having visited the faces round its loop", faces.size === 4, [...faces].join());
}

console.log(`\n  cube: ${passed} passed, ${failed} failed`);
if (fails.length) {
  console.log("\n  failures:");
  for (const f of fails) console.log(`    x ${f}`);
  process.exit(1);
}

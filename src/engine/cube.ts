/**
 * The cube: a board that is one face of a cube, all six faces copies of it.
 *
 * The grid you build on is every face at once — a mirror placed at (2, 3)
 * sits at (2, 3) on all six. What differs between faces is how each one sits
 * in space, so light that runs off an edge carries on over it onto the
 * neighbouring face, entering from whichever of that face's edges actually
 * touches — and the same mirror, met on another face from another side,
 * sends it somewhere else. Planning a route means thinking about the board
 * from six directions at once.
 *
 * Geometry, done once, generically: each face has an outward normal and two
 * in-plane axes (u along x, v along y, both screen-wise). A step over an edge
 * keeps the light's position along the edge, turns its direction to point
 * "down" the new face, and lands it on the first row of cells inside. Nothing
 * here is special-cased per face pair, so the whole cube is consistent by
 * construction — and the tests check it is.
 */
import { Dir } from "./types";

type V = readonly [number, number, number];

interface Face { n: V; u: V; v: V; name: string }

/**
 * The six faces. Front is the face you build on and the moon shines into.
 * Each is described as you would see it with the cube turned to face you, so
 * every face shows the board the same way up as the front.
 */
export const FACES: readonly Face[] = [
  { name: "front",  n: [0, 0, 1],  u: [1, 0, 0],  v: [0, -1, 0] },
  { name: "right",  n: [1, 0, 0],  u: [0, 0, -1], v: [0, -1, 0] },
  { name: "back",   n: [0, 0, -1], u: [-1, 0, 0], v: [0, -1, 0] },
  { name: "left",   n: [-1, 0, 0], u: [0, 0, 1],  v: [0, -1, 0] },
  { name: "top",    n: [0, 1, 0],  u: [1, 0, 0],  v: [0, 0, 1] },
  { name: "bottom", n: [0, -1, 0], u: [1, 0, 0],  v: [0, 0, -1] },
];

const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (...vs: V[]): V => vs.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]] as V, [0, 0, 0] as V);
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const same = (a: V, b: V) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

const DIR_VEC: readonly [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // Down, Right, Up, Left

function dirOf(dx: number, dy: number): Dir {
  return DIR_VEC.findIndex(([x, y]) => x === dx && y === dy) as Dir;
}

export interface CubeStep { face: number; x: number; y: number; dir: Dir }

/**
 * Light on `face` at cell (x, y), heading `dir`, steps off the edge of an
 * n-by-n board. Where does it come back on?
 *
 * Positions are in doubled coordinates so cell centres are whole numbers:
 * the cube spans -n..n on each axis, and a cell's centre sits at 2x+1-n.
 */
export function cubeExit(n: number, face: number, x: number, y: number, dir: Dir): CubeStep {
  const f = FACES[face];
  const [dx, dy] = DIR_VEC[dir];
  const D = add(mul(f.u, dx), mul(f.v, dy));                 // travelling, in space
  const P = add(mul(f.n, n), mul(f.u, 2 * x + 1 - n), mul(f.v, 2 * y + 1 - n));
  const g = FACES.findIndex((q) => same(q.n, D));
  const G = FACES[g];
  // Keep the position along the edge; step one half-cell down the new face.
  const along = add(P, mul(f.n, -dot(P, f.n)), mul(D, -dot(P, D)));
  const Q = add(mul(G.n, n), mul(f.n, n - 1), along);
  const out = mul(f.n, -1);                                   // now heading away from the old face
  return {
    face: g,
    x: (dot(Q, G.u) + n - 1) / 2,
    y: (dot(Q, G.v) + n - 1) / 2,
    dir: dirOf(dot(out, G.u), dot(out, G.v)),
  };
}

/** Which edge of the board a cell-and-direction leaves by, for drawing. */
export type Edge = "top" | "right" | "bottom" | "left";
export function edgeOf(dir: Dir): Edge {
  return dir === Dir.Down ? "bottom" : dir === Dir.Right ? "right" : dir === Dir.Up ? "top" : "left";
}

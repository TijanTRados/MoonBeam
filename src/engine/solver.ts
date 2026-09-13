/**
 * The solver.
 *
 * This exists for the generator, not for the player. A procedurally generated
 * level is worthless unless you can prove it is solvable, and interesting only
 * if you know *how hard* it is to solve — both of which mean actually solving it.
 *
 * The naive search is hopeless: placing 6 pieces into 49 cells is ~10^9 orderings.
 * The trick that makes it tractable is an observation about the physics:
 *
 *   A piece placed on a cell no beam ever reaches cannot change the outcome.
 *
 * So instead of enumerating cells, we simulate, look at which cells the light
 * currently touches, and only branch on those. Each placement redirects the
 * beam, exposing a different (usually small) frontier for the next placement.
 * In practice this turns the search into a tree of branching factor ~10-25 and
 * depth = piece count, which solves 7x7 levels in single-digit milliseconds.
 */
import { Level, Tile, TileKind, Light } from "./types";
import { evaluate, simulate } from "./simulate";

export interface Placement { i: number; kind: TileKind; mask?: Light }

export interface SolveResult {
  solved: boolean;
  /** The shortest solution found, as placements. Empty if already solved. */
  solution: Placement[];
  /** Fewest pieces any found solution used — the level's "par". */
  minPieces: number;
  /** Distinct solutions found, capped at `solutionCap`. A proxy for tightness. */
  solutionCount: number;
  /** Search nodes expanded. The core input to the difficulty score. */
  nodes: number;
  /** True if we hit the node budget, so `solved: false` means "don't know". */
  truncated: boolean;
}

export interface SolveOpts {
  /** Stop expanding after this many nodes. Keeps generation responsive. */
  nodeBudget?: number;
  /** Stop after finding this many distinct solutions. */
  solutionCap?: number;
  /** Return as soon as one solution exists (used for fast feasibility checks). */
  firstOnly?: boolean;
}

/**
 * Inventory pool key.
 *
 * The two mirror orientations draw from one pool: the player is given "three
 * mirrors", not "two of these and one of those", and chooses each orientation
 * when placing. That makes the tray far less fiddly on a phone and matches the
 * tap-to-cycle feel of the original, at the cost of the solver having to try
 * both orientations at every candidate cell.
 */
export const poolKey = (k: TileKind, m?: Light) =>
  k === "mirrorA" || k === "mirrorB" ? "mirror" : `${k}:${m ?? ""}`;

/** Expand an inventory into the distinct pieces that may be placed. */
function pieceTypes(level: Level): { kind: TileKind; mask?: Light }[] {
  const out: { kind: TileKind; mask?: Light }[] = [];
  let mirrors = false;
  for (const it of level.inventory) {
    if (it.count <= 0) continue;
    if (it.kind === "mirrorA" || it.kind === "mirrorB") { mirrors = true; continue; }
    out.push({ kind: it.kind, mask: it.mask });
  }
  if (mirrors) out.push({ kind: "mirrorA" }, { kind: "mirrorB" });
  return out;
}

/**
 * Cells where a piece could plausibly matter: empty, and currently lit.
 *
 * Derived from the `touched` set that `evaluate` already computed, so a search
 * node costs exactly one pass over the movement cycle rather than two.
 */
function frontierFrom(level: Level, touched: Set<number>): number[] {
  const out: number[] = [];
  for (const i of touched) {
    if (level.tiles[i].kind === "empty") out.push(i);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Search for solutions, pruned to the lit frontier.
 *
 * Iterative deepening, not plain DFS. A depth-first search finds *a* solution
 * quickly but has no reason to find a *short* one: it will happily bury a
 * three-piece answer before backtracking far enough to notice the one-piece
 * answer sitting beside it. Since `minPieces` is the level's advertised par and
 * the dominant term in the difficulty model, "shortest found" is not good
 * enough — it has to be the genuine minimum.
 *
 * So we try depth 1, then 2, and so on, and stop at the first depth that yields
 * anything. That depth is the true par by construction. Re-walking the shallow
 * levels is cheap because the frontier keeps the branching factor small.
 *
 * Placements commute — placing A then B gives the same board as B then A — so
 * boards are keyed by their sorted placement set and visited once per depth.
 */
export function solve(level: Level, opts: SolveOpts = {}): SolveResult {
  const nodeBudget = opts.nodeBudget ?? 25_000;
  const solutionCap = opts.solutionCap ?? 40;

  const types = pieceTypes(level);
  const budget = level.inventory.reduce((s, it) => s + it.count, 0);

  // Working copy: we mutate tiles in place and undo on the way out.
  const tiles: Tile[] = level.tiles.map((t) => ({ ...t }));
  const work: Level = { ...level, tiles };
  const remaining = new Map<string, number>();
  const keyOf = poolKey;
  for (const it of level.inventory) {
    const k = keyOf(it.kind, it.mask);
    remaining.set(k, (remaining.get(k) ?? 0) + it.count);
  }

  let seen = new Set<string>();
  let solutions: Placement[][] = [];
  const placed: Placement[] = [];
  let nodes = 0;
  let truncated = false;

  const signature = () =>
    placed.map((p) => `${p.i}${p.kind}${p.mask ?? ""}`).sort().join("|");

  /** Explore, never placing more than `limit` pieces in total. */
  const dfs = (limit: number): boolean => {
    if (nodes >= nodeBudget) { truncated = true; return false; }
    nodes++;

    const sig = signature();
    if (seen.has(sig)) return false;
    seen.add(sig);

    const out = evaluate(work);
    if (out.won) {
      solutions.push(placed.slice());
      return true; // a superset of a solution is not a more interesting solution
    }
    if (placed.length >= limit) return false;

    for (const i of frontierFrom(work, out.touched)) {
      for (const t of types) {
        const left = remaining.get(keyOf(t.kind, t.mask)) ?? 0;
        if (left <= 0) continue;

        tiles[i] = { kind: t.kind, mask: t.mask, placed: true };
        remaining.set(keyOf(t.kind, t.mask), left - 1);
        placed.push({ i, kind: t.kind, mask: t.mask });

        const found = dfs(limit);

        placed.pop();
        remaining.set(keyOf(t.kind, t.mask), left);
        tiles[i] = { kind: "empty" };

        if (found && opts.firstOnly) return true;
        if (solutions.length >= solutionCap) return false;
        if (nodes >= nodeBudget) { truncated = true; return false; }
      }
    }
    return false;
  };

  for (let limit = 0; limit <= budget; limit++) {
    seen = new Set();
    solutions = [];
    dfs(limit);
    if (solutions.length) break;
    if (nodes >= nodeBudget) { truncated = true; break; }
  }

  return {
    solved: solutions.length > 0,
    solution: solutions[0] ?? [],
    // Every solution at the stopping depth has the same length by construction.
    minPieces: solutions[0]?.length ?? Infinity,
    solutionCount: solutions.length,
    nodes,
    truncated,
  };
}

/** Cheap yes/no feasibility check, for the generator's inner loop. */
export function isSolvable(level: Level, nodeBudget = 12_000): boolean {
  return solve(level, { firstOnly: true, nodeBudget }).solved;
}

/**
 * Turn a solve result into a 1-10 difficulty rating.
 *
 * The inputs are chosen to track the things that actually make a light puzzle
 * feel hard, rather than just big:
 *
 *   - `minPieces`      how much has to be got right at once
 *   - `nodes`          how much blind search the level resists (log-scaled)
 *   - `solutionCount`  fewer solutions = a tighter, less forgiving level
 *   - `depth`          how far the light travels before resolving
 *   - branching        splitters and prisms mean tracking several beams at once
 *   - colours          how many distinct channels must be kept separate
 */
/** The names of the difficulty features, in the order `features()` returns them. */
export const FEATURE_NAMES = [
  "par",        // pieces that must be right at once — the dominant term
  "branchers",  // splitters and prisms: how many beams are in play
  "colours",    // distinct receptor colours beyond the first
  "receptors",  // goals beyond the first
  "stars",      // collectibles, which force a *complete* rather than minimal route
  "trayExtra",  // decoys: pieces offered beyond what the solution needs
  "moving",     // dynamic parts, which add the timing dimension
  "search",     // how much blind search the level resists (log-scaled, clamped)
  "resisted",   // whether it exhausted the solver's budget outright
  "tightness",  // how few other ways in there are
  "depth",      // how far the light travels before resolving
] as const;

/** Extract the difficulty feature vector for a level. */
export function features(level: Level, res: SolveResult): number[] {
  const sim = simulate(level, 0);

  const colours = new Set<Light>();
  let branchers = 0, receptors = 0, stars = 0, moving = 0;
  for (const t of level.tiles) {
    if (t.kind === "receptor") { receptors++; colours.add(t.mask ?? 7); }
    if (t.kind === "star") stars++;
    if (t.kind === "splitter" || t.kind === "prism") branchers++;
    if (t.track && t.track.length > 1) moving++;
  }
  for (const it of level.inventory) {
    if (it.kind === "splitter" || it.kind === "prism") branchers += it.count;
    if (it.kind === "filter") branchers += it.count * 0.5;
  }

  const par = isFinite(res.minPieces) ? res.minPieces : 7;
  const trayExtra = Math.max(0, level.inventory.reduce((s, it) => s + it.count, 0) - par);

  return [
    par,
    branchers,
    colours.size - 1,
    receptors - 1,
    stars,
    trayExtra,
    moving,
    Math.max(0, Math.min(4, Math.log2(Math.max(res.nodes, 16) / 16))),
    res.truncated ? 1 : 0,
    res.solutionCount <= 2 ? 1 : res.solutionCount <= 6 ? 0.5 : 0,
    Math.min(40, sim.depth),
  ];
}

/**
 * Coefficients fitted by `tools/fit-difficulty.ts`.
 *
 * Rather than hand-picking weights, the generator was run across every target
 * band and a linear model least-squares fitted to the resulting feature
 * vectors, using the requested target as the ground-truth label. Re-run the
 * tool and paste the output here after changing the generator's budgets.
 *
 * Fit on 601 levels: R^2 = 0.972, RMSE = 0.50.
 *
 * A few weights come out negative. That is collinearity, not a claim that
 * moving parts make a level easier — stars, moving parts and high piece counts
 * all arrive together at the top of the range, so the fit attributes their
 * shared variance to whichever feature carries it most cleanly (here, `stars`
 * and `par`). The model is used only to rank and band levels, which it does
 * well; do not read the individual coefficients as design guidance.
 */
const COEF: readonly number[] = [
  // base, then one per FEATURE_NAMES entry
  0.7348,  // base
  0.3956,  // par
  0.0666,  // branchers
  -0.0576, // colours
  -0.2130, // receptors
  1.3941,  // stars
  0.3295,  // trayExtra
  -0.0808, // moving
  0.2096,  // search
  0.2548,  // resisted
  -0.1663, // tightness
  0.0223,  // depth
];

export function scoreDifficulty(level: Level, res: SolveResult): number {
  const f = features(level, res);
  let raw = COEF[0];
  for (let i = 0; i < f.length; i++) raw += f[i] * (COEF[i + 1] ?? 0);
  return Math.max(1, Math.min(10, Math.round(raw * 10) / 10));
}

/** Convenience: solve and score in one call. */
export function analyse(level: Level) {
  const res = solve(level);
  return { ...res, difficulty: scoreDifficulty(level, res) };
}

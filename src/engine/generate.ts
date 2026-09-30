/**
 * Procedural level generation.
 *
 * This is the piece the thesis mentor asked about: can levels be produced
 * automatically, with real depth rather than random noise?
 *
 * Random placement does not work. A 7x7 grid sprinkled with mirrors is almost
 * always either unsolvable or trivially solvable, and you cannot tell which
 * without solving it. So the generator never guesses. It works in three phases:
 *
 *   1. CONSTRUCT (backwards)
 *      Start at the moon and walk the light forward, *choosing* where to bend,
 *      split and filter it. Because we place the pieces as we walk, we are
 *      building a board and its solution at the same time. Receptors are then
 *      nailed onto wherever the branches happened to end up, in whatever colour
 *      the light happened to be carrying. The puzzle is the fossil of a walk.
 *
 *   2. EXCAVATE
 *      Lift the placed pieces off the board and into the player's tray. The
 *      level is now provably solvable — putting them back is a solution — but
 *      the player does not know where "back" is. Decoy pieces and walls are
 *      added to widen the search without changing the physics of the solution.
 *
 *   3. VERIFY & SCORE
 *      Run the real solver (`solver.ts`). Reject anything unsolvable, anything
 *      solvable too many different ways (a level with 200 solutions is a level
 *      with no idea), and anything whose difficulty score misses the target
 *      band. Retry with the next seed until one survives.
 *
 * Everything is driven by a seeded PRNG, so a level is fully described by its
 * seed and target difficulty. Levels do not need to be stored or shipped — an
 * endless campaign is a counter.
 */
import {
  Chan, Dir, DELTA, InventoryItem, Level, Light, Tile, TileKind, WHITE, Warp,
  inBounds, tileFrom, turnCCW, turnCW,
} from "./types";
import { cycleLength, evaluate, simulate, wins } from "./simulate";
import { analyse, solve, scoreDifficulty, poolKey, Placement, SolveResult } from "./solver";
import {
  Feature, Features, SOFT_GATE, defaultFeatures, nightDifficulty, nightRequires, phaseFor,
} from "./phases";

/** mulberry32 — small, fast, and identical across platforms, so seeds are portable. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const pick = <T,>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const chance = (r: Rand, p: number) => r() < p;

export interface GenOptions {
  w?: number;
  h?: number;
  /** Target difficulty 1-10. The generator aims for +/- `tolerance`. */
  difficulty?: number;
  tolerance?: number;
  /** Max seeds to try before returning the best near-miss. */
  attempts?: number;
  name?: string;
  /** Which elements may appear. Defaults to whatever the difficulty allows. */
  features?: Features;
  /**
   * Elements the level must contain — used to introduce each new element on
   * its own night, so the player is guaranteed to meet it there.
   */
  require?: Feature[];
}

/**
 * How much of what the generator may use, for a difficulty and a feature set.
 *
 * Each element is present only if its phase allows it *and* the ramp has
 * reached its soft gate; beyond that, difficulty scales how much of it there is.
 * `boost` forces an element in — for the night it is introduced.
 */
export function budgetFor(d: number, f: Features = defaultFeatures(d), boost: Feature[] = []) {
  const has = (k: Feature) => f[k] && (d >= SOFT_GATE[k] || boost.includes(k));
  const forced = (k: Feature) => boost.includes(k);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return {
    /** Pieces the player must place. */
    pieces: Math.max(2, Math.min(7, Math.round(1.4 + d * 0.62))),
    /** Chance a step places a beam-splitting piece. */
    splitChance: has("splitters") ? clamp((d - 2) * 0.09, forced("splitters") ? 0.3 : 0.1, 0.42) : 0,
    /** Chance of a crystal, which introduces colour separation. */
    crystalChance: has("crystals") ? clamp((d - 3) * 0.085, forced("crystals") ? 0.45 : 0.14, 0.45) : 0,
    /** Chance of a tint, which converts one colour into another. */
    tintChance: has("tints") ? clamp((d - 4) * 0.08, forced("tints") ? 0.4 : 0.1, 0.4) : 0,
    /** Collectible stars to scatter along the solution. */
    stars: has("stars") ? Math.max(1, Math.min(3, Math.floor((d - 1) / 2.6))) : 0,
    /** Decoy pieces added to the tray beyond what the solution needs. */
    decoys: d < 4 ? 0 : Math.min(3, Math.floor((d - 3) / 1.8)),
    /** Walls scattered in unused space. */
    walls: Math.min(7, Math.floor(d * 0.8)),
    /** Whether to attempt a moving shutter. */
    moving: has("movingWalls"),
    /** Chance the walk drops a jump: a portal pair, black hole, or satellite. */
    jumpChance: (has("portals") || has("blackholes") || has("satellites"))
      ? clamp((d - 5) * 0.025, (forced("portals") || forced("blackholes") || forced("satellites")) ? 0.3 : 0.04, 0.3)
      : 0,
    portals: has("portals"),
    blackholes: has("blackholes"),
    satellites: has("satellites"),
    forceJump: (["portals", "blackholes", "satellites"] as Feature[]).find(forced),
    /** Chance this level has warps at all — decided per level, not per branch. */
    levelWarpChance: has("warps") ? (forced("warps") ? 1 : clamp((d - 3.5) * 0.12, 0.25, 0.5)) : 0,
    /** Chance of a galaxy over part of the route. Harmless, so it comes early. */
    galaxyChance: has("galaxy") ? (d < 3 ? 0.5 : 0.8) : 0,
    /** A shooting star to chase. */
    cometChance: has("comets") ? (forced("comets") ? 1 : 0.55) : 0,
    /** Patches of rough ground that cannot be built on. */
    terrainChance: has("terrain") ? (forced("terrain") ? 1 : 0.7) : 0,
    terrain: has("terrain"),
    /** Whether to try adding an asteroid, which makes the moment of firing matter. */
    asteroids: has("asteroids"),
    /** Rings needing two beams at once. */
    combined: has("combinedRings"),
  };
}
type Budget = ReturnType<typeof budgetFor>;

interface Branch { x: number; y: number; dir: Dir; light: Light; steps: number }

/**
 * Phase 1: walk the light and build the board underneath it.
 *
 * The walker obeys exactly the same physics as `simulate`, so the board it
 * leaves behind reproduces the walk when replayed. Where it differs from the
 * simulator is that on an empty cell it may *choose* to drop a piece.
 */
function construct(r: Rand, w: number, h: number, d: number, b: Budget) {
  const tiles: Tile[] = Array.from({ length: w * h }, () => ({ kind: "empty" as const }));
  const solutionCells: { i: number; kind: TileKind; mask?: Light; from?: Light }[] = [];
  const pathCells: number[] = [];

  // The moon sits outside the grid, as in the original, and fires inward.
  const col = 1 + Math.floor(r() * (w - 2));
  const emitter = { x: col, y: 0, dir: Dir.Down, light: WHITE };

  const queue: Branch[] = [{ ...emitter, steps: 0 }];
  const terminals: { x: number; y: number; light: Light }[] = [];
  let placedCount = 0;
  let jumpUsed = false;
  const warps: Warp[] = [];
  const warpBudget = chance(r, b.levelWarpChance) ? (d >= 8 && chance(r, 0.3) ? 2 : 1) : 0;
  const guard = new Set<string>();

  while (queue.length) {
    const br = queue.shift()!;
    let { x, y, dir, light } = br;
    let steps = br.steps;

    while (true) {
      // A branch reaching the edge may wrap round instead of ending: add a warp
      // for that row or column and carry on from the far side. The moon's own
      // column never wraps, so its gates never collide with the moon.
      if (!inBounds({ w, h }, x, y) && steps <= w * h * 2 && warps.length < warpBudget &&
          chance(r, 0.6)) {
        const horizontal = x < 0 || x >= w;
        const axis: Warp["axis"] = horizontal ? "row" : "col";
        const index = horizontal ? y : x;
        const clash = warps.some((wp) => wp.axis === axis && wp.index === index);
        if (!clash && !(axis === "col" && index === emitter.x)) {
          warps.push({ axis, index, hue: warps.length });
          x = (x + w) % w;
          y = (y + h) % h;
          steps++;
          continue;
        }
      }
      if (!inBounds({ w, h }, x, y) && warps.some((wp) =>
        (wp.axis === "row" && (x < 0 || x >= w) && wp.index === y) ||
        (wp.axis === "col" && (y < 0 || y >= h) && wp.index === x))) {
        // An existing warp this branch happens to reach carries it too.
        x = (x + w) % w;
        y = (y + h) % h;
        steps++;
        continue;
      }
      if (!inBounds({ w, h }, x, y) || steps > w * h * 2) {
        // Branch ran off the edge — back up one cell and cap it with a receptor.
        const bx = x - DELTA[dir].x, by = y - DELTA[dir].y;
        if (inBounds({ w, h }, bx, by) && tiles[by * w + bx].kind === "empty") {
          terminals.push({ x: bx, y: by, light });
        }
        break;
      }

      const gk = `${x},${y},${dir},${light}`;
      if (guard.has(gk)) break; // walked into our own loop
      guard.add(gk);

      const i = y * w + x;
      pathCells.push(i);
      const cell = tiles[i];

      // Jumps are resolved here rather than in `applyExisting`, because where
      // the light re-emerges depends on the partner's position — a property of
      // the board, not of the tile. They are always level furniture, never tray
      // pieces: the puzzle is routing light *through* them, not placing them.
      if (cell.kind === "portal" || cell.kind === "blackhole" || cell.kind === "satellite") {
        const want = cell.kind === "portal" ? "portal" : cell.kind === "blackhole" ? "whitehole" : "dish";
        const twin = tiles.findIndex(
          (t, j) => j !== i && t.kind === want && t.pair === cell.pair,
        );
        if (twin < 0) break;
        x = twin % w;
        y = Math.floor(twin / w);
        pathCells.push(twin);
        x += DELTA[dir].x;
        y += DELTA[dir].y;
        steps++;
        continue;
      }

      if (cell.kind === "empty" && !jumpUsed && steps > 1 && chance(r, b.jumpChance)) {
        // Drop a pair and jump. Keeping the exit well away from the entrance
        // stops the jump reading as a wobble rather than a teleport.
        const free: number[] = [];
        for (let j = 0; j < tiles.length; j++) {
          if (tiles[j].kind !== "empty" || j === i) continue;
          const jx = j % w, jy = Math.floor(j / w);
          if (Math.abs(jx - x) + Math.abs(jy - y) > 3) free.push(j);
        }
        if (free.length) {
          const twin = pick(r, free);
          // A portal pair works both ways; a black hole only ever feeds its
          // white hole. Same jump for this forward walk, different puzzle for
          // the player, who cannot route anything back through the exit.
          // A satellite does the same, but holds the light on the way. With
          // nothing moving that changes nothing; once asteroids drift across
          // the board it is the difference between arriving now and later.
          const kinds = ([
            b.portals && "portals", b.blackholes && "blackholes", b.satellites && "satellites",
          ].filter(Boolean)) as Feature[];
          const kind = b.forceJump ?? pick(r, kinds);
          if (kind === "satellites") {
            tiles[i] = { kind: "satellite", pair: 2, delay: chance(r, 0.6) ? 1 : 2 };
            tiles[twin] = { kind: "dish", pair: 2 };
          } else if (kind === "portals") {
            tiles[i] = { kind: "portal", pair: 1 };
            tiles[twin] = { kind: "portal", pair: 1 };
          } else {
            tiles[i] = { kind: "blackhole", pair: 1 };
            tiles[twin] = { kind: "whitehole", pair: 1 };
          }
          jumpUsed = true;
          x = twin % w;
          y = Math.floor(twin / w);
          pathCells.push(twin);
          x += DELTA[dir].x;
          y += DELTA[dir].y;
          steps++;
          continue;
        }
      }

      if (cell.kind !== "empty") {
        // An earlier branch already furnished this cell. Obey it rather than
        // overwrite it, so the board stays consistent with its own physics.
        const next = applyExisting(cell, dir, light);
        if (!next.length) break;
        for (let k = 1; k < next.length; k++) {
          queue.push({ x, y, dir: next[k].dir, light: next[k].light, steps: steps + 1 });
        }
        dir = next[0].dir; light = next[0].light;
      } else if (
        placedCount < b.pieces &&
        steps > 0 &&
        chance(r, steps < 2 ? 0.25 : 0.55)
      ) {
        // Drop a piece and bend the walk around it.
        const choice = choosePiece(r, b, light);
        tiles[i] = { kind: choice.kind, mask: choice.mask, from: choice.from };
        solutionCells.push({ i, kind: choice.kind, mask: choice.mask, from: choice.from });
        placedCount++;

        const next = applyExisting(tiles[i], dir, light);
        if (!next.length) break;
        for (let k = 1; k < next.length; k++) {
          queue.push({ x, y, dir: next[k].dir, light: next[k].light, steps: steps + 1 });
        }
        dir = next[0].dir; light = next[0].light;
      }

      x += DELTA[dir].x;
      y += DELTA[dir].y;
      steps++;
    }
  }

  return { tiles, solutionCells, pathCells, emitter, terminals, warps, w, h };
}

/** The piece rules, shared by the walker so construction matches simulation. */
function applyExisting(t: Tile, dir: Dir, light: Light): { dir: Dir; light: Light }[] {
  switch (t.kind) {
    case "mirrorA":
      return [{ dir: dir === Dir.Down ? Dir.Left : dir === Dir.Left ? Dir.Down
                   : dir === Dir.Up ? Dir.Right : Dir.Up, light }];
    case "mirrorB":
      return [{ dir: dir === Dir.Down ? Dir.Right : dir === Dir.Right ? Dir.Down
                   : dir === Dir.Up ? Dir.Left : Dir.Up, light }];
    case "splitter":
      return [{ dir: turnCW(dir), light }, { dir: turnCCW(dir), light }];
    case "crystal":
      return light === WHITE
        ? [{ dir: turnCW(dir), light: Chan.R },
           { dir, light: Chan.G },
           { dir: turnCCW(dir), light: Chan.B }]
        : [{ dir, light }];
    case "tint":
      return [{
        dir,
        light: t.from === undefined || light === t.from ? (t.mask ?? light) : light,
      }];
    case "whitehole":
    case "dish":
      return [{ dir, light }];
    case "asteroid":
      return [];
    case "wall":
      return [];
    default:
      return [{ dir, light }];
  }
}

function choosePiece(
  r: Rand,
  b: ReturnType<typeof budgetFor>,
  light: Light,
): { kind: TileKind; mask?: Light; from?: Light } {
  const roll = r();
  if (light === WHITE && roll < b.crystalChance) return { kind: "crystal" as TileKind };
  if (roll < b.crystalChance + b.splitChance) return { kind: "splitter" as TileKind };
  if (roll < b.crystalChance + b.splitChance + b.tintChance) {
    // A tint converts rather than subtracts, so it can never kill the branch —
    // it just has to actually change something to be worth placing.
    const others = ([Chan.R, Chan.G, Chan.B, WHITE] as Light[]).filter((c) => c !== light);
    const to = pick(r, others);
    return { kind: "tint" as TileKind, mask: to, from: light };
  }
  return { kind: pick(r, ["mirrorA", "mirrorB"] as TileKind[]) };
}

/** Phase 2: lift the solution into the tray and dress the board. */
function excavate(
  built: ReturnType<typeof construct>,
  r: Rand,
  d: number,
  name: string,
  seed: number,
  b: Budget,
): Level | null {
  const { w, h } = built;
  const tiles = built.tiles.map((t) => ({ ...t }));

  const probe = (): Level => ({
    id: "probe", name: "probe", w, h, tiles,
    emitters: [built.emitter], inventory: [], warps: built.warps,
  });

  /**
   * Receptors are derived from the simulation, not from the walk.
   *
   * The walk knows what colour each branch was carrying when it left the grid,
   * but that is not the same as what a receptor placed there would receive: a
   * receptor absorbs, so putting one down truncates every *other* branch that
   * crossed the same cell, and receptors match their colour exactly, so a cell
   * two branches pass through accumulates a colour neither branch carried.
   *
   * Reading the mask off the real simulation instead makes the level correct by
   * construction — whatever arrives is, by definition, what the receptor wants.
   */
  const exits = new Set<number>();
  for (const s of simulate(probe(), 0).segments) {
    // Light running into a warp gate is not leaving the board — it comes back
    // on the far side — so a gate is never somewhere to put a ring.
    if (!inBounds({ w, h }, s.x1, s.y1) && !s.warp && !s.gate) {
      const i = s.y0 * w + s.x0;
      if (tiles[i].kind === "empty") exits.add(i);
    }
  }
  if (exits.size === 0) return null;

  const wanted = Math.max(1, Math.min(exits.size, 1 + Math.floor(d / 3.5)));
  const chosen = [...exits].sort((a, b2) => a - b2);
  for (let k = chosen.length - 1; k > 0; k--) {
    const j = Math.floor(r() * (k + 1));
    [chosen[k], chosen[j]] = [chosen[j], chosen[k]];
  }
  let live = chosen.slice(0, wanted);
  for (const i of live) tiles[i] = { kind: "receptor", mask: WHITE };

  // A ring wanting two channels at once needs two separate beams converging on
  // it, which is a genuinely different and much harder idea than aiming one
  // beam. Hold it back until the player has had time to meet prisms and
  // splitters on their own.
  const allowCombined = b.combined;
  const channels = (m: Light) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1);

  // Settle: absorbing at one receptor changes what reaches the others, so read
  // the masks back and drop any receptor left in the dark, until it converges.
  for (let pass = 0; pass < 5 && live.length; pass++) {
    const sim = simulate(probe(), 0);
    const survivors: number[] = [];
    let changed = false;
    for (const i of live) {
      const got = sim.receptorLight.get(i) ?? 0;
      if (got === 0) { tiles[i] = { kind: "empty" }; changed = true; continue; }
      if (!allowCombined && channels(got) > 1 && got !== WHITE) {
        tiles[i] = { kind: "empty" }; changed = true; continue;
      }
      if (tiles[i].mask !== got) { tiles[i] = { kind: "receptor", mask: got }; changed = true; }
      survivors.push(i);
    }
    live = survivors;
    if (!changed) break;
  }
  if (live.length === 0) return null;

  const used = new Set(live);

  // Stars go on cells the light already visits, so they never make the level
  // harder by accident — only more demanding of a *complete* solution.
  const touchedNow = simulate(probe(), 0).touched;
  const pathFree = [...touchedNow].filter(
    (i) => tiles[i].kind === "empty" && !used.has(i),
  );
  for (let s = 0; s < b.stars && pathFree.length; s++) {
    const i = pathFree.splice(Math.floor(r() * pathFree.length), 1)[0];
    tiles[i] = { kind: "star" };
  }

  // A shooting star along the route. Its pieces go on cells the light reaches
  // at strictly increasing hops, so following the known solution collects
  // them in order by construction — and the player has to discover that order.
  let cometCells: number[] = [];
  if (chance(r, b.cometChance)) {
    const first = new Map<number, number>();
    for (const sg of simulate(probe(), 0).segments) {
      if (sg.warp || sg.carry || !inBounds({ w, h }, sg.x1, sg.y1)) continue;
      const i = sg.y1 * w + sg.x1;
      if (!first.has(i) || sg.order < first.get(i)!) first.set(i, sg.order);
    }
    const cand = [...first.entries()]
      .filter(([i]) => tiles[i].kind === "empty" && !used.has(i))
      .sort((a, b2) => a[1] - b2[1]);
    const k = d >= 7 ? 4 : 3;
    if (cand.length >= k) {
      const chosen: [number, number][] = [];
      for (let j = 0; j < k; j++) {
        const at = cand[Math.round((j * (cand.length - 1)) / (k - 1))];
        if (!chosen.length || at[1] > chosen[chosen.length - 1][1]) chosen.push(at);
      }
      if (chosen.length === k) {
        cometCells = chosen.map(([i]) => i);
        cometCells.forEach((i, seq) => { tiles[i] = { kind: "comet", seq }; });
      }
    }
  }

  // Rough ground: a patch or two where nothing can be built. Light crosses it,
  // so it can sit right on the route — it takes away building spots, not paths.
  if (chance(r, b.terrainChance)) {
    const open = tiles.map((t, i) => (t.kind === "empty" ? i : -1)).filter((i) => i >= 0);
    const patches = 1 + (d >= 7 ? 1 : 0);
    for (let n = 0; n < patches && open.length; n++) {
      const seedCell = pick(r, open);
      const size = 2 + Math.floor(r() * 3);
      const patch = [seedCell];
      for (let tries = 0; patch.length < size && tries < 20; tries++) {
        const from = pick(r, patch);
        const dv = DELTA[Math.floor(r() * 4)];
        const nx = (from % w) + dv.x, ny = Math.floor(from / w) + dv.y;
        const ni = ny * w + nx;
        if (inBounds({ w, h }, nx, ny) && tiles[ni].kind === "empty" && !patch.includes(ni)) patch.push(ni);
      }
      for (const i of patch) tiles[i] = { kind: "terrain" };
    }
  }

  // A galaxy over part of the route: a patch of two or three cells square,
  // centred somewhere the light already goes, so routing through more of it is
  // a choice the player can make for points rather than an accident.
  let galaxy: number[] | undefined;
  const route = [...touchedNow];
  if (route.length && chance(r, b.galaxyChance)) {
    const c = pick(r, route);
    const gw = chance(r, 0.5) ? 3 : 2, gh = chance(r, 0.5) ? 3 : 2;
    const gx = Math.max(0, Math.min(w - gw, (c % w) - Math.floor(r() * gw)));
    const gy = Math.max(0, Math.min(h - gh, Math.floor(c / w) - Math.floor(r() * gh)));
    galaxy = [];
    for (let yy = gy; yy < gy + gh; yy++) for (let xx = gx; xx < gx + gw; xx++) galaxy.push(yy * w + xx);
  }

  // Walls only in dead space, so the verified solution survives. "Dead" means
  // untouched by the real simulation, not by the walk — the two differ wherever
  // a receptor swallowed a branch.
  const touched = touchedNow;
  const dead = tiles
    .map((t, i) => (t.kind === "empty" && !touched.has(i) ? i : -1))
    .filter((i) => i >= 0);
  for (let k = 0; k < b.walls && dead.length; k++) {
    const i = dead.splice(Math.floor(r() * dead.length), 1)[0];
    tiles[i] = { kind: "wall" };
  }

  // Excavation proper: the pieces we placed while walking become the tray.
  // Both mirror orientations share one tray slot — the player is given "three
  // mirrors" and picks each orientation when placing, so the tray stays small.
  const inv = new Map<string, InventoryItem>();
  const add = (kind: TileKind, mask?: Light, from?: Light) => {
    const k = poolKey(kind, mask, from);
    const e = inv.get(k);
    if (e) e.count++;
    else inv.set(k, { kind: k === "mirror" ? "mirrorB" : kind, mask, from, count: 1 });
  };
  for (const p of built.solutionCells) {
    // Only lift a cell that still holds the exact piece we recorded. A later
    // phase of the walk may have built something else on top of it, and
    // clearing that would delete level furniture — which is how a portal pair
    // once lost half of itself.
    const t = tiles[p.i];
    if (t.kind !== p.kind || t.mask !== p.mask || t.from !== p.from) continue;
    tiles[p.i] = { kind: "empty" };
    add(p.kind, p.mask, p.from);
  }
  if (inv.size === 0) return null;

  // Decoys: extra pieces that widen the search space without unlocking a
  // shortcut. They are the cheapest honest way to add difficulty.
  for (let k = 0; k < b.decoys; k++) {
    add(pick(r, ["mirrorA", "mirrorB"] as TileKind[]));
  }

  return {
    id: `gen-${seed}`,
    name,
    w, h,
    tiles,
    emitters: [built.emitter],
    inventory: [...inv.values()],
    seed,
    difficulty: d,
    warps: built.warps.length ? built.warps : undefined,
    galaxy,
  };
}

/**
 * Close off shortcuts.
 *
 * A constructed level is solvable by definition, but it is often solvable by
 * something much cheaper than the route it was built around: on an open 7x7
 * board a single mirror in the moon's column reaches almost any receptor, so a
 * level built around four pieces can have a par of one. That is the single
 * biggest quality problem in generated light puzzles, and it is invisible
 * unless you compute the true minimum — which is exactly what the solver's
 * iterative deepening now gives us.
 *
 * The fix is to find where the cheap solution goes and wall it off, as long as
 * the intended solution survives. Each wall raises par by forcing the light the
 * long way round.
 */
function tighten(level: Level, known: Placement[], r: Rand, want: number, useTerrain = false): Level {
  const knownCells = new Set(known.map((k) => k.i));
  let cur = level;

  for (let round = 0; round < 4; round++) {
    const res = solve(cur, { nodeBudget: 5_000, solutionCap: 4 });
    if (!res.solved || res.minPieces >= want) break;

    // Cells the cheap solution relies on, that the intended one does not.
    const blockable = res.solution
      .map((p) => p.i)
      .filter((i) => !knownCells.has(i));
    if (!blockable.length) break;

    const pickIdx = Math.floor(r() * blockable.length);
    let placed = false;
    for (let k = 0; k < blockable.length && !placed; k++) {
      const i = blockable[(pickIdx + k) % blockable.length];
      // Rough ground blocks the build without blocking the light, so on
      // phases that have it, it can close a shortcut even on the route itself.
      const probe: Level = { ...cur, tiles: cur.tiles.map((t) => ({ ...t })) };
      probe.tiles[i] = { kind: useTerrain ? "terrain" : "wall" };

      const replay: Level = { ...probe, tiles: probe.tiles.map((t) => ({ ...t })), inventory: [] };
      for (const p of known) replay.tiles[p.i] = tileFrom(p);
      if (evaluate(replay).won) { cur = probe; placed = true; }
    }
    if (!placed) break;
  }
  return cur;
}

/**
 * Phase 3 helper: try to add a moving shutter without breaking solvability.
 *
 * Because every receptor must be lit on the *same* tick, a wall that slides in
 * and out turns a spatial puzzle into a timing one. We only keep it if the
 * level still verifies.
 */
function tryAddMovingPart(level: Level, r: Rand, known: Placement[]): Level {
  const solutionCells = new Set(known.map((k) => k.i));
  const onTrack = trackCells(level);
  // Every cell of the track must be free. The track used to be clamped at the
  // edge without looking at what was there, so a sliding wall could pass over
  // a ring and blot it out for a tick at a time.
  const free = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= level.w || y >= level.h) return false;
    const i = y * level.w + x;
    return level.tiles[i].kind === "empty" && !solutionCells.has(i) && !onTrack.has(i);
  };
  const candidates = level.tiles
    .map((_, i) => (free(i % level.w, Math.floor(i / level.w)) ? i : -1))
    .filter((i) => i >= 0);
  if (candidates.length < 2) return level;

  for (let attempt = 0; attempt < 4; attempt++) {
    const i = pick(r, candidates);
    const x = i % level.w, y = Math.floor(i / level.w);
    const horiz = chance(r, 0.5);
    const track = [0, 1, 2, 1].map((o) => ({ x: horiz ? x + o : x, y: horiz ? y : y + o }));
    if (!track.every((p) => free(p.x, p.y))) continue;

    const probe: Level = {
      ...level,
      tiles: level.tiles.map((t, j) =>
        j === i ? { kind: "wall" as const, track, phase: Math.floor(r() * track.length) } : { ...t },
      ),
    };
    // Verified the same cheap way: lay the known solution back down and check
    // that some tick in the movement cycle still lights every receptor at once.
    const replay: Level = { ...probe, tiles: probe.tiles.map((t) => ({ ...t })), inventory: [] };
    for (const p of known) replay.tiles[p.i] = tileFrom(p);
    if (evaluate(replay).won) return probe;
  }
  return level;
}

/** Every cell anything moving can occupy. */
export function trackCells(level: Level): Set<number> {
  const out = new Set<number>();
  for (const t of level.tiles) for (const p of t.track ?? []) out.add(p.y * level.w + p.x);
  return out;
}

/**
 * Try to send an asteroid drifting across the route.
 *
 * It sweeps back and forth along a short lane of empty cells. The asteroid is
 * only kept if it is *interesting*: the known solution must still win when
 * fired at some moments and fail at others. One that never gets in the way is
 * scenery; one that is always in the way breaks the level. In between is a
 * puzzle about when to press Shine.
 */
function tryAddAsteroid(level: Level, r: Rand, known: Placement[]): Level {
  const { w, h } = level;
  const blocked = new Set(known.map((k) => k.i));
  const replayOf = (l: Level): Level => {
    const rp: Level = { ...l, tiles: l.tiles.map((t) => ({ ...t })), inventory: [] };
    for (const p of known) rp.tiles[p.i] = tileFrom(p);
    return rp;
  };
  const path = simulate(replayOf(level), 0).touched;
  const onTrack = trackCells(level);
  const free = (i: number) => level.tiles[i].kind === "empty" && !blocked.has(i) && !onTrack.has(i);

  for (let attempt = 0; attempt < 10; attempt++) {
    // A lane through a cell the light uses, running across the beam.
    const via = pick(r, [...path].filter(free));
    if (via === undefined) return level;
    const horiz = chance(r, 0.5);
    const len = 3 + Math.floor(r() * 3);
    const cells: number[] = [];
    const vx = via % w, vy = Math.floor(via / w);
    const start = Math.floor(r() * len);
    for (let k = 0; k < len; k++) {
      const x = horiz ? vx - start + k : vx, y = horiz ? vy : vy - start + k;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      if (!free(i)) break;
      cells.push(i);
    }
    if (cells.length < 3) continue;
    const pts = cells.map((i) => ({ x: i % w, y: Math.floor(i / w) }));
    const track = [...pts, ...pts.slice(1, -1).reverse()];   // there and back again

    const probe: Level = { ...level, tiles: level.tiles.map((t) => ({ ...t })) };
    probe.tiles[cells[0]] = { kind: "asteroid", track, phase: Math.floor(r() * track.length) };

    const rp = replayOf(probe);
    const n = cycleLength(rp);
    let good = 0;
    for (let t = 0; t < n; t++) if (wins(rp, simulate(rp, t))) good++;
    if (good > 0 && good < n) return probe;
  }
  return level;
}

export interface GenResult {
  level: Level;
  attempts: number;
  analysis: ReturnType<typeof analyse>;
}

/** Generate one verified level at (approximately) the target difficulty. */
export function generateLevel(seed: number, opts: GenOptions = {}): GenResult {
  const w = opts.w ?? 7;
  const h = opts.h ?? 7;
  const target = opts.difficulty ?? 4;
  const tolerance = opts.tolerance ?? 1.4;
  const attempts = opts.attempts ?? 140;
  const features = opts.features ?? defaultFeatures(target);
  const need = opts.require ?? [];
  const b = budgetFor(target, features, need);

  let best: GenResult | null = null;

  for (let n = 0; n < attempts; n++) {
    const s = (seed + n * 0x9e3779b1) >>> 0;
    const r = rng(s);

    const built = construct(r, w, h, target, b);
    const level = excavate(built, r, target, opts.name ?? `Seed ${seed}`, s, b);
    if (!level) continue;

    // Verification by replay, not by search.
    //
    // We know where the solution goes — we put it there. So putting the tray
    // back on the board and running the simulation once proves the level is
    // honest, and catches the one thing that can go wrong: a later branch of
    // the walk crossing an earlier branch's piece and changing the physics
    // underneath it. This costs one simulation instead of a full solve, which
    // is what makes generating a hard level affordable at all.
    const replay: Level = {
      ...level,
      tiles: level.tiles.map((t) => ({ ...t })),
      inventory: [],
    };
    // Only pieces whose cell survived excavation as empty are part of the
    // solution the player is being asked to find; anything the receptor pass
    // overwrote is now level furniture, not a tray piece.
    const known = built.solutionCells.filter((p) => level.tiles[p.i].kind === "empty");
    for (const p of known) replay.tiles[p.i] = tileFrom(p);
    if (known.length === 0) continue;
    if (!evaluate(replay).won) continue;

    // Wall off any route cheaper than the one the level was built around, so
    // par reflects the idea in the level rather than an accident of geometry.
    const tightened = target >= 2 ? tighten(level, known, r, known.length, b.terrain) : level;

    // Now the solver runs only to *measure*: how much search does the level
    // resist, and how many other ways are there in? Running out of budget is
    // informative rather than fatal, because solvability is already settled.
    const res = solve(tightened, { nodeBudget: target >= 6 ? 6_000 : 4_000, solutionCap: 12 });
    const minPieces = Math.min(
      isFinite(res.minPieces) ? res.minPieces : Infinity,
      known.length,
    );
    const measured: SolveResult = { ...res, solved: true, minPieces };

    // A level with a dozen-plus solutions is a level with no idea in it.
    if (res.solutionCount >= 12 && target >= 4) continue;

    // A hard night that happens to fall to two mirrors is not a hard night,
    // however many decoys and stars are sitting on it. Insist that the true
    // minimum grows with the target.
    const floor = target >= 8 ? 4 : target >= 6 ? 3 : target >= 3 ? 2 : 1;
    if (minPieces < floor) continue;

    let finalLevel = tightened;
    let finalRes = measured;

    // The timing dimension is expensive to verify, so it is only attempted on
    // levels that have already earned their place.
    if (b.asteroids) {
      const withRock = tryAddAsteroid(finalLevel, r, known);
      if (withRock !== finalLevel) finalLevel = withRock;
    }
    if (b.moving) {
      const withMotion = tryAddMovingPart(finalLevel, r, known);
      if (withMotion !== finalLevel) {
        finalLevel = withMotion;
        finalRes = { ...measured };
      }
    }

    // An introduction night must actually contain what it introduces.
    if (need.length && !need.every((f) => contains(finalLevel, f)) && n < attempts - 1) continue;

    const difficulty = scoreDifficulty(finalLevel, finalRes);
    const scored: GenResult = {
      level: { ...finalLevel, difficulty, par: minPieces, solution: known },
      attempts: n + 1,
      analysis: { ...finalRes, difficulty },
    };

    // Widen the band as attempts run out rather than falling off a cliff into
    // the trivial fallback.
    const band = tolerance + (n / attempts) * 1.6;
    if (Math.abs(difficulty - target) <= band) return scored;
    if (
      !best ||
      Math.abs(difficulty - target) < Math.abs((best.level.difficulty ?? 99) - target)
    ) {
      best = scored;
    }
  }

  if (best) return best;

  // Last resort. Constructed directly rather than searched, so it can never
  // fail and the game never dead-ends on a hostile seed.
  return fallbackLevel(seed, w, h, opts.name ?? `Seed ${seed}`);
}

/** Does a level contain a given element — on the board or in the tray? */
export function contains(l: Level, f: Feature): boolean {
  const onBoard = (k: string) => l.tiles.some((t) => t.kind === k);
  const inTray = (k: string) => l.inventory.some((it) => it.kind === k);
  switch (f) {
    case "stars": return onBoard("star");
    case "splitters": return onBoard("splitter") || inTray("splitter");
    case "crystals": return onBoard("crystal") || inTray("crystal");
    case "tints": return onBoard("tint") || inTray("tint");
    case "galaxy": return !!l.galaxy?.length;
    case "comets": return onBoard("comet");
    case "portals": return onBoard("portal");
    case "terrain": return onBoard("terrain");
    case "warps": return !!l.warps?.length;
    case "blackholes": return onBoard("blackhole");
    case "combinedRings": return l.tiles.some((t) => t.kind === "receptor" && t.mask !== undefined &&
      t.mask !== WHITE && ((t.mask & 1) + ((t.mask >> 1) & 1) + ((t.mask >> 2) & 1)) > 1);
    case "asteroids": return onBoard("asteroid");
    case "satellites": return onBoard("satellite");
    case "movingWalls": return l.tiles.some((t) => t.kind === "wall" && !!t.track);
  }
}

/**
 * A hand-shaped one-mirror level: moon down a column, a single turn, a receptor
 * on the wall. Always solvable, always in exactly one way.
 */
function fallbackLevel(seed: number, w: number, h: number, name: string): GenResult {
  const r = rng(seed);
  const col = 1 + Math.floor(r() * (w - 2));
  const row = 2 + Math.floor(r() * (h - 3));
  const tiles: Tile[] = Array.from({ length: w * h }, () => ({ kind: "empty" as const }));
  tiles[row * w + (w - 1)] = { kind: "receptor", mask: WHITE };

  const level: Level = {
    id: `gen-${seed}`, name, w, h, tiles,
    emitters: [{ x: col, y: 0, dir: Dir.Down, light: WHITE }],
    inventory: [{ kind: "mirrorB", count: 1 }],
    seed, difficulty: 1, par: 1,
    // A single mirror in the moon's column, on the receptor's row, turns the
    // beam straight into it. Stated rather than searched for, so this path
    // always ships a solution like every other.
    solution: [{ i: row * w + col, kind: "mirrorB" }],
  };
  const res = solve(level, { nodeBudget: 20_000 });
  return { level, attempts: 0, analysis: { ...res, difficulty: 1 } };
}

/**
 * A campaign is a difficulty ramp, not a list. Level n of the endless mode is
 * always the same level for the same run seed, but nobody has to store it.
 */
export function campaignDifficulty(n: number): number {
  return nightDifficulty(n);
}

/**
 * A campaign night: its phase decides what may appear and how hard it is, and
 * an introduction night is required to contain the element it introduces.
 */
export function generateCampaignLevel(n: number, runSeed = 1): GenResult {
  const { phase } = phaseFor(n);
  return generateLevel((runSeed * 2654435761 + n * 40503) >>> 0, {
    difficulty: nightDifficulty(n),
    name: `Night ${n}`,
    tolerance: 1.5,
    features: phase.features,
    require: nightRequires(n),
  });
}

/**
 * MoonBeam — core types.
 *
 * The engine is deliberately pure: no DOM, no canvas, no timers. Everything in
 * this folder is a plain function over plain data, which is what lets the level
 * generator run the same simulation the player sees, thousands of times a second.
 */

/** Direction the beam travels. Values match the original 2015 thesis encoding. */
export enum Dir {
  Down = 0,
  Right = 1,
  Up = 2,
  Left = 3,
}

/** Unit vector per direction, indexed by Dir. */
export const DELTA: readonly { x: number; y: number }[] = [
  { x: 0, y: 1 },  // Down
  { x: 1, y: 0 },  // Right
  { x: 0, y: -1 }, // Up
  { x: -1, y: 0 }, // Left
];

export function turnCW(d: Dir): Dir {
  return ((d + 1) % 4) as Dir;
}
export function turnCCW(d: Dir): Dir {
  return ((d + 3) % 4) as Dir;
}

/**
 * Light is an additive RGB bitmask rather than the thesis's three discrete
 * colours. White is R|G|B. This is the single biggest depth change to the
 * original rules: crystals *separate* the channels, tints *convert* between
 * them, and receptors *accumulate* — so colour becomes a resource to route
 * rather than a label to match.
 */
export enum Chan {
  R = 1,
  G = 2,
  B = 4,
}
export type Light = number; // 1..7
export const WHITE: Light = Chan.R | Chan.G | Chan.B;

/** Every kind of thing that can occupy a grid cell. */
export type TileKind =
  | "empty"
  /** Absorbs any beam. Level geometry, never placeable. */
  | "wall"
  /** "/" mirror (SW-NE) — reflects Down<->Left, Up<->Right. */
  | "mirrorA"
  /** "\" mirror (NW-SE) — reflects Down<->Right, Up<->Left. This is the thesis's mirror1. */
  | "mirrorB"
  /** Diamond: splits an incoming beam into the two perpendicular directions. */
  | "splitter"
  /**
   * Crystal: separates moonlight into its three colours, one per side.
   *
   * Deliberately *not* called a prism. A real prism disperses light into a
   * continuous spectrum by wavelength-dependent refraction — it does not emit
   * three discrete beams at right angles to each other. Naming this a prism
   * invited a physics argument the game cannot win, so it is a crystal: a
   * made-up object that obeys the game's rules and claims nothing about optics.
   */
  | "crystal"
  /**
   * Tint: turns one colour into another.
   *
   * `to` is the colour that comes out. If `from` is set, only light of exactly
   * that colour is converted and everything else passes through untouched; if
   * `from` is unset, any light that enters leaves as `to`.
   */
  | "tint"
  /** Paired teleport. Beam exits the twin portal with the same direction. */
  | "portal"
  /**
   * Black hole: swallows light, which falls out of the paired white hole still
   * travelling the same way. One-way, unlike a portal — that asymmetry is the
   * whole point of having both.
   */
  | "blackhole"
  /** Where a black hole's light comes back out. Otherwise transparent. */
  | "whitehole"
  /**
   * Asteroid: drifts along a track and breaks any beam that hits it. Hitting one
   * costs points, and because light takes time to cross the board, whether it
   * is in the way depends on the moment you fire.
   */
  | "asteroid"
  /**
   * Satellite: catches light and carries it to its dish, which releases it
   * `delay` ticks later still travelling the same way. The delay is the point:
   * by the time the light comes back down, asteroids have moved.
   */
  | "satellite"
  /** Where a satellite puts its light back down. Otherwise transparent. */
  | "dish"
  /**
   * One piece of a shooting star. The pieces form a sequence (`seq` 0, 1, 2 …)
   * and only the active one can be collected: light must reach piece 0, and
   * then — later in the same firing — piece 1, and so on. Light passing a piece
   * before its turn does nothing. Transparent, like a star.
   */
  | "comet"
  /**
   * Rough ground. Light crosses it freely, but nothing can be built on it — it
   * takes building spots away without taking routes away.
   */
  | "terrain"
  /** Collectible. Light passes straight through; lighting it banks it permanently. */
  | "star"
  /** Goal. Must be hit by light matching `mask` exactly. */
  | "receptor";

export interface Tile {
  kind: TileKind;
  /** For `receptor`: the colour it demands. For `tint`: the colour it emits. */
  mask?: Light;
  /** For `tint`: only convert light of exactly this colour. Unset means "any". */
  from?: Light;
  /** Pairing id for `portal`, `blackhole`/`whitehole` and `satellite`/`dish`. */
  pair?: number;
  /**
   * Set on tiles the player placed this session, so we can render them
   * differently from level furniture and let them be picked back up.
   */
  placed?: boolean;
  /**
   * Movement track for dynamic tiles. The tile occupies
   * `track[(tick + phase) % track.length]` — see `simulate.ts`.
   */
  track?: { x: number; y: number }[];
  phase?: number;
  /** For `satellite`: ticks of board time it holds the light before its dish releases it. */
  delay?: number;
  /** For `comet`: this piece's place in the shooting star's sequence, from 0. */
  seq?: number;
}

/**
 * An edge warp: one row or column whose two ends are joined. Light leaving the
 * board through one gate comes back in through the gate at the other end,
 * still travelling the same way — a tunnel under the board.
 */
export interface Warp {
  axis: "row" | "col";
  index: number;
  /** Which of the warp colours marks this pair of gates. Decoration only. */
  hue: number;
}

/** A piece in the player's tray, with a count. */
export interface InventoryItem {
  kind: TileKind;
  mask?: Light;
  /** For `tint`: the colour it converts from. */
  from?: Light;
  count: number;
}

export interface Emitter {
  /** Grid coords of the cell the beam first enters (the moon itself sits outside). */
  x: number;
  y: number;
  dir: Dir;
  light: Light;
}

export interface Level {
  id: string;
  name: string;
  w: number;
  h: number;
  /** Row-major, length w*h. */
  tiles: Tile[];
  emitters: Emitter[];
  inventory: InventoryItem[];
  /** Seed the level was generated from, if procedural. */
  seed?: number;
  /** 1..10, from the generator's scorer. */
  difficulty?: number;
  /** Minimum pieces needed, from the solver. Used for the "par" star rating. */
  par?: number;
  /**
   * A known-good solution. The generator gets this for free (it built the
   * level around it), which is what lets the game offer a hint without
   * having to solve anything at runtime.
   */
  solution?: { i: number; kind: TileKind; mask?: Light; from?: Light }[];
  /** Rows and columns that wrap round. */
  warps?: Warp[];
  /**
   * Cells covered by a galaxy. Not a piece — pieces can sit on it — but light
   * crossing it shines brighter and carries more points.
   */
  galaxy?: number[];
}

export const idx = (l: { w: number }, x: number, y: number) => y * l.w + x;
export const inBounds = (l: { w: number; h: number }, x: number, y: number) =>
  x >= 0 && y >= 0 && x < l.w && y < l.h;

/**
 * Rebuild a tile from a recorded placement.
 *
 * Always go through this rather than spreading the fields by hand. Tiles have
 * grown optional fields over time (`mask`, then `from`), and every hand-written
 * `{ kind, mask }` silently dropped the newer ones — which turned a targeted
 * tint into an untargeted one and made verified solutions look broken.
 */
export function tileFrom(
  p: { kind: TileKind; mask?: Light; from?: Light },
  placed = false,
): Tile {
  return { kind: p.kind, mask: p.mask, from: p.from, ...(placed ? { placed: true } : {}) };
}

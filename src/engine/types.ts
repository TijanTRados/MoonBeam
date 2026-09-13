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

export const DIRS: readonly Dir[] = [Dir.Down, Dir.Right, Dir.Up, Dir.Left];

/** Unit vector per direction, indexed by Dir. */
export const DELTA: readonly { x: number; y: number }[] = [
  { x: 0, y: 1 },  // Down
  { x: 1, y: 0 },  // Right
  { x: 0, y: -1 }, // Up
  { x: -1, y: 0 }, // Left
];

export function opposite(d: Dir): Dir {
  return ((d + 2) % 4) as Dir;
}
export function turnCW(d: Dir): Dir {
  return ((d + 1) % 4) as Dir;
}
export function turnCCW(d: Dir): Dir {
  return ((d + 3) % 4) as Dir;
}

/**
 * Light is an additive RGB bitmask rather than the thesis's three discrete
 * colours. White is R|G|B. This is the single biggest depth change to the
 * original rules: filters *subtract* channels and prisms *separate* them, so
 * colour becomes a resource to route rather than a label to match.
 */
export enum Chan {
  R = 1,
  G = 2,
  B = 4,
}
export type Light = number; // 1..7
export const WHITE: Light = Chan.R | Chan.G | Chan.B;

export function lightName(l: Light): string {
  return (
    { 1: "red", 2: "green", 3: "yellow", 4: "blue", 5: "magenta", 6: "cyan", 7: "white" } as Record<number, string>
  )[l] ?? "dark";
}

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
  /** Pairing id for `portal`, and for `blackhole`/`whitehole`. */
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

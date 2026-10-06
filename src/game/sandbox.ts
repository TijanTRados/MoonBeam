/**
 * The Galaxy: a sandbox with every element in the game and no rules about
 * which you may use.
 *
 * Everything is placeable here, including the level furniture a campaign night
 * never lets you touch — rings, stars, asteroids, satellites, shooting stars,
 * warps, the Milky Way, even the moon. Pieces that come in pairs pair
 * themselves up as you place them; tapping something you placed cycles through
 * its variants and finally picks it back up.
 *
 * It runs on the same Game and the same engine as the campaign, so whatever
 * you build here behaves exactly as it would on a real night.
 */
import { Chan, Dir, Level, Light, Tile, TileKind, WHITE } from "../engine/types";
import { Game } from "./state";

export type ToolKind = TileKind | "milkyway" | "warp" | "moon" | "cube";

export interface Tool {
  key: string;
  kind: ToolKind;
  mask?: Light;
  from?: Light;
  name: string;
}

export const TOOLS: Tool[] = [
  { key: "mirror", kind: "mirrorB", name: "Mirror" },
  { key: "splitter", kind: "splitter", name: "Splitter" },
  { key: "crystal", kind: "crystal", name: "Crystal" },
  { key: "tint", kind: "tint", from: Chan.R, mask: Chan.B, name: "Tint" },
  { key: "receptor", kind: "receptor", mask: WHITE, name: "Ring" },
  { key: "star", kind: "star", name: "Star" },
  { key: "comet", kind: "comet", name: "Shooting star" },
  { key: "milkyway", kind: "milkyway", name: "Milky Way" },
  { key: "portal", kind: "portal", name: "Portal" },
  { key: "blackhole", kind: "blackhole", name: "Black hole" },
  { key: "whitehole", kind: "whitehole", name: "White hole" },
  { key: "warp", kind: "warp", name: "Warp" },
  { key: "satellite", kind: "satellite", name: "Satellite" },
  { key: "dish", kind: "dish", name: "Dish" },
  { key: "asteroid", kind: "asteroid", name: "Asteroid" },
  { key: "terrain", kind: "terrain", name: "Rough ground" },
  { key: "wall", kind: "wall", name: "Wall" },
  { key: "moon", kind: "moon", name: "Moon" },
  { key: "cube", kind: "cube", name: "Cube" },
];

/** What tapping each tool's cell does, in a line, for the caption. */
export const TOOL_TIPS: Record<string, string> = {
  mirror: "Tap it again to flip, a third time to take it back.",
  tint: "Tap it again to change which colours it converts.",
  receptor: "Tap it again to change the colour it wants.",
  comet: "Pieces are numbered in the order you place them.",
  milkyway: "Tap cells to paint the Milky Way on or off.",
  portal: "Place two — they pair up by themselves.",
  blackhole: "Pairs with the next white hole you place.",
  whitehole: "Pairs with the last black hole you placed.",
  warp: "Tap a cell to warp its row; again for its column; again to remove.",
  satellite: "Pairs with the next dish. Tap again to lengthen its delay.",
  dish: "Pairs with the last satellite you placed.",
  asteroid: "Drifts back and forth along the free cells beside it.",
  moon: "Tap a column to move the moon over it.",
  cube: "Tap anywhere to fold the board into a cube — or flatten it again.",
};

const TINTS: { from?: Light; mask: Light }[] = [
  { from: Chan.R, mask: Chan.B },
  { from: Chan.B, mask: Chan.G },
  { from: Chan.G, mask: Chan.R },
  { mask: Chan.R },
];
const RINGS: Light[] = [WHITE, Chan.R, Chan.G, Chan.B, Chan.R | Chan.B];

/** The Galaxy's opening board: one of nearly everything, already in place. */
export function sandboxLevel(): Level {
  const w = 8, h = 8;
  const tiles: Tile[] = Array.from({ length: w * h }, () => ({ kind: "empty" } as Tile));
  const put = (x: number, y: number, t: Tile) => { tiles[y * w + x] = { ...t, placed: true }; };

  put(1, 2, { kind: "star" });
  put(1, 5, { kind: "satellite", pair: 101, delay: 1 });
  put(6, 1, { kind: "dish", pair: 101 });
  put(3, 1, { kind: "asteroid", track: [{ x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }, { x: 4, y: 1 }], phase: 0 });
  put(6, 6, { kind: "mirrorA" });
  put(2, 3, { kind: "comet", seq: 0 });
  put(4, 6, { kind: "comet", seq: 1 });
  put(0, 6, { kind: "comet", seq: 2 });
  put(0, 0, { kind: "portal", pair: 102 });
  put(7, 3, { kind: "portal", pair: 102 });
  put(2, 5, { kind: "terrain" });
  put(3, 5, { kind: "terrain" });
  put(3, 7, { kind: "receptor", mask: WHITE });
  put(7, 7, { kind: "wall" });

  const galaxy: number[] = [];
  for (let y = 3; y <= 4; y++) for (let x = 4; x <= 6; x++) galaxy.push(y * w + x);

  return {
    id: "galaxy", name: "The Galaxy", w, h, tiles,
    emitters: [{ x: 1, y: 0, dir: Dir.Down, light: WHITE }],
    inventory: [],
    warps: [{ axis: "row", index: 6, hue: 0 }],
    galaxy,
    difficulty: 0,
  };
}

export type SandboxResult = "placed" | "rotated" | "removed" | "moved" | "none";

let nextPair = 200;

/** A tap on the Galaxy board with a tool selected. */
export function sandboxTap(game: Game, i: number, tool: Tool): SandboxResult {
  if (game.phase === "running") return "none";
  const l = game.level;
  const x = i % l.w, y = Math.floor(i / l.w);
  const r = apply(game, i, x, y, tool);
  if (r !== "none") game.refresh();
  return r;
}

function apply(game: Game, i: number, x: number, y: number, tool: Tool): SandboxResult {
  const l = game.level;
  const board = game.board;

  // Tools that are not pieces work on any cell.
  if (tool.kind === "milkyway") {
    const g = l.galaxy ?? (l.galaxy = []);
    const k = g.indexOf(i);
    if (k >= 0) { g.splice(k, 1); return "removed"; }
    g.push(i);
    return "placed";
  }
  if (tool.kind === "warp") {
    const ws = l.warps ?? (l.warps = []);
    const row = ws.findIndex((w) => w.axis === "row" && w.index === y);
    const col = ws.findIndex((w) => w.axis === "col" && w.index === x);
    const hue = ws.length % 4;
    if (row < 0 && col < 0) { ws.push({ axis: "row", index: y, hue }); return "placed"; }
    if (row >= 0) {
      ws.splice(row, 1);
      if (col < 0) { ws.push({ axis: "col", index: x, hue }); return "rotated"; }
      return "removed";
    }
    ws.splice(col, 1);
    return "removed";
  }
  if (tool.kind === "cube") {
    // Warps and a cube don't mix: a cube's edges already lead somewhere.
    l.cube = !l.cube || undefined;
    if (l.cube) l.warps = [];
    return "rotated";
  }
  if (tool.kind === "moon") {
    const e = l.emitters[0];
    if (e.x === x) return "none";
    l.emitters = [{ ...e, x, y: 0, dir: Dir.Down }];
    return "moved";
  }

  // Something drifts through this cell: tapping its path picks it up.
  if (game.noBuild.has(i)) {
    const j = board.findIndex((t) => t.placed && t.track?.some((p) => p.y * l.w + p.x === i));
    if (j < 0) return "none";
    board[j] = { kind: "empty" };
    return "removed";
  }

  const t = board[i];
  if (t.kind !== "empty") {
    if (!t.placed) return "none";
    return cycle(game, i, t);
  }

  const kind = tool.kind as TileKind;
  const tile: Tile = { kind, mask: tool.mask, from: tool.from, placed: true };
  switch (kind) {
    case "portal": {
      const count = new Map<number, number>();
      for (const b of board) if (b.kind === "portal") count.set(b.pair ?? 0, (count.get(b.pair ?? 0) ?? 0) + 1);
      const lonely = [...count].find(([, n]) => n === 1);
      tile.pair = lonely ? lonely[0] : nextPair++;
      break;
    }
    case "blackhole": case "satellite":
      tile.pair = unmatched(board, kind === "blackhole" ? "whitehole" : "dish", kind) ?? nextPair++;
      if (kind === "satellite") tile.delay = 1;
      break;
    case "whitehole": case "dish":
      tile.pair = unmatched(board, kind === "whitehole" ? "blackhole" : "satellite", kind) ?? nextPair++;
      break;
    case "comet":
      tile.seq = board.filter((b) => b.kind === "comet").length;
      break;
    case "asteroid": {
      const lane = laneFrom(game, x, y);
      if (lane.length < 2) return "none";
      tile.track = [...lane, ...lane.slice(1, -1).reverse()];
      tile.phase = 0;
      board[lane[0].y * l.w + lane[0].x] = tile;
      return "placed";
    }
  }
  board[i] = tile;
  return "placed";
}

/** Tapping something already placed: its next variant, or back into the tray. */
function cycle(game: Game, i: number, t: Tile): SandboxResult {
  const board = game.board;
  const remove = (): SandboxResult => {
    board[i] = { kind: "empty" };
    if (t.kind === "comet") renumberComets(board);
    return "removed";
  };
  switch (t.kind) {
    case "mirrorB": board[i] = { ...t, kind: "mirrorA" }; return "rotated";
    case "tint": {
      const k = TINTS.findIndex((v) => v.from === t.from && v.mask === t.mask);
      if (k + 1 >= TINTS.length) return remove();
      board[i] = { ...t, ...TINTS[k + 1] };
      return "rotated";
    }
    case "receptor": {
      const k = RINGS.indexOf(t.mask ?? WHITE);
      if (k + 1 >= RINGS.length) return remove();
      board[i] = { ...t, mask: RINGS[k + 1] };
      return "rotated";
    }
    case "satellite": {
      const d = t.delay ?? 1;
      if (d >= 3) return remove();
      board[i] = { ...t, delay: d + 1 };
      return "rotated";
    }
    default: return remove();
  }
}

/** A pair id whose `want` end exists with no matching `self` end yet. */
function unmatched(board: Tile[], want: TileKind, self: TileKind): number | undefined {
  const mine = new Set(board.filter((b) => b.kind === self).map((b) => b.pair));
  const theirs = board.filter((b) => b.kind === want && !mine.has(b.pair));
  return theirs.length ? theirs[theirs.length - 1].pair : undefined;
}

function renumberComets(board: Tile[]) {
  board
    .map((t, i) => ({ t, i }))
    .filter((e) => e.t.kind === "comet")
    .sort((a, b) => (a.t.seq ?? 0) - (b.t.seq ?? 0))
    .forEach((e, k) => { board[e.i] = { ...e.t, seq: k }; });
}

/** Free cells for an asteroid to drift along: rightwards if there is room, else left, else down. */
function laneFrom(game: Game, x: number, y: number): { x: number; y: number }[] {
  const l = game.level;
  const free = (cx: number, cy: number) =>
    cx >= 0 && cy >= 0 && cx < l.w && cy < l.h &&
    game.board[cy * l.w + cx].kind === "empty" && !game.noBuild.has(cy * l.w + cx);
  const lanes = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => {
    const lane = [{ x, y }];
    while (lane.length < 4 && free(x + dx * lane.length, y + dy * lane.length)) {
      lane.push({ x: x + dx * lane.length, y: y + dy * lane.length });
    }
    return lane;
  });
  // The first direction with room to really drift; failing that, the longest.
  return lanes.find((l) => l.length >= 3) ?? lanes.reduce((a, b) => (b.length > a.length ? b : a));
}

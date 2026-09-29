/**
 * What every piece does, in words — the single source for the tray caption,
 * the tap-to-inspect toast, the how-to screen and the first-encounter cards.
 *
 * Each entry also carries a tiny demo board. The demos are real levels run by
 * the real engine and drawn by the real renderer, so an explanation can never
 * disagree with what the piece actually does on the board.
 */
import { Chan, Dir, Level, Light, Tile, TileKind, WHITE } from "../engine/types";
import { LIGHT_LABEL } from "../render/theme";

export type PieceKey =
  | "mirror" | "splitter" | "crystal" | "tint" | "portal"
  | "blackhole" | "whitehole" | "wall" | "star" | "receptor";

export interface PieceInfo {
  key: PieceKey;
  name: string;
  /** One line, for the tray caption and toasts. */
  short: string;
  /** A few sentences, for the introduction card. */
  detail: string;
  /** The icon to draw for it. */
  icon: { kind: TileKind; mask?: Light; from?: Light };
}

export const INFO: Record<PieceKey, PieceInfo> = {
  mirror: {
    key: "mirror", name: "Mirror",
    short: "Bends light 90°. Tap a mirror you placed to flip it, again to take it back.",
    detail: "A mirror turns the beam through a right angle. Tap one you placed to flip " +
      "it the other way; tap once more to pick it back up.",
    icon: { kind: "mirrorB" },
  },
  splitter: {
    key: "splitter", name: "Splitter",
    short: "Sends light out of both sides at once — never straight through.",
    detail: "The splitter divides a beam into two, leaving at right angles on either " +
      "side. Nothing carries straight on, so the way you came in is always blocked.",
    icon: { kind: "splitter" },
  },
  crystal: {
    key: "crystal", name: "Crystal",
    short: "Splits moonlight into red, green and blue. Arrows show where each goes.",
    detail: "White light entering a crystal comes out as three colours. From the " +
      "light's point of view, red peels off to its left, blue to its right, and " +
      "green carries straight on. Light that is already coloured passes through " +
      "untouched. The coloured arrows on a crystal show which way each will go.",
    icon: { kind: "crystal" },
  },
  tint: {
    key: "tint", name: "Tint",
    short: "Turns one colour into another. Light of any other colour passes through.",
    detail: "A tint changes the colour of light that passes through it — the left dot " +
      "becomes the right dot. Light of any other colour goes straight through " +
      "unchanged. A tint never destroys light, so it is always safe to try one.",
    icon: { kind: "tint", from: Chan.R, mask: Chan.B },
  },
  portal: {
    key: "portal", name: "Portal",
    short: "Light entering one portal leaves the other, still travelling the same way.",
    detail: "Portals come in pairs. Light that enters either one steps out of the " +
      "other, still heading in the same direction. They work in both directions.",
    icon: { kind: "portal" },
  },
  blackhole: {
    key: "blackhole", name: "Black hole",
    short: "Swallows light, which falls back out of its white hole.",
    detail: "A black hole swallows any light that touches it — and the light falls " +
      "back out of the matching white hole, still travelling the same way. Unlike a " +
      "portal it only works one way: nothing goes back.",
    icon: { kind: "blackhole" },
  },
  whitehole: {
    key: "whitehole", name: "White hole",
    short: "Where a black hole's light comes back out. Otherwise light passes through.",
    detail: "The exit for a black hole. Light swallowed by the black hole reappears " +
      "here. Light that wanders into a white hole directly just passes through it.",
    icon: { kind: "whitehole" },
  },
  wall: {
    key: "wall", name: "Wall",
    short: "Stops light dead. Some slide back and forth.",
    detail: "Walls absorb any light that hits them. Some move along a track, so a path " +
      "that is blocked now may be open a moment later.",
    icon: { kind: "wall" },
  },
  star: {
    key: "star", name: "Star",
    short: "Light passes through and collects it. Any colour of light will do.",
    detail: "Stars are transparent: light carries on through them. Every star must be " +
      "touched by light to finish the night — and any colour counts, whatever colour " +
      "the star happens to be shimmering.",
    icon: { kind: "star" },
  },
  receptor: {
    key: "receptor", name: "Ring",
    short: "The goal. Needs exactly its colour — dots inside mean colours together.",
    detail: "Rings are what you are lighting. Each one needs exactly its own colour: " +
      "too much light fails it just like too little. Dots inside a ring mean it needs " +
      "those colours together, so two beams have to arrive at it.",
    icon: { kind: "receptor", mask: WHITE },
  },
};

export function infoKey(kind: TileKind): PieceKey | null {
  if (kind === "mirrorA" || kind === "mirrorB") return "mirror";
  if (kind === "empty") return null;
  return kind as PieceKey;
}

/** The one-liner for a specific tile, including what a particular tint does. */
export function describe(t: Tile): { name: string; text: string } | null {
  const k = infoKey(t.kind);
  if (!k) return null;
  const base = INFO[k];
  if (k === "tint") {
    const to = LIGHT_LABEL[t.mask ?? WHITE] ?? "";
    const text = t.from === undefined
      ? `Turns any light ${to}.`
      : `Turns ${LIGHT_LABEL[t.from] ?? ""} light into ${to}. Other colours pass straight through.`;
    return { name: base.name, text };
  }
  if (k === "receptor" && t.mask !== undefined && t.mask !== WHITE) {
    return { name: `${LIGHT_LABEL[t.mask]} ring`, text: `Needs exactly ${LIGHT_LABEL[t.mask]} light. ${base.short}` };
  }
  return { name: base.name, text: base.short };
}

// ---------------------------------------------------------------- demo boards

function board(w: number, h: number, col: number, light: Light = WHITE): Level {
  return {
    id: "demo", name: "demo", w, h,
    tiles: Array.from({ length: w * h }, () => ({ kind: "empty" } as Tile)),
    emitters: [{ x: col, y: 0, dir: Dir.Down, light }],
    inventory: [],
  };
}

/** A small level that shows one piece doing its one thing. */
export function demoLevel(k: PieceKey): Level {
  const put = (l: Level, x: number, y: number, t: Tile) => { l.tiles[y * l.w + x] = t; };
  let l: Level;
  switch (k) {
    case "mirror":
      l = board(3, 3, 1);
      put(l, 1, 1, { kind: "mirrorB" });
      put(l, 2, 1, { kind: "receptor", mask: WHITE });
      return l;
    case "splitter":
      l = board(3, 3, 1);
      put(l, 1, 1, { kind: "splitter" });
      put(l, 0, 1, { kind: "receptor", mask: WHITE });
      put(l, 2, 1, { kind: "receptor", mask: WHITE });
      return l;
    case "crystal":
      l = board(3, 3, 1);
      put(l, 1, 1, { kind: "crystal" });
      put(l, 2, 1, { kind: "receptor", mask: Chan.R });
      put(l, 1, 2, { kind: "receptor", mask: Chan.G });
      put(l, 0, 1, { kind: "receptor", mask: Chan.B });
      return l;
    case "tint":
      l = board(3, 3, 1, Chan.R);
      put(l, 1, 1, { kind: "tint", from: Chan.R, mask: Chan.B });
      put(l, 1, 2, { kind: "receptor", mask: Chan.B });
      return l;
    case "portal":
      l = board(4, 3, 0);
      put(l, 0, 1, { kind: "portal", pair: 1 });
      put(l, 3, 1, { kind: "portal", pair: 1 });
      put(l, 3, 2, { kind: "receptor", mask: WHITE });
      return l;
    case "blackhole":
    case "whitehole":
      l = board(4, 3, 0);
      put(l, 0, 1, { kind: "blackhole", pair: 1 });
      put(l, 3, 1, { kind: "whitehole", pair: 1 });
      put(l, 3, 2, { kind: "receptor", mask: WHITE });
      return l;
    case "wall":
      l = board(3, 3, 1);
      put(l, 1, 1, { kind: "wall" });
      put(l, 1, 2, { kind: "receptor", mask: WHITE });
      return l;
    case "star":
      l = board(3, 3, 1);
      put(l, 1, 1, { kind: "star" });
      put(l, 1, 2, { kind: "receptor", mask: WHITE });
      return l;
    case "receptor":
      l = board(3, 3, 1);
      put(l, 1, 2, { kind: "receptor", mask: WHITE });
      return l;
  }
}

/** Every piece kind appearing in a level, board and tray together. */
export function kindsIn(level: Level): PieceKey[] {
  const out = new Set<PieceKey>();
  for (const t of level.tiles) { const k = infoKey(t.kind); if (k) out.add(k); }
  for (const it of level.inventory) { const k = infoKey(it.kind); if (k) out.add(k); }
  // Introduce things in the order a player would meet them.
  const order: PieceKey[] = ["receptor", "mirror", "wall", "star", "splitter", "crystal",
    "tint", "portal", "blackhole", "whitehole"];
  return order.filter((k) => out.has(k));
}

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

/** Tile kinds, plus the things on a board that are not tiles. */
export type IconKind = TileKind | "warp" | "milkyway" | "moon" | "cube";

export type PieceKey =
  | "mirror" | "splitter" | "crystal" | "tint" | "portal"
  | "blackhole" | "whitehole" | "wall" | "star" | "receptor"
  | "asteroid" | "satellite" | "dish" | "comet" | "terrain" | "warp" | "milkyway" | "cube";

export interface PieceInfo {
  key: PieceKey;
  name: string;
  /** One line, for the tray caption and toasts. */
  short: string;
  /** A few sentences, for the introduction card. */
  detail: string;
  /** The icon to draw for it. */
  icon: { kind: IconKind; mask?: Light; from?: Light };
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
  milkyway: {
    key: "milkyway", name: "Milky Way",
    short: "Light crossing it shines brighter and scores five times the points.",
    detail: "A stretch of the Milky Way lies across some cells. It is not a piece — " +
      "you can build on top of it — but every cell of light that crosses it is worth " +
      "five times as much. Solving is the goal; routing through here is the style.",
    icon: { kind: "milkyway" },
  },
  comet: {
    key: "comet", name: "Shooting star",
    short: "Catch its pieces in order: the big bright one first, then the next lights up.",
    detail: "A shooting star is broken into numbered pieces. Only the big, bright one " +
      "can be caught; when light reaches it, the star leaps to the next piece and that " +
      "one lights up. Catch every piece, in order, in a single shine — the tune climbs " +
      "with each one. Light passing a piece before its turn does nothing.",
    icon: { kind: "comet" },
  },
  terrain: {
    key: "terrain", name: "Rough ground",
    short: "Light crosses it, but nothing can be built on it.",
    detail: "Broken, rocky ground. Light passes over it freely, but there is nowhere " +
      "to stand a piece — so the obvious spot for a mirror may not be available.",
    icon: { kind: "terrain" },
  },
  warp: {
    key: "warp", name: "Warp",
    short: "A row or column whose ends are joined: leave one gate, come back in the other.",
    detail: "Matching coloured gates on opposite edges of the board mark a warp. Light " +
      "leaving through one gate is pulled through a tunnel under the board and comes " +
      "back in through the other, still travelling the same way.",
    icon: { kind: "warp" },
  },
  asteroid: {
    key: "asteroid", name: "Asteroid",
    short: "Drifts back and forth and smashes any light it meets. Costs points.",
    detail: "Asteroids drift along a lane, and light that hits one is broken — and " +
      "costs you points. Light takes time to cross the board, so whether an asteroid " +
      "is in the way depends on the moment you press Shine. Watch it, and pick your moment.",
    icon: { kind: "asteroid" },
  },
  satellite: {
    key: "satellite", name: "Satellite",
    short: "Catches light and beams it down at its dish, a moment later.",
    detail: "A satellite catches light and carries it to its dish, which sends it on in " +
      "the same direction. The trip takes time — the dots show how many ticks — so by " +
      "the time the light comes back down, anything moving has moved.",
    icon: { kind: "satellite" },
  },
  cube: {
    key: "cube", name: "The cube",
    short: "The board is a cube: light off one edge carries on over it onto the next face.",
    detail: "Out here the board folds into a cube, and all six faces are copies of the grid " +
      "you build on — a piece you place sits on every face at once. Light that runs off an " +
      "edge carries on over it onto the next face, and the board turns to follow. Each face " +
      "meets the light from a different side, so the same mirror can send it somewhere new. " +
      "Rings here can only be reached by going round.",
    icon: { kind: "cube" },
  },
  dish: {
    key: "dish", name: "Dish",
    short: "Where a satellite puts its light back down. Otherwise light passes through.",
    detail: "The ground station for a satellite. Light the satellite carries is released " +
      "here, still travelling the way it was going. Light that wanders in directly " +
      "just passes through.",
    icon: { kind: "dish" },
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
    case "milkyway":
      l = board(3, 3, 1);
      l.galaxy = [0, 1, 2, 3, 4, 5];
      put(l, 1, 2, { kind: "receptor", mask: WHITE });
      return l;
    case "comet":
      l = board(4, 3, 1);
      put(l, 1, 1, { kind: "comet", seq: 0 });
      put(l, 1, 2, { kind: "mirrorB" });
      put(l, 2, 2, { kind: "comet", seq: 1 });
      put(l, 3, 2, { kind: "receptor", mask: WHITE });
      return l;
    case "terrain":
      l = board(3, 3, 1);
      put(l, 0, 1, { kind: "terrain" });
      put(l, 1, 1, { kind: "terrain" });
      put(l, 2, 1, { kind: "terrain" });
      put(l, 1, 2, { kind: "receptor", mask: WHITE });
      return l;
    case "warp":
      // Down into a mirror, off the right edge, back in from the left, and
      // round the mirror's other face into the ring.
      l = board(4, 3, 1);
      l.warps = [{ axis: "row", index: 1, hue: 0 }];
      put(l, 1, 1, { kind: "mirrorB" });
      put(l, 1, 2, { kind: "receptor", mask: WHITE });
      return l;
    case "asteroid":
      l = board(3, 3, 1);
      put(l, 0, 1, { kind: "asteroid", track: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }], phase: 1 });
      put(l, 1, 2, { kind: "receptor", mask: WHITE });
      return l;
    case "cube":
      // Off the right edge, onto the right face — where the same mirror,
      // met from the other side, turns the light down into the ring.
      l = board(5, 5, 1);
      l.cube = true;
      put(l, 1, 1, { kind: "mirrorB" });
      put(l, 1, 3, { kind: "receptor", mask: WHITE });
      return l;
    case "satellite":
    case "dish":
      l = board(4, 3, 0);
      put(l, 0, 1, { kind: "satellite", pair: 1, delay: 1 });
      put(l, 3, 1, { kind: "dish", pair: 1 });
      put(l, 3, 2, { kind: "receptor", mask: WHITE });
      return l;
  }
}

/** Every piece kind appearing in a level, board and tray together. */
export function kindsIn(level: Level): PieceKey[] {
  const out = new Set<PieceKey>();
  for (const t of level.tiles) { const k = infoKey(t.kind); if (k) out.add(k); }
  for (const it of level.inventory) { const k = infoKey(it.kind); if (k) out.add(k); }
  if (level.warps?.length) out.add("warp");
  if (level.galaxy?.length) out.add("milkyway");
  if (level.cube) out.add("cube");
  // Introduce things in the order a player would meet them. The dish is
  // explained on the satellite's card.
  const order: PieceKey[] = ["receptor", "mirror", "wall", "star", "milkyway", "splitter", "crystal",
    "tint", "comet", "portal", "terrain", "warp", "blackhole", "whitehole", "asteroid", "satellite", "cube"];
  return order.filter((k) => out.has(k));
}

/**
 * Medals: three optional challenges on every night, so a solved night still
 * has something to come back for.
 *
 *   ☾  Lit      solve it
 *   ✦  Fewest   solve it with the fewest pieces possible
 *   ☄  Clean    solve it on the first Shine, with no hint or booster
 *
 * Stored as a bitmask per night and only ever added to.
 */
export const MEDALS = [
  { bit: 1, glyph: "☾", name: "Lit", how: "Solve it" },
  { bit: 2, glyph: "✦", name: "Fewest", how: "Use the fewest pieces possible" },
  { bit: 4, glyph: "☄", name: "Clean", how: "Solve it on the first Shine, with no help" },
] as const;

export function medalsFor(s: { solved: boolean; used: number; par: number; firstTry: boolean }): number {
  if (!s.solved) return 0;
  let m = 1;
  if (s.par > 0 && s.used <= s.par) m |= 2;
  if (s.firstTry) m |= 4;
  return m;
}

export const medalCount = (mask: number) => (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1);

/** The medals newly won, given what a night already had. */
export function newMedals(before: number, now: number) {
  return MEDALS.filter((m) => (now & m.bit) && !(before & m.bit));
}

// ---------------------------------------------------------------- the star map

/** One night's constellation: the cells the light joined up, on its board. */
export interface Constellation { w: number; h: number; pts: number[] }

/**
 * A constellation for a level that was solved before the star map existed:
 * the moon's entry, its solution's pieces and its goals, chained
 * nearest-first from the moon — close to the route the light takes.
 */
export function constellationOf(level: {
  w: number; h: number; tiles: { kind: string }[]; emitters: { x: number; y: number }[]; solution?: { i: number }[];
}): Constellation {
  const goals = level.tiles.map((t, i) => (t.kind === "receptor" || t.kind === "star" || t.kind === "comet" ? i : -1)).filter((i) => i >= 0);
  const entry = level.emitters[0] ? level.emitters[0].y * level.w + level.emitters[0].x : -1;
  const left = [...new Set([...goals, ...(level.solution ?? []).map((p) => p.i)])].filter((i) => i !== entry);
  const pts: number[] = entry >= 0 ? [entry] : [];
  let x = level.emitters[0]?.x ?? 0, y = level.emitters[0]?.y ?? 0;
  while (left.length) {
    let best = 0, bd = Infinity;
    left.forEach((i, k) => {
      const d = Math.hypot((i % level.w) - x, Math.floor(i / level.w) - y);
      if (d < bd) { bd = d; best = k; }
    });
    const i = left.splice(best, 1)[0];
    pts.push(i);
    x = i % level.w; y = Math.floor(i / level.w);
  }
  return { w: level.w, h: level.h, pts };
}

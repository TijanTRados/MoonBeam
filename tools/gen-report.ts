/**
 * Generate a pack of levels and report on them.
 *
 * Useful for eyeballing what the generator is actually producing, and for
 * regression-checking after changing budgets or the difficulty model.
 *
 *   npx tsx tools/gen-report.ts            # 20 campaign nights
 *   npx tsx tools/gen-report.ts 40         # 40 nights
 *   npx tsx tools/gen-report.ts 12 --draw  # 12 nights, with ASCII boards
 */
import { Level } from "../src/engine/types";
import { evaluate } from "../src/engine/simulate";
import { generateCampaignLevel, campaignDifficulty } from "../src/engine/generate";

const args = process.argv.slice(2);
const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 20);
const drawBoards = args.includes("--draw");

const GLYPH: Record<string, string> = {
  empty: "·", wall: "▓", mirrorA: "/", mirrorB: "\\", splitter: "◇",
  prism: "△", filter: "▣", star: "✦", receptor: "◎", portal: "◉",
};

function render(l: Level): string[] {
  const out: string[] = [];
  const moon = " ".repeat(l.emitters[0].x * 2 + 2) + "☾";
  out.push(moon);
  for (let y = 0; y < l.h; y++) {
    let row = "  ";
    for (let x = 0; x < l.w; x++) row += GLYPH[l.tiles[y * l.w + x].kind] + " ";
    out.push(row);
  }
  return out;
}

console.log(`\nMoonBeam — generating ${count} campaign nights\n`);
console.log("  n  target  scored  par  tray  rings  stars  walls  ms   ok");
console.log("  " + "-".repeat(62));

let totalMs = 0;
let bad = 0;
const scored: number[] = [];

for (let n = 1; n <= count; n++) {
  const t0 = performance.now();
  const g = generateCampaignLevel(n);
  const ms = performance.now() - t0;
  totalMs += ms;

  const l = g.level;
  let rings = 0, stars = 0, walls = 0;
  for (const t of l.tiles) {
    if (t.kind === "receptor") rings++;
    if (t.kind === "star") stars++;
    if (t.kind === "wall") walls++;
  }
  const tray = l.inventory.reduce((s, it) => s + it.count, 0);

  // Verify the shipped solution really wins.
  const board: Level = { ...l, tiles: l.tiles.map((t) => ({ ...t })), inventory: [] };
  for (const p of l.solution ?? []) board.tiles[p.i] = { kind: p.kind, mask: p.mask };
  const ok = (l.solution?.length ?? 0) > 0 && evaluate(board).won;
  if (!ok) bad++;
  scored.push(l.difficulty ?? 0);

  console.log(
    `  ${String(n).padStart(2)}  ${campaignDifficulty(n).toFixed(1).padStart(6)}  ` +
    `${(l.difficulty ?? 0).toFixed(1).padStart(6)}  ${String(l.par).padStart(3)}  ` +
    `${String(tray).padStart(4)}  ${String(rings).padStart(5)}  ${String(stars).padStart(5)}  ` +
    `${String(walls).padStart(5)}  ${ms.toFixed(0).padStart(3)}  ${ok ? "✓" : "✗ FAIL"}`,
  );

  if (drawBoards) {
    console.log();
    for (const line of render(l)) console.log("   " + line);
    console.log(`    tray: ${l.inventory.map((i) => `${i.kind}×${i.count}`).join(", ")}\n`);
  }
}

console.log("  " + "-".repeat(62));
console.log(
  `\n  ${count} levels in ${totalMs.toFixed(0)}ms (${(totalMs / count).toFixed(0)}ms each)` +
  `\n  difficulty ${Math.min(...scored).toFixed(1)} to ${Math.max(...scored).toFixed(1)}` +
  `\n  ${bad === 0 ? "all solutions verified" : `${bad} INVALID`}\n`,
);
if (bad) process.exit(1);

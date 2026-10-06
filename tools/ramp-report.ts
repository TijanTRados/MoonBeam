/**
 * Where does the campaign get hard?
 *
 * Generates every night in a range across several run seeds and prints the
 * averages that make a night hard for a person: how many pieces must be right
 * at once (fewest), how many decoys the tray offers, how many rings and
 * colours, whether two beams must meet, how much is moving, and how hard the
 * solver had to search.
 *
 *   npx tsx tools/ramp-report.ts            # nights 1-40, 4 seeds
 *   npx tsx tools/ramp-report.ts 11 30 6    # nights 11-30, 6 seeds
 */
import { generateCampaignLevel } from "../src/engine/generate";
import { nightDifficulty, phaseFor } from "../src/engine/phases";
import { features } from "../src/engine/solver";

const [from = 1, to = 40, seeds = 4] = process.argv.slice(2).map(Number);

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const f1 = (x: number) => x.toFixed(1).padStart(5);

console.log(`\n  night world     target  rated fewest  tray decoy rings cols  2beam  move search   ms`);
for (let n = from; n <= to; n++) {
  const rows: number[][] = [];
  let ms = 0;
  let target = 0;
  for (let s = 1; s <= seeds; s++) {
    const t0 = performance.now();
    const g = generateCampaignLevel(n, s);
    ms += performance.now() - t0;
    const l = g.level;
    const f = features(l, g.analysis);
    const tray = l.inventory.reduce((a, it) => a + it.count, 0);
    rows.push([g.analysis.difficulty, f[0], tray, f[5], f[3] + 1, f[2] + 1, f[11], f[6], f[7]]);
    target = nightDifficulty(n);
  }
  const col = (k: number) => f1(avg(rows.map((r) => r[k])));
  const { phase } = phaseFor(n);
  console.log(
    `  ${String(n).padStart(5)} ${phase.name.padEnd(9).slice(0, 9)} ${f1(target)}  ${col(0)} ${col(1)} ${col(2)} ${col(3)} ${col(4)} ${col(5)} ${col(6)} ${col(7)} ${col(8)} ${String(Math.round(ms / seeds)).padStart(4)}`,
  );
}

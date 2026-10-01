/**
 * Where does generation time go? Times `simulate` on boards with and without
 * warps and moving parts, and counts how many steps a typical call takes.
 */
import { generateLevel } from "../src/engine/generate";
import { simulate } from "../src/engine/simulate";
import { solve } from "../src/engine/solver";

const buckets: Record<string, { n: number; ms: number; steps: number; solveMs: number }> = {};
for (let s = 0; s < 30; s++) {
  const l = generateLevel(s * 977 + 5, { difficulty: 6 }).level;
  const key = `${l.warps?.length ? "warp" : "nowarp"}/${l.tiles.some((t) => t.track) ? "moving" : "static"}`;
  const b = (buckets[key] ??= { n: 0, ms: 0, steps: 0, solveMs: 0 });
  const t0 = performance.now();
  let steps = 0;
  for (let k = 0; k < 200; k++) steps += simulate(l, k % 3).segments.length;
  b.ms += (performance.now() - t0) / 200;
  b.steps += steps / 200;
  const t1 = performance.now();
  solve(l, { nodeBudget: 3000, solutionCap: 12 });
  b.solveMs += performance.now() - t1;
  b.n++;
}
for (const [k, b] of Object.entries(buckets)) {
  console.log(`${k.padEnd(16)} n=${String(b.n).padStart(2)}  simulate ${(b.ms / b.n * 1000).toFixed(0)}us  segs ${(b.steps / b.n).toFixed(0)}  solve(3k) ${(b.solveMs / b.n).toFixed(0)}ms`);
}

/**
 * Fits the difficulty model.
 *
 * The generator is told to aim for a target, and the features of what it
 * produces (piece count, branching, colours, ...) turn out to scale cleanly
 * with that target. So rather than hand-picking coefficients, we treat the
 * target as a ground-truth label and least-squares fit a linear model to the
 * features. The printed coefficients are pasted into `scoreDifficulty`.
 *
 * Run with: npx tsx tools/fit-difficulty.ts
 */
import { Level } from "../src/engine/types";
import { features, FEATURE_NAMES } from "../src/engine/solver";
import * as G from "../src/engine/generate";

const X: number[][] = [];
const y: number[] = [];

for (const target of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
  for (let n = 0; n < 90; n++) {
    const g = G.generateLevel(n * 7717 + target * 1013, {
      difficulty: target, tolerance: 99, attempts: 1,
    });
    if (g.attempts === 0) continue; // fell through to the fallback
    const l: Level = g.level;
    X.push([1, ...features(l, g.analysis)]);
    y.push(target);
  }
}

console.log(`fitting on ${X.length} generated levels\n`);

// Normal equations: (X'X) b = X'y, solved by Gaussian elimination with partial
// pivoting. Tiny system (11x11), so nothing cleverer is warranted.
const p = X[0].length;
const A: number[][] = Array.from({ length: p }, () => new Array(p + 1).fill(0));
for (let i = 0; i < p; i++) {
  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let k = 0; k < X.length; k++) s += X[k][i] * X[k][j];
    A[i][j] = s;
  }
  let s = 0;
  for (let k = 0; k < X.length; k++) s += X[k][i] * y[k];
  A[i][p] = s;
}
// Ridge term keeps the fit stable when two features move together.
for (let i = 0; i < p; i++) A[i][i] += 1e-3;

for (let c = 0; c < p; c++) {
  let piv = c;
  for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
  [A[c], A[piv]] = [A[piv], A[c]];
  const d = A[c][c];
  if (Math.abs(d) < 1e-12) continue;
  for (let j = c; j <= p; j++) A[c][j] /= d;
  for (let r = 0; r < p; r++) {
    if (r === c) continue;
    const f = A[r][c];
    for (let j = c; j <= p; j++) A[r][j] -= f * A[c][j];
  }
}
const b = A.map((row) => row[p]);

console.log("const COEF = {");
console.log(`  base: ${b[0].toFixed(4)},`);
FEATURE_NAMES.forEach((n, i) => console.log(`  ${n}: ${b[i + 1].toFixed(4)},`));
console.log("};\n");

// Report fit quality per target.
const pred = X.map((row) => row.reduce((s, v, i) => s + v * b[i], 0));
let sse = 0, sst = 0;
const ybar = y.reduce((a, c) => a + c, 0) / y.length;
for (let i = 0; i < y.length; i++) { sse += (pred[i] - y[i]) ** 2; sst += (y[i] - ybar) ** 2; }
console.log(`R^2 = ${(1 - sse / sst).toFixed(3)}, RMSE = ${Math.sqrt(sse / y.length).toFixed(2)}\n`);

for (let t = 1; t <= 10; t++) {
  const ps = pred.filter((_, i) => y[i] === t);
  if (!ps.length) continue;
  const m = ps.reduce((a, c) => a + c, 0) / ps.length;
  const lo = Math.min(...ps), hi = Math.max(...ps);
  console.log(`  target ${String(t).padStart(2)} -> predicted ${m.toFixed(2)}  [${lo.toFixed(1)}, ${hi.toFixed(1)}]  n=${ps.length}`);
}

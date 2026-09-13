import { generateLevel } from "../src/engine/generate";
import { solve } from "../src/engine/solver";
import { simulate, evaluate } from "../src/engine/simulate";
import { Level, Dir, WHITE, Tile } from "../src/engine/types";

const blank = (): Level => ({
  id: "p", name: "p", w: 7, h: 7,
  tiles: Array.from({ length: 49 }, () => ({ kind: "empty" } as Tile)),
  emitters: [{ x: 3, y: 0, dir: Dir.Down, light: WHITE }],
  inventory: [{ kind: "mirrorB", count: 3 }],
});

let t = performance.now();
for (let i = 0; i < 20000; i++) simulate(blank(), 0);
console.log(`simulate      : ${((performance.now() - t) / 20000 * 1000).toFixed(1)}us`);

t = performance.now();
for (let i = 0; i < 20000; i++) evaluate(blank());
console.log(`evaluate      : ${((performance.now() - t) / 20000 * 1000).toFixed(1)}us`);

const l = blank();
l.tiles[6 * 7 + 6] = { kind: "receptor", mask: WHITE };
t = performance.now();
const r = solve(l);
console.log(`solve (3 mir) : ${(performance.now() - t).toFixed(1)}ms  nodes=${r.nodes} solved=${r.solved} sols=${r.solutionCount}`);

for (const d of [1, 3, 5, 7, 9]) {
  t = performance.now();
  const g = generateLevel(d * 99991, { difficulty: d });
  console.log(
    `generate d=${d}    : ${(performance.now() - t).toFixed(0)}ms  attempts=${g.attempts} ` +
    `actual=${g.level.difficulty} par=${g.level.par} nodes=${g.analysis.nodes} sols=${g.analysis.solutionCount}`,
  );
}

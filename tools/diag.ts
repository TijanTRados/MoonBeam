/** Calibration: what do generated levels actually look like per target? */
import { Level } from "../src/engine/types";
import * as G from "../src/engine/generate";

interface Row { pieces: number; branch: number; cols: number; recs: number; stars: number; tray: number; nodes: number; trunc: number; sols: number; depth: number; moving: number }

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

for (const target of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
  const rows: Row[] = [];
  for (let n = 0; n < 60; n++) {
    const g = G.generateLevel(n * 7717 + target * 1013, {
      difficulty: target, tolerance: 99, attempts: 1,
    });
    if (g.attempts === 0) continue;
    const l: Level = g.level;
    let branch = 0, recs = 0, stars = 0, moving = 0;
    const cols = new Set<number>();
    for (const t of l.tiles) {
      if (t.kind === "receptor") { recs++; cols.add(t.mask ?? 7); }
      if (t.kind === "star") stars++;
      if (t.kind === "splitter" || t.kind === "crystal") branch++;
      if (t.track && t.track.length > 1) moving++;
    }
    for (const it of l.inventory) if (it.kind === "splitter" || it.kind === "crystal") branch += it.count;
    const tray = l.inventory.reduce((s, it) => s + it.count, 0);
    rows.push({
      pieces: l.par ?? 0, branch, cols: cols.size, recs, stars,
      tray: tray - (l.par ?? 0),
      nodes: g.analysis.nodes, trunc: g.analysis.truncated ? 1 : 0,
      sols: g.analysis.solutionCount, depth: 0, moving,
    });
  }
  if (!rows.length) { console.log(`target ${target}: none`); continue; }
  console.log(
    `d=${String(target).padStart(2)} n=${String(rows.length).padStart(2)} | ` +
    `par ${mean(rows.map(r => r.pieces)).toFixed(1)} | ` +
    `branch ${mean(rows.map(r => r.branch)).toFixed(1)} | ` +
    `cols ${mean(rows.map(r => r.cols)).toFixed(1)} | ` +
    `recs ${mean(rows.map(r => r.recs)).toFixed(1)} | ` +
    `stars ${mean(rows.map(r => r.stars)).toFixed(1)} | ` +
    `extra ${mean(rows.map(r => r.tray)).toFixed(1)} | ` +
    `nodes ${mean(rows.map(r => r.nodes)).toFixed(0)} | ` +
    `trunc ${(mean(rows.map(r => r.trunc)) * 100).toFixed(0)}% | ` +
    `sols ${mean(rows.map(r => r.sols)).toFixed(1)} | ` +
    `mov ${mean(rows.map(r => r.moving)).toFixed(1)}`,
  );
}

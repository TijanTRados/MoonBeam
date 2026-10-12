/**
 * Run every test suite, each in its own process, and add them up.
 *
 *   npm test             # everything
 *   npm test -- cube     # only suites whose file name contains "cube"
 *
 * Each suite is a plain script that prints "<n> passed, <m> failed" and exits
 * non-zero on failure, so they stay runnable on their own with `npx tsx`.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const filter = process.argv.slice(2).join(" ").trim();

// The engine first: if the physics is broken, nothing after it means much.
const ORDER = ["engine", "cube", "elements", "phases", "reveal", "help", "sandbox", "daily", "leaderboard"];
const suites = readdirSync(here)
  .filter((f) => f.endsWith(".test.ts") && (!filter || f.includes(filter)))
  .sort((a, b) => {
    const ra = ORDER.indexOf(a.replace(".test.ts", "")), rb = ORDER.indexOf(b.replace(".test.ts", ""));
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || a.localeCompare(b);
  });

if (!suites.length) {
  console.log(`No test suite matches "${filter}".`);
  process.exit(1);
}

let passed = 0, failed = 0;
const broken: string[] = [];
const t0 = performance.now();

for (const file of suites) {
  const name = file.replace(".test.ts", "");
  const s0 = performance.now();
  const r = spawnSync(process.execPath, ["--import", "tsx", join(here, file)], { encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const p = m ? Number(m[1]) : 0, f = m ? Number(m[2]) : 0;
  passed += p;
  failed += f;
  const ok = r.status === 0 && m !== null;
  if (!ok) broken.push(name);
  const secs = ((performance.now() - s0) / 1000).toFixed(1);
  console.log(`  ${ok ? "✓" : "✗"} ${name.padEnd(12)} ${String(p).padStart(3)} passed${f ? `, ${f} failed` : ""}  ${secs}s`);
  // Show a failing suite's own report — or, if it crashed, whatever it said.
  if (!ok) console.log(out.split("\n").map((l) => `      ${l}`).join("\n"));
}

const secs = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`\n  ${passed} passed, ${failed} failed across ${suites.length} suite${suites.length === 1 ? "" : "s"} in ${secs}s`);
if (broken.length) {
  console.log(`  broken: ${broken.join(", ")}`);
  process.exit(1);
}

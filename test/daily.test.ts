/**
 * The daily puzzle: numbering, the weekly rhythm, determinism, streaks and the
 * share card.
 */
import { tileFrom } from "../src/engine/types";
import { evaluate } from "../src/engine/simulate";
import {
  dailyDate, dailyDifficulty, dailyMoon, dailyNumber, formatTime, generateDaily, levelHash,
  liveStreak, nextStreak, shareText, weekday,
} from "../src/game/daily";

let passed = 0;
let failed = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else { failed++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); }
}

// ---------------------------------------------------------------- numbering

ok("1 October 2026 is puzzle #1", dailyNumber(new Date(2026, 9, 1, 0, 5)) === 1);
ok("late the same evening is still #1", dailyNumber(new Date(2026, 9, 1, 23, 59)) === 1);
ok("the next morning is #2", dailyNumber(new Date(2026, 9, 2, 0, 1)) === 2);
ok("a clock change does not skip a day", dailyNumber(new Date(2026, 9, 26, 12)) === 26 &&
   dailyNumber(new Date(2026, 9, 25, 12)) === 25);
ok("a year on is #366", dailyNumber(new Date(2027, 9, 1, 12)) === 366);
ok("dates round-trip", [1, 2, 30, 100, 400].every((n) => dailyNumber(dailyDate(n)) === n));

// 1 October 2026 is a Thursday.
ok("puzzle #1 falls on a Thursday", weekday(1) === 3);
ok("Monday is the gentlest day", dailyDifficulty(5) === Math.min(...[1, 2, 3, 4, 5, 6, 7].map(dailyDifficulty)));
ok("Saturday is the hardest", dailyDifficulty(3) === Math.max(...[1, 2, 3, 4, 5, 6, 7].map(dailyDifficulty)));
ok("the moon waxes through the week", dailyMoon(5) < dailyMoon(6) && dailyMoon(10) < dailyMoon(11) && dailyMoon(11) === 1);

// ---------------------------------------------------------------- the puzzle

for (const n of [1, 2, 3, 4, 5, 6, 7]) {
  const a = generateDaily(n).level;
  const b = generateDaily(n).level;
  ok(`daily #${n} is the same board every time`, levelHash(a) === levelHash(b));
  const replay = { ...a, tiles: a.tiles.map((t) => ({ ...t })), inventory: [] };
  for (const p of a.solution ?? []) replay.tiles[p.i] = tileFrom(p);
  ok(`daily #${n} is solvable`, evaluate(replay).won);
}
ok("different days are different boards", levelHash(generateDaily(1).level) !== levelHash(generateDaily(2).level));

// ---------------------------------------------------------------- streaks

ok("a first solve starts a streak", nextStreak(0, 0, 10) === 1);
ok("solving the next day extends it", nextStreak(4, 9, 10) === 5);
ok("solving the same day again changes nothing", nextStreak(4, 10, 10) === 4);
ok("a missed day starts over", nextStreak(4, 7, 10) === 1);
ok("a streak is alive until a whole day is missed", liveStreak(4, 9, 10) === 4 && liveStreak(4, 10, 10) === 4);
ok("…and lapses after", liveStreak(4, 8, 10) === 0);

// ---------------------------------------------------------------- the share card

const text = shareText(2, { points: 412, used: 3, fewest: 3, seconds: 102, misses: 2, assisted: false }, 5, "https://x");
ok("the card names the puzzle", text.startsWith("MoonBeam Daily #2"));
ok("one moon per Shine, the last one full", text.includes("🌑🌑🌕"));
ok("it says when the fewest pieces were used", text.includes("3 pieces (fewest!)"));
ok("it shows the time and streak", text.includes("1:42") && text.includes("5-day streak"));
ok("a hinted solve is marked", shareText(2, { points: 1, used: 4, fewest: 3, seconds: 1, misses: 0, assisted: true }, 1, "u").includes("🔭"));
ok("times format sensibly", formatTime(5) === "0:05" && formatTime(65) === "1:05" && formatTime(3725) === "1:02:05");

console.log(`\n  daily: ${passed} passed, ${failed} failed`);
if (fails.length) {
  console.log("\n  failures:");
  for (const f of fails) console.log(`    x ${f}`);
  process.exit(1);
}

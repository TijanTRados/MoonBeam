# Changelog

How MoonBeam got from a 2015 undergraduate thesis to what it is now. Dates are
when each piece landed; the commit history has the detail.

## Unreleased — October 2026

**The cube.** From Uranus on, some nights are cubes: the board is one face of
a cube whose six faces are copies of the grid you build on. Light running off
an edge carries on over it onto the next face, and the board swings round to
follow. One generic edge rule, tested on every crossing of every face; the
generator walks over edges like the light does, and rejects any cube whose
solution would also work flat.

**Against the clock.** Every night has a moon that slowly sets — a ring that
drains round it — and solving with time left earns a bonus; running out costs
only the bonus. **Moon Rush** is the arcade mode: ninety seconds, time back for
every solve, the same run of puzzles for everyone each day, with its own
leaderboard that replays every solve in the run.

**Tooling.** One test runner (`npm test`, or `npm test -- cube`), and an
engine suite that runs in half the time.

*Tried and taken back:* a low-key pixel-art look, which read as blurry in play.

## October 2026 — a game people come back to

Measured why playtesters stalled around night 20 (`tools/ramp-report.ts`) and
retuned the ramp. Hints in two steps and a way to skip a stuck night. A daily
puzzle generated from the date, with a streak and a spoiler-free share card.
Leaderboards that never trust a score: the client sends what it placed, and
the server regenerates the puzzle and replays the shot. Stardust and boosters
that can buy your way past a night but never up a board. Medals, and a star
map of every night you have solved.

## September 2026 — worlds and a voice

The campaign became a journey from Earth out to a black hole, ten nights per
world, each with its own sky, song and new element: shooting stars caught in
order, the Milky Way, warps, rough ground, asteroids, satellites. Points.
Synthesised sound and music, explanation cards with live demos, a payoff for
solving, and the Galaxy — a sandbox with every element in it.

## September 2026 — the rebuild

Rebuilt from the thesis's design rather than its code: an RGB light model,
exact-colour rings, crystals and tints instead of a prism and filters, black
holes, and — the answer to the thesis mentor's question — every level
generated, verified by replay and difficulty-rated at runtime. The original
2015 Android app is kept alongside, unchanged.

## 2015 — the thesis

*Izrada interaktivne računalne igre za mobilne uređaje*, Završni rad
br. 4106, FER, University of Zagreb. A 7×7 grid, a moon, mirrors, a prism,
filters and nine hand-built levels.

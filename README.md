<div align="center">

# 🌙 MoonBeam

**A cozy lo-fi puzzle about routing moonlight.**
The moon shines. You build the path.

*Originally a 2015 undergraduate thesis at FER, University of Zagreb — rebuilt from the design up.*

</div>

---

## What it is

The moon drops a beam of light into a grid. You place mirrors, splitters,
crystals and tints so the light reaches every ring — passing through every star
on the way. Rings must be hit by **exactly** their colour, so light is a resource to be
separated, recombined and spent carefully rather than just aimed.

The campaign is a journey outward — **Earth, Venus, Mercury, Mars, Jupiter,
Saturn, Uranus, Neptune, and finally a black hole** — ten nights per world, each
with its own sky, its own song and its own new element. Along the way there are
shooting stars to catch in order, the Milky Way to route through for points,
asteroids to time around, satellites that hold the light, and warps that fold
the board's edges together. The **Galaxy** is a sandbox with every element in
it and no rules.

Every level is generated, verified and difficulty-rated at runtime. There is no
level file anywhere in this repository.

- **Play:** <https://tijantrados.github.io/MoonBeam/>
- **Source:** <https://github.com/TijanTRados/MoonBeam>
- Works on phone, tablet and desktop. Installable as a PWA; packaged for Android
  with Capacitor.

## The original

The 2015 version was an Android app in Java: a 7×7 grid, a moon, ring receptors,
and mirrors / prism / diamond / filters, with nine hand-built levels each living
in its own `Activity`. The thesis specified the whole system — including the
beam's `direction`, `color` and `life` attributes and the main animation loop —
but the shipped code was a skeleton: `beam.java`, `field.java` and `moon.java`
were empty attribute bags, and `animationStart()` was pseudocode in a comment.

So this is a rebuild from the *design*, not a port of the code. The physics
below is the thesis's physics, checked against it in `test/engine.test.ts`.

### What changed, and why

| 2015 | Now | Why |
|---|---|---|
| Three fixed colours (white / red / blue) | Additive **RGB channel mask** | Colour becomes something you route rather than a label you match |
| Receptor accepts its colour | Receptor needs an **exact** match | Over-lighting now fails, which makes filters and careful routing matter |
| — | Receptors **accumulate** | Two beams can combine into a colour neither one carried |
| Beam is a travelling ball, one cell per tick | Instant simulation, **animated** reveal | The puzzle resolves deterministically; the travelling-ball reveal is kept, because it was the best part |
| Nine hand-built levels | **Generated, verified, rated** | See below |
| — | Stars, portals, black holes, moving shutters | Depth: collection, non-local routing, one-way jumps, and timing |
| "Prism", splitting into 3 beams | **Crystal** | A real prism disperses a continuous spectrum by refraction; it does not fire three beams at right angles. The name invited an argument the game cannot win, so the object is now openly invented |
| Filter *subtracts* channels | **Tint** *converts* one colour to another | Subtractive filters killed beams silently and were hard to reason about. A tint states plainly "red becomes blue", and never destroys light |
| Nine Java `Activity` classes | One pure TS engine | The generator needs to run the simulation thousands of times a second |

---

## How level generation works

> *"Can I build a system which generates levels automatically, including more
> depth, more elements, more logic and thinking?"* — the thesis mentor's question.

Yes, but not by placing pieces randomly. A 7×7 grid sprinkled with mirrors is
almost always either unsolvable or trivially solvable, and **you cannot tell
which without solving it.** So the generator never guesses. It works backwards.

### 1. Construct — the puzzle is the fossil of a walk

Start at the moon and walk the light forward, *choosing* where to bend, split and
filter it. Because the pieces are placed as the walk proceeds, a board and its
solution are built at the same time. The walker obeys exactly the same physics as
the simulator, so the board reproduces the walk when replayed.

Receptors are then derived **from the simulation, not from the walk**. This
distinction is the single subtlest part of the generator. The walk knows what
colour each branch carried when it left the grid, but that is not what a receptor
placed there would receive: a receptor *absorbs*, so placing one truncates every
other branch crossing that cell, and receptors match exactly, so a cell two
branches pass through accumulates a colour neither branch carried. Reading the
mask off a real simulation instead makes the level correct by construction —
whatever arrives is, by definition, what the receptor wants.

Getting this wrong dropped the usable-construction rate to **2%**. Getting it
right brought it to **~70%**.

### 2. Excavate — lift the solution into the tray

Take the placed pieces off the board and into the player's tray. The level is now
provably solvable (putting them back is a solution) but the player does not know
where "back" is. Walls go in dead space and decoy pieces into the tray, widening
the search without changing the physics of the solution.

### 3. Verify, tighten, and rate

**Verification is by replay, not by search.** We know where the solution goes —
we put it there — so laying the tray back down and running the simulation *once*
proves the level is honest. This costs one simulation instead of a full solve,
which is what makes generating a hard level affordable at all. It also catches
the one thing that can genuinely go wrong: a later branch of the walk crossing an
earlier branch's piece and changing the physics underneath it.

**Then the shortcuts get closed.** A constructed level is often solvable far more
cheaply than the route it was built around — on an open board a single mirror in
the moon's column reaches almost any receptor, so a level built around four
pieces can have a par of one. The generator finds where the cheap solution goes
and walls it off, as long as the intended solution survives.

**Finally the solver runs — only to measure.** How much search does the level
resist? How many other ways in are there? Running out of budget is informative
rather than fatal, because solvability is already settled.

### The solver

The naive search is hopeless: placing 6 pieces into 49 cells is ~10⁹ orderings.
The trick is an observation about the physics:

> **A piece placed on a cell no beam ever reaches cannot change the outcome.**

So instead of enumerating cells, simulate, look at which cells the light actually
touches, and branch only on those. Each placement redirects the beam, exposing a
different (usually small) frontier for the next one. Branching factor drops to
~10–25 and depth equals piece count.

It uses **iterative deepening**, not plain DFS. A depth-first search finds *a*
solution quickly but has no reason to find a *short* one — it will bury a
three-piece answer before backtracking far enough to notice the one-piece answer
beside it. Since `minPieces` is the level's advertised par and the dominant term
in the difficulty model, "shortest found" is not good enough; it has to be the
genuine minimum. Trying depth 1, then 2, and stopping at the first depth that
yields anything makes par correct by construction.

### Worlds, and teaching order

Difficulty is not only how much there is to do — it is which ideas are in play.
Some are gated rather than scaled, because meeting them cold is not a challenge,
it is a bug report. The campaign is split into **worlds** of ten nights
(`src/engine/phases.ts`). Each world decides which elements may appear at all,
how hard its nights ramp, and which new elements it introduces — and a new
element is *required* on its introduction night, so the player meets exactly one
new idea at a time, with its explanation card.

| Nights | World | New here |
|---|---|---|
| 1–10 | Earth | mirrors and rings; then stars, the Milky Way, splitters |
| 11–20 | Venus | crystals, tints |
| 21–30 | Mercury | shooting stars, portals |
| 31–40 | Mars | rough ground, warps, black holes, rings needing two beams |
| 41–50 | Jupiter | asteroids — the moment you press Shine starts to matter |
| 51–60 | Saturn | satellites, moving walls |
| 61–80 | Uranus, Neptune | everything, harder |
| 81+ | The Black Hole | everything, hardest, forever |

Difficulty ramps across each world and steps back a little at the start of the
next: new rules should be taught before they are tested. Each world's fifth night
is a breather. The ramp was tuned from measurement (`tools/ramp-report.ts`):
the first version asked for three or four pieces and two ring colours by night
16 — in the same world that introduces colour — and playtesters stalled there.
Now each world climbs about one point and the steep part is saved for the outer
planets. The moon waxes across
each world's ten nights — a thin crescent on the first, full on the tenth — so
it doubles as a progress marker.

The two-beam rule in that table was added after a playtest report that "night 7 is broken, the red
receptor never triggers". The level was fine; the ring was magenta, needing red
*and* blue to arrive together, and nothing had taught that. Holding it back —
and drawing the required channels as dots inside the ring — was the fix.

### The difficulty model

Difficulty is a **linear model fitted to generator features**, not hand-picked
weights. The generator is asked for a target, and the features of what it
produces — fewest pieces, branching, colours, receptors, stars, decoys, moving parts,
search resistance, solution count — scale cleanly with that target. So the target
is treated as a ground-truth label and a least-squares fit gives the weights:

```
Fit on 658 generated levels:  R² = 0.977,  RMSE = 0.45
```

Re-run `npx tsx tools/fit-difficulty.ts` and paste the output into `solver.ts`
after changing any generator budget.

A caveat worth stating: a few fitted weights come out negative. That is
collinearity, not a claim that moving parts make a level easier — stars, moving
parts and high piece counts all arrive together at the top of the range, so the
fit attributes their shared variance to whichever feature carries it most
cleanly. The model is used only to rank and band levels, which it does well.
Don't read individual coefficients as design guidance.

### A level is a number

Everything is driven by a seeded PRNG, so a level is fully described by its seed
and target difficulty. Nothing needs to be stored or shipped — **an endless
campaign is a counter.** `campaignDifficulty(n)` follows the worlds' ramps, with
a small sawtooth so the curve breathes instead of grinding upward.

Generating a night takes **3–190 ms**, so it happens on demand.

---

### The daily puzzle

Everyone gets the same board on the same day, and nothing is stored or served:
the puzzle number is the date, and the date is the seed (`src/game/daily.ts`).
Like a newspaper crossword it is gentle on Monday and hardest on Saturday, and
the moon waxes through the week to match. Solving it moves a day streak on; the
share card shows one moon per Shine — dark for a miss, full for the solve — with
points, pieces and time, and never the board.

### Getting unstuck, and stardust

Hints are free and come in two steps per piece, following the light: first the
cell pulses (*where*), then a faint ghost of the right piece appears (*what*).
After three missed Shines the hint button glows; after five, a night can be
skipped and come back to later.

**Stardust** is earned by solving a night for the first time and from the
daily puzzle (more the longer the streak), and spent on boosters that do a
step for you: *place a piece*, *sweep decoys* out of the tray, or *perfect
timing* — Shine waits for a moment that works when things are moving. Any hint
or booster makes a solve "assisted": it still counts for progress, but it is
not ranked. Stardust can buy your way past a night, never up a leaderboard.

### Medals and the star map

Every night has three medals — ☾ *lit* (solve it), ✦ *fewest* (with the fewest
pieces possible) and ☄ *clean* (first Shine, no help) — shown on the Nights
screen, so a solved night still has something to come back for. Each solve
also adds that night's constellation to the **star map**: the route the light
took, from the moon through every piece and goal, gathered into one sky by
world.

### Leaderboards

Three boards: **today's daily**, **each campaign night**, and the **Moon ladder**
(best points summed over every night). They rank by fewest pieces, then points,
then time — the puzzle's own skill first, style second, speed only to break
ties. Solves with a hint aren't ranked.

**Nothing a client says about its score is trusted.** The engine is
deterministic and every puzzle is a pure function of its number, so the game
sends only *what it placed and when it pressed Shine*. The server
(`server/`, Node's own `http`, no framework, no database) regenerates the same
puzzle, checks the placements against the tray and the board, replays the shot
with the same simulator, and scores it itself. A fingerprint of the board
catches a client whose generator has drifted.

Joining is opt-in, with a nickname. The server keeps a random player id, that
nickname, and each player's best result per board — no email, no account, no
IP addresses (those are used for rate limiting in memory only). Players can
rename or leave, which deletes their scores.

Running it:

```bash
npm run server                 # http://localhost:8787, scores in server/data/
```

In dev the game finds it on port 8787 of whatever host served the page. To put
it online, run the same command on any Node 22 host (Render, Fly.io, Railway, a
small VPS) with `ALLOWED_ORIGINS=https://tijantrados.github.io` and
`DATA_FILE` on persistent storage, then set the repository variable
`LEADERBOARD_URL` to its address — the Pages build picks it up. Unset, the game
simply says leaderboards are off.

## The physics

Four directions, and light is an RGB bitmask (white = R|G|B).

| Piece | Behaviour |
|---|---|
| **Mirror** `\` | Down↔Right, Up↔Left. *(the thesis's mirror1)* |
| **Mirror** `/` | Down↔Left, Up↔Right. |
| **Splitter** ◇ | Emits to **both sides**, never straight on. |
| **Crystal** △ | Moonlight in → red one way, blue the other, green straight through. Already-separated light passes untouched. |
| **Tint** ▣ | Converts one colour into another. Light it does not match passes through unharmed — a tint never destroys light. |
| **Wall** ▓ | Absorbs. May ride a track, moving one cell per tick. |
| **Star** ✦ | Transparent. Collect every one to finish. |
| **Ring** ◎ | The goal. Needs an **exact** colour match; beams accumulate additively, and a ring needing two channels shows them as dots inside it. |
| **Portal** ◉ | Teleports, preserving direction. Works both ways. |
| **Black hole** ● / **White hole** ○ | Light falls into the black hole and out of its white hole, still travelling the same way. **One-way** — that asymmetry is why both exist. |
| **Shooting star** ☄ | Numbered pieces, transparent. Only the active (big) piece can be caught; catching it makes the next one active. All pieces, in order, in one shine. |
| **Milky Way** | Not a piece — a patch of cells. Light crossing it scores five times as much. |
| **Warp** | A row or column whose ends are joined by coloured gates: out one side, back in the other, same direction. |
| **Rough ground** | Transparent to light, but nothing can be built on it. |
| **Asteroid** | Drifts along a lane and breaks any beam it meets, costing points. |
| **Satellite** / **dish** | The satellite catches light and its dish releases it `delay` ticks later — by which time asteroids have moved. |

Two properties fall out of this that are worth knowing:

- **Mirrors are reversible.** The same tile that bends light in bends it back
  out, so a ring of mirrors fed from outside always leaks — you cannot trap light
  with mirrors alone.
- **Splitters are not.** They discard the straight-through direction, so they
  *can* trap light. The simulator's visited set, keyed on
  `(cell, direction, colour)`, terminates those loops — this is the modern form
  of the thesis's `life` countdown.

**Light takes time.** It crosses six cells per tick of board time, and the
board's clock keeps running while you build — asteroids drift and walls slide
in front of you. Shine fires the light at the moment you press it, and one
firing must light every ring, every star and the whole shooting star. With
nothing moving, every moment is the same and it plays like the static game.
The generator checks every level against this exact rule by replaying it.

### Points

Solving is the goal; points are how well you solved it (`src/game/score.ts`).
Every cell of light earns a little, the Milky Way five times as much; stars,
rings and each shooting-star piece add more, a whole shooting star a bonus on
top. Asteroids cost. The card then compares your piece count with the **fewest
possible** (found by the solver): matching it earns a bonus, every extra piece
costs points. The counter over the board climbs with the beam, and is tested to
land exactly on the run's score.

---

## Making a solve feel like a moment

A light puzzle has a built-in problem: the outcome is decided the instant you
press Shine, so without care the payoff is a flat "correct". The reveal is
choreographed so the result is something you watch arrive.

- **The beam plays a tune.** Every piece the light touches rings one step higher
  on the scale, so a run is heard as a phrase climbing towards its ending.
- **The crystal shows its hand.** When white light splits, a rainbow bloom opens
  and a pulse races ahead along every path the separated colours will actually
  take — through mirrors, round corners, into rings — before the beam gets there.
- **Time slows at the end.** On a winning run the reveal drops to a crawl for the
  last stretch, with a rising swell under it, so you watch the light creep into
  the final ring. The engine knows the solve is coming; the player gets to feel it.
- **Then everything lands at once.** A crash and a chord, the music ducking out of
  the way, a shockwave across the board, every beam flaring white, the board
  leaning towards you, sparks out of every ring — and the collected stars and rings
  joined up as a constellation, the board's own star map of what you did.
- **The result says what was special.** Stars pop onto the card one at a time,
  badges call out a first-try solve, the fewest possible pieces, and streaks, and
  the points count up — with your best per night remembered.

The music is part of it. It runs through its own low-pass filter, which opens as
the beam travels and is thrown wide at the moment of solving — a single knob that
makes the whole soundtrack lean in.

All of this is verified frame by frame in `test/reveal.test.ts`: exactly one
climax on a winning run, landing on the frame the last ring fills, with the
slow-down strictly before it, and none of it on a losing run.

### Sound and music

Everything is synthesised with the Web Audio API — no audio files. Sound effects
use the C-major pentatonic, which has no wrong notes against the music, so a chime
can land on any beat and still sound intended.

Each world has its own original 16-bar loop, played by the same little synth
band so it feels like one radio station changing records. Earth is bouncy
late-90s bubblegum pop — octave bass, a clap on two and four, syncopated stabs,
a glockenspiel doing the sparkle; the further out you go, the slower, sparser
and colder it gets, until the black hole is a heartbeat and a drone. They borrow
the genre's instrumentation, not anybody's melody — every hook is built from its
own chord tones. Songs change at a bar line, never mid-beat. Warps whoosh
through a comb filter (air resonating in a tube), satellites chirp, asteroids
crunch, and each shooting-star piece rings a step higher than the last. Notes
are scheduled on the audio clock, not timers, so the groove stays tight while a
level is generating. Sound and music have separate switches, both remembered.

### Explaining the pieces

Every piece is described in one place (`src/game/info.ts`), which feeds the line
above the tray, the toast when you tap a level piece, the how-to screen, and a
card introducing each piece the first time you meet it. Each card carries a small
live demo — a real level, run by the real engine, drawn by the real renderer — so
the picture can never contradict the words.

## Running it

```bash
npm install
npm run dev      # http://localhost:5273
npm test         # engine, reveal, elements, worlds and sandbox tests
npm run build    # → dist/
```

Developer tools:

```bash
npx tsx tools/gen-report.ts 20 --draw   # generate a pack and print the boards
npx tsx tools/fit-difficulty.ts         # re-fit the difficulty model
npx tsx tools/ramp-report.ts 1 40       # what makes each night hard, averaged over seeds
npx tsx tools/profile.ts                # time the hot paths
```

To play any night without earning your way there, tick **Open all** on the
Nights screen.

In dev, `window.mb` is exposed: `mb.go(14)` jumps to a night, `mb.galaxy()`
opens the sandbox, `mb.solveIt()` lays down the stored solution, `mb.level()`
dumps the board.

### Android

```bash
npm run build
npx cap add android      # first time only; needs Android Studio + JDK 17
npx cap sync
npx cap open android
```

## Layout

```
legacy-2015/      the original Android app, kept unchanged — see its README
src/
  engine/          pure, no DOM — the part the generator runs thousands of times
    types.ts         directions, light masks, tiles, levels
    simulate.ts      beam propagation; light speed; loop termination; movement ticks
    solver.ts        frontier-pruned iterative deepening; difficulty model
    generate.ts      construct → excavate → verify → tighten → rate
    phases.ts        the worlds: what each allows, introduces, and how hard it ramps
  render/          canvas drawing; everything procedural, no sprite sheets
    moon.ts          the moon at any phase — only what is lit
    themes.ts        each world's sky, planet and constellations
    elements.ts      asteroids, satellites, shooting stars, warps, the Milky Way
    starmap.ts       every solved night's constellation in one sky
  game/            the bridge between engine and DOM
    score.ts         points
    sandbox.ts       the Galaxy
    daily.ts         the daily puzzle, streaks, the share card
    stardust.ts      earning, and the boosters
    medals.ts        the three medals; constellations for the star map
  net/leaderboard.ts  opt-in player, submitting solves, an offline queue
  audio.ts         synthesised sound effects
  music.ts         the worlds' songs
  main.ts          screens, input, render loop
server/            the leaderboard: verify by replay, rank, store
test/
tools/
```

The engine has no dependencies and no imports from `render/`, `game/` or the DOM.
That separation is not tidiness — it is the reason the generator can run the same
simulation the player sees, a few hundred thousand times, in under a second.

## Credits

Design, original thesis and game — **Tijan Tomislav Radoš**.
*Izrada interaktivne računalne igre za mobilne uređaje*, Završni rad br. 4106,
FER, University of Zagreb, June 2015.

Rebuilt in 2026 with Claude.

## Licence

MIT

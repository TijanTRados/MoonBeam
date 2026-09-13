<div align="center">

# 🌙 MoonBeam

**A cozy lo-fi puzzle about routing moonlight.**
The moon shines. You build the path.

*Originally a 2015 undergraduate thesis at FER, University of Zagreb — rebuilt from the design up.*

</div>

---

## What it is

The moon drops a beam of light into a grid. You place mirrors, splitters, prisms
and filters so the light reaches every ring — passing through every star on the
way. Rings must be hit by **exactly** their colour, so light is a resource to be
separated, recombined and spent carefully rather than just aimed.

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

### Teaching order

Difficulty is not only how much there is to do — it is which ideas are in play.
Some are gated rather than scaled, because meeting them cold is not a challenge,
it is a bug report:

| Idea | First appears |
|---|---|
| Splitters | difficulty 3 |
| The crystal, and colour | difficulty 4 |
| Tints | difficulty 5 |
| Jumps — portals and black holes | difficulty 6 |
| Rings needing **two converging beams** | difficulty 6 |
| Moving shutters, and timing | difficulty 7 |

That last one was added after a playtest report that "night 7 is broken, the red
receptor never triggers". The level was fine; the ring was magenta, needing red
*and* blue to arrive together, and nothing had taught that. Holding it back —
and drawing the required channels as dots inside the ring — was the fix.

### The difficulty model

Difficulty is a **linear model fitted to generator features**, not hand-picked
weights. The generator is asked for a target, and the features of what it
produces — par, branching, colours, receptors, stars, decoys, moving parts,
search resistance, solution count — scale cleanly with that target. So the target
is treated as a ground-truth label and a least-squares fit gives the weights:

```
Fit on 601 generated levels:  R² = 0.972,  RMSE = 0.50

  target  1 → 1.3     target  6 → 5.5
  target  2 → 1.8     target  7 → 7.4
  target  3 → 2.6     target  8 → 7.5
  target  4 → 4.3     target  9 → 9.6
  target  5 → 5.1     target 10 → 9.6
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
campaign is a counter.** `campaignDifficulty(n)` is a logarithmic ramp with a
small sawtooth so the curve breathes instead of grinding upward.

Generating a night takes **3–190 ms**, so it happens on demand.

---

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

Two properties fall out of this that are worth knowing:

- **Mirrors are reversible.** The same tile that bends light in bends it back
  out, so a ring of mirrors fed from outside always leaks — you cannot trap light
  with mirrors alone.
- **Splitters are not.** They discard the straight-through direction, so they
  *can* trap light. The simulator's visited set, keyed on
  `(cell, direction, colour)`, terminates those loops — this is the modern form
  of the thesis's `life` countdown.

Stars bank across ticks, but every receptor must be lit on the **same** tick.
With no moving parts that collapses to a single tick and behaves exactly like the
static game.

---

## Running it

```bash
npm install
npm run dev      # http://localhost:5273
npm test         # 39 engine + generator assertions
npm run build    # → dist/
```

Developer tools:

```bash
npx tsx tools/gen-report.ts 20 --draw   # generate a pack and print the boards
npx tsx tools/fit-difficulty.ts         # re-fit the difficulty model
npx tsx tools/profile.ts                # time the hot paths
```

In dev, `window.mb` is exposed: `mb.go(14)` jumps to a night, `mb.solveIt()`
lays down the stored solution, `mb.level()` dumps the board.

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
    simulate.ts      beam propagation; loop termination; movement ticks
    solver.ts        frontier-pruned iterative deepening; difficulty model
    generate.ts      construct → excavate → verify → tighten → rate
  render/          canvas drawing; everything procedural, no sprite sheets
  game/            the bridge between engine and DOM
  main.ts          screens, input, render loop
test/engine.test.ts
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

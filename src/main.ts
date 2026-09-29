/**
 * App shell: screens, input, the render loop, and the choreography that turns
 * a solved puzzle into a moment.
 *
 * The board is canvas; everything else is DOM, so buttons stay real buttons.
 */
import "./style.css";
import { Level, Light, TileKind, WHITE, tileFrom } from "./engine/types";
import { generateCampaignLevel, campaignDifficulty, generateLevel } from "./engine/generate";
import { Segment, SimResult, simulate } from "./engine/simulate";
import { Game, loadProgress, saveProgress, Progress, RevealTick } from "./game/state";
import { INFO, PieceKey, demoLevel, describe, infoKey, kindsIn } from "./game/info";
import { cellAt, computeLayout, draw, drawIcon, frontOf } from "./render/renderer";
import { PathSeg, clearFx, spawnFx } from "./render/fx";
import { Particles, rand } from "./render/particles";
import { LIGHT_LABEL } from "./render/theme";
import {
  isMuted, isMusicMuted, musicBrightness, musicDuck,
  sfxCardStar, sfxClimax, sfxDissolve, sfxHint, sfxHit, sfxInfo, sfxMiss, sfxPlace,
  sfxRemove, sfxRing, sfxRiser, sfxRotate, sfxSelect, sfxShine, sfxStar, sfxWhoosh,
  sfxWrongRing, toggleMusicMuted, toggleMuted,
} from "./audio";
import { isMusicPlaying, startMusic, stopMusic } from "./music";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];

let progress: Progress = loadProgress();
let game: Game | null = null;
let night = 1;
let endless = false;
let endlessSeed = Date.now() >>> 0;

const now = () => performance.now() / 1000;

// ---------------------------------------------------------------- screens

type ScreenName = "title" | "nights" | "game";
let currentScreen: ScreenName = "title";

function show(name: ScreenName) {
  if (name !== currentScreen) sfxWhoosh();
  currentScreen = name;
  $$(".screen").forEach((s) => s.classList.remove("is-active"));
  $(`#screen-${name}`).classList.add("is-active");
  if (name === "nights") renderNights();
  if (name === "title") refreshContinue();
}

/** Keep the main menu button in step with progress made since it was drawn. */
function refreshContinue() {
  ($("[data-action=play]") as HTMLElement).textContent =
    progress.unlocked > 1 ? `Continue · Night ${progress.unlocked}` : "Play";
}

// ---------------------------------------------------------------- canvases

const canvas = $<HTMLCanvasElement>("#board");
const ctx = canvas.getContext("2d")!;
const boardFx = new Particles(420);
const titleFx = new Particles(220);
const cardFx = new Particles(160);

let hover = -1;
let winGlow = 0;
let flare = 0;
let punch = 0;
let lastT = performance.now();

function fitCanvas(c: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const r = c.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return { w: r.width, h: r.height, dpr };
}

function frame(nowMs: number) {
  const dt = Math.min(0.05, (nowMs - lastT) / 1000);
  lastT = nowMs;
  const t = nowMs / 1000;

  if (game && currentScreen === "game") {
    const { w, h, dpr } = fitCanvas(canvas);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (game.phase === "running") handleReveal(game.advance(dt), t);

    const celebrating = game.phase === "won" || climaxed;
    winGlow = celebrating ? Math.min(1, winGlow + dt * 2.4) : Math.max(0, winGlow - dt * 2.4);
    flare = Math.max(0, flare - dt * 1.1);
    punch = Math.max(0, punch - dt * 3.2);

    // While building, silently simulate the board as it stands, so crystals can
    // show where their colours will go before the player commits to a run.
    const preview: SimResult | null = game.phase === "build" ? simulate(game.current(), 0) : null;

    draw(ctx, w, h, {
      level: game.current(),
      sim: game.sim,
      tick: game.tick,
      reveal: game.reveal,
      starsLit: game.starsLit,
      hover,
      time: t,
      winGlow,
      hint: game.hint,
      particles: boardFx,
      dt,
      flare,
      punch,
      previewSim: preview,
    });
  }

  drawTitleArt(t, dt);
  drawCardDemo(t, dt);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- the reveal

/** How far up the scale this run's notes have climbed. */
let rung = 2;
let climaxed = false;
let climaxCell = -1;
let exitOrders: number[] = [];
let lastDissolve = 0;

function beginRun() {
  if (!game) return;
  rung = 2;
  climaxed = false;
  climaxCell = -1;
  sfxShine();
  musicBrightness(0.62, 0.6);
  game.start();
  exitOrders = game.exitOrders();
}

/**
 * React to what the light reached this frame.
 *
 * Each piece the beam touches plays a note one rung higher than the last, so a
 * run is heard as a phrase climbing towards its ending. Crystals fire the
 * rainbow pulse; rings burst or shake depending on whether they are satisfied.
 */
function handleReveal(tick: RevealTick, t: number) {
  if (!game?.sim) return;
  const sim = game.sim;
  const board = game.current().tiles;

  for (const i of tick.reached) {
    const kind = board[i]?.kind;
    if (!kind || kind === "empty") continue;
    climaxCell = i;

    if (kind === "star") {
      spawnFx(i, "star", t);
      sfxStar(rung++);
      fountain(i, 10, "#fff3d6", 0.9);
    } else if (kind === "receptor") {
      const light = sim.receptorLight.get(i) ?? WHITE;
      if (sim.satisfied.has(i)) {
        spawnFx(i, "ring", t, light);
        sfxRing(rung++);
        fountain(i, 16, "#ffffff", 1.2);
      } else {
        spawnFx(i, "wrong", t, board[i].mask ?? WHITE);
        sfxWrongRing();
      }
    } else if (kind === "crystal") {
      spawnFx(i, "prism", t, WHITE, { paths: downstreamFrom(sim.segments, i, game.level.w) });
      sfxHit(kind, rung);
      rung += 2;
    } else {
      if (kind === "blackhole") spawnFx(i, "absorb", t);
      sfxHit(kind, rung++);
    }
  }

  // Light fizzing off the edge of the board.
  const f = game.frontHops;
  for (const o of exitOrders) {
    if (o > f - 0.3 && o <= f && t - lastDissolve > 0.14) {
      sfxDissolve();
      lastDissolve = t;
    }
  }

  if (tick.slowMoStarted) {
    sfxRiser(tick.slowMoSeconds);
    musicBrightness(1, Math.max(0.3, tick.slowMoSeconds));
  }
  if (tick.climax) celebrate(t);
  if (tick.settled) onSettled();
}

/**
 * The moment of solving.
 *
 * Everything fires at once, on the frame the final goal completes: a crash and
 * a chord, the music ducking out of the way, a shockwave rolling across the
 * board, every beam flaring white, the board leaning towards you, and a
 * fountain of sparks out of every lit ring. It lasts about a second and a half.
 */
function celebrate(t: number) {
  if (!game?.sim || climaxed) return;
  climaxed = true;
  sfxClimax();
  musicDuck(0.25, 1.6);
  musicBrightness(1, 0.05);
  flare = 1;
  punch = 1;
  if (climaxCell >= 0) spawnFx(climaxCell, "shockwave", t);
  for (const i of game.sim.satisfied) fountain(i, 26, "#ffe98f", 1.8);
  buzz([10, 30, 60]);
}

/** Sparks thrown up out of a cell and drifting back down. */
function fountain(i: number, n: number, color: string, power: number) {
  if (!game) return;
  const w = game.level.w;
  const x = (i % w) + 0.5, y = Math.floor(i / w) + 0.5;
  const t = now();
  const palette = [color, "#ffffff", "#ff9ec8", "#8fd3ff", "#a6f0c0", "#ffe066"];
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + rand(-1.1, 1.1);
    const sp = rand(0.8, 2.6) * power;
    boardFx.add({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 3.2,
      born: t + rand(0, 0.08), life: rand(0.7, 1.4),
      size: rand(0.02, 0.05), color: palette[k % palette.length],
      glint: Math.random() < 0.55, twinkle: Math.random() * 6,
    });
  }
}

/**
 * Every segment of light downstream of a crystal, in the order it will be
 * drawn — the route the rainbow pulse races along. Follows portal jumps and
 * any splitting further on, because the pulse should go everywhere the
 * separated colours actually go.
 */
function downstreamFrom(segs: Segment[], cell: number, w: number): PathSeg[] {
  const x = cell % w, y = Math.floor(cell / w);
  let frontier = segs.filter((s) => s.x0 === x && s.y0 === y && !s.warp
    && (s.light === 1 || s.light === 2 || s.light === 4));
  if (!frontier.length) return [];
  const base = Math.min(...frontier.map((s) => s.order)) - 1;
  const seen = new Set<Segment>();
  const out: PathSeg[] = [];
  while (frontier.length && out.length < 240) {
    const next: Segment[] = [];
    for (const s of frontier) {
      if (seen.has(s)) continue;
      seen.add(s);
      if (!s.warp) out.push({ x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, depth: s.order - 1 - base, light: s.light });
      for (const n of segs) {
        if (n.x0 === s.x1 && n.y0 === s.y1 && n.order === s.order + 1 && !seen.has(n)) next.push(n);
      }
    }
    frontier = next;
  }
  return out;
}

function onSettled() {
  if (!game) return;
  if (game.phase === "won") {
    if (!climaxed) celebrate(now());
    const s = game.score();
    const earned = 1 + s.stars;
    const firstTry = s.firstTry;
    if (!endless) {
      progress.stars[night] = Math.max(progress.stars[night] ?? 0, earned);
      progress.unlocked = Math.max(progress.unlocked, night + 1);
    }
    progress.streak = firstTry ? progress.streak + 1 : 0;
    progress.bestStreak = Math.max(progress.bestStreak, progress.streak);
    saveProgress(progress);

    // Join up what the light found, like a star map, then show the card once
    // the board has had a moment to itself.
    const pts = game.constellation();
    if (pts.length >= 2) spawnFx(pts[0], "constellation", now(), WHITE, { points: pts });
    window.setTimeout(() => showWin(s), 900);
  } else {
    const o = game.outcome;
    sfxMiss();
    musicBrightness(0.35, 1.2);
    const msg = !o || o.satisfiedCount === 0
      ? "The light never arrived."
      : o.satisfiedCount < o.totalReceptors
        ? `${o.satisfiedCount} of ${o.totalReceptors} rings lit.`
        : o.starsLit.size < o.totalStars
          ? `Rings lit, but ${o.totalStars - o.starsLit.size} star(s) missed.`
          : "Not quite.";
    toast(msg, 2400);
  }
}

// ---------------------------------------------------------------- title art

const titleCanvas = $<HTMLCanvasElement>("#title-canvas");
const titleCtx = titleCanvas.getContext("2d")!;

/**
 * A decorative board that runs forever behind the logo. A fine grid: at 5x4 the
 * beams read as slabs across the menu, at 9x9 they read as texture.
 */
const TW = 9, TH = 9;
const titleLevel: Level = {
  id: "title", name: "title", w: TW, h: TH,
  tiles: Array.from({ length: TW * TH }, () => ({ kind: "empty" as const })),
  emitters: [{ x: 2, y: 0, dir: 0, light: WHITE }],
  inventory: [],
};
const T = (x: number, y: number, t: Parameters<typeof Object>[0]) => { titleLevel.tiles[y * TW + x] = t; };
T(2, 2, { kind: "mirrorB" });
T(6, 2, { kind: "crystal" });
T(6, 6, { kind: "splitter" });
T(4, 2, { kind: "star" });
T(2, 6, { kind: "mirrorA" });
const titleSim = simulate(titleLevel, 0);
const titleStars = new Set([2 * TW + 4]);
const EMPTY: Set<number> = new Set();

function drawTitleArt(t: number, dt: number) {
  if (currentScreen !== "title") return;
  const { w, h, dpr } = fitCanvas(titleCanvas);
  titleCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  titleCtx.globalAlpha = 0.5;
  draw(titleCtx, w, h, {
    level: titleLevel, sim: titleSim, tick: 0, reveal: 1,
    starsLit: titleStars, hover: -1, time: t, winGlow: 0, hint: EMPTY,
    particles: titleFx, dt,
  });
  titleCtx.globalAlpha = 1;
}

// ---------------------------------------------------------------- piece cards

/** Pieces waiting to be introduced, shown one card at a time. */
let cardQueue: PieceKey[] = [];
let cardKey: PieceKey | null = null;
let cardOpened = 0;
let cardLevel: Level | null = null;
let cardSim: SimResult | null = null;
const cardCanvas = $<HTMLCanvasElement>("#piece-demo");
const cardCtx = cardCanvas.getContext("2d")!;

function openCard(k: PieceKey, isNew: boolean) {
  cardKey = k;
  cardOpened = now();
  cardLevel = demoLevel(k);
  cardSim = simulate(cardLevel, 0);
  cardFx.clear();
  const info = INFO[k];
  $("#piece-tag").textContent = isNew ? "New" : "About";
  $("#piece-name").textContent = info.name;
  $("#piece-detail").textContent = info.detail;
  $("#piece-card").hidden = false;
  sfxInfo();
}

function nextCard() {
  if (cardKey && !progress.seen.includes(cardKey)) {
    progress.seen.push(cardKey);
    saveProgress(progress);
  }
  const k = cardQueue.shift();
  if (k) openCard(k, true);
  else { cardKey = null; $("#piece-card").hidden = true; }
}

/**
 * The demo on a card: the piece's little board, lit up on a loop. It is the real
 * engine running a real level, so the picture cannot contradict the words.
 */
function drawCardDemo(t: number, dt: number) {
  if (!cardKey || !cardLevel || !cardSim) return;
  const { w, h, dpr } = fitCanvas(cardCanvas);
  cardCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cycle = (t - cardOpened) % 3.6;
  const reveal = Math.min(1.15, (cycle / 1.8) * 1.15);
  if (cycle < dt) cardFx.clear();
  draw(cardCtx, w, h, {
    level: cardLevel, sim: cycle < 0.15 ? null : cardSim, tick: 0, reveal,
    starsLit: reveal > 0.7 ? cardSim.starsLit : EMPTY,
    hover: -1, time: t, winGlow: 0, hint: EMPTY,
    particles: cardFx, dt, mini: true,
  });
}

function introduceNewPieces(level: Level) {
  const fresh = kindsIn(level).filter((k) => !progress.seen.includes(k));
  if (!fresh.length) return;
  cardQueue = fresh.slice(1);
  openCard(fresh[0], true);
}

// ---------------------------------------------------------------- input

function pointerCell(e: PointerEvent): number {
  if (!game) return -1;
  const r = canvas.getBoundingClientRect();
  const L = computeLayout(r.width, r.height, game.current());
  return cellAt(L, e.clientX - r.left, e.clientY - r.top);
}

// Hovering a piece with a mouse for a moment explains it.
let hoverTimer = 0;
canvas.addEventListener("pointermove", (e) => {
  const i = pointerCell(e);
  if (i === hover) return;
  hover = i;
  window.clearTimeout(hoverTimer);
  if (e.pointerType !== "mouse" || i < 0 || !game) return;
  hoverTimer = window.setTimeout(() => {
    const d = game && describe(game.current().tiles[i]);
    if (d && hover === i) toast(`${d.name} — ${d.text}`, 3000);
  }, 700);
});
canvas.addEventListener("pointerleave", () => { hover = -1; window.clearTimeout(hoverTimer); });

canvas.addEventListener("pointerdown", (e) => {
  if (!game) return;
  const i = pointerCell(e);
  if (i < 0) return;
  e.preventDefault();
  startMusicOnce();
  const tile = game.current().tiles[i];
  const r = game.tap(i);
  if (r === "none") {
    // Tapping the level's own furniture tells you what it is.
    const d = describe(tile);
    if (d && game.phase !== "running") { toast(`${d.name} — ${d.text}`, 3200); sfxInfo(); }
    return;
  }
  buzz(r === "removed" ? 8 : 12);
  spawnFx(i, r === "placed" ? "place" : r === "rotated" ? "rotate" : "remove", now());
  if (r === "placed") sfxPlace();
  else if (r === "rotated") sfxRotate();
  else sfxRemove();
  renderTray();
});

function buzz(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

// ---------------------------------------------------------------- tray

function renderTray() {
  if (!game) return;
  const tray = $("#tray");
  tray.innerHTML = "";
  game.tray.forEach((slot, k) => {
    const left = slot.total - slot.used;
    const b = document.createElement("button");
    b.className = `slot${k === game!.selected ? " selected" : ""}${left === 0 ? " empty" : ""}`;
    b.setAttribute("aria-label", `${pieceName(slot.kind, slot.mask, slot.from)}, ${left} left`);
    b.setAttribute("aria-pressed", String(k === game!.selected));

    const c = document.createElement("canvas");
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    c.width = c.height = Math.round(42 * dpr);
    const cc = c.getContext("2d")!;
    cc.scale(dpr, dpr);
    drawIcon(cc, 42, slot.kind, slot.mask, slot.from);
    b.appendChild(c);

    const n = document.createElement("span");
    n.className = "count";
    n.textContent = String(left);
    b.appendChild(n);

    b.addEventListener("click", () => {
      if (left === 0) return;
      game!.selected = k;
      sfxSelect();
      renderTray();
    });
    tray.appendChild(b);
  });
  renderCaption();
}

/** The line above the tray: what the selected piece does. */
function renderCaption() {
  const cap = $("#tray-caption");
  const slot = game?.tray[game.selected];
  if (!slot) { cap.hidden = true; return; }
  const d = describe({ kind: slot.kind, mask: slot.mask, from: slot.from });
  if (!d) { cap.hidden = true; return; }
  cap.hidden = false;
  $("#tray-caption-text").innerHTML = `<b>${d.name}</b> ${d.text}`;
}

function pieceName(kind: TileKind, mask?: Light, from?: Light): string {
  if (kind === "tint") {
    return from === undefined
      ? `${LIGHT_LABEL[mask ?? 7] ?? ""} tint`
      : `${LIGHT_LABEL[from] ?? ""} to ${LIGHT_LABEL[mask ?? 7] ?? ""}`;
  }
  const k = infoKey(kind);
  return k ? INFO[k].name : kind;
}

// ---------------------------------------------------------------- level flow

function startLevel(n: number, isEndless = false) {
  endless = isEndless;
  night = n;

  // Generating a hard night can take a few hundred milliseconds on an old
  // phone. Show the screen first and generate on the next turn of the loop, so
  // the tap always feels immediate.
  $("#level-name").textContent = isEndless ? `Drift ${n}` : `Night ${n}`;
  $("#level-meta").innerHTML = "<span>composing…</span>";
  $("#tray").innerHTML = "";
  $("#tray-caption").hidden = true;
  $("#win").hidden = true;
  game = null;
  show("game");

  setTimeout(() => {
    const gen = isEndless
      ? generateLevel((endlessSeed + n * 2654435761) >>> 0, {
          difficulty: campaignDifficulty(n), name: `Drift ${n}`, tolerance: 1.6,
        })
      : generateCampaignLevel(n, progress.runSeed);

    // The player may have navigated away while we were thinking.
    if (currentScreen !== "game" || night !== n) return;

    game = new Game(gen.level);
    winGlow = 0;
    flare = 0;
    climaxed = false;
    clearFx();
    boardFx.clear();
    musicBrightness(0.35, 0.8);
    $("#level-name").textContent = gen.level.name;
    renderMeta(gen.level);
    renderTray();
    toast(describeGoal(gen.level), 2600);
    introduceNewPieces(gen.level);
  }, 16);
}

function renderMeta(l: Level) {
  const d = Math.round(l.difficulty ?? 1);
  const pips = Array.from({ length: 10 }, (_, i) =>
    `<i class="pip${i < d ? " on" : ""}"></i>`).join("");
  $("#level-meta").innerHTML =
    `<span class="pips" title="Difficulty ${l.difficulty}">${pips}</span>` +
    `<span>par ${l.par ?? "?"}</span>`;
}

function describeGoal(l: Level): string {
  const rings = l.tiles.filter((t) => t.kind === "receptor");
  const stars = l.tiles.filter((t) => t.kind === "star").length;
  const cols = [...new Set(rings.map((r) => LIGHT_LABEL[r.mask ?? 7]))];
  const ring = rings.length === 1 ? "1 ring" : `${rings.length} rings`;
  const colour = cols.length === 1 ? ` (${cols[0]})` : ` (${cols.join(", ")})`;
  return stars
    ? `Light ${ring}${colour} and collect ${stars} star${stars > 1 ? "s" : ""}`
    : `Light ${ring}${colour}`;
}

/**
 * The results card. Stars pop in one at a time, each with its own rising chime,
 * and badges call out what was special about this solve — first try, on par,
 * a streak — because a result nobody comments on does not feel like one.
 */
function showWin(s: ReturnType<Game["score"]>) {
  const total = 1 + s.totalStars;
  const got = 1 + s.stars;
  const starsEl = $("#win-stars");
  starsEl.innerHTML = "";
  for (let k = 0; k < total; k++) {
    const span = document.createElement("span");
    span.className = k < got ? "win-star on" : "win-star";
    span.textContent = k < got ? "★" : "☆";
    span.style.animationDelay = `${0.12 + k * 0.22}s`;
    starsEl.appendChild(span);
    if (k < got) window.setTimeout(() => sfxCardStar(k), 120 + k * 220);
  }

  $("#win-title").textContent = got === total ? "Perfect night" : "Solved";
  $("#win-sub").textContent =
    `${s.used} piece${s.used === 1 ? "" : "s"} placed` +
    (s.par ? ` · par ${s.par}` : "") +
    (s.totalStars ? ` · ${s.stars}/${s.totalStars} stars` : "");

  const badges: string[] = [];
  if (s.firstTry) badges.push("✨ First try");
  if (s.par && s.used < s.par) badges.push("🌙 Under par");
  else if (s.par && s.used === s.par) badges.push("🌙 On par");
  if (progress.streak >= 2) badges.push(`💫 ${progress.streak} in a row`);
  $("#win-badges").innerHTML = badges
    .map((b, k) => `<span class="badge" style="animation-delay:${0.5 + k * 0.15}s">${b}</span>`)
    .join("");

  $("#win").hidden = false;
}

let toastTimer = 0;
function toast(msg: string, ms = 1800) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), ms);
}

// ---------------------------------------------------------------- nights screen

function renderNights() {
  const grid = $("#night-grid");
  grid.innerHTML = "";
  const max = Math.max(24, progress.unlocked + 6);
  for (let n = 1; n <= max; n++) {
    const locked = n > progress.unlocked;
    const stars = progress.stars[n] ?? 0;
    const b = document.createElement("button");
    b.className = `night${locked ? " locked" : ""}`;
    b.disabled = locked;
    b.innerHTML =
      `<span>${locked ? "·" : n}</span>` +
      `<span class="stars">${"★".repeat(stars)}</span>` +
      `<span class="diff">${locked ? "" : `lv ${Math.round(campaignDifficulty(n))}`}</span>`;
    if (!locked) b.addEventListener("click", () => startLevel(n));
    grid.appendChild(b);
  }
}

// ---------------------------------------------------------------- how to play

function renderHowto() {
  const keys: PieceKey[] = ["receptor", "mirror", "splitter", "crystal", "tint",
    "star", "wall", "portal", "blackhole"];
  const ul = $("#howto-list");
  ul.innerHTML = "";
  for (const k of keys) {
    const info = INFO[k];
    const li = document.createElement("li");
    li.dataset.action = "piece-about";
    li.dataset.piece = k;
    const c = document.createElement("canvas");
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    c.width = c.height = Math.round(38 * dpr);
    const cc = c.getContext("2d")!;
    cc.scale(dpr, dpr);
    drawIcon(cc, 38, info.icon.kind, info.icon.mask, info.icon.from);
    li.appendChild(c);
    const txt = document.createElement("div");
    txt.innerHTML = `<b>${info.name}</b><span>${info.short}</span>`;
    li.appendChild(txt);
    ul.appendChild(li);
  }
}

// ---------------------------------------------------------------- music

let musicStarted = false;
/** Browsers only allow audio after a gesture; start the music on the first one. */
function startMusicOnce() {
  if (musicStarted || isMusicMuted()) return;
  musicStarted = true;
  startMusic();
}
document.addEventListener("pointerdown", startMusicOnce, { capture: true });
document.addEventListener("keydown", startMusicOnce, { capture: true });

// ---------------------------------------------------------------- actions

document.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
  if (!el) return;
  const action = el.dataset.action!;

  switch (action) {
    case "play": startLevel(progress.unlocked); break;
    case "nights": show("nights"); break;
    case "endless": endlessSeed = Date.now() >>> 0; startLevel(1, true); break;
    case "home": show("title"); break;
    case "howto": renderHowto(); $("#howto").hidden = false; sfxInfo(); break;
    case "close-howto": $("#howto").hidden = true; break;
    case "mute": toggleMuted(); renderToggles(); if (!isMuted()) sfxSelect(); break;
    case "music": {
      toggleMusicMuted();
      if (isMusicMuted()) stopMusic();
      else { musicStarted = true; startMusic(); }
      renderToggles();
      break;
    }

    case "run": {
      if (!game || game.phase === "running" || game.phase === "won") return;
      if (game.remaining > 0) toast(`${game.remaining} piece(s) still in the tray`, 1500);
      beginRun();
      break;
    }
    case "reset": game?.reset(); clearFx(); boardFx.clear(); renderTray(); sfxRemove(); break;
    case "hint": {
      if (!game) return;
      const ok = game.takeHint();
      toast(ok ? "A piece belongs here." : "Nothing more to hint.", 2200);
      if (ok) sfxHint();
      break;
    }
    case "piece-info": {
      const slot = game?.tray[game.selected];
      const k = slot && infoKey(slot.kind);
      if (k) { cardQueue = []; openCard(k, false); }
      break;
    }
    case "piece-about": {
      const k = el.dataset.piece as PieceKey | undefined;
      if (k) { $("#howto").hidden = true; cardQueue = []; openCard(k, false); }
      break;
    }
    case "piece-ok": nextCard(); break;
    case "replay":
      $("#win").hidden = true; game?.reset(); clearFx(); boardFx.clear(); climaxed = false;
      musicBrightness(0.35, 0.8); renderTray();
      break;
    case "next": $("#win").hidden = true; startLevel(night + 1, endless); break;
  }
});

// Keyboard: space to run, R to reset, 1-9 to pick a tray slot.
document.addEventListener("keydown", (e) => {
  if (!game || currentScreen !== "game") return;
  if (!$("#piece-card").hidden) {
    if (e.key === "Enter" || e.key === " " || e.key === "Escape") { e.preventDefault(); nextCard(); }
    return;
  }
  if (e.key === " " || e.key === "Enter") { e.preventDefault(); ($("[data-action=run]") as HTMLElement).click(); }
  else if (e.key.toLowerCase() === "r") { game.reset(); clearFx(); renderTray(); }
  else if (/^[1-9]$/.test(e.key)) {
    const k = Number(e.key) - 1;
    if (k < game.tray.length) { game.selected = k; sfxSelect(); renderTray(); }
  }
});

// ---------------------------------------------------------------- boot

function renderToggles() {
  for (const b of $$("[data-action=mute]")) {
    const off = isMuted();
    b.textContent = off ? "🔇" : "🔊";
    b.setAttribute("aria-label", off ? "Turn sounds on" : "Turn sounds off");
    b.setAttribute("aria-pressed", String(off));
  }
  for (const b of $$("[data-action=music]")) {
    const off = isMusicMuted();
    b.classList.toggle("is-off", off);
    b.setAttribute("aria-label", off ? "Turn music on" : "Turn music off");
    b.setAttribute("aria-pressed", String(off));
  }
}

renderToggles();
show("title");
requestAnimationFrame(frame);

// Dev-only handle for poking at a level from the console: `mb.level()`,
// `mb.solveIt()` to auto-place the known solution, `mb.go(12)` to jump nights.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).mb = {
    get game() { return game; },
    level: () => game?.level,
    board: () => game?.board,
    go: (n: number, e = false) => startLevel(n, e),
    solveIt: () => {
      if (!game?.level.solution) return "no stored solution";
      for (const p of game.level.solution) {
        game.board[p.i] = tileFrom(p, true);
        const slot = game.slotFor(p.kind, p.mask, p.from);
        if (slot) slot.used++;
      }
      renderTray();
      return game.level.solution;
    },
    run: () => beginRun(),
    /**
     * Drive the reveal by hand, `frames` at 60fps, firing the same sounds and
     * effects as the render loop. Background panes throttle animation frames,
     * so this is how to reach an exact moment — e.g. the climax — on demand.
     */
    step: (frames = 1, untilClimax = false) => {
      for (let k = 0; k < frames && game?.phase === "running"; k++) {
        const tick = game.advance(1 / 60);
        handleReveal(tick, now());
        if (untilClimax && tick.climax) return { frame: k, climax: true };
      }
      return { phase: game?.phase };
    },
    phase: () => game?.phase,
    /** The app's own audio state — importing the modules separately gets a different instance. */
    audio: () => ({ musicMuted: isMusicMuted(), musicPlaying: isMusicPlaying(), sfxMuted: isMuted() }),
    front: () => game && frontOf(game),
    particles: () => boardFx.count,
  };
}

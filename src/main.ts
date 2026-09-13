/**
 * App shell: screens, input, and the render loop.
 *
 * The board is canvas; everything else is DOM, so buttons stay real buttons.
 */
import "./style.css";
import { Chan, Level, Light, TileKind, WHITE } from "./engine/types";
import { generateCampaignLevel, campaignDifficulty, generateLevel } from "./engine/generate";
import { simulate } from "./engine/simulate";
import { Game, loadProgress, saveProgress, Progress } from "./game/state";
import { cellAt, computeLayout, draw, drawIcon, ViewState } from "./render/renderer";
import { LIGHT_LABEL } from "./render/theme";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];

let progress: Progress = loadProgress();
let game: Game | null = null;
let night = 1;
let endless = false;
let endlessSeed = Date.now() >>> 0;

// ---------------------------------------------------------------- screens

type ScreenName = "title" | "nights" | "game";
function show(name: ScreenName) {
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

// ---------------------------------------------------------------- board canvas

const canvas = $<HTMLCanvasElement>("#board");
const ctx = canvas.getContext("2d")!;
let hover = -1;
let winGlow = 0;
let lastT = performance.now();

function fitCanvas(c: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const r = c.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return { w: r.width, h: r.height, dpr };
}

function frame(now: number) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  if (game && $("#screen-game").classList.contains("is-active")) {
    const { w, h, dpr } = fitCanvas(canvas);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (game.phase === "running") {
      const settled = game.advance(dt);
      if (settled) onSettled();
    }
    winGlow = game.phase === "won"
      ? Math.min(1, winGlow + dt * 2.4)
      : Math.max(0, winGlow - dt * 2.4);

    const view: ViewState = {
      level: game.current(),
      sim: game.sim,
      tick: game.tick,
      reveal: game.reveal,
      starsLit: game.starsLit,
      hover,
      time: now / 1000,
      winGlow,
      hint: game.hint,
    };
    draw(ctx, w, h, view);
  }

  drawTitleArt(now);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- title art

const titleCanvas = $<HTMLCanvasElement>("#title-canvas");
const titleCtx = titleCanvas.getContext("2d")!;

/**
 * A decorative board that runs forever behind the logo. Deliberately a fine
 * grid: at 5x4 the beams read as slabs across the menu, at 9x9 they read as
 * texture.
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
T(6, 2, { kind: "prism" });
T(6, 6, { kind: "splitter" });
T(4, 2, { kind: "star" });
T(2, 6, { kind: "mirrorA" });
const titleSim = simulate(titleLevel, 0);
const titleStars = new Set([2 * TW + 4]);

function drawTitleArt(now: number) {
  if (!$("#screen-title").classList.contains("is-active")) return;
  const { w, h, dpr } = fitCanvas(titleCanvas);
  titleCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const view: ViewState = {
    level: titleLevel,
    sim: titleSim,
    tick: 0,
    reveal: 1,
    starsLit: titleStars,
    hover: -1,
    time: now / 1000,
    winGlow: 0,
    hint: EMPTY,
  };
  titleCtx.globalAlpha = 0.42;
  draw(titleCtx, w, h, view);
  titleCtx.globalAlpha = 1;
}

const EMPTY: Set<number> = new Set();

// ---------------------------------------------------------------- input

function pointerCell(e: PointerEvent): number {
  if (!game) return -1;
  const r = canvas.getBoundingClientRect();
  const L = computeLayout(r.width, r.height, game.current());
  return cellAt(L, e.clientX - r.left, e.clientY - r.top);
}

canvas.addEventListener("pointermove", (e) => { hover = pointerCell(e); });
canvas.addEventListener("pointerleave", () => { hover = -1; });
canvas.addEventListener("pointerdown", (e) => {
  if (!game) return;
  const i = pointerCell(e);
  if (i < 0) return;
  e.preventDefault();
  const r = game.tap(i);
  if (r !== "none") {
    buzz(r === "removed" ? 8 : 12);
    renderTray();
  }
});

function buzz(ms: number) {
  try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
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
    b.setAttribute("aria-label", `${pieceName(slot.kind, slot.mask)}, ${left} left`);
    b.setAttribute("aria-pressed", String(k === game!.selected));

    const c = document.createElement("canvas");
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    c.width = c.height = Math.round(42 * dpr);
    const cc = c.getContext("2d")!;
    cc.scale(dpr, dpr);
    drawIcon(cc, 42, slot.kind, slot.mask);
    b.appendChild(c);

    const n = document.createElement("span");
    n.className = "count";
    n.textContent = String(left);
    b.appendChild(n);

    b.addEventListener("click", () => {
      if (left === 0) return;
      game!.selected = k;
      renderTray();
    });
    tray.appendChild(b);
  });
}

function pieceName(kind: TileKind, mask?: Light): string {
  switch (kind) {
    case "mirrorA": case "mirrorB": return "Mirror";
    case "splitter": return "Splitter";
    case "prism": return "Prism";
    case "filter": return `${LIGHT_LABEL[mask ?? 7] ?? ""} filter`;
    case "portal": return "Portal";
    default: return kind;
  }
}

// ---------------------------------------------------------------- level flow

function startLevel(n: number, isEndless = false) {
  endless = isEndless;
  night = n;

  // Generating a hard night means running the solver a few hundred times, which
  // is tens of milliseconds here and can be a few hundred on an old phone. Show
  // the screen first and generate on the next turn of the event loop, so the tap
  // always feels immediate.
  $("#level-name").textContent = isEndless ? `Drift ${n}` : `Night ${n}`;
  $("#level-meta").innerHTML = "<span>composing…</span>";
  $("#tray").innerHTML = "";
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
    if (!$("#screen-game").classList.contains("is-active") || night !== n) return;

    game = new Game(gen.level);
    winGlow = 0;
    $("#level-name").textContent = gen.level.name;
    renderMeta(gen.level);
    renderTray();
    toast(describeGoal(gen.level), 2600);
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

function onSettled() {
  if (!game) return;
  if (game.phase === "won") {
    const s = game.score();
    const earned = 1 + s.stars;
    if (!endless) {
      progress.stars[night] = Math.max(progress.stars[night] ?? 0, earned);
      progress.unlocked = Math.max(progress.unlocked, night + 1);
      saveProgress(progress);
    }
    buzz([12, 40, 18] as unknown as number);
    showWin(s);
  } else {
    const o = game.outcome;
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

function showWin(s: ReturnType<Game["score"]>) {
  const total = 1 + s.totalStars;
  const got = 1 + s.stars;
  $("#win-stars").textContent = "★".repeat(got) + "☆".repeat(Math.max(0, total - got));
  $("#win-title").textContent = got === total ? "Perfect night" : "Solved";
  $("#win-sub").textContent =
    `${s.used} piece${s.used === 1 ? "" : "s"} placed` +
    (s.par ? ` · par ${s.par}` : "") +
    (s.totalStars ? ` · ${s.stars}/${s.totalStars} stars` : "");
  $("#win").hidden = false;
}

let toastTimer = 0;
function toast(msg: string, ms = 1800) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), ms);
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
  const items: [TileKind, Light | undefined, string, string][] = [
    ["mirrorB", undefined, "Mirror", "Bends light 90°. Tap one you placed to flip it."],
    ["splitter", undefined, "Splitter", "Sends light out both sides at once — never straight on."],
    ["prism", undefined, "Prism", "Separates white light into rose, mint and sky."],
    ["filter", Chan.R, "Filter", "Removes every colour but its own. Light with none left dies."],
    ["star", undefined, "Star", "Light passes through. Collect every one to finish the night."],
    ["receptor", Chan.G, "Ring", "The goal. Must receive exactly its colour — mixing counts."],
  ];
  const ul = $("#howto-list");
  ul.innerHTML = "";
  for (const [kind, mask, name, desc] of items) {
    const li = document.createElement("li");
    const c = document.createElement("canvas");
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    c.width = c.height = Math.round(38 * dpr);
    const cc = c.getContext("2d")!;
    cc.scale(dpr, dpr);
    drawIcon(cc, 38, kind, mask);
    li.appendChild(c);
    const txt = document.createElement("div");
    txt.innerHTML = `<b>${name}</b><span>${desc}</span>`;
    li.appendChild(txt);
    ul.appendChild(li);
  }
}

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
    case "howto": renderHowto(); $("#howto").hidden = false; break;
    case "close-howto": $("#howto").hidden = true; break;

    case "run": {
      if (!game || game.phase === "running") return;
      if (game.phase === "won") return;
      if (game.remaining > 0) toast(`${game.remaining} piece(s) still in the tray`, 1500);
      game.start();
      break;
    }
    case "reset": game?.reset(); renderTray(); break;
    case "hint": {
      if (!game) return;
      toast(game.takeHint() ? "A piece belongs here." : "Nothing more to hint.", 2200);
      break;
    }
    case "replay": $("#win").hidden = true; game?.reset(); renderTray(); break;
    case "next": $("#win").hidden = true; startLevel(night + 1, endless); break;
  }
});

// Keyboard: space to run, R to reset, 1-6 to pick a tray slot.
document.addEventListener("keydown", (e) => {
  if (!game || !$("#screen-game").classList.contains("is-active")) return;
  if (e.key === " " || e.key === "Enter") { e.preventDefault(); ($("[data-action=run]") as HTMLElement).click(); }
  else if (e.key.toLowerCase() === "r") { game.reset(); renderTray(); }
  else if (/^[1-9]$/.test(e.key)) {
    const k = Number(e.key) - 1;
    if (k < game.tray.length) { game.selected = k; renderTray(); }
  }
});

// ---------------------------------------------------------------- boot

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
        game.board[p.i] = { kind: p.kind, mask: p.mask, placed: true };
        const slot = game.slotFor(p.kind, p.mask);
        if (slot) slot.used++;
      }
      renderTray();
      return game.level.solution;
    },
    run: () => game?.start(),
    phase: () => game?.phase,
  };
}

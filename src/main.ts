/**
 * App shell: screens, input, the render loop, and the choreography that turns
 * a solved puzzle into a moment.
 *
 * The board is canvas; everything else is DOM, so buttons stay real buttons.
 */
import "./style.css";
import { Level, Light, TileKind, WHITE, tileFrom } from "./engine/types";
import { generateCampaignLevel, campaignDifficulty, generateLevel } from "./engine/generate";
import { Segment, SimResult, evaluate, simulate } from "./engine/simulate";
import { PHASES, Phase as World, PhaseKey, phaseFor } from "./engine/phases";
import { Game, loadProgress, saveProgress, Progress, RevealTick } from "./game/state";
import { INFO, PieceKey, demoLevel, describe, infoKey, kindsIn } from "./game/info";
import { bonuses } from "./game/score";
import { TOOLS, TOOL_TIPS, sandboxLevel, sandboxTap } from "./game/sandbox";
import { BOOSTERS, BoosterKey, applicable, earned as dustFor } from "./game/stardust";
import { MEDALS, constellationOf, medalCount, medalsFor, newMedals } from "./game/medals";
import { MapLayout, MapWorld, boxAt, drawStarMap, layoutStarMap } from "./render/starmap";
import {
  DailyResult, WEEKDAY_NAMES, dailyMoon, dailyWorld, formatTime, generateDaily, levelHash, liveStreak,
  nextStreak, shareText, todayNumber, weekday,
} from "./game/daily";
import {
  BoardKind, SubmitBody, fetchBoard, fetchLadder, flushPending, forgetMe, leaderboardsEnabled,
  placementsOf, player, rename, setPlayer, submit, validName,
} from "./net/leaderboard";
import { cellAt, computeLayout, draw, drawIcon, frontOf } from "./render/renderer";
import { PathSeg, clearFx, spawnFx, spawnFxAt } from "./render/fx";
import { Particles, rand } from "./render/particles";
import { LIGHT_LABEL } from "./render/theme";
import { DEFAULT_THEME, THEMES, Theme } from "./render/themes";
import { moonForNight, moonPath } from "./render/moon";
import { WARP_HUES } from "./render/elements";
import {
  isMuted, isMusicMuted, musicBrightness, musicDuck,
  sfxAsteroid, sfxCardStar, sfxClimax, sfxComet, sfxDissolve, sfxHint, sfxHit, sfxInfo, sfxMiss,
  sfxNewWorld, sfxPlace, sfxPointTick, sfxPoints, sfxRemove, sfxRing, sfxRiser, sfxRotate,
  sfxSatelliteDown, sfxSatelliteUp, sfxSelect, sfxShine, sfxStar, sfxWarp, sfxWhoosh,
  sfxWrongRing, toggleMusicMuted, toggleMuted,
} from "./audio";
import { isMusicPlaying, setSong, startMusic, stopMusic } from "./music";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];

let progress: Progress = loadProgress();
let game: Game | null = null;
let night = 1;
let endless = false;
let endlessSeed = Date.now() >>> 0;
/** In the Galaxy: everything placeable, nothing recorded. */
let sandbox = false;
/** Playing a daily puzzle: its number, or 0. */
let dailyN = 0;
/** Seconds spent on the daily so far — only while it is on screen. */
let dailySeconds = 0;
let toolSel = 0;

/** The current world's look, and how full its moon is tonight. */
let theme: Theme = DEFAULT_THEME;
let moonLit = 0.35;

const now = () => performance.now() / 1000;

// ---------------------------------------------------------------- screens

type ScreenName = "title" | "nights" | "game" | "ranks" | "map";
let currentScreen: ScreenName = "title";

function show(name: ScreenName) {
  if (name !== currentScreen) sfxWhoosh();
  currentScreen = name;
  $$(".screen").forEach((s) => s.classList.remove("is-active"));
  $(`#screen-${name}`).classList.add("is-active");
  if (name === "nights") renderNights();
  if (name === "ranks") void renderRanks();
  if (name === "map") openMap();
  if (name === "title") refreshContinue();
}

/** Keep the main menu button in step with progress made since it was drawn. */
function refreshContinue() {
  ($("[data-action=play]") as HTMLElement).textContent =
    progress.unlocked > 1 ? `Continue · Night ${progress.unlocked}` : "Play";
  const today = todayNumber();
  const done = progress.daily[today];
  const streak = liveStreak(progress.dailyStreak, progress.lastDaily, today);
  $("#daily-sub").textContent = done
    ? `✓ solved${streak >= 2 ? ` · 🔥 ${streak}` : ""}`
    : `#${today} · ${WEEKDAY_NAMES[weekday(today)]}${streak >= 1 ? ` · 🔥 ${streak}` : ""}`;
  $("[data-action=daily]").classList.toggle("done", !!done);
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

    game.tickClock(dt);
    if (dailyN && game.phase !== "won" && $("#piece-card").hidden) {
      const before = Math.floor(dailySeconds);
      dailySeconds += dt;
      if (Math.floor(dailySeconds) !== before) renderDailyClock();
    }
    if (game.phase === "running") handleReveal(game.advance(dt), t);
    for (const [k, v] of gateFlash) {
      if (v <= dt * 2.5) gateFlash.delete(k); else gateFlash.set(k, v - dt * 2.5);
    }
    renderScore();

    const celebrating = game.phase === "won" || climaxed;
    winGlow = celebrating ? Math.min(1, winGlow + dt * 2.4) : Math.max(0, winGlow - dt * 2.4);
    flare = Math.max(0, flare - dt * 1.1);
    punch = Math.max(0, punch - dt * 3.2);

    // While building, silently simulate the board as it stands — at the moment
    // Shine would fire — so crystals can show where their colours will go
    // before the player commits to a run.
    const preview: SimResult | null = game.phase === "build" ? simulate(game.current(), game.fireTick) : null;
    const front = game.frontHops;
    const cometCollected = game.sim && game.phase !== "build"
      ? game.sim.cometHits.filter((c) => c.order <= front).length : 0;

    draw(ctx, w, h, {
      level: game.current(),
      sim: game.sim,
      tick: game.tick,
      reveal: game.reveal,
      starsLit: game.starsLit,
      hover,
      time: t,
      winGlow,
      hint: game.openHints,
      hintGhost: game.openGhosts,
      particles: boardFx,
      dt,
      flare,
      punch,
      previewSim: preview,
      clock: game.displayClock,
      moonLit,
      theme,
      cometCollected,
      gateFlash,
    });
  }

  drawTitleArt(t, dt);
  if (currentScreen === "map") drawMap(t);
  drawCardDemo(t, dt);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- the reveal

/** How far up the scale this run's notes have climbed. */
let rung = 2;
let climaxed = false;
let climaxCell = -1;
let exitOrders: number[] = [];
let gates: ReturnType<Game["gateCrossings"]> = [];
let carries: ReturnType<Game["carries"]> = [];
let lastDissolve = 0;
let lastWarp = 0;
let lastPointTick = 0;
let pointTicks = 0;
/** How far the light had got at the end of the previous frame, in hops. */
let lastFront = 0;
/** Warp gates flashing as light passes through them: "axis:index" -> 0..1. */
const gateFlash = new Map<string, number>();

function beginRun() {
  if (!game) return;
  rung = 2;
  climaxed = false;
  climaxCell = -1;
  lastFront = 0;
  pointTicks = 0;
  if (game.timingAid && game.moving) {
    const t = game.nextWinningTick();
    if (t === null) toast("No moment works with these pieces — something needs to change.", 2600);
    else game.clock = t;
  }
  sfxShine();
  musicBrightness(0.62, 0.6);
  game.start();
  exitOrders = game.exitOrders();
  gates = game.gateCrossings();
  carries = game.carries();
}

/** Things the reveal handles through their own events rather than on touch. */
const QUIET_ON_TOUCH = new Set(["comet", "asteroid", "satellite", "dish", "terrain"]);

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
    if (!kind || kind === "empty" || QUIET_ON_TOUCH.has(kind)) continue;
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

  handleEvents(tick, t);

  // Light fizzing off the edge of the board.
  const f = game.frontHops;
  const prev = lastFront;
  lastFront = f;

  // Through a warp gate: a hollow whoosh and a flash in the gate's colour.
  const w = game.level.w, h = game.level.h;
  for (const g of gates) {
    if (g.order <= prev || g.order > f) continue;
    const row = g.x < 0 || g.x >= w;
    const warp = game.level.warps?.find((wp) => wp.axis === (row ? "row" : "col") && wp.index === (row ? g.y : g.x));
    const hue = warp?.hue ?? 0;
    const at = { x: Math.max(-0.62, Math.min(w - 0.38, g.x)), y: Math.max(-0.62, Math.min(h - 0.38, g.y)) };
    spawnFxAt(at.x, at.y, "warpFlash", t, { color: WARP_HUES[hue % WARP_HUES.length] });
    if (warp) gateFlash.set(`${warp.axis}:${warp.index}`, 1);
    if (t - lastWarp > 0.25) { sfxWarp(hue); lastWarp = t; }
  }

  // A satellite picking the light up, and its dish putting it down.
  for (const c of carries) {
    if (c.from > prev && c.from <= f) sfxSatelliteUp();
    if (c.to > prev && c.to <= f) {
      sfxSatelliteDown();
      spawnFxAt(c.x1, c.y1, "warpFlash", t, { color: "#bff4ff" });
    }
  }

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
 * Points as the light earns them: a number floating up off each thing that
 * scores, a chime for the big ones, and a soft tick for the travel itself.
 */
function handleEvents(tick: RevealTick, t: number) {
  if (!game) return;
  const w = game.level.w;
  const pos = (i: number) => ({ x: i % w, y: Math.floor(i / w) });
  let evPoints = 0;

  for (const e of tick.events) {
    evPoints += e.points;
    const p = pos(e.cell);
    const label = `${e.points > 0 ? "+" : "−"}${Math.abs(e.points)}`;
    switch (e.kind) {
      case "galaxy":
        spawnFxAt(p.x, p.y, "points", t, { text: label, color: "#ffb3f0" });
        sparkle(e.cell, 3, "#ffc8f4");
        if (t - lastPointTick > 0.05) { sfxPointTick(pointTicks++, true); lastPointTick = t; }
        break;
      case "star":
        spawnFxAt(p.x, p.y, "points", t + 0.1, { text: label, color: "#ffe066" });
        break;
      case "ring":
        spawnFxAt(p.x, p.y, "points", t + 0.15, { text: label, color: "#fff3d6" });
        sfxPoints(true);
        break;
      case "asteroid":
        spawnFx(e.cell, "shatter", t, game.sim?.segments.find((s) => s.x1 === p.x && s.y1 === p.y)?.light ?? WHITE);
        spawnFxAt(p.x, p.y, "points", t + 0.05, { text: label, color: "#ff8a7a" });
        sfxAsteroid();
        buzz([30, 20, 30]);
        break;
      case "comet": {
        spawnFxAt(p.x, p.y, "points", t + 0.1, { text: label, color: "#bff4ff" });
        sfxComet(e.seq ?? 0, !!e.last);
        const next = game.current().tiles.findIndex((tl) => tl.kind === "comet" && tl.seq === (e.seq ?? 0) + 1);
        if (next >= 0) {
          spawnFxAt(p.x, p.y, "cometLeap", t, { to: pos(next) });
        } else if (e.last) {
          fountain(e.cell, 22, "#bff4ff", 1.5);
          toast("Shooting star caught!", 1800);
        }
        sparkle(e.cell, 8, "#bff4ff");
        break;
      }
    }
  }

  // The plain travel points: a quiet tick, rising, a few times a second.
  if (tick.points - evPoints > 0 && t - lastPointTick > 0.09) {
    sfxPointTick(pointTicks++, false);
    lastPointTick = t;
  }
}

/** A few sparks twinkling around a cell. */
function sparkle(i: number, n: number, color: string) {
  if (!game) return;
  const w = game.level.w;
  const x = (i % w) + 0.5, y = Math.floor(i / w) + 0.5;
  const t = now();
  for (let k = 0; k < n; k++) {
    const a = rand(0, Math.PI * 2);
    const sp = rand(0.2, 0.9);
    boardFx.add({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0,
      born: t, life: rand(0.4, 0.9), size: rand(0.015, 0.035), color,
      glint: true, twinkle: Math.random() * 6,
    });
  }
}

// ---------------------------------------------------------------- leaderboards

/** The solve waiting to be sent, if the player has not decided about joining yet. */
let unsent: SubmitBody | null = null;

/** Which board a solve belongs on: today's daily or a campaign night. Endless and the Galaxy have none. */
function boardOf(): { kind: BoardKind; id: number } | null {
  if (dailyN) return { kind: "daily", id: dailyN };
  if (!endless && !sandbox && night > 0) return { kind: "night", id: night };
  return null;
}

function winRank(html: string) {
  const el = $("#win-rank");
  el.innerHTML = html;
  el.hidden = !html;
}

/**
 * After a win: send what was placed and when — never a score; the server
 * replays the shot and scores it itself — and say where it ranks.
 */
async function sendScore(assisted: boolean) {
  winRank("");
  unsent = null;
  const where = boardOf();
  if (!game || !where || !leaderboardsEnabled()) return;
  if (assisted) { winRank("Solved with a hint — hint-free solves go on the leaderboard."); return; }
  const body: SubmitBody = {
    ...where,
    placements: placementsOf(game.board),
    fireTick: game.firedAt,
    seconds: dailyN ? Math.round(dailySeconds) : undefined,
    hash: levelHash(game.level),
  };
  const me = player();
  if (me.optIn === null || (me.optIn && !me.name)) {
    unsent = body;
    winRank(`<button class="link" data-action="join-open">Join the leaderboard</button> to see where this ranks.`);
    return;
  }
  if (!me.optIn) return;
  await sendBody(body);
}

async function sendBody(body: SubmitBody) {
  const label = body.kind === "daily" ? "today's daily" : `Night ${body.id}`;
  winRank("Sending to the leaderboard…");
  try {
    const r = await submit(body);
    if (!r) { winRank(""); return; }
    winRank(`<button class="link" data-action="ranks-from-win">🏆 #${r.rank} of ${r.total} on ${label}</button>` +
      (r.improved ? "" : " · your best stands"));
  } catch (e) {
    const status = (e as { status?: number }).status;
    winRank(status === undefined ? "Couldn't reach the leaderboard — it'll be sent next time."
      : `Not ranked: ${(e as Error).message}.`);
  }
}

let ranksTab: "daily" | "night" | "ladder" = "daily";
let ranksNight = 1;

/** The leaderboards screen: today's daily, one night at a time, and the ladder. */
async function renderRanks() {
  for (const b of $$("[data-action=ranks-tab]")) b.classList.toggle("on", b.dataset.tab === ranksTab);
  $("#ranks-nightnav").hidden = ranksTab !== "night";
  $("#ranks-night").textContent = `Night ${ranksNight}`;
  renderMe();
  const list = $("#ranks-list");
  const you = $("#ranks-you");
  you.textContent = "";
  if (!leaderboardsEnabled()) {
    list.innerHTML = `<p class="muted center">Leaderboards aren't connected in this build of the game.</p>`;
    return;
  }
  list.innerHTML = `<p class="muted center">Looking up…</p>`;
  const tab = ranksTab, n = ranksNight;
  try {
    if (tab === "ladder") {
      const v = await fetchLadder();
      if (tab !== ranksTab) return;
      list.innerHTML = v.rows.length ? v.rows.map((r) =>
        `<li class="${r.you ? "you" : ""}"><span class="rk">${r.rank}</span><span class="nm">${esc(r.name)}</span>` +
        `<span class="dim">${r.nights} night${r.nights === 1 ? "" : "s"}</span><b>${r.points}</b></li>`).join("")
        : `<p class="muted center">Nobody yet. Solve a night to be first.</p>`;
      if (v.you && !v.rows.some((r) => r.you)) you.textContent = `You: #${v.you.rank} of ${v.total} · ${v.you.points}`;
    } else {
      const id = tab === "daily" ? todayNumber() : n;
      const v = await fetchBoard(tab, id);
      if (tab !== ranksTab || n !== ranksNight) return;
      list.innerHTML = v.rows.length ? v.rows.map((r) =>
        `<li class="${r.you ? "you" : ""}"><span class="rk">${r.rank}</span><span class="nm">${esc(r.name)}</span>` +
        `<span class="dim">${r.used} pc${r.used === 1 ? "" : "s"}${r.used <= r.fewest ? " ✓" : ""}${tab === "daily" ? ` · ${formatTime(r.seconds)}` : ""}</span>` +
        `<b>${r.points}</b></li>`).join("")
        : `<p class="muted center">Nobody yet. ${tab === "daily" ? "Today's puzzle is waiting." : "Be the first."}</p>`;
      if (v.you && !v.rows.some((r) => r.you)) you.textContent = `You: #${v.you.rank} of ${v.total}`;
    }
  } catch {
    list.innerHTML = `<p class="muted center">Can't reach the leaderboard right now.</p>`;
  }
}

function renderMe() {
  const me = player();
  $("#ranks-me").innerHTML = me.optIn && me.name
    ? `Playing as <b>${esc(me.name)}</b> · <button class="link" data-action="join-open">rename</button> · ` +
      `<button class="link" data-action="forget">leave</button>`
    : `<button class="link" data-action="join-open">Join with a nickname</button> to appear here.`;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function openJoin() {
  ($("#join-name") as HTMLInputElement).value = player().name;
  $("#join-error").textContent = "";
  $("#join-card").hidden = false;
  window.setTimeout(() => ($("#join-name") as HTMLInputElement).focus(), 50);
}

async function joinYes() {
  const name = validName(($("#join-name") as HTMLInputElement).value);
  if (!name) { $("#join-error").textContent = "2–16 letters, numbers, spaces or _ . ' -"; return; }
  const was = player();
  $("#join-card").hidden = true;
  if (was.optIn && was.name) {
    try { await rename(name); } catch { toast("Couldn't rename right now.", 2000); }
  } else {
    setPlayer({ name, optIn: true });
  }
  sfxSelect();
  if (unsent) { const b = unsent; unsent = null; await sendBody(b); }
  void flushPending();
  if (currentScreen === "ranks") void renderRanks();
}

let forgetArmed = 0;

/** After enough misses on a campaign night, offer a way past it. */
function renderSkip() {
  const b = $("[data-action=skip]");
  b.hidden = !game || sandbox || endless || !!dailyN || game.misses < 5 || game.phase === "won";
}

// ---------------------------------------------------------------- star map

const mapWrap = $("#map-wrap");
const mapCanvas = $<HTMLCanvasElement>("#map-canvas");
const mapCtx = mapCanvas.getContext("2d")!;
let mapWorlds: MapWorld[] = [];
let mapLayout: MapLayout | null = null;
let backfill = 0;

/** The worlds reached so far, each with its nights and whatever they have won. */
function buildMapWorlds(): MapWorld[] {
  const reach = Math.max(progress.unlocked, ...Object.keys(progress.maps).map(Number), 1);
  const out: MapWorld[] = [];
  for (const w of PHASES) {
    if (w.first > reach) break;
    const last = Number.isFinite(w.last) ? w.last : Math.max(w.first + 9, reach);
    const nights = [];
    for (let n = w.first; n <= last; n++) nights.push({ n, c: progress.maps[n], medals: medalsOf(n) });
    out.push({ name: w.name, color: THEMES[w.key].planet.body[0], nights });
  }
  return out;
}

function openMap() {
  mapWorlds = buildMapWorlds();
  mapLayout = layoutStarMap(mapWrap.clientWidth || 360, mapWorlds);
  $("#map-spacer").style.height = `${mapLayout.height}px`;
  renderMapCount();
  // Nights solved before the star map existed: rebuild their constellations
  // quietly, one at a time, so opening the map never stalls.
  window.clearTimeout(backfill);
  const missing = Object.keys(progress.best).map(Number).filter((n) => n > 0 && !progress.maps[n]);
  const step = () => {
    const n = missing.shift();
    if (n === undefined || currentScreen !== "map") return;
    progress.maps[n] = constellationOf(generateCampaignLevel(n, progress.runSeed).level);
    saveProgress(progress);
    mapWorlds = buildMapWorlds();
    renderMapCount();
    backfill = window.setTimeout(step, 30);
  };
  backfill = window.setTimeout(step, 200);
}

function renderMapCount() {
  const solved = Object.keys(progress.maps).length;
  let medals = 0;
  for (let n = 1; n <= progress.unlocked; n++) medals += medalCount(medalsOf(n));
  $("#map-count").textContent = `${solved} constellation${solved === 1 ? "" : "s"} · ${medals} medal${medals === 1 ? "" : "s"}`;
}

function drawMap(t: number) {
  if (!mapLayout) return;
  const { w, h, dpr } = fitCanvas(mapCanvas);
  mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawStarMap(mapCtx, w, h, t, mapWorlds, mapLayout, mapWrap.scrollTop);
}

mapCanvas.addEventListener("click", (e) => {
  if (!mapLayout) return;
  const r = mapCanvas.getBoundingClientRect();
  const n = boxAt(mapLayout, e.clientX - r.left, e.clientY - r.top + mapWrap.scrollTop);
  if (!n) return;
  if (progress.openAll || n <= progress.unlocked) startLevel(n);
  else toast(`Night ${n} is still ahead of you.`, 1600);
});
window.addEventListener("resize", () => { if (currentScreen === "map") openMap(); });

// ---------------------------------------------------------------- stardust

let dustGained = 0;

function renderDust() {
  for (const el of $$(".dust-count")) el.textContent = String(progress.stardust);
}

/** The booster sheet: what each does, what it costs, and whether it can help here. */
function openBoosters() {
  if (!game || sandbox || game.phase === "running") return;
  const g = game;
  $("#boost-balance").textContent = String(progress.stardust);
  const list = $("#boost-list");
  list.innerHTML = "";
  for (const b of BOOSTERS) {
    const can = applicable(b.key, g.current(), g.decoys, g.nextPiece) && !(b.key === "timing" && g.timingAid);
    const afford = progress.stardust >= b.cost;
    const li = document.createElement("li");
    li.innerHTML = `<div><b>${b.name}</b><span>${b.key === "timing" && g.timingAid ? "On for this night." : b.blurb}</span></div>`;
    const btn = document.createElement("button");
    btn.className = "btn btn-primary btn-cost";
    btn.textContent = `✦ ${b.cost}`;
    btn.disabled = !can || !afford;
    btn.title = !can ? "Nothing for it to do here" : !afford ? "Not enough stardust" : "";
    btn.dataset.action = "boost";
    btn.dataset.boost = b.key;
    li.appendChild(btn);
    list.appendChild(li);
  }
  $("#boost-card").hidden = false;
  sfxInfo();
}

function useBooster(key: BoosterKey) {
  if (!game) return;
  const b = BOOSTERS.find((x) => x.key === key)!;
  if (progress.stardust < b.cost) return;
  let ok = false;
  if (key === "place") {
    const i = game.placeNext();
    ok = i >= 0;
    if (ok) { spawnFx(i, "place", now()); sfxPlace(); }
  } else if (key === "sweep") {
    ok = game.sweepDecoys() > 0;
    if (ok) { sfxRemove(); toast("Decoys swept away.", 1800); }
  } else if (key === "timing") {
    ok = game.moving && !game.timingAid;
    if (ok) { game.timingAid = true; sfxHint(); toast("Shine will wait for a moment that works.", 2200); }
  }
  $("#boost-card").hidden = true;
  if (!ok) return;
  progress.stardust -= b.cost;
  saveProgress(progress);
  renderDust();
  renderTray();
}

/** The points counter over the board. */
function renderScore() {
  const el = $("#score");
  if (!game || (game.phase === "build" && !game.runScore)) { el.hidden = true; return; }
  el.hidden = false;
  const v = game.runScore;
  const txt = `✦ ${v}`;
  if (el.textContent !== txt) {
    el.textContent = txt;
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
  }
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
  if (sandbox) {
    // The Galaxy keeps no score card: just say what that run was worth.
    if (game.phase === "won" && !climaxed && game.sim?.satisfied.size) celebrate(now());
    const pts = game.constellation();
    if (game.phase === "won" && pts.length >= 2) spawnFx(pts[0], "constellation", now(), WHITE, { points: pts });
    toast(`${game.phase === "won" && game.sim?.satisfied.size ? "Solved! " : ""}✦ ${game.runScore} points`, 2400);
    if (game.phase !== "won") sfxMiss();
    return;
  }
  if (game.phase === "won") {
    if (!climaxed) celebrate(now());
    const s = game.score();
    const earned = 1 + s.stars;
    const firstTry = s.firstTry;
    const total = s.points + bonuses(s.used, s.par, s.firstTry).reduce((n, b) => n + b.points, 0);
    let newBest = false;
    wonMedals = [];
    // Only a first solve earns stardust, so nothing can be farmed.
    const first = dailyN ? !progress.daily[dailyN]
      : !endless && !sandbox && progress.best[night] === undefined;
    if (dailyN) {
      newBest = !progress.daily[dailyN];
      recordDaily(s, total);
      renderDailyClock();
    } else if (!endless) {
      progress.stars[night] = Math.max(progress.stars[night] ?? 0, earned);
      progress.unlocked = Math.max(progress.unlocked, night + 1);
      newBest = total > (progress.best[night] ?? -Infinity);
      if (newBest) progress.best[night] = total;
      const had = medalsOf(night);
      progress.medals[night] = had | medalsFor({ solved: true, used: s.used, par: s.par, firstTry: s.firstTry });
      wonMedals = newMedals(had, progress.medals[night]).map((m) => `${m.glyph} ${m.name}`);
      progress.maps[night] = { w: game.level.w, h: game.level.h, pts: game.route() };
      progress.skipped = progress.skipped.filter((n) => n !== night);
    }
    progress.streak = firstTry ? progress.streak + 1 : 0;
    progress.bestStreak = Math.max(progress.bestStreak, progress.streak);
    dustGained = endless ? 0 : dustFor({ first, points: total, daily: !!dailyN, streak: progress.dailyStreak });
    progress.stardust += dustGained;
    saveProgress(progress);
    renderDust();

    // Join up what the light found, like a star map, then show the card once
    // the board has had a moment to itself.
    const pts = game.constellation();
    if (pts.length >= 2) spawnFx(pts[0], "constellation", now(), WHITE, { points: pts });
    window.setTimeout(() => showWin(s, total, newBest), 900);
    void sendScore(s.assisted);
  } else {
    const o = game.outcome;
    const sim = game.sim;
    sfxMiss();
    musicBrightness(0.35, 1.2);
    const smashed = (sim?.asteroidsHit.size ?? 0) > 0;
    let msg = !o || o.satisfiedCount === 0
      ? smashed ? "An asteroid broke the light." : "The light never arrived."
      : o.satisfiedCount < o.totalReceptors
        ? `${o.satisfiedCount} of ${o.totalReceptors} rings lit.`
        : o.starsLit.size < o.totalStars
          ? `Rings lit, but ${o.totalStars - o.starsLit.size} star(s) missed.`
          : sim && sim.cometTotal > sim.cometHits.length
            ? `Rings lit, but the shooting star got away (${sim.cometHits.length} of ${sim.cometTotal}).`
            : "Not quite.";
    // With things moving, the same board may win at a different moment.
    if (game.moving && evaluate(game.current()).won) msg += " The pieces are right — try another moment!";
    // Stuck? Offer a hint after a few misses, and a way past after a few more.
    else if (game.misses === 3 && !sandbox) {
      msg += " Stuck? Tap ? for a hint.";
      $("[data-action=hint]").classList.add("nudge");
    }
    toast(msg, 3200);
    renderSkip();
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
    particles: titleFx, dt, moonLit: 0.3,
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
  const shown = cycle < 0.15 ? null : cardSim;
  const front = frontOf({ sim: shown, reveal });
  draw(cardCtx, w, h, {
    level: cardLevel, sim: shown, tick: 0, reveal,
    starsLit: reveal > 0.7 ? cardSim.starsLit : EMPTY,
    hover: -1, time: t, winGlow: 0, hint: EMPTY,
    particles: cardFx, dt, mini: true, theme, moonLit,
    cometCollected: shown ? shown.cometHits.filter((c) => c.order <= front).length : 0,
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
  const r = sandbox ? sandboxTap(game, i, TOOLS[toolSel]) : game.tap(i);
  if (r === "blocked") {
    toast("Something drifts through here — nothing can be built on its path.", 2400);
    sfxWrongRing();
    return;
  }
  if (r === "none") {
    // Tapping the level's own furniture tells you what it is.
    const onMilkyWay = tile.kind === "empty" && game.level.galaxy?.includes(i);
    const d = onMilkyWay ? { name: INFO.milkyway.name, text: INFO.milkyway.short } : describe(tile);
    if (d && game.phase !== "running") { toast(`${d.name} — ${d.text}`, 3200); sfxInfo(); }
    return;
  }
  buzz(r === "removed" ? 8 : 12);
  spawnFx(i, r === "placed" || r === "moved" ? "place" : r === "rotated" ? "rotate" : "remove", now());
  if (r === "placed" || r === "moved") sfxPlace();
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
  tray.classList.toggle("is-sandbox", sandbox);
  if (sandbox) { renderToolTray(tray); return; }
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

/** The Galaxy's tray: one of every tool, and no counts. */
function renderToolTray(tray: HTMLElement) {
  TOOLS.forEach((tool, k) => {
    const b = document.createElement("button");
    b.className = `slot${k === toolSel ? " selected" : ""}`;
    b.setAttribute("aria-label", tool.name);
    b.setAttribute("aria-pressed", String(k === toolSel));
    b.title = tool.name;
    const c = document.createElement("canvas");
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    c.width = c.height = Math.round(42 * dpr);
    const cc = c.getContext("2d")!;
    cc.scale(dpr, dpr);
    drawIcon(cc, 42, tool.kind, tool.mask, tool.from);
    b.appendChild(c);
    b.addEventListener("click", () => {
      toolSel = k;
      sfxSelect();
      renderTray();
      b.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    });
    tray.appendChild(b);
  });
  const tool = TOOLS[toolSel];
  const k = tool.key === "mirror" ? "mirror" : infoKey(tool.kind as TileKind) ?? (tool.key as PieceKey);
  const info = tool.kind === "moon" ? null : INFO[k as PieceKey];
  const cap = $("#tray-caption");
  cap.hidden = false;
  $("#tray-caption-text").innerHTML =
    `<b>${tool.name}</b> ${TOOL_TIPS[tool.key] ?? info?.short ?? ""}`;
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

/** Dress the scene for a night: its world's sky, its moon, its song. */
function setWorld(key: PhaseKey, lit: number) {
  theme = THEMES[key] ?? DEFAULT_THEME;
  moonLit = lit;
  setSong(key);
  document.documentElement.style.setProperty("--world", theme.planet.body[0]);
}

function startLevel(n: number, isEndless = false) {
  endless = isEndless;
  sandbox = false;
  dailyN = 0;
  night = n;
  const { phase: world, index } = phaseFor(n);
  setWorld(world.key, moonForNight(index));

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
    $("[data-action=boosters]").hidden = false;
    $("[data-action=hint]").classList.remove("nudge");
    renderSkip();
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
    // Arriving somewhere new: the world's own card first, then its pieces.
    if (!isEndless && !progress.phasesSeen.includes(world.key)) openWorld(world, gen.level);
    else introduceNewPieces(gen.level);
  }, 16);
}

const dailyCache = new Map<number, Level>();

/** Today's puzzle — the same board for everyone, from the date alone. */
function startDaily() {
  const n = todayNumber();
  endless = false;
  sandbox = false;
  dailyN = n;
  night = 0;
  dailySeconds = 0;
  setWorld(dailyWorld(n), dailyMoon(n));
  $("#level-name").textContent = `Daily #${n}`;
  $("#level-meta").innerHTML = "<span>composing…</span>";
  $("#tray").innerHTML = "";
  $("#tray-caption").hidden = true;
  $("#win").hidden = true;
  game = null;
  show("game");

  setTimeout(() => {
    let level = dailyCache.get(n);
    if (!level) { level = generateDaily(n).level; dailyCache.set(n, level); }
    if (currentScreen !== "game" || dailyN !== n) return;
    game = new Game(level);
    $("[data-action=boosters]").hidden = false;
    $("[data-action=hint]").classList.remove("nudge");
    renderSkip();
    winGlow = 0; flare = 0; climaxed = false;
    clearFx(); boardFx.clear();
    musicBrightness(0.35, 0.8);
    renderDailyClock();
    renderTray();
    const done = progress.daily[n];
    toast(done ? "Already solved today — play it again for fun." : describeGoal(level), 2600);
    introduceNewPieces(level);
  }, 16);
}

/** The daily's header line: the day, the clock, and the fewest pieces. */
function renderDailyClock() {
  if (!dailyN) return;
  const done = progress.daily[dailyN];
  $("#level-meta").innerHTML =
    `<span>${WEEKDAY_NAMES[weekday(dailyN)]}</span>` +
    `<span class="clock">${done ? `✓ ${formatTime(done.seconds)}` : `⏱ ${formatTime(dailySeconds)}`}</span>` +
    (game ? `<span>fewest ${game.level.par ?? "?"}</span>` : "");
}

/** Record the first solve of a daily, and move the streak on. */
function recordDaily(s: ReturnType<Game["score"]>, total: number): DailyResult {
  const existing = progress.daily[dailyN];
  if (existing) return existing;
  const r: DailyResult = {
    points: total, used: s.used, fewest: s.par, seconds: Math.round(dailySeconds),
    misses: game?.misses ?? 0, assisted: s.assisted,
  };
  progress.daily[dailyN] = r;
  progress.dailyStreak = nextStreak(progress.dailyStreak, progress.lastDaily, dailyN);
  progress.dailyBestStreak = Math.max(progress.dailyBestStreak, progress.dailyStreak);
  progress.lastDaily = dailyN;
  saveProgress(progress);
  return r;
}

const SHARE_URL = "https://tijantrados.github.io/MoonBeam/";

async function shareDaily() {
  const r = progress.daily[dailyN];
  if (!r) return;
  const text = shareText(dailyN, r, progress.dailyStreak, SHARE_URL);
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) { await navigator.share({ text }); return; }
  } catch { /* cancelled, or not allowed: fall back to the clipboard */ }
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied — paste it anywhere.", 2000);
  } catch {
    toast(text, 6000);
  }
}

/** The Galaxy: every element, no rules, nothing recorded. */
function startSandbox() {
  endless = false;
  dailyN = 0;
  sandbox = true;
  night = 0;
  toolSel = 0;
  setWorld("neptune", 1);
  game = new Game(sandboxLevel());
  renderSkip();
  winGlow = 0; flare = 0; climaxed = false;
  clearFx(); boardFx.clear();
  $("#win").hidden = true;
  $("#level-name").textContent = "The Galaxy";
  $("[data-action=boosters]").hidden = true;
  $("#level-meta").innerHTML = "<span>every element · build anything</span>";
  show("game");
  renderTray();
  musicBrightness(0.5, 0.8);
  toast("Everything is here. Place anything, tap it again to change it, and Shine.", 3600);
}

let worldLevel: Level | null = null;

/** A new world's opening card: its planet, its mood, and what is new there. */
function openWorld(world: World, level: Level) {
  worldLevel = level;
  const th = THEMES[world.key];
  const planet = $("#world-planet");
  const [a, b, c] = th.planet.body;
  planet.style.background = world.key === "blackhole"
    ? "radial-gradient(circle at 50% 50%, #000 0 34%, #ffb86b 38%, #ff7ad9 46%, transparent 64%)"
    : `radial-gradient(circle at 32% 30%, ${a}, ${b} 55%, ${c})`;
  planet.classList.toggle("ringed", world.key === "saturn" || world.key === "uranus");
  $("#world-tag").textContent = `Nights ${world.first}–${Number.isFinite(world.last) ? world.last : "∞"}`;
  $("#world-name").textContent = world.name;
  $("#world-blurb").textContent = world.blurb;
  const fresh = world.introduces.map((f) => FEATURE_NAMES[f]).filter(Boolean);
  $("#world-new").textContent = fresh.length ? `New here: ${fresh.join(", ")}.` : "";
  $("#world-card").hidden = false;
  sfxNewWorld();
  progress.phasesSeen.push(world.key);
  saveProgress(progress);
}

const FEATURE_NAMES: Partial<Record<string, string>> = {
  crystals: "crystals", tints: "tints", comets: "shooting stars", portals: "portals",
  terrain: "rough ground", warps: "warps", blackholes: "black holes", asteroids: "asteroids",
  satellites: "satellites", movingWalls: "moving walls",
};

function renderMeta(l: Level) {
  const d = Math.round(l.difficulty ?? 1);
  const pips = Array.from({ length: 10 }, (_, i) =>
    `<i class="pip${i < d ? " on" : ""}"></i>`).join("");
  $("#level-meta").innerHTML =
    `<span class="pips" title="Difficulty ${l.difficulty}">${pips}</span>` +
    `<span title="The fewest pieces this night can be solved with">fewest ${l.par ?? "?"}</span>` +
    (night > 0 && !endless ? medalRow(medalsOf(night)) : "");
}

/** A night's medals, counting nights solved before medals existed as lit. */
function medalsOf(n: number): number {
  return progress.medals[n] ?? (progress.best[n] !== undefined || (progress.stars[n] ?? 0) > 0 ? 1 : 0);
}

let wonMedals: string[] = [];

function medalRow(mask: number): string {
  return `<span class="medals">${MEDALS.map((m) =>
    `<i class="${mask & m.bit ? "on" : ""}" title="${m.name}: ${m.how}">${m.glyph}</i>`).join("")}</span>`;
}

function describeGoal(l: Level): string {
  const rings = l.tiles.filter((t) => t.kind === "receptor");
  const stars = l.tiles.filter((t) => t.kind === "star").length;
  const comet = l.tiles.some((t) => t.kind === "comet");
  const cols = [...new Set(rings.map((r) => LIGHT_LABEL[r.mask ?? 7]))];
  const ring = rings.length === 1 ? "1 ring" : `${rings.length} rings`;
  const colour = cols.length === 1 ? ` (${cols[0]})` : ` (${cols.join(", ")})`;
  const extras = [
    stars ? `collect ${stars} star${stars > 1 ? "s" : ""}` : "",
    comet ? "catch the shooting star" : "",
  ].filter(Boolean);
  return `Light ${ring}${colour}${extras.length ? ` and ${extras.join(" and ")}` : ""}`;
}

/**
 * The results card. Stars pop in one at a time, each with its own rising chime,
 * and badges call out what was special about this solve — first try, the
 * fewest pieces, a streak — because a result nobody comments on does not feel
 * like one. Below them, the points: the run's own, then each bonus and
 * penalty, counting up to the total.
 */
function showWin(s: ReturnType<Game["score"]>, points: number, newBest: boolean) {
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
    (s.par ? ` · fewest possible ${s.par}` : "") +
    (s.totalStars ? ` · ${s.stars}/${s.totalStars} stars` : "");

  const badges: string[] = [];
  if (s.firstTry) badges.push("✨ First try");
  if (s.assisted) badges.push("🔭 With help");
  for (const m of wonMedals) badges.push(`🏅 ${m}`);
  if (s.par && s.used < s.par) badges.push("🌙 Fewer than we found!");
  else if (s.par && s.used === s.par) badges.push("🌙 Fewest possible");
  if (progress.streak >= 2) badges.push(`💫 ${progress.streak} in a row`);
  $("#win-badges").innerHTML = badges
    .map((b, k) => `<span class="badge" style="animation-delay:${0.5 + k * 0.15}s">${b}</span>`)
    .join("");

  $("#win-dust").textContent = dustGained > 0 ? `✦ +${dustGained} stardust` : "";
  const rows = [{ label: "This run", points: s.points }, ...bonuses(s.used, s.par, s.firstTry)];
  $("#win-points").innerHTML =
    rows.map((r, k) =>
      `<div class="pt-row${r.points < 0 ? " neg" : ""}" style="animation-delay:${0.6 + k * 0.12}s">` +
      `<span>${r.label}</span><b>${r.points > 0 ? "+" : r.points < 0 ? "−" : ""}${Math.abs(r.points)}</b></div>`).join("") +
    `<div class="pt-row pt-total" style="animation-delay:${0.6 + rows.length * 0.12}s">` +
    `<span>Total${newBest ? ` <em>new best!</em>` : ""}</span><b data-count="${points}">0</b></div>`;
  const totalEl = $("#win-points [data-count]");
  const t0 = performance.now() + (0.6 + rows.length * 0.12) * 1000;
  const countUp = (ms: number) => {
    const k = Math.max(0, Math.min(1, (ms - t0) / 700));
    totalEl.textContent = String(Math.round(points * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(countUp);
    else sfxPoints(true);
  };
  requestAnimationFrame(countUp);
  ($("#win [data-action=next]") as HTMLElement).hidden = sandbox || !!dailyN;
  ($("#win [data-action=share]") as HTMLElement).hidden = !dailyN;
  if (dailyN) {
    const r = progress.daily[dailyN];
    $("#win-title").innerHTML = `Daily <span class="num">#${dailyN}</span>`;
    $("#win-sub").textContent = r
      ? `Solved in ${formatTime(r.seconds)} · ${r.misses + 1} Shine${r.misses ? "s" : ""}` +
        (progress.dailyStreak >= 2 ? ` · 🔥 ${progress.dailyStreak}-day streak` : "")
      : "";
  }

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

/**
 * The nights, grouped by world. Each night shows its moon — a crescent on the
 * first night of a world, full on the tenth — so where you are in a world can
 * be read at a glance.
 */
function renderNights() {
  const grid = $("#night-grid");
  grid.innerHTML = "";
  ($("#open-all") as HTMLInputElement).checked = progress.openAll;
  const lastShown = Math.max(90, progress.unlocked + 6);
  for (const world of PHASES) {
    const first = world.first;
    const last = Math.min(Number.isFinite(world.last) ? world.last : lastShown, lastShown);
    const open = progress.openAll || first <= progress.unlocked;
    const th = THEMES[world.key];

    const sec = document.createElement("section");
    sec.className = `world${open ? "" : " locked"}`;
    sec.style.setProperty("--world", th.planet.body[0]);
    const [a, b, c] = th.planet.body;
    const orb = world.key === "blackhole"
      ? "radial-gradient(circle, #000 0 40%, #ffb86b 46%, transparent 70%)"
      : `radial-gradient(circle at 32% 30%, ${a}, ${b} 55%, ${c})`;
    sec.innerHTML =
      `<header class="world-head"><i class="world-orb" style="background:${orb}"></i>` +
      `<div><h3>${world.name}</h3><p>${open ? world.blurb : "Not yet reached."}</p></div></header>`;
    const row = document.createElement("div");
    row.className = "world-nights";
    for (let n = first; n <= last; n++) {
      const locked = !progress.openAll && n > progress.unlocked;
      const stars = progress.stars[n] ?? 0;
      const best = progress.best[n];
      const btn = document.createElement("button");
      btn.className = `night${locked ? " locked" : ""}${n === progress.unlocked ? " current" : ""}`;
      btn.disabled = locked;
      btn.setAttribute("aria-label", `Night ${n}${locked ? ", locked" : ""}`);
      btn.appendChild(moonIcon(moonForNight(n - first), locked));
      const label = document.createElement("span");
      label.className = "num";
      label.textContent = String(n);
      btn.appendChild(label);
      if (progress.skipped.includes(n)) {
        btn.classList.add("skipped");
        const meta = document.createElement("span");
        meta.className = "stars";
        meta.textContent = "skipped";
        btn.appendChild(meta);
      } else {
        const meta = document.createElement("span");
        meta.innerHTML = medalRow(medalsOf(n));
        btn.appendChild(meta.firstElementChild!);
      }
      if (best !== undefined) btn.title = `Best ${best} · ${"★".repeat(stars)}`;
      if (!locked) btn.addEventListener("click", () => startLevel(n));
      row.appendChild(btn);
    }
    sec.appendChild(row);
    grid.appendChild(sec);
  }
}

/** A little moon at a phase: just the lit part, no ghost of the rest. */
function moonIcon(lit: number, dim: boolean): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  c.width = c.height = Math.round(26 * dpr);
  c.className = "moon-icon";
  const cc = c.getContext("2d")!;
  cc.scale(dpr, dpr);
  cc.translate(13, 13);
  cc.rotate(-0.22);
  const path = moonPath(9, lit);
  cc.fillStyle = dim ? "#6f6690" : "#f6c64a";
  cc.shadowColor = dim ? "transparent" : "rgba(255, 226, 154, 0.6)";
  cc.shadowBlur = 6;
  cc.fill(path);
  cc.shadowBlur = 0;
  cc.strokeStyle = "rgba(91, 58, 18, 0.7)";
  cc.lineWidth = 1.2;
  cc.stroke(path);
  return c;
}

// ---------------------------------------------------------------- how to play

function renderHowto() {
  const keys: PieceKey[] = ["receptor", "mirror", "splitter", "star", "milkyway", "crystal", "tint",
    "comet", "portal", "wall", "terrain", "warp", "blackhole", "asteroid", "satellite"];
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
    case "galaxy": startSandbox(); break;
    case "map": show("map"); break;
    case "boosters": openBoosters(); break;
    case "boost": useBooster(el.dataset.boost as BoosterKey); break;
    case "close-boosters": $("#boost-card").hidden = true; break;
    case "ranks":
      ranksTab = "daily";
      ranksNight = Math.max(1, progress.unlocked - 1);
      show("ranks");
      break;
    case "ranks-from-win":
      $("#win").hidden = true;
      ranksTab = dailyN ? "daily" : "night";
      ranksNight = Math.max(1, night);
      show("ranks");
      break;
    case "ranks-tab":
      ranksTab = (el.dataset.tab as typeof ranksTab) ?? "daily";
      sfxSelect();
      void renderRanks();
      break;
    case "ranks-step":
      ranksNight = Math.max(1, ranksNight + Number(el.dataset.step ?? 0));
      void renderRanks();
      break;
    case "join-open": openJoin(); break;
    case "join-no":
      $("#join-card").hidden = true;
      if (player().optIn === null) setPlayer({ optIn: false });
      if (unsent) { unsent = null; winRank(""); }
      break;
    case "join-yes": void joinYes(); break;
    case "forget": {
      // Two taps: the first arms it, the second does it.
      if (Date.now() - forgetArmed > 4000) {
        forgetArmed = Date.now();
        toast("Tap leave again to delete your scores from the leaderboard.", 3500);
        break;
      }
      forgetArmed = 0;
      forgetMe().then(() => toast("Done — your scores are gone.", 2200))
        .catch(() => toast("Couldn't reach the leaderboard; try again later.", 2400))
        .finally(() => void renderRanks());
      break;
    }
    case "daily": startDaily(); break;
    case "share": void shareDaily(); break;
    case "open-all":
      progress.openAll = ($("#open-all") as HTMLInputElement).checked;
      saveProgress(progress);
      sfxSelect();
      renderNights();
      break;
    case "world-ok":
      $("#world-card").hidden = true;
      if (worldLevel) introduceNewPieces(worldLevel);
      worldLevel = null;
      break;
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
    case "reset":
      if (sandbox) { startSandbox(); sfxRemove(); break; }
      game?.reset(); clearFx(); boardFx.clear(); renderTray(); sfxRemove();
      break;
    case "hint": {
      if (!game || game.phase === "running") return;
      $("[data-action=hint]").classList.remove("nudge");
      const h = game.takeHint();
      toast(h === "where" ? "A piece belongs here. Ask again to see which."
        : h === "what" ? "That piece, that way round."
        : sandbox ? "No hints in the Galaxy — anything goes." : "Everything placed is right — try Shine!", 2600);
      if (h !== "none") sfxHint();
      break;
    }
    case "skip": {
      if (!game || sandbox || endless || dailyN) return;
      if (!progress.skipped.includes(night)) progress.skipped.push(night);
      progress.unlocked = Math.max(progress.unlocked, night + 1);
      progress.streak = 0;
      saveProgress(progress);
      toast(`Night ${night} skipped — it'll wait for you on the Nights screen.`, 2600);
      startLevel(night + 1);
      break;
    }
    case "piece-info": {
      if (sandbox) {
        const tool = TOOLS[toolSel];
        const k = tool.kind === "moon" ? null
          : tool.kind === "milkyway" || tool.kind === "warp" ? tool.kind as PieceKey : infoKey(tool.kind);
        if (k) { cardQueue = []; openCard(k, false); }
        break;
      }
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
  if (!$("#join-card").hidden) {
    if (e.key === "Enter") { e.preventDefault(); void joinYes(); }
    else if (e.key === "Escape") ($("[data-action=join-no]") as HTMLElement).click();
    return;
  }
  if (!game || currentScreen !== "game") return;
  if (!$("#world-card").hidden) {
    if (e.key === "Enter" || e.key === " " || e.key === "Escape") { e.preventDefault(); ($("[data-action=world-ok]") as HTMLElement).click(); }
    return;
  }
  if (!$("#boost-card").hidden) {
    if (e.key === "Escape") $("#boost-card").hidden = true;
    return;
  }
  if (!$("#piece-card").hidden) {
    if (e.key === "Enter" || e.key === " " || e.key === "Escape") { e.preventDefault(); nextCard(); }
    return;
  }
  if (e.key === " " || e.key === "Enter") { e.preventDefault(); ($("[data-action=run]") as HTMLElement).click(); }
  else if (e.key.toLowerCase() === "r") { ($("[data-action=reset]") as HTMLElement).click(); }
  else if (/^[1-9]$/.test(e.key)) {
    const k = Number(e.key) - 1;
    if (sandbox) { if (k < TOOLS.length) { toolSel = k; sfxSelect(); renderTray(); } return; }
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
renderDust();
show("title");
void flushPending();
requestAnimationFrame(frame);

// Dev-only handle for poking at a level from the console: `mb.level()`,
// `mb.solveIt()` to auto-place the known solution, `mb.go(12)` to jump nights.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).mb = {
    get game() { return game; },
    level: () => game?.level,
    board: () => game?.board,
    go: (n: number, e = false) => startLevel(n, e),
    galaxy: () => startSandbox(),
    daily: () => startDaily(),
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

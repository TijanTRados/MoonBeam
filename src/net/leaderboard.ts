/**
 * Talking to the leaderboard server.
 *
 * A player is a random id kept in this browser and a nickname they chose —
 * nothing else. Nothing is sent until they opt in. A solve that cannot be
 * sent (offline, server asleep) waits in a small queue and goes next time.
 *
 * The server's address comes from VITE_LEADERBOARD_URL at build time. In dev
 * it defaults to port 8787 on whatever host served the page, so a phone on
 * the same network reaches the dev server too. With neither, leaderboards are
 * simply off and the game says so.
 */
import type { Level } from "../engine/types";

export type BoardKind = "daily" | "night" | "rush";

export interface Row { rank: number; name: string; points: number; used: number; fewest: number; seconds: number; you?: boolean }
export interface BoardView { rows: Row[]; you?: Row; total: number }
export interface LadderRow { rank: number; name: string; points: number; nights: number; you?: boolean }
export interface LadderView { rows: LadderRow[]; you?: LadderRow; total: number }

export interface SolveBody {
  placements: { i: number; kind: string; mask?: number; from?: number }[];
  fireTick: number;
  hash: string;
}

export interface SubmitBody extends Partial<SolveBody> {
  kind: BoardKind;
  id: number;
  seconds?: number;
  /** Moon Rush: every puzzle solved in the run. */
  solves?: (SolveBody & { k: number })[];
}
export interface SubmitResult { points: number; used: number; fewest: number; rank?: number; total?: number; improved: boolean }

export interface Player { id: string; name: string; optIn: boolean | null }

const PLAYER_KEY = "moonbeam.player.v1";
const PENDING_KEY = "moonbeam.pending.v1";

export function serverUrl(): string {
  const env = (import.meta.env.VITE_LEADERBOARD_URL as string | undefined)?.replace(/\/+$/, "");
  if (env) return env;
  if (import.meta.env.DEV && typeof location !== "undefined") return `${location.protocol}//${location.hostname}:8787`;
  return "";
}

export const leaderboardsEnabled = () => serverUrl() !== "";

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? { ...fallback, ...JSON.parse(raw) } : fallback; } catch { return fallback; }
}
function write(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}

function newId(): string {
  try { return crypto.randomUUID(); } catch {
    return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join("-");
  }
}

/** This browser's player. Created on first use; `optIn` stays null until they choose. */
export function player(): Player {
  const p = read<Player>(PLAYER_KEY, { id: "", name: "", optIn: null });
  if (!p.id) { p.id = newId(); write(PLAYER_KEY, p); }
  return p;
}

export function setPlayer(next: Partial<Player>) {
  write(PLAYER_KEY, { ...player(), ...next });
}

/** What the server accepts as a nickname — the same rule it applies. */
export function validName(raw: string): string | null {
  const name = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 16) return null;
  return /^[\p{L}\p{N} _.'-]+$/u.test(name) ? name : null;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const url = serverUrl();
  if (!url) throw new Error("offline");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url + path, body === undefined ? { signal: ctl.signal } : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? `HTTP ${res.status}`), { status: res.status });
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

/** The placements a board holds, in the shape the server expects. */
export function placementsOf(board: Level["tiles"]) {
  const out: SubmitBody["placements"] = [];
  board.forEach((t, i) => { if (t.placed) out.push({ i, kind: t.kind, mask: t.mask, from: t.from }); });
  return out;
}

/**
 * Send a solve. Network trouble queues it for later; a refusal from the
 * server (a changed puzzle, a closed daily) is final and is not retried.
 */
export async function submit(body: SubmitBody): Promise<SubmitResult | null> {
  const p = player();
  if (!p.optIn || !p.name) return null;
  try {
    return await call<SubmitResult>("/api/score", { ...body, player: p.id, name: p.name });
  } catch (e) {
    if ((e as { status?: number }).status === undefined) queue(body);
    throw e;
  }
}

function queue(body: SubmitBody) {
  const list = read<{ items: SubmitBody[] }>(PENDING_KEY, { items: [] }).items;
  list.push(body);
  write(PENDING_KEY, { items: list.slice(-20) });
}

/** Try the queued solves again. Quietly; whatever still fails stays queued. */
export async function flushPending() {
  const items = read<{ items: SubmitBody[] }>(PENDING_KEY, { items: [] }).items;
  if (!items.length || !player().optIn) return;
  write(PENDING_KEY, { items: [] });
  for (const b of items) { try { await submit(b); } catch { /* re-queued if it was the network */ } }
}

export const fetchBoard = (kind: BoardKind, id: number) =>
  call<BoardView>(`/api/board/${kind}/${id}?player=${encodeURIComponent(player().id)}`);

export const fetchLadder = () => call<LadderView>(`/api/ladder?player=${encodeURIComponent(player().id)}`);

export async function rename(name: string) {
  setPlayer({ name });
  if (player().optIn) await call("/api/name", { player: player().id, name });
}

/** Delete everything the server holds about this player, and stop sending. */
export async function forgetMe() {
  const id = player().id;
  setPlayer({ optIn: false });
  await call("/api/forget", { player: id });
}

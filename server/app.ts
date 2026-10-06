/**
 * The leaderboard API, as a plain function from request to response so the
 * tests can drive it without opening a port.
 *
 *   GET  /api/health
 *   POST /api/score                   a solve: placements in, rank out
 *   GET  /api/board/daily/12?player=  a board's top 50, and where you stand
 *   GET  /api/board/night/21?player=
 *   GET  /api/board/rush/12?player=   a day's Moon Rush
 *   GET  /api/ladder?player=          best points summed over every night
 *   POST /api/name    {player, name}  change your nickname
 *   POST /api/forget  {player}        delete everything stored about you
 */
import { Store } from "./store";
import { BoardKind, Submission, cleanName, verify } from "./verify";

export interface Req { method: string; url: string; body?: unknown; ip: string }
export interface Res { status: number; body: unknown }

/** Submissions per address per minute. Generous for a person, dull for a script. */
const RATE = 20;
const hits = new Map<string, number[]>();

function limited(ip: string, now: number): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear();
  return recent.length > RATE;
}

const ID = /^[a-zA-Z0-9-]{8,64}$/;

export function handle(store: Store, req: Req, now = new Date()): Res {
  const url = new URL(req.url, "http://x");
  const path = url.pathname.replace(/\/+$/, "");
  const player = url.searchParams.get("player") ?? undefined;
  const who = player && ID.test(player) ? player : undefined;

  if (req.method === "GET" && path === "/api/health") return { status: 200, body: { ok: true } };

  if (req.method === "POST" && path === "/api/score") {
    if (limited(req.ip, now.getTime())) return { status: 429, body: { error: "slow down a little" } };
    const sub = req.body as Submission;
    const v = verify(sub, now);
    if (!v.ok) return { status: v.status, body: { error: v.reason } };
    const name = cleanName(sub.name)!;
    const improved = store.submit(sub.player, name, sub.kind, sub.id, v.result, now.getTime());
    const b = store.board(sub.kind, sub.id, sub.player, 0);
    return { status: 200, body: { ...v.result, improved, rank: b.you?.rank, total: b.total } };
  }

  const m = path.match(/^\/api\/board\/(daily|night|rush)\/(\d{1,6})$/);
  if (req.method === "GET" && m) {
    return { status: 200, body: store.board(m[1] as BoardKind, Number(m[2]), who) };
  }

  if (req.method === "GET" && path === "/api/ladder") return { status: 200, body: store.ladder(who) };

  if (req.method === "POST" && path === "/api/name") {
    const b = req.body as { player?: string; name?: string };
    const name = cleanName(b?.name);
    if (!b?.player || !ID.test(b.player) || !name) return { status: 400, body: { error: "bad name" } };
    return { status: 200, body: { ok: store.rename(b.player, name) } };
  }

  if (req.method === "POST" && path === "/api/forget") {
    const b = req.body as { player?: string };
    if (!b?.player || !ID.test(b.player)) return { status: 400, body: { error: "bad player" } };
    store.forget(b.player);
    return { status: 200, body: { ok: true } };
  }

  return { status: 404, body: { error: "not found" } };
}

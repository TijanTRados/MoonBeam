/**
 * The leaderboard server. Node's own http module, no framework, no database.
 *
 *   npm run server
 *
 * Environment:
 *   PORT             default 8787
 *   DATA_FILE        where scores live; default server/data/leaderboard.json
 *   ALLOWED_ORIGINS  comma-separated origins the game is served from;
 *                    default "*" (fine for local play — set it in production)
 */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Store } from "./store";
import { handle } from "./app";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8787);
const store = new Store(process.env.DATA_FILE ?? join(here, "data", "leaderboard.json"));
const origins = (process.env.ALLOWED_ORIGINS ?? "*").split(",").map((s) => s.trim()).filter(Boolean);

const server = createServer((req, res) => {
  const origin = req.headers.origin ?? "";
  const allow = origins.includes("*") ? "*" : origins.includes(origin) ? origin : "";
  if (allow) {
    res.setHeader("Access-Control-Allow-Origin", allow);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }

  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk: string) => {
    raw += chunk;
    if (raw.length > 32_000) req.destroy();
  });
  req.on("end", () => {
    let body: unknown;
    try { body = raw ? JSON.parse(raw) : undefined; } catch {
      res.writeHead(400, { "Content-Type": "application/json" }).end('{"error":"bad json"}');
      return;
    }
    // Behind a proxy the address is in X-Forwarded-For; it is used only for
    // rate limiting, held in memory for a minute, and never written down.
    const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress || "?";
    try {
      const out = handle(store, { method: req.method ?? "GET", url: req.url ?? "/", body, ip });
      res.writeHead(out.status, { "Content-Type": "application/json" }).end(JSON.stringify(out.body));
    } catch (e) {
      console.error(e);
      res.writeHead(500, { "Content-Type": "application/json" }).end('{"error":"server error"}');
    }
  });
});

server.listen(port, () => console.log(`MoonBeam leaderboard on http://localhost:${port}`));

const stop = () => { store.flush(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

/**
 * The stand's relay: a NIP-01 relay on Bun.serve WebSockets, in memory, for local stands only.
 * It keeps gift wraps (kind 1059) whose id and signature verify, answers REQ with the kinds, ids,
 * #p, since, until and limit filters, then EOSE, pushes new events to open subscriptions, and
 * answers every EVENT with OK. It logs counts, never content, ids or keys.
 *
 *   PORT=18547 bun infra/relay/relay.ts        (HOST defaults to 127.0.0.1)
 */
import { verifyEvent, type NostrEvent } from "nostr-tools/pure";

export const GIFT_WRAP_KIND = 1059;
/** Largest WebSocket message taken. A give link with an ERC-6492 wrapper wraps to a few kB. */
export const MAX_MESSAGE_BYTES = 1 << 20;
/** Events kept; the oldest go first. A stand lives for hours, not weeks. */
export const MAX_EVENTS = 10_000;
const MAX_SUBS_PER_CLIENT = 20;

interface Filter {
  ids?: string[];
  kinds?: number[];
  "#p"?: string[];
  since?: number;
  until?: number;
  limit?: number;
}

interface Client {
  subs: Map<string, Filter[]>;
}

export interface RelayOptions {
  port: number;
  hostname?: string;
  /** Where count lines go; console.log by default. */
  log?: (line: string) => void;
}

export interface RunningRelay {
  port: number;
  url: string;
  /** Counts only: what the log says. */
  counts(): { stored: number; accepted: number; rejected: number; clients: number; subscriptions: number };
  stop(): Promise<void>;
}

function matches(event: NostrEvent, f: Filter): boolean {
  if (f.ids && !f.ids.includes(event.id)) return false;
  if (f.kinds && !f.kinds.includes(event.kind)) return false;
  if (f.since !== undefined && event.created_at < f.since) return false;
  if (f.until !== undefined && event.created_at > f.until) return false;
  if (f["#p"] && !event.tags.some((t) => t[0] === "p" && f["#p"]!.includes(t[1]!))) return false;
  return true;
}

function isFilter(v: unknown): v is Filter {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const f = v as Record<string, unknown>;
  const strings = (x: unknown) => x === undefined || (Array.isArray(x) && x.every((s) => typeof s === "string"));
  const ints = (x: unknown) => x === undefined || (Array.isArray(x) && x.every((n) => Number.isInteger(n)));
  const int = (x: unknown) => x === undefined || Number.isInteger(x);
  return strings(f.ids) && ints(f.kinds) && strings(f["#p"]) && int(f.since) && int(f.until) && int(f.limit);
}

/** A copy with only the event's own fields, so verification never trusts a cached flag. */
function eventOf(v: unknown): NostrEvent | undefined {
  if (!v || typeof v !== "object") return undefined;
  const e = v as Record<string, unknown>;
  if (
    typeof e.id !== "string" ||
    typeof e.pubkey !== "string" ||
    typeof e.sig !== "string" ||
    typeof e.content !== "string" ||
    !Number.isInteger(e.kind) ||
    !Number.isInteger(e.created_at) ||
    !Array.isArray(e.tags) ||
    !e.tags.every((t) => Array.isArray(t) && t.every((s) => typeof s === "string"))
  ) {
    return undefined;
  }
  return {
    id: e.id,
    pubkey: e.pubkey,
    created_at: e.created_at as number,
    kind: e.kind as number,
    tags: e.tags as string[][],
    content: e.content,
    sig: e.sig,
  };
}

export function startRelay(options: RelayOptions): RunningRelay {
  const log = options.log ?? ((line: string) => console.log(line));
  const events: NostrEvent[] = [];
  const ids = new Set<string>();
  const clients = new Set<{ data: Client; send(s: string): unknown }>();
  let accepted = 0;
  let rejected = 0;

  const counts = () => {
    let subscriptions = 0;
    for (const c of clients) subscriptions += c.data.subs.size;
    return { stored: events.length, accepted, rejected, clients: clients.size, subscriptions };
  };
  const report = (what: string) => {
    const c = counts();
    log(`relay: ${what} · stored ${c.stored} · accepted ${c.accepted} · rejected ${c.rejected} · clients ${c.clients} · subscriptions ${c.subscriptions}`);
  };

  const server = Bun.serve<Client>({
    port: options.port,
    hostname: options.hostname ?? "127.0.0.1",
    fetch(req, srv) {
      if (srv.upgrade(req, { data: { subs: new Map() } })) return undefined;
      if (req.headers.get("accept") === "application/nostr+json") {
        return Response.json(
          {
            name: "aHand stand relay",
            description: "In-memory relay for a local aHand stand. Keeps gift wraps (kind 1059) only.",
            supported_nips: [1, 11, 59],
            limitation: { max_message_length: MAX_MESSAGE_BYTES, max_subscriptions: MAX_SUBS_PER_CLIENT },
          },
          { headers: { "access-control-allow-origin": "*" } },
        );
      }
      return new Response("aHand stand relay: connect with a WebSocket (NIP-01, kind 1059 only).\n");
    },
    websocket: {
      maxPayloadLength: MAX_MESSAGE_BYTES,
      open(ws) {
        clients.add(ws);
        report("client in");
      },
      close(ws) {
        clients.delete(ws);
        report("client out");
      },
      message(ws, raw) {
        let msg: unknown;
        try {
          msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
        } catch {
          ws.send(JSON.stringify(["NOTICE", "invalid: not JSON"]));
          return;
        }
        if (!Array.isArray(msg) || typeof msg[0] !== "string") {
          ws.send(JSON.stringify(["NOTICE", "invalid: not a NIP-01 message"]));
          return;
        }
        const [type] = msg;
        if (type === "EVENT") {
          const event = eventOf(msg[1]);
          const id = typeof (msg[1] as { id?: unknown })?.id === "string" ? (msg[1] as { id: string }).id : "";
          const answer = (ok: boolean, why: string) => ws.send(JSON.stringify(["OK", id, ok, why]));
          if (!event) {
            rejected++;
            answer(false, "invalid: malformed event");
          } else if (event.kind !== GIFT_WRAP_KIND) {
            rejected++;
            answer(false, "blocked: this relay keeps gift wraps (kind 1059) only");
          } else if (!verifyEvent(event)) {
            rejected++;
            answer(false, "invalid: bad id or signature");
          } else if (ids.has(event.id)) {
            answer(true, "duplicate: already have it");
            return;
          } else {
            events.push(event);
            ids.add(event.id);
            while (events.length > MAX_EVENTS) ids.delete(events.shift()!.id);
            accepted++;
            answer(true, "");
            for (const c of clients) {
              for (const [subId, filters] of c.data.subs) {
                if (filters.some((f) => matches(event, f))) c.send(JSON.stringify(["EVENT", subId, event]));
              }
            }
            report("event in");
            return;
          }
          report("event refused");
          return;
        }
        if (type === "REQ") {
          const subId = msg[1];
          const filters = msg.slice(2);
          if (typeof subId !== "string" || subId.length === 0 || subId.length > 64) {
            ws.send(JSON.stringify(["NOTICE", "invalid: subscription id"]));
            return;
          }
          if (!filters.every(isFilter)) {
            ws.send(JSON.stringify(["CLOSED", subId, "invalid: unsupported filter"]));
            return;
          }
          if (!ws.data.subs.has(subId) && ws.data.subs.size >= MAX_SUBS_PER_CLIENT) {
            ws.send(JSON.stringify(["CLOSED", subId, "blocked: too many subscriptions"]));
            return;
          }
          ws.data.subs.set(subId, filters as Filter[]);
          const found = new Map<string, NostrEvent>();
          for (const f of filters as Filter[]) {
            let hits = events.filter((e) => matches(e, f));
            if (f.limit !== undefined) hits = hits.sort((a, b) => b.created_at - a.created_at).slice(0, Math.max(0, f.limit));
            for (const e of hits) found.set(e.id, e);
          }
          const ordered = [...found.values()].sort((a, b) => b.created_at - a.created_at);
          for (const e of ordered) ws.send(JSON.stringify(["EVENT", subId, e]));
          ws.send(JSON.stringify(["EOSE", subId]));
          report("subscription open");
          return;
        }
        if (type === "CLOSE") {
          if (typeof msg[1] === "string" && ws.data.subs.delete(msg[1])) report("subscription closed");
          return;
        }
        ws.send(JSON.stringify(["NOTICE", `unsupported: ${type.slice(0, 16)}`]));
      },
    },
  });

  const port = server.port as number;
  log(`relay: listening on ws://${options.hostname ?? "127.0.0.1"}:${port} (kind 1059 only, in memory)`);
  return {
    port,
    url: `ws://${options.hostname ?? "127.0.0.1"}:${port}`,
    counts,
    async stop() {
      await server.stop(true);
      log("relay: stopped");
    },
  };
}

if (import.meta.main) {
  const port = Number(process.env.PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error("relay: set PORT to the port to listen on, e.g. PORT=18547 bun infra/relay/relay.ts");
    process.exit(2);
  }
  const relay = startRelay({ port, hostname: process.env.HOST || "127.0.0.1" });
  const down = async () => {
    await relay.stop();
    process.exit(0);
  };
  process.on("SIGINT", down);
  process.on("SIGTERM", down);
}

/**
 * The stand's plain file server (ARCHITECTURE §10, §11, §14): what serves a slot's built app when
 * face is off. Existing files are served as they are (`/exit.html`, `/build.json`, `/assets/…`);
 * every other path gets `index.html`, so `/31337/1` opens the Hand view. A missing path whose last
 * part has a file extension (`/assets/gone.js`) is a 404, not the index: a browser must never run
 * an HTML page as a script or a style.
 *
 * Every answer carries the CSP of §11 (with the configuration's RPC and relay URLs in
 * `connect-src`), `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`. It logs
 * method, path without the query, and status; nothing else.
 *
 * Two additions to the CSP, the same as face's (apps/face/src/headers.ts), for the build's pages
 * that carry their code inline (exit.html is one self-contained file): an HTML answer's
 * `script-src` also names the sha256 of each inline script of that very file, so exactly the
 * shipped code runs and nothing injected does; and exit.html, which takes any RPC address its
 * reader types, may connect to any https address and to this machine.
 *
 *   bun infra/stand/static.ts --dir <folder> --port <port> [--config <app config.json>] [--host 127.0.0.1]
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";

/** The sha256 sources of the inline scripts of an HTML file, as CSP writes them. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(match[1]!)) continue;
    const body = match[2]!;
    if (body === "") continue;
    hashes.push(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
  }
  return hashes;
}

/** The extra sources a served page may need: its own inline scripts, and any RPC (exit.html). */
export interface PageSources {
  inline?: readonly string[];
  anyRpc?: boolean;
}

/**
 * ARCHITECTURE §11, word for word; `connect` are the RPC and relay URLs of the configuration.
 * `page` adds the two exceptions described at the top of this file.
 */
export function contentSecurityPolicy(connect: readonly string[], page: PageSources = {}): string {
  for (const source of connect) {
    if (!/^(https?|wss?):\/\/[A-Za-z0-9.\-:[\]]+\/?$/.test(source)) throw new Error(`not a source for connect-src: ${source}`);
  }
  const connectSources = [...connect];
  if (page.anyRpc) connectSources.push("https:", "http://127.0.0.1:*", "http://localhost:*");
  return [
    "default-src 'self'",
    ["script-src 'self'", ...(page.inline ?? [])].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    page.anyRpc ? "font-src 'self' data:" : "font-src 'self'",
    ["connect-src 'self'", ...new Set(connectSources)].join(" "),
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders(connect: readonly string[], page: PageSources = {}): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(connect, page),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

/** The RPC and relay URLs of an app configuration (apps/hand/src/config/schema.ts). */
export function connectSourcesOf(config: { chain: { rpcUrls: string[] }; relays: string[] }): string[] {
  return [...config.chain.rpcUrls, ...config.relays].map((url) => url.replace(/\/$/, ""));
}

export type Resolution = { file: string; fallback: boolean } | { status: 400 | 404 };

/**
 * Where a request path leads inside `root`: an existing file, the index (fallback), a 404 for a
 * missing file with an extension, or a 400 for a path that does not decode or would leave `root`.
 * Symbolic links are not followed.
 */
export function resolvePath(root: string, pathname: string): Resolution {
  const base = resolve(root);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { status: 400 };
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return { status: 400 };
  const parts = decoded.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.includes("..")) return { status: 400 };

  const index = { file: join(base, "index.html"), fallback: false };
  if (parts.length === 0) return index;
  const file = join(base, ...parts);
  if (file !== base && !file.startsWith(base + sep)) return { status: 400 };

  if (existsSync(file)) {
    const stat = lstatSync(file);
    if (stat.isFile()) return { file, fallback: false };
  }
  if (extname(parts[parts.length - 1]!) !== "") return { status: 404 };
  return { file: index.file, fallback: true };
}

export interface StaticOptions {
  dir: string;
  port: number;
  hostname?: string;
  /** RPC and relay URLs for connect-src. */
  connect?: readonly string[];
  log?: (line: string) => void;
}

/** Starts the server; `stop()` on the result frees the port. */
export function startStatic(options: StaticOptions) {
  const headers = securityHeaders(options.connect ?? []);
  const log = options.log ?? ((line: string) => console.log(line));
  const answer = (method: string, path: string, status: number, body: BodyInit | null, extra: Record<string, string> = {}) => {
    log(`${method} ${path} ${status}`);
    return new Response(body, { status, headers: { ...headers, ...extra } });
  };

  return Bun.serve({
    port: options.port,
    hostname: options.hostname ?? "127.0.0.1",
    fetch(request) {
      const url = new URL(request.url);
      const method = request.method;
      if (method !== "GET" && method !== "HEAD") return answer(method, url.pathname, 405, "Method not allowed\n", { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });

      const found = resolvePath(options.dir, url.pathname);
      if ("status" in found) {
        const text = found.status === 404 ? "Not found\n" : "Bad request\n";
        return answer(method, url.pathname, found.status, method === "HEAD" ? null : text, { "Content-Type": "text/plain; charset=utf-8" });
      }
      if (!existsSync(found.file)) return answer(method, url.pathname, 404, method === "HEAD" ? null : "No build here yet\n", { "Content-Type": "text/plain; charset=utf-8" });

      const file = Bun.file(found.file);
      const html = found.file.endsWith(".html");
      const page: Record<string, string> = {};
      if (html) {
        const inline = inlineScriptHashes(readFileSync(found.file, "utf8"));
        const anyRpc = !found.fallback && found.file === resolve(options.dir, "exit.html");
        if (inline.length > 0 || anyRpc) page["Content-Security-Policy"] = contentSecurityPolicy(options.connect ?? [], { inline, anyRpc });
      }
      const cache = url.pathname.startsWith("/assets/") && !found.fallback ? "public, max-age=31536000, immutable" : "no-cache";
      const type = file.type || "application/octet-stream";
      return answer(method, url.pathname, 200, method === "HEAD" ? null : file, {
        "Content-Type": html ? "text/html; charset=utf-8" : type,
        "Content-Length": String(file.size),
        "Cache-Control": cache,
        ...page,
      });
    },
  });
}

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  if (at < 0) return undefined;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    const dir = flag(argv, "--dir");
    const port = Number(flag(argv, "--port"));
    if (!dir || !Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error("usage: bun infra/stand/static.ts --dir <folder> --port <port> [--config <config.json>] [--host 127.0.0.1]");
    }
    const configPath = flag(argv, "--config");
    const connect = configPath ? connectSourcesOf(JSON.parse(readFileSync(configPath, "utf8"))) : [];
    const server = startStatic({ dir: resolve(dir), port, hostname: flag(argv, "--host"), connect });
    console.log(`static: serving ${resolve(dir)} on http://${server.hostname}:${server.port} (all paths to index.html)`);
    const stop = () => {
      server.stop(true);
      process.exit(0);
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  } catch (error) {
    console.error(`static: ${(error as Error).message}`);
    process.exit(1);
  }
}

/**
 * Serves the DOM player (index.html) with rrweb's replayer and the recordings in tests/demo/.run/dom:
 *   bun tests/demo/player/serve.ts [--port 47190] [--dist <a build of the app>]   → http://127.0.0.1:47190/?s=first-thanks
 *
 * Every other path is a file of the app's build (its /assets: fonts, styles, images), as the
 * recordings name them relative to the site, the way a branch's site would serve them.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, normalize, resolve } from "node:path";

const require = createRequire(import.meta.url);
const replay = dirname(require.resolve("@rrweb/replay"));
const DOM = resolve(import.meta.dirname, "../.run/dom");
const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
/** A build of the app for the recordings' fonts, styles and images: --dist, else the newest stand slot's. */
function newestDist(): string | undefined {
  const runs = resolve(import.meta.dirname, "../../../infra/stand/.run");
  if (!existsSync(runs)) return undefined;
  return readdirSync(runs)
    .map((slot) => join(runs, slot, "dist"))
    .filter((dist) => existsSync(join(dist, "build.json")))
    .sort((a, b) => statSync(join(b, "build.json")).mtimeMs - statSync(join(a, "build.json")).mtimeMs)[0];
}
const DIST = resolve(arg("--dist") ?? newestDist() ?? "");
if (!existsSync(join(DIST, "index.html"))) {
  console.warn(`player: no build of the app at "${DIST}": the recordings will play without their fonts, styles and images. Bring a stand up (bun infra/stand/stand.ts up --slot N) or pass --dist <a build>.`);
}
const port = Number(process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : 47190);
const files: Record<string, string> = {
  "/": join(import.meta.dirname, "index.html"),
  "/replay.umd.min.js": join(replay, "replay.umd.min.cjs"),
  "/replay.css": join(replay, "style.css"),
};

Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch(request) {
    const path = new URL(request.url).pathname;
    let file = files[path];
    if (!file && path.startsWith("/dom/")) {
      const inside = normalize(join(DOM, path.slice(5)));
      if (inside.startsWith(DOM + "/")) file = inside;
    }
    if (!file) {
      const inside = normalize(join(DIST, path));
      if (inside.startsWith(DIST + "/")) file = inside;
    }
    if (!file || !existsSync(file)) return new Response("not found\n", { status: 404 });
    const type = file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".json") ? "application/json" : file.endsWith(".cjs") ? "text/javascript" : Bun.file(file).type;
    return new Response(Bun.file(file), { headers: { "content-type": type } });
  },
});
console.log(`player: http://127.0.0.1:${port}/?s=first-thanks`);

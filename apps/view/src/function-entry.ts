import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { configFromEnv } from "./config.ts";
import { viewFunction } from "./function.ts";

/**
 * The entry of the view server bundled as one serverless function (function.ts), for a host that
 * serves the built app's files itself. The app's deploy build bundles this file and puts beside
 * the bundle:
 *
 *   view.json    the view server's settings as VIEW_* names (config.ts), from the app's public
 *                configuration: VIEW_RPC, VIEW_CHAIN, VIEW_CORES, VIEW_CANONICAL, VIEW_RELAYS,
 *                VIEW_SITE, VIEW_TOKENS, and VIEW_PRIVY when the app signs in by email through Privy
 *   index.html   the built app's index.html, byte for byte the one the host serves as a file
 *   fonts/, og/  og.tsx's fonts and lockup (it reads them beside itself)
 *   node_modules/@resvg/…   resvg's JavaScript and its prebuilt binary for this platform
 *
 * The exported object is the web-standard handler a Node.js function runtime (Vercel's, for one)
 * calls: `{ fetch }`.
 */

const beside = (name: string) => fileURLToPath(new URL(name, import.meta.url));

const env = JSON.parse(readFileSync(beside("./view.json"), "utf8")) as Record<string, string>;
const config = configFromEnv({ ...env, VIEW_DIST: beside(".") });
const fetch = viewFunction(config, readFileSync(beside("./index.html"), "utf8"));

export default { fetch };

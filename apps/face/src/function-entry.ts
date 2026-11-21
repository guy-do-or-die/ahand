import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { configFromEnv } from "./config.ts";
import { faceFunction } from "./function.ts";

/**
 * The entry of the bundle apps/hand/vercel.ts builds for the Vercel Function (apps/web/face/handler.mjs,
 * which apps/web/api/face.mjs re-exports). Beside the bundle the build puts:
 *
 *   face.json    face's settings as FACE_* names (config.ts), from the public configuration:
 *                FACE_RPC, FACE_CHAIN, FACE_CORES, FACE_CANONICAL, FACE_RELAYS, FACE_SITE,
 *                and FACE_PRIVY when the app signs in by email through Privy
 *   index.html   the built app's index.html, byte for byte the one Vercel serves as a file
 *   fonts/, og/  og.tsx's fonts and lockup (it reads them beside itself)
 *   node_modules/@resvg/…   resvg's JavaScript and its prebuilt binary for this platform
 *
 * The exported object is the web-standard handler Vercel's Node.js runtime calls: `{ fetch }`.
 */

const beside = (name: string) => fileURLToPath(new URL(name, import.meta.url));

const env = JSON.parse(readFileSync(beside("./face.json"), "utf8")) as Record<string, string>;
const config = configFromEnv({ ...env, FACE_DIST: beside(".") });
const fetch = faceFunction(config, readFileSync(beside("./index.html"), "utf8"));

export default { fetch };

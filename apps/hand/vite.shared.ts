import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { defaultClientConditions, type Plugin } from "vite";

/**
 * What both Vite builds share (ARCHITECTURE §14):
 * - AHAND_CONFIG: the app's configuration file, exposed as `virtual:ahand-config`
 *   (default: src/config/config.example.json);
 * - AHAND_OUT_DIR: both builds' output folder (default: dist);
 * - AHAND_VITE_CACHE: Vite's dependency cache (default: node_modules/.vite);
 * - the `source` export condition, so workspace packages are read from their TypeScript.
 */

const here = import.meta.dirname;

function fromRoot(path: string): string {
  return isAbsolute(path) ? path : resolve(here, path);
}

export const configFile = fromRoot(process.env.AHAND_CONFIG || "src/config/config.example.json");
export const outDir = fromRoot(process.env.AHAND_OUT_DIR || "dist");
export const cacheDir = fromRoot(process.env.AHAND_VITE_CACHE || "node_modules/.vite");
export const conditions = ["source", ...defaultClientConditions];

const VIRTUAL = "virtual:ahand-config";
const RESOLVED = `\0${VIRTUAL}`;

export function ahandConfig(): Plugin {
  return {
    name: "ahand-config",
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED) return undefined;
      this.addWatchFile(configFile);
      // Parsed and re-serialised, so the module is plain data whatever the file's formatting.
      const parsed: unknown = JSON.parse(readFileSync(configFile, "utf8"));
      return `export default ${JSON.stringify(parsed)};`;
    },
  };
}

/**
 * A recording of the page instead of its pixels (DEMO_DOM=1): rrweb (@rrweb/record 2.2.2) writes
 * each persona's DOM as it is first drawn and every change after it, as JSON, and the gallery plays
 * it back as the real page (crisp text at any size, a fraction of a video's weight). The director's
 * own overlay sits in a closed shadow root and is not recorded: the step captions are kept as a
 * timeline beside the events, and the player draws them itself.
 *
 * Files: tests/demo/.run/dom/<scenario id>/<persona key>.json and steps.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import type { BrowserContext } from "@playwright/test";

const require = createRequire(import.meta.url);
// The package's exports name no UMD bundle: find it beside its entry.
const RECORDER = join(dirname(require.resolve("@rrweb/record")), "record.umd.min.cjs");
export const DOM_DIR = resolve(import.meta.dirname, "../.run/dom");

export const domOn = () => process.env.DEMO_DOM === "1";

/** Starts recording every page of a persona's context into `sink`. */
export async function recordDom(context: BrowserContext, sink: unknown[]): Promise<void> {
  await context.exposeBinding("__demoDomEmit", (_source, event: unknown) => void sink.push(event));
  await context.addInitScript({ path: RECORDER });
  await context.addInitScript(() => {
    const lib = (window as unknown as { rrwebRecord?: { record?: (o: object) => void } }).rrwebRecord;
    const record = lib?.record;
    if (!record || window !== window.top) return;
    record({
      emit: (event: unknown) => (window as unknown as { __demoDomEmit: (e: unknown) => void }).__demoDomEmit(event),
      inlineStylesheet: true,
      inlineImages: true,
      collectFonts: true,
      sampling: { mousemove: 50, scroll: 150, input: "last" },
    });
  });
}

export interface StepMark {
  t: number;
  caption: string;
  who?: string;
}

/**
 * Writes a scenario's recording. The stand's own origin is cut from every URL in it (stylesheets,
 * fonts, images: "http://127.0.0.1:47052/assets/…" becomes "/assets/…"), so a page served by the
 * site of a branch takes them from that site, under its own CSP; fonts keep their content-hashed
 * names from build to build.
 */
export function saveDom(id: string, origin: string, personas: Record<string, { name: string; role: string; color: string; events: unknown[] }>, steps: StepMark[]): string {
  const dir = join(DOM_DIR, id);
  mkdirSync(dir, { recursive: true });
  const local = (json: string) => json.replaceAll(`${origin.replace(/\/$/, "")}/`, "/");
  for (const [key, p] of Object.entries(personas)) writeFileSync(join(dir, `${key}.json`), local(JSON.stringify(p.events)));
  writeFileSync(join(dir, "steps.json"), JSON.stringify({ id, personas: Object.fromEntries(Object.entries(personas).map(([k, p]) => [k, { name: p.name, role: p.role, color: p.color }])), steps }));
  return dir;
}

/**
 * The one Playwright configuration. Run from the worktree root:
 *
 *   STAND_SLOT=3 bunx playwright test tests/e2e/…          # the site in infra/stand/.run/3/stand.json
 *   STAND_BASE_URL=http://127.0.0.1:18311 bunx playwright test tests/e2e/…
 *
 * The site comes from the slot's stand.json, so a stand brought up with STAND_PORT_BASE (moved
 * ports, infra/stand/ports.ts) needs nothing more here.
 *
 * Results go to tests/e2e/test-results/slot-<slot or x>, so runs of different slots never wipe
 * each other's. Chromium only. Projects: `phone` (390×844, touch), the default, and `desk`
 * (1280×800), which runs only when asked for (`--project desk`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { defineConfig } from "@playwright/test";

const root = import.meta.dirname;
const slotText = process.env.STAND_SLOT;
if (slotText !== undefined && !/^[0-9]$/.test(slotText)) throw new Error(`STAND_SLOT must be a slot from 0 to 9, not "${slotText}"`);

function standSite(slot: string): string | undefined {
  const file = join(root, "infra/stand/.run", slot, "stand.json");
  if (!existsSync(file)) return undefined;
  const site = JSON.parse(readFileSync(file, "utf8")).site;
  return typeof site === "string" && site ? site : undefined;
}

const fromEnv = process.env.STAND_BASE_URL;
const slot = slotText ?? (fromEnv ? undefined : "0");
const baseURL = fromEnv || (slot !== undefined ? standSite(slot) : undefined);
if (!baseURL) {
  throw new Error(
    `No site to test: set STAND_BASE_URL, or bring a stand up (bun infra/stand/stand.ts up --slot ${slot ?? 0}) so that infra/stand/.run/${slot ?? 0}/stand.json names one.`,
  );
}

// Workers load this file again with other arguments, so the main process decides once and
// passes the decision on through the environment.
if (process.env.AHAND_PW_DESK === undefined) {
  process.env.AHAND_PW_DESK = process.argv.some((arg) => /(^|=)desk$/.test(arg)) ? "1" : "0";
}
const withDesk = process.env.AHAND_PW_DESK === "1";

export default defineConfig({
  testDir: join(root, "tests/e2e"),
  testMatch: "**/*.spec.ts",
  outputDir: join(root, "tests/e2e/test-results", `slot-${slotText ?? (fromEnv ? "x" : slot)}`),
  reporter: "line",
  fullyParallel: false,
  // One stand is one chain: spec files share its dev accounts (and their nonces), its clock and
  // its relay, so two files running at once can send from one account in the same block. Files
  // pass in any order (each seeds its own fixtures), one at a time.
  workers: 1,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "phone", use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
    ...(withDesk ? [{ name: "desk", use: { viewport: { width: 1280, height: 800 } } }] : []),
  ],
});

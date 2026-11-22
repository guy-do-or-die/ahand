/**
 * The demo engine's Playwright configuration (tests/demo/README.md). The site comes from the
 * target (tests/demo/engine/target.ts): DEMO_TARGET=stand (default) reads the slot's stand.json as
 * playwright.config.ts does, or STAND_BASE_URL; fork reads tests/demo/.run/fork/stand.json; site
 * takes DEMO_SITE. DEMO=1 makes it headed; the director (tests/demo/engine/director.ts) does the rest.
 */
import { join } from "node:path";

import { defineConfig } from "@playwright/test";

import { targetOf, targetStand } from "./tests/demo/engine/target";

const root = import.meta.dirname;
const demo = process.env.DEMO === "1";
const target = targetOf();
const baseURL = target === "stand" && process.env.STAND_BASE_URL ? process.env.STAND_BASE_URL : targetStand(target).site!;
const label = target === "stand" ? `slot-${process.env.STAND_SLOT ?? "0"}` : target;

export default defineConfig({
  testDir: join(root, "tests/demo"),
  testMatch: "**/*.spec.ts",
  outputDir: join(root, "tests/demo/test-results", label),
  reporter: demo ? "list" : [[process.env.CI ? "list" : "line"], ["html", { outputFolder: join(root, "tests/demo/report"), open: "never" }]],
  fullyParallel: false,
  // One target is one chain: scenarios share its accounts (and their nonces), its clock, its relay.
  workers: 1,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    browserName: "chromium",
    headless: !demo || process.env.DEMO_HEADLESS === "1",
    // A full trace for every show; in CI only for a scenario that failed (a trace is ~100 MB).
    trace: process.env.DEMO_TRACE === "0" ? "off" : process.env.CI ? "retain-on-failure" : "on",
    screenshot: "only-on-failure",
    // No press may wait forever: an element that went away under a sheet fails the step instead.
    actionTimeout: 20_000,
    // Headed windows on X11 so the director can place them (Wayland ignores window positions).
    launchOptions: { args: demo ? ["--ozone-platform=x11"] : [] },
  },
  projects: [{ name: `demo-${target}` }],
});

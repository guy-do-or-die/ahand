/**
 * Spec-side helpers of the guards (tests/e2e/guards/*.spec.ts): the craft tool and the guards' own
 * forge tool as child processes, a silent dev-server socket, and how a person opens an address and
 * moves inside the app. No workspace package is imported here (PLAN rule 9).
 */
import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { Address, Hex } from "viem";

import { resolve } from "node:path";

import { runProgram, seed, standSlot } from "../../lib/stand";

/** One fixture as infra/stand/seed.ts prints it; only the fields the guards read. */
export interface Fixture {
  handId: string;
  n: number;
  reward: string;
  expiry: number;
  title: string;
  content?: string;
  address: string;
  state: string;
  inbox?: Hex;
  giveAddress?: string;
  firstGiveAddress?: string;
  secondGiveAddress?: string;
  dropped?: { position: number; key: Address; payee: Address | null }[];
}

export interface SeedRun {
  chainId: number;
  core: Address;
  site: string;
  raiser: { account: number; address: Address };
  accounts: Record<string, Address>;
  fixtures: Record<string, Fixture>;
}

export function seedFixtures(only?: string[]): SeedRun {
  return seed<SeedRun>(standSlot(), only);
}

export function fixtureOf(run: SeedRun, name: string): Fixture {
  const found = run.fixtures[name];
  if (!found) throw new Error(`the seed made no ${name} fixture`);
  return found;
}

function tool<T>(script: string, args: string[]): T {
  // A helper chain outside the slots is named by STAND_FILE; a slot's stand by its number.
  const where = process.env.STAND_FILE ? ["--stand", resolve(process.env.STAND_FILE)] : ["--slot", String(standSlot())];
  const { stdout, stderr, code } = runProgram(script, [...args, ...where], { allowFailure: true, timeoutMs: 120_000 });
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(`${script} ${args[0]} exited ${code} without JSON:\n${stderr || stdout}`);
  }
}

/** tests/e2e/lib/craft.ts, its JSON parsed (a refusal to open is JSON too: {ok: false, code}). */
export const craft = <T = Record<string, unknown>>(...args: string[]) => tool<T>("tests/e2e/lib/craft.ts", args);

/** tests/e2e/guards/lib/forge.ts, its JSON parsed. */
export const forge = <T = Record<string, unknown>>(...args: string[]) => tool<T>("tests/e2e/guards/lib/forge.ts", args);

/** A live link's seed in the three forms the hygiene guard looks for. */
export interface SecretForms {
  hex: string;
  base64url: string;
  digits: string;
}

export function secretsOf(address: string): SecretForms {
  const forms = craft<SecretForms & { ok: boolean; message?: string }>("secrets", address);
  if (!forms.ok) throw new Error(`craft secrets: ${forms.message ?? "no seed"}`);
  return { hex: forms.hex, base64url: forms.base64url, digits: forms.digits };
}

/**
 * In --dev mode Vite reloads every open page when any agent edits any file of the shared app, and
 * a reload forgets the link by design. The dev server's own socket (same origin as the site) is
 * answered here by one that never reaches it. A built stand has no such socket.
 */
export async function quiet(context: BrowserContext, site: string): Promise<void> {
  const origin = new URL(site).origin.replace(/^http/, "ws");
  await context.routeWebSocket((url) => url.origin === origin, () => {
    // accepted and left silent
  });
}

/**
 * Opens an address as a person does: the browser goes to it, link intake takes the fragment, and
 * the address bar loses it. A dev server may reload once while it prepares modules, so the visit
 * is repeated (at most three times) until the Hand view or its error is on screen.
 */
export async function visit(page: Page, address: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto("about:blank");
      await page.goto(address, { waitUntil: "networkidle" });
      await expect(page.locator('[data-testid="hand-deal-card"], [data-testid="hand-error"]').first()).toBeVisible({ timeout: 20_000 });
      return;
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
}

/** Moves inside the app without a reload, the way the router does: the tab's memory is kept. */
export async function within(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

/** Every element whose test id ends in "-swipe": the one gesture that goes on, on every screen. */
export function swipes(page: Page) {
  return page.locator('[data-testid$="-swipe"]');
}

/** No swipe on the page may be pressed: either none is shown or every one shown is disabled. */
export async function expectNoWayOn(page: Page): Promise<void> {
  const all = swipes(page);
  const count = await all.count();
  for (let i = 0; i < count; i++) {
    const one = all.nth(i);
    if (await one.isVisible()) await expect(one).toBeDisabled();
  }
}

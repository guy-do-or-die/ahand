/**
 * Helpers of the raise smoke (tests/e2e/smoke/raise.spec.ts): fill the compose surface, swipe and
 * answer the connect sheet and the keys card, read the device's IndexedDB as plain text, and run
 * the craft tool for opening an address and listing a link's secret forms.
 */
import { resolve } from "node:path";

import { expect, type Page } from "@playwright/test";

import { runProgram, standSlot } from "../stand";

export interface Compose {
  title: string;
  details?: string;
  /** A chip ("5", "20", "50") or any amount typed after "Your call". */
  reward: "5" | "20" | "50" | { custom: string };
  days?: 7 | 30 | 90 | 180;
  mode?: "public" | "unlisted" | "dark";
}

export async function compose(page: Page, c: Compose): Promise<void> {
  await page.getByTestId("raise-what").fill(c.title);
  if (c.details) {
    await page.getByTestId("raise-details-toggle").click();
    await page.getByTestId("raise-details").fill(c.details);
  }
  if (typeof c.reward === "string") {
    await page.locator(`[data-testid="raise-reward-chip"][data-value="${c.reward}"]`).click();
  } else {
    await page.locator('[data-testid="raise-reward-chip"][data-value="custom"]').click();
    await page.getByTestId("raise-reward-custom").locator("input").fill(c.reward.custom);
  }
  const days = c.days ?? 30;
  if ([7, 30, 90].includes(days)) {
    await page.locator(`[data-testid="raise-expiry-chip"][data-value="${days}"]`).click();
  } else {
    // Any other term is the asker's own date; 180 days is the last date the field offers (Core's cap).
    if (days !== 180) throw new Error(`compose: ${days} days has no chip; only the cap (180) is picked as a date here`);
    await page.getByTestId("raise-expiry-date").click();
    const calendar = page.getByTestId("raise-expiry-calendar");
    const last = (await calendar.getAttribute("data-max"))!;
    for (let month = 0; month < 8 && (await calendar.locator(`[data-date="${last}"]`).count()) === 0; month++) await calendar.locator('[data-step="later"]').click();
    await calendar.locator(`[data-date="${last}"]`).click();
  }
  await page.locator(`[data-testid="raise-visibility"][data-value="${c.mode ?? "unlisted"}"]`).click();
}

/**
 * Presses the swipe, connects `account` if the connect sheet opens, and confirms the keys card as
 * often as it comes (twice-asking is one card; a later raise in the same tab asks none).
 */
export async function swipe(page: Page, account: number): Promise<void> {
  await expect(page.getByTestId("raise-swipe")).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId("raise-swipe").click();
  await answerPrompts(page, account);
}

/** Answers the connect sheet and the keys card if they come, until neither is shown. */
export async function answerPrompts(page: Page, account: number): Promise<void> {
  const entry = page.getByTestId(`dev-account-${account}`);
  const keys = page.getByTestId("raise-keys-confirm");
  for (let round = 0; round < 3; round++) {
    const which = await Promise.race([
      entry.waitFor({ timeout: 15_000 }).then(() => "connect" as const),
      keys.waitFor({ timeout: 15_000 }).then(() => "keys" as const),
    ]).catch(() => undefined);
    // The keys card wins when both show: the connect sheet may still be closing after the pick.
    if (which === "keys" || (await keys.isVisible())) return keys.click();
    // The entry was just seen in the open sheet: press it there. Reopening the sheet through
    // pickDevAccount raced the sheet's own closing (review round 1 gate: an entry seen while the
    // sheet closed sent the helper looking for "Connect a wallet" behind the keys card).
    if (which === "connect") await entry.click({ timeout: 10_000 }).catch(() => undefined);
    else return;
  }
}

/** Every record of every store of the app's IndexedDB, as one string (bytes as numbers). */
export async function dumpDb(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("ahand");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const out: Record<string, unknown[]> = {};
    for (const name of Array.from(db.objectStoreNames)) {
      out[name] = await new Promise<unknown[]>((resolve, reject) => {
        const request = db.transaction(name, "readonly").objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    db.close();
    return JSON.stringify(out, (_key, value) => {
      if (value instanceof Uint8Array) return Array.from(value);
      if (typeof CryptoKey !== "undefined" && value instanceof CryptoKey) return `CryptoKey(${value.type}, extractable ${value.extractable})`;
      if (typeof value === "bigint") return value.toString();
      return value;
    });
  });
}

/** The escrow store's keys: the locked copies still on the device. */
export async function escrowKeys(page: Page): Promise<string[]> {
  return JSON.parse(await dumpDb(page)).escrow.map((record: { intent: string }) => record.intent);
}

/** The craft tool (tests/e2e/lib/craft.ts) on this run's stand (STAND_FILE, else the slot's), its JSON parsed. */
export function craft<T = Record<string, unknown>>(...args: string[]): T {
  const stand = process.env.STAND_FILE ? ["--stand", resolve(process.env.STAND_FILE)] : ["--slot", String(standSlot())];
  const run = runProgram("tests/e2e/lib/craft.ts", [...args, ...stand], { timeoutMs: 120_000 });
  return JSON.parse(run.stdout) as T;
}

/**
 * Presses the swipe and answers with a wallet the browser announced (EIP-6963), by its name in
 * the connect sheet; then confirms the keys card. With `connected`, the wallet is connected already.
 */
export async function swipeWith(page: Page, walletName: string, opts: { connected?: boolean } = {}): Promise<void> {
  await expect(page.getByTestId("raise-swipe")).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId("raise-swipe").click();
  if (!opts.connected) await page.getByTestId("kit-connect-option").filter({ hasText: walletName }).click();
  await page.getByTestId("raise-keys-confirm").click();
}

/** The `hands` records the device keeps, as plain objects. */
export async function keptHands(page: Page): Promise<Record<string, unknown>[]> {
  return JSON.parse(await dumpDb(page)).hands;
}

/** The copy row's value through the clipboard, as a person gets it. */
export async function copied(page: Page): Promise<string> {
  await page.getByTestId("raise-copy").getByRole("button").click();
  return page.evaluate(() => navigator.clipboard.readText());
}

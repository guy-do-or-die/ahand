/**
 * Privy test accounts (Privy's dashboard, "Test accounts"): an email of the form
 * test-XXXX@privy.io with a fixed code, in the dev Privy app only. Their codes live outside Git in
 * ~/.config/ahand-demo/privy-test.json (0600; DEMO_PRIVY_FILE overrides), with the address of the
 * wallet Privy made on the first sign-in. The engine reads them in the test process and types
 * them into Privy's window the way a person would; it never prints them.
 *
 * Privy only answers pages on the origins its dashboard allows, so a scenario with a Privy
 * persona runs on a fork brought up on one of them (bun tests/demo/fork.ts up --privy-port 3411)
 * or on a branch site.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { expect, type Locator, type Page } from "@playwright/test";
import type { Address } from "viem";

const FILE = process.env.DEMO_PRIVY_FILE ?? join(homedir(), ".config/ahand-demo/privy-test.json");

interface PrivyAccount {
  name: string;
  email: string;
  otp: string;
  wallet?: Address;
}

export function privyAccounts(): PrivyAccount[] {
  if (!existsSync(FILE)) throw new Error(`no Privy test accounts: ${FILE} is missing (Privy's dashboard, Test accounts)`);
  if ((statSync(FILE).mode & 0o077) !== 0) throw new Error(`${FILE} is readable by others: chmod 600 it`);
  return (JSON.parse(readFileSync(FILE, "utf8")) as { accounts: PrivyAccount[] }).accounts;
}

/** The wallet addresses of the test accounts that have one (for a fork to fund). */
export function privyWallets(): Address[] {
  return existsSync(FILE) ? privyAccounts().flatMap((a) => (a.wallet ? [a.wallet] : [])) : [];
}

function accountOf(n: number): PrivyAccount {
  const found = privyAccounts()[n - 1];
  if (!found) throw new Error(`Privy test account ${n} is not in ${FILE}; the dashboard can add another`);
  return found;
}

/** Privy's own window (its modal), which the app opens for every "Log in". */
export function privyWindow(page: Page): Locator {
  return page.locator("#privy-modal-content");
}

/**
 * Signs in to Privy with test account n: opens Privy's window through the app's own control if it
 * is not open yet, types the email, then the fixed code, and waits for the window to go and the
 * app to show the account connected.
 */
export async function signInPrivy(page: Page, n: number, opener: Locator): Promise<void> {
  const account = accountOf(n);
  const modal = privyWindow(page);
  const email = modal.locator("input[type=email]").first();
  await email.or(opener).first().waitFor({ timeout: 20_000 });
  if (!(await email.isVisible())) await opener.click();
  await email.waitFor({ timeout: 30_000 });
  await email.fill(account.email);
  await modal.getByRole("button", { name: /submit/i }).click();
  // The code's six boxes take typed digits one after another, as a person types them.
  await expect(modal.locator("input").first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1_500);
  await page.keyboard.type(account.otp, { delay: 60 });
  await expect(modal).toBeHidden({ timeout: 45_000 });
}

export function privyAddress(n: number): Address | null {
  return accountOf(n).wallet ?? null;
}

/**
 * With the lens on, Privy shows its own window for each signature (the app gives Privy
 * showWalletUIs = the lens): a person reads it and approves. Waits a moment for that window and
 * presses its approve button; with the lens off it never comes, and this returns.
 */
export async function approveInPrivy(page: Page, waitMs = 8_000): Promise<boolean> {
  const modal = privyWindow(page);
  const approve = modal.getByRole("button", { name: /^(approve|confirm|sign)/i }).first();
  if (!(await approve.waitFor({ timeout: waitMs }).then(() => true, () => false))) return false;
  await approve.click();
  await expect(modal).toBeHidden({ timeout: 30_000 });
  return true;
}

/**
 * Screenshots for looking at by eye (not a test): the raise screen while the raise has been sent
 * and waits for its block (the TxRail at "Sent", the state this package added), then the share
 * step once the Hand is up, at phone width 390 in English and Russian.
 *
 *   bun tests/e2e/lib/e2e-life/shots.ts <slot> <out-dir>
 *
 * To hold the "Sent" state long enough to look at, block production is paused while the raise is
 * in the pool and resumed afterwards. The raiser's allowance is set from the test side first, so
 * the raise is one step. Dev account 2 raises (account 1 belongs to the life scenario, tests/demo/scenarios/life.ts).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "@playwright/test";
import { createWalletClient, erc20Abi, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import { account } from "../accounts";
import { pauseBlocks, resumeBlocks, rpc } from "../rpc";
import { readStand, tokenOf } from "../stand";

const [slotText, out] = process.argv.slice(2);
if (!slotText || !out) throw new Error("usage: shots.ts <slot> <out-dir>");
mkdirSync(out, { recursive: true });
const stand = readStand(Number(slotText));
const chain = rpc(stand.rpc);
const who = 2;

const wallet = createWalletClient({ account: privateKeyToAccount(account(who).privateKey), chain: foundry, transport: http(stand.rpc) });
const approve = await wallet.writeContract({ address: tokenOf(stand, "usd").address, abi: erc20Abi, functionName: "approve", args: [stand.core, 10n ** 12n] });
await chain.client.waitForTransactionReceipt({ hash: approve });

const browser = await chromium.launch();
try {
  for (const lang of ["en", "ru"] as const) {
    for (const scheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: lang === "ru" ? "ru-RU" : "en-GB", colorScheme: scheme, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.on("dialog", (dialog) => void dialog.accept());
      await page.goto(`${stand.site}/raise`);
      await page.getByTestId("raise-what").waitFor({ timeout: 30_000 });
      await page.getByTestId("raise-what").fill(lang === "ru" ? "Кто одолжит лестницу в Батуми на выходные?" : "Who can lend a ladder in Batumi this weekend?");
      await page.locator('[data-testid="raise-reward-chip"][data-value="50"]').click();
      await page.getByTestId("raise-swipe").click();
      await page.getByTestId(`dev-account-${who}`).click();
      // No block comes until resumed: the raise waits in the pool after it is sent.
      await pauseBlocks(chain);
      try {
        await page.getByTestId("raise-keys-confirm").click();
        await page.locator('[data-testid="raise-tx-rail"][data-value="sent"]').waitFor({ timeout: 30_000 });
        await page.waitForTimeout(400);
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        await page.screenshot({ path: join(out, `raise-sent-${lang}-phone-${scheme}.png`), fullPage: true });
        console.log(`${lang} ${scheme} sent: scrollWidth ${width}`);
      } finally {
        await resumeBlocks(chain);
      }
      await page.getByTestId("raise-up").waitFor({ timeout: 30_000 });
      await page.locator('[data-testid="raise-tx-rail"][data-value="final"]').waitFor({ timeout: 30_000 });
      await page.screenshot({ path: join(out, `raise-final-${lang}-phone-${scheme}.png`), fullPage: true });
      await context.close();
    }
  }
} finally {
  await resumeBlocks(chain).catch(() => undefined);
  await browser.close();
}

/**
 * A pass that names the asker's own address: Core
 * allows it, and every route the app renders says so, not only /thank. One Hand is raised by
 * account 1, passed once keeping 5% for account 1 itself, answered by account 4 and thanked by
 * account 1 from outside the browser (the CLI's calldata, sent with viem). Then:
 *
 *   the Hand view's rail flags that pass, on the hand and on its back;
 *   /give says it before the helper answers;
 *   the passport notes it under the route line and the share line.
 *
 *   STAND_SLOT=0 bunx playwright test tests/e2e/smoke/asker-hop.spec.ts
 */
import { expect, test } from "@playwright/test";
import { createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import { account } from "../lib/accounts";
import { craft, quietDevServer } from "../lib/feat-hand/helpers";
import { lensOn } from "../lib/lens";
import { hands, rpc } from "../lib/rpc";
import { readStand, runProgram } from "../lib/stand";

test.describe.configure({ mode: "serial" });

const stand = readStand();
const chain = rpc(stand.rpc);
const asker = account(1);
let handId: string;
let passed: string;
let given: string;

test.beforeAll(async () => {
  const made = craft<{ ok: boolean; handId: string; address: string }>(["make", "--title", "Who can lend a tent for the weekend?", "--reward", "20"]);
  expect(made.ok).toBe(true);
  handId = made.handId;
  passed = craft<{ ok: boolean; address: string }>(["pass", made.address, "--keep", "500", "--payee-account", "1"]).address;
  given = craft<{ ok: boolean; address: string }>(["give", passed, "--giver", "4"]).address;
});

test.beforeEach(async ({ context }) => {
  await quietDevServer(context, stand.site!);
});

test("the Hand view's rail flags the pass that kept a share for the asker's own address", async ({ page }) => {
  await page.goto(passed);
  const rail = page.getByTestId("hand-rail");
  await expect(rail).toBeVisible({ timeout: 20_000 });
  const flagged = rail.locator('[data-flag="asker"]');
  await expect(flagged).toHaveCount(1);
  await expect(flagged).toHaveAttribute("data-role", "passer");
  await expect(flagged.getByTestId("kit-rail-flag")).toHaveText("the asker's own address");
  // The asker's own hand is not flagged; only the pass is.
  await expect(rail.locator('[data-role="asker"][data-flag]')).toHaveCount(0);
  // The flag stands in the calm view; the hand turns over only under the lens, and its back says
  // why, before its proof.
  await lensOn(page);
  await flagged.getByRole("button").first().click();
  await expect(rail.locator(".ah-back__flag")).toContainText("This pass named the asker's own address");
});

test("/give says it before the helper answers", async ({ page }) => {
  await page.goto(passed);
  await page.getByTestId("hand-help").click();
  const note = page.getByTestId("give-asker-hop");
  await expect(note).toBeVisible({ timeout: 20_000 });
  await expect(note).toHaveAttribute("data-value", "1");
  await expect(note).toContainText("Pass 1 on this route named the asker's own address");
});

test("thanked: the passport notes the route line and the share line that name the asker", async ({ page }) => {
  const calldata = runProgram("tools/ahand.ts", ["thank-calldata", given, "--rpc", stand.rpc]);
  const data = /0x[0-9a-f]{200,}/.exec(calldata.stdout)?.[0] as Hex | undefined;
  expect(data, calldata.stdout).toBeDefined();
  const wallet = createWalletClient({ account: privateKeyToAccount(asker.privateKey), chain: foundry, transport: http(stand.rpc) });
  const hash = await wallet.sendTransaction({ to: stand.core as Address, data: data! });
  const receipt = await chain.client.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
  expect((await hands(chain, stand.core as Address, BigInt(handId))).closedAt).toBeGreaterThan(0);

  await page.goto(`/${stand.chainId}/${handId}/proof`);
  await expect(page.getByTestId("proof-tally")).toHaveAttribute("data-done", "true", { timeout: 30_000 });
  const notes = page.getByTestId("proof-asker-hop");
  await expect(notes).toHaveCount(2);
  expect(await notes.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-value")))).toEqual(["route.0", "share.0"]);
  await expect(notes.nth(0)).toHaveText("This pass named the asker's own address for its share: that share goes back to the asker.");
  await expect(notes.nth(1)).toHaveText("This share went to the asker's own address.");
  // The lines still hold: Core allows it.
  for (const id of ["route.0", "share.0"]) await expect(page.locator(`[data-testid="proof-check"][data-value="${id}"]`)).toHaveAttribute("data-verdict", "ok");
});

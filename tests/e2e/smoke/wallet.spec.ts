/**
 * The wallet layer in a real browser against a real local chain (PLAN wave 3, app-wallet):
 * /dev/wallet connects the dev wallet's accounts, asks each for the same typed message twice,
 * shows the network's time beside the browser's, follows a time jump, names the connect control
 * "Use another account" once connected, and sends a test approve through the four states, after
 * which the allowance is read from the chain itself.
 *
 *   STAND_BASE_URL=http://127.0.0.1:18331 bunx playwright test tests/e2e/smoke/wallet.spec.ts
 *   STAND_SLOT=0 bunx playwright test tests/e2e/smoke/wallet.spec.ts
 *
 * The chain is the one the page reads: its RPC is taken from the page (data-rpc), so the spec
 * never talks to another chain than the app does. A local build only (the page is not in others).
 */
import { expect, test, type Page } from "@playwright/test";
import { erc20Abi, type Address, type Hex } from "viem";

import { account, NOT_SET_UP, pickDevAccount } from "../lib/accounts";
import { chainNow, rpc, type Rpc } from "../lib/rpc";

const DAY = 86_400;
const ERC6492_SUFFIX = "6492649264926492649264926492649264926492649264926492649264926492";

test.describe.configure({ mode: "serial" });

async function open(page: Page): Promise<Rpc> {
  await page.goto("/dev/wallet");
  const time = page.getByTestId("dev-wallet-network-time");
  await expect(time).toHaveAttribute("data-value", /^[0-9]+$/);
  return rpc((await time.getAttribute("data-rpc"))!);
}

async function connectAs(page: Page, which: number | typeof NOT_SET_UP): Promise<Address> {
  await pickDevAccount(page, which);
  const shown = page.getByTestId("dev-wallet-account");
  if (which !== NOT_SET_UP) await expect(shown).toHaveAttribute("data-value", account(which).address);
  else await expect(shown).toHaveAttribute("data-role", "unset");
  return (await shown.getAttribute("data-value")) as Address;
}

/** The page's fixed sample message (screens/dev-wallet/index.tsx), rebuilt to check answers here. */
async function sample(page: Page, signer: Address) {
  const marker = page.getByTestId("dev-wallet-sample");
  return {
    domain: { name: "aHand dev wallet", version: "1", chainId: Number(await marker.getAttribute("data-chain")), verifyingContract: (await marker.getAttribute("data-core")) as Address },
    types: { Sample: [{ name: "text", type: "string" }, { name: "account", type: "address" }, { name: "n", type: "uint256" }] },
    primaryType: "Sample" as const,
    message: { text: "The same message, asked twice.", account: signer, n: 1n },
  };
}

async function askTwice(page: Page): Promise<{ first: Hex; second: Hex; verdict: string; wrapped: string }> {
  await page.getByTestId("dev-wallet-sign").click();
  const signatures = page.getByTestId("dev-wallet-signature");
  await expect(signatures).toHaveCount(2);
  return {
    first: (await signatures.nth(0).getAttribute("data-value")) as Hex,
    second: (await signatures.nth(1).getAttribute("data-value")) as Hex,
    verdict: (await page.getByTestId("dev-wallet-verdict").getAttribute("data-value"))!,
    wrapped: (await page.getByTestId("dev-wallet-wrapped").getAttribute("data-value"))!,
  };
}

test("the network's time runs at least 39 days ahead of the browser's, and follows a jump within two blocks", async ({ page }) => {
  const chain = await open(page);
  const time = page.getByTestId("dev-wallet-network-time");
  const network = Number(await time.getAttribute("data-value"));
  const browser = await page.evaluate(() => Math.floor(Date.now() / 1000));
  expect(network - browser).toBeGreaterThanOrEqual(39 * DAY);
  await expect(page.getByTestId("dev-wallet-ahead")).toBeVisible();

  const before = await chainNow(chain);
  const jump = 7 * DAY;
  await chain.test.increaseTime({ seconds: jump });
  // The page shows a block at most two after the one the jump was made at, already moved.
  await expect
    .poll(async () => BigInt((await time.getAttribute("data-block")) || "0"), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(before.number + 1n);
  await expect
    .poll(
      async () => {
        const block = BigInt((await time.getAttribute("data-block")) || "0");
        const shown = Number(await time.getAttribute("data-value"));
        return block <= before.number + 2n ? shown - before.timestamp >= jump : "past two blocks";
      },
      { timeout: 10_000, intervals: [100] },
    )
    .toBe(true);
});

test("account 1 gives the same answer twice; account 5 two different ones", async ({ page }) => {
  const chain = await open(page);
  const first = await connectAs(page, 1);
  const one = await askTwice(page);
  expect(await chain.client.verifyTypedData({ ...(await sample(page, first)), address: first, signature: one.first })).toBe(true);
  expect(one.first).toMatch(/^0x[0-9a-f]{130}$/);
  expect(one.first).toBe(one.second);
  expect(one.verdict).toBe("same");
  expect(one.wrapped).toBe("false");

  const fifth = await connectAs(page, 5);
  const five = await askTwice(page);
  expect(five.first).not.toBe(five.second);
  for (const signature of [five.first, five.second]) expect(await chain.client.verifyTypedData({ ...(await sample(page, fifth)), address: fifth, signature })).toBe(true);
  expect(five.verdict).toBe("different");
});

test("once connected, the control says 'Use another account', never 'Connect a wallet' beside 'Disconnect'", async ({ page }) => {
  await open(page);
  const connect = page.getByTestId("connect-wallet");
  await expect(connect).toHaveText("Connect a wallet");
  const first = await connectAs(page, 1);
  await expect(page.getByTestId("wallet-connected")).toHaveAttribute("data-value", first);
  // The person's own account is how they know which one they use: its short address stands in
  // the calm view too (the lens is off here), never "someone".
  await expect(page.locator("html")).not.toHaveAttribute("data-lens", "on");
  await expect(page.getByTestId("wallet-connected")).toContainText(`${first.slice(0, 6)}…${first.slice(-4)}`);
  await expect(page.getByTestId("wallet-connected")).not.toContainText("someone");
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
  await expect(connect).toHaveText("Use another account");
  await expect(page.getByRole("button", { name: "Connect a wallet" })).toHaveCount(0);
  // The same control still opens the sheet: switching to account 2 goes through it.
  await connect.click();
  await page.getByTestId("dev-account-2").click();
  await expect(page.getByTestId("dev-wallet-account")).toHaveAttribute("data-value", account(2).address);
  await expect(connect).toHaveText("Use another account");
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(connect).toHaveText("Connect a wallet");
});

test("the account that is not set up yet answers wrapped per ERC-6492", async ({ page }) => {
  const chain = await open(page);
  const address = await connectAs(page, NOT_SET_UP);
  expect((await chain.client.getCode({ address })) ?? "0x").toBe("0x");
  const unset = await askTwice(page);
  expect(unset.wrapped).toBe("true");
  expect(unset.first.endsWith(ERC6492_SUFFIX)).toBe(true);
  // viem's ERC-6492 verifier (a simulated setup, then ERC-1271) accepts it before the account exists.
  expect(await chain.client.verifyTypedData({ ...(await sample(page, address)), address, signature: unset.first })).toBe(true);
  expect((await chain.client.getCode({ address })) ?? "0x").toBe("0x");
});

test("an approve goes Sent → In a block → the two further states, and the allowance is on chain", async ({ page }) => {
  const chain = await open(page);
  const owner = await connectAs(page, 1);
  const button = page.getByTestId("dev-wallet-approve");
  const token = (await button.getAttribute("data-token")) as Address;
  const core = (await button.getAttribute("data-core")) as Address;

  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __txSeen: string[] }).__txSeen = seen;
    const record = () => {
      const value = document.querySelector("[data-testid=kit-tx-rail]")?.getAttribute("data-value");
      if (value && seen.at(-1) !== value) seen.push(value);
    };
    new MutationObserver(record).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-value"] });
  });
  await button.click();
  const rail = page.getByTestId("kit-tx-rail");
  await expect(rail).toHaveAttribute("data-value", "final", { timeout: 20_000 });
  const seen = await page.evaluate(() => (window as unknown as { __txSeen: string[] }).__txSeen);
  // Sent may pass between two renders on a 1 s chain; In a block, safe and final are each shown.
  expect(seen.filter((s) => s !== "sent")).toEqual(["in-block", "safe", "final"]);
  expect(["sent", "in-block"]).toContain(seen[0]!);
  // The calm view says it in one sentence; under the lens both further steps carry the LOCAL
  // STAND-IN tag on a chain with no Ethereum behind it.
  await expect(rail).toContainText("Done. It can't be undone.");
  await expect(rail.locator(".ah-tx__local")).toHaveCount(0);
  await page.getByTestId("shell-lens").click();
  await expect(rail.locator(".ah-tx__local")).toBeVisible();

  const hash = (await page.getByTestId("dev-wallet-hash").first().textContent())!.trim() as Hex;
  const receipt = await chain.client.getTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
  expect(receipt.from.toLowerCase()).toBe(owner.toLowerCase());
  expect(receipt.to?.toLowerCase()).toBe(token.toLowerCase());
  // The money on the chain afterwards: Core may now take exactly one test dollar from account 1.
  expect(await chain.client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, core] })).toBe(1_000_000n);
});

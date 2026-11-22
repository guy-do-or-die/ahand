/**
 * The public test build (apps/web/src/config/base-sepolia.json, chain.local false: no dev wallet,
 * no gallery) on a local anvil fork of Base Sepolia, driven by tests/e2e/fork/run.ts, which starts
 * the fork, builds the app against it, serves it with infra/stand/static.ts and sets:
 *
 *   STAND_BASE_URL  the served build          FORK_RPC   the fork's RPC (127.0.0.1 only)
 *   FORK_CORE       Core's address            FORK_USDC  Circle's test USDC on Base Sepolia
 *   FORK_PHASE      absent: before Core is put on the fork; life: after
 *
 * absent  every screen that reads Core says "This contract is not on Base Sepolia (test network)
 *         yet." in English and Russian, never "Can't reach the network"; /core shows its derivation
 *         and the empty eth_getCode; the landing and /build.json are as usual.
 * life    raise (an injected test wallet with anvil's public key 1) → pass at 0% (no wallet) →
 *         help with a pasted payee (no wallet; the public relays are blocked, so the give link is
 *         pasted into /thank, the fallback) → /check of that link → thank → /core → the passport.
 *         Every step ends on Core's state or a token balance read from the fork.
 *
 * Every person's requests to any host but 127.0.0.1 are aborted and listed; only the configured
 * relays may appear in that list.
 */
import { RECOMMENDED_RELAYS } from "@ahand/deliver";
import { expect, test, type Page } from "@playwright/test";
import { erc20Abi, getAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { account } from "../lib/accounts";
import { person, type Person } from "../lib/e2e-life/people";
import { FORK_WALLET_NAME, injectForkWallet } from "../lib/fork/key-wallet";
import { compose, copied, swipeWith } from "../lib/feat-raise/raise";
import { hands, rpc } from "../lib/rpc";
import type { StandInfo } from "../lib/stand";

const PHASE = process.env.FORK_PHASE ?? "";
const RPC = process.env.FORK_RPC ?? "";
const CORE = (process.env.FORK_CORE ?? "0x65ac707E2AE7392583de5d6192C619F1D8862309") as Address;
const USDC = (process.env.FORK_USDC ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address;
const CHAIN = 84532;
const SITE = process.env.STAND_BASE_URL ?? "";
// The public configuration's relays (apps/web/src/config/base-sepolia.json, the recommended list of @ahand/deliver).
const RELAYS = RECOMMENDED_RELAYS.map((relay) => relay.url);
const USD = 1_000_000n;

// Only for run.ts: the stand's own suites must never pick this file up by accident.
test.skip(!RPC || !SITE || !["absent", "life"].includes(PHASE), "run through tests/e2e/fork/run.ts");

const stand = { mode: "built", site: SITE } as StandInfo;
const people: Person[] = [];
test.afterAll(async () => {
  for (const one of people) await one.context.close().catch(() => undefined);
});

/** Only the configured relays may have been tried off this machine. */
function onlyRelaysOffHost(one: Person): void {
  const off = [...new Set(one.offHost.map((url) => new URL(url).origin.replace(/^https?/, (s) => (s === "https" ? "wss" : "ws"))))];
  for (const origin of off) expect(RELAYS, `${one.name} reached ${origin}`).toContain(origin);
}

const GATED = ["/raise", `/${CHAIN}/1`, `/${CHAIN}/1/proof`, "/check", "/waiting", "/thank", "/my", "/pass", "/give", `/care/${CHAIN}/1`];

test.describe("before Core is on the fork", () => {
  test.skip(PHASE !== "absent");

  test("every screen that reads Core says the contract is not on Base Sepolia yet, in both languages; never that the network is unreachable", async ({ browser }) => {
    const reader = await person(browser, "reader", stand);
    people.push(reader);
    const { page } = reader;
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (/Uncompiled message/.test(message.text())) warnings.push(message.text());
    });
    const code = await rpc(RPC).client.getCode({ address: CORE });
    expect(code ?? "0x").toBe("0x");

    for (const path of GATED) {
      await page.goto(path);
      const band = page.getByTestId("shell-no-core");
      await expect(band, path).toBeVisible({ timeout: 20_000 });
      await expect(band).toHaveAttribute("data-value", CORE);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("This contract is not on Base Sepolia (test network) yet.");
      await expect(page.locator("main")).not.toContainText("Can't reach the network");
    }

    // The header says these are test dollars on a test network (it said nothing off a local stand).
    await expect(page.getByTestId("shell-ribbon")).toHaveText("Base Sepolia (test network) · Test dollars");

    await page.goto("/core");
    await expect(page.getByTestId("core-absent")).toContainText("This contract is not on Base Sepolia (test network) yet.", { timeout: 20_000 });
    // The public site writes link previews for a Hand's address (the view server's Vercel Function); the contract opens on the chain's explorer.
    await expect(page.locator("main")).toContainText("A Hand's address and its card carry the preview tags and image this server adds; /index.html is the file as built.");
    await expect(page.locator("main")).not.toContainText("This site adds nothing to its pages");
    await expect(page.getByTestId("shell-explorer").first()).toHaveAttribute("href", `https://sepolia.basescan.org/address/${CORE}`);
    await expect(page.getByTestId("core-absent")).toContainText("No code was found at this address on this network just now.");
    await expect(page.getByTestId("core-derivation")).toHaveAttribute("data-match", "true");
    await expect(page.locator("main")).toContainText("Base Sepolia (test network) · Chain ID 84532");
    await expect(page.locator("main")).not.toContainText("Can't reach the network");
    await expect(page.getByTestId("core-build-hash")).toBeVisible();

    await page.getByTestId("shell-lang-ru").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(page.getByTestId("core-absent")).toContainText("Этого контракта ещё нет в сети Base Sepolia (тестовая сеть).");
    await expect(page.getByTestId("shell-ribbon")).toHaveText("Base Sepolia (тестовая сеть) · Тестовые доллары");
    await page.goto("/raise");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Этого контракта ещё нет в сети Base Sepolia (тестовая сеть).", { timeout: 20_000 });
    await expect(page.locator("main")).not.toContainText("Сеть сейчас недоступна");
    await page.getByTestId("shell-lang-en").click();

    // Check again asks the chain again and keeps the sentence while the address is still empty.
    await page.getByTestId("shell-no-core-retry").click();
    await expect(page.getByTestId("shell-no-core")).toBeVisible();

    // The landing does not read Core and draws as usual; the build serves its own build.json.
    await page.goto("/");
    await expect(page.getByTestId("shell-no-core")).toHaveCount(0);
    await expect(page.getByTestId("landing-raise")).toBeVisible();
    const build = await page.request.get("/build.json");
    expect(build.headers()["content-type"]).toContain("json");
    expect((await build.json()).hash).toMatch(/^[0-9a-f]{64}$/);

    expect(warnings).toEqual([]);
    onlyRelaysOffHost(reader);
  });
});

/* ------------------------------------------------------------------ the life */

async function open(page: Page, address: string): Promise<void> {
  await page.goto(address);
  await expect(page.getByTestId("hand-deal-card")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => location.href)).not.toContain("#");
}

async function connectIfAsked(page: Page): Promise<void> {
  if ((await page.getByTestId("wallet-connected").count()) > 0) return;
  await page.getByTestId("connect-wallet").first().click();
  await page.getByTestId("kit-connect-option").filter({ hasText: FORK_WALLET_NAME }).click();
}

const balanceOf = (who: Address) => rpc(RPC).client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [who] });

test.describe("the life on the fork", () => {
  test.skip(PHASE !== "life");

  test("raise → pass at 0% → help with a pasted payee → /check → thank, then /core and the passport", async ({ browser }) => {
    test.setTimeout(300_000);
    const join = async (name: string) => {
      const one = await person(browser, name, stand);
      people.push(one);
      return one;
    };
    const raiser = await join("raiser");
    const wallet = await injectForkWallet(raiser.context, RPC, CHAIN, account(1).privateKey);
    const alice = await join("alice");
    const bob = await join("bob");
    const helperPayee = privateKeyToAccount(generatePrivateKey()).address;
    const title = `Who can lend a ladder in Batumi this weekend? ${Date.now() % 100_000}`;
    let handId = 0n;
    let raised = "";
    let passed = "";
    let given = "";

    await test.step("raise: 5 test USDC, 7 days, unlisted, from the injected test wallet", async () => {
      const before = await balanceOf(wallet.address);
      const { page } = raiser;
      await page.goto("/raise");
      await expect(page.getByTestId("raise-what")).toBeVisible({ timeout: 30_000 });
      // Test money: where it comes from, what it is worth, and the smallest reward first.
      await expect(page.getByTestId("shell-faucets")).toContainText("Test money is free on Base Sepolia (test network):");
      await expect(page.getByTestId("shell-faucets").getByRole("link", { name: "faucet.circle.com" })).toHaveAttribute("href", "https://faucet.circle.com");
      await expect(page.getByTestId("raise-issuer-line")).toContainText("Held in test USDC on Base Sepolia (test network): it is worth nothing.");
      await compose(page, { title, reward: "5", days: 7, mode: "unlisted" });
      // The preview of a link names this chain and shows what the view server's function writes for it.
      const unfurl = page.getByTestId("raise-unfurl");
      await expect(unfurl).toHaveAttribute("data-previews", "true");
      await expect(unfurl).toContainText(`/${CHAIN}/…?d=…#E…`);
      await expect(unfurl).not.toContainText("/31337/");
      await expect(unfurl).not.toContainText("On this test site a chat's link preview shows only the site's name.");
      await swipeWith(page, FORK_WALLET_NAME);
      const up = page.getByTestId("raise-up");
      await expect(up).toBeVisible({ timeout: 90_000 });
      handId = BigInt((await up.getAttribute("data-hand-id"))!);
      raised = await copied(page);
      expect(raised).toMatch(new RegExp(`^${SITE}/${CHAIN}/${handId}\\?d=[A-Za-z0-9_-]+#[A-Za-z0-9_-]+$`));
      const row = await hands(rpc(RPC), CORE, handId);
      expect(getAddress(row.raiser)).toBe(wallet.address);
      expect(getAddress(row.token)).toBe(getAddress(USDC));
      expect(row.reward).toBe(5n * USD);
      expect(row.closedAt).toBe(0);
      expect(await balanceOf(wallet.address)).toBe(before - 5n * USD);
      expect(wallet.asked("eth_sendTransaction")).toBe(2); // approve, then raise
    });

    await test.step("Alice, no wallet, passes at 0%", async () => {
      const { page } = alice;
      await open(page, raised);
      await expect(page.getByTestId("hand-deal-card")).toContainText(title);
      await expect(page.getByTestId("hand-deal-card")).toHaveAttribute("data-state", "open");
      await page.getByTestId("hand-pass").click();
      await expect(page).toHaveURL(/\/pass$/);
      await page.getByTestId("pass-swipe").click();
      await expect(page.getByTestId("pass-read-back")).toHaveAttribute("data-bps", "0");
      passed = ((await page.getByTestId("pass-copy").locator(".ah-linkrow__value").textContent()) ?? "").trim();
      expect(passed).toContain("#");
      expect(alice.watch.prompt).toBe(false);
    });

    await test.step("Bob, no wallet, helps with a pasted payee; the relays are out of reach, so his link is the way", async () => {
      const { page } = bob;
      await open(page, passed);
      await expect(page.getByTestId("hand-rail")).toHaveAttribute("data-value", "2");
      await page.getByTestId("hand-help").click();
      await expect(page).toHaveURL(/\/give$/);
      await page.getByTestId("give-words").fill("I have a three-metre ladder near the boulevard.");
      await page.getByRole("radio", { name: "An address I have" }).check();
      await page.getByRole("textbox", { name: "The address" }).fill(helperPayee);
      await expect(page.getByTestId("give-agree").locator("[data-payee]")).toHaveAttribute("data-payee", helperPayee);
      await page.getByTestId("give-swipe").click();
      const copy = page.getByTestId("give-copy");
      await expect(copy).toBeVisible({ timeout: 60_000 });
      given = (await copy.getAttribute("data-value"))!;
      expect(given.startsWith(`${SITE}/#`)).toBe(true);
      expect(bob.watch.prompt).toBe(false);
    });

    await test.step("/check of Bob's link: Core accepts the Give", async () => {
      const { page } = alice;
      await page.goto("/check");
      await page.getByTestId("check-input").fill(given);
      await page.getByTestId("check-run").click();
      await expect(page.getByTestId("check-core-answer")).toHaveAttribute("data-state", "done", { timeout: 30_000 });
      await expect(page.getByTestId("check-core-answer")).toHaveAttribute("data-value", "accepted");
    });

    await test.step("the Raiser pastes the link into /thank and thanks: 5 USDC land at Bob's payee", async () => {
      const { page } = raiser;
      await page.goto("/thank");
      await page.getByTestId("thank-input").fill(given);
      await page.getByTestId("thank-open").click();
      await expect(page.getByTestId("thank-predicted")).toBeVisible({ timeout: 30_000 });
      await connectIfAsked(page);
      await expect(page.getByTestId("wallet-connected").first()).toHaveAttribute("data-value", wallet.address, { timeout: 20_000 });
      await expect(page.getByTestId("thank-cost")).toContainText(/costs about/, { timeout: 30_000 });
      await expect(page.getByTestId("thank-swipe")).toBeEnabled();
      await page.getByTestId("thank-swipe").click();
      const done = page.getByTestId("thank-done");
      await expect(done).toBeVisible({ timeout: 90_000 });
      const hash = (await done.getAttribute("data-hash")) as Hex;
      const receipt = await rpc(RPC).client.getTransactionReceipt({ hash });
      expect(receipt.status).toBe("success");
      await expect(done.getByTestId("shell-explorer")).toHaveAttribute("href", `https://sepolia.basescan.org/tx/${hash}`);
      expect(await balanceOf(helperPayee)).toBe(5n * USD);
      expect((await hands(rpc(RPC), CORE, handId)).closedAt).toBeGreaterThan(0);
    });

    await test.step("/core reads Core on the fork: its code, its domain, the derivation and the served build", async () => {
      const { page } = bob;
      await page.goto("/core");
      await expect(page.getByTestId("core-address")).toHaveText(CORE);
      await expect(page.getByTestId("core-domain")).toContainText("84532", { timeout: 30_000 });
      await expect(page.getByTestId("core-cap")).toHaveAttribute("data-value", String(180 * 86_400));
      await expect(page.getByTestId("core-derivation")).toHaveAttribute("data-match", "true");
      await expect(page.getByTestId("core-absent")).toHaveCount(0);
      await expect(page.getByTestId("core-build-hash")).toBeVisible();
    });

    await test.step("the passport of the thanked Hand: every line ticks in, none failed", async () => {
      const { page } = bob;
      await page.goto(`/${CHAIN}/${handId}/proof`);
      await expect(page.getByTestId("proof-tally")).toHaveAttribute("data-done", "true", { timeout: 60_000 });
      const lines = await page.getByTestId("proof-check").evaluateAll((nodes) => nodes.map((node) => ({ id: node.getAttribute("data-value") ?? "", verdict: node.getAttribute("data-verdict") ?? "" })));
      expect(lines.length).toBeGreaterThan(5);
      for (const line of lines) expect(["ok", "not-checkable"], `${line.id} is ${line.verdict}`).toContain(line.verdict);
      expect(lines.map((line) => line.id)).toContain("give-hash");
    });

    for (const one of people) onlyRelaysOffHost(one);
  });

  test("a phone app's browser that only sets window.ethereum is offered, and connects", async ({ browser }) => {
    const phone = await person(browser, "phone", stand);
    people.push(phone);
    const address = account(2).address;
    // No EIP-6963 announcement: only window.ethereum, as many phone wallets' built-in browsers do.
    await phone.context.addInitScript(([who, chainHex]: [string, string]) => {
      (window as unknown as { ethereum: unknown }).ethereum = {
        async request({ method }: { method: string }) {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [who];
          if (method === "eth_chainId") return chainHex;
          if (method === "wallet_switchEthereumChain") return null;
          throw Object.assign(new Error(`not here: ${method}`), { code: 4200 });
        },
        on() {},
        removeListener() {},
      };
    }, [address, `0x${CHAIN.toString(16)}`] as [string, string]);
    const { page } = phone;
    await page.goto("/my");
    await page.getByTestId("connect-wallet").first().click();
    const option = page.getByTestId("kit-connect-option");
    await expect(option).toHaveCount(1);
    await expect(option).toContainText("The crypto app in this browser");
    await option.click();
    await expect(page.getByTestId("wallet-connected").first()).toHaveAttribute("data-value", address, { timeout: 20_000 });
  });
});

/**
 * Wallet kinds: how a persona's browser context gets a wallet and how the persona answers the
 * app's connect sheet. One entry per kind in WALLETS; a new kind (a smart account, say) is one
 * more entry and nothing else changes.
 *
 * Keys never enter a page. The dev wallet signs with anvil's public keys inside local builds
 * only (apps/web/src/wallet/dev.ts refuses any chain but 31337); the injected wallet forwards
 * every request to this test process, which signs (tests/e2e/lib/fork/key-wallet.ts, which itself
 * refuses any RPC not on this machine).
 */
import type { BrowserContext, Locator, Page } from "@playwright/test";
import type { Address } from "viem";

import { TID } from "../../../apps/web/src/testids";
import { account } from "../../e2e/lib/accounts";
import { FORK_WALLET_NAME, injectForkWallet } from "../../e2e/lib/fork/key-wallet";
import { BURNER_CHAIN_ID, burnerAddresses } from "./burners";
import { BURNER_WALLET_NAME, injectBurner } from "./signer";
import { approveInPrivy, privyAddress, privyWindow, signInPrivy } from "./privy";
import type { Scenario, WalletSpec } from "./scenario";
import type { World } from "./world";

export interface WalletKind<S extends WalletSpec = WalletSpec> {
  /** Before the persona's first page: inject a provider, if this kind needs one. */
  prepare(context: BrowserContext, spec: S, world: World): Promise<void>;
  /** Opens the connect sheet if it is closed and chooses this persona's wallet in it. */
  choose(page: Page, spec: S): Promise<void>;
  /** This wallet's entry in the open connect sheet, for code that waits on several prompts at once. */
  entry(page: Page, spec: S): Locator;
  /** The address this wallet answers for, or null when it has none. */
  address(spec: S): Address | null;
  /** After a press that signs: answers the wallet's own confirmation window, if this kind shows one. */
  approve?(page: Page, spec: S): Promise<void>;
  /** How this kind answers a prompt that `entry` found, when a press on the entry is not enough. */
  answer?(page: Page, spec: S): Promise<void>;
}

const none: WalletKind<{ kind: "none" }> = {
  async prepare() {},
  async choose() {
    throw new Error("this persona has no wallet: give it one in the scenario, or let it act without one");
  },
  entry(page) {
    return page.getByTestId("no-wallet-has-no-entry");
  },
  address: () => null,
};

const dev: WalletKind<{ kind: "dev"; account: 1 | 2 | 3 | 4 | 5 | "not-set-up" }> = {
  async prepare(_context, _spec, world) {
    if (world.target !== "stand") throw new Error("the dev wallet exists in local builds only: use an injected wallet on a fork or a branch site");
  },
  async choose(page, spec) {
    const entry = page.getByTestId(`${TID.wallet.devAccount}-${spec.account}`);
    const connect = page.getByTestId(TID.wallet.connect).first();
    // A sheet that is still opening shows neither for a moment: wait for whichever comes, and
    // open the sheet only when the entry is not what came (the race tests/e2e/lib/feat-raise notes).
    await entry.or(connect).first().waitFor({ timeout: 15_000 });
    if (!(await entry.isVisible())) await connect.click();
    await entry.click();
  },
  entry: (page, spec) => page.getByTestId(`${TID.wallet.devAccount}-${spec.account}`),
  address: (spec) => (spec.account === "not-set-up" ? null : (account(spec.account).address as Address)),
};

/** The kit's connect option of a wallet the browser announced by name (EIP-6963). */
async function chooseAnnounced(page: Page, name: string): Promise<void> {
  const entry = page.getByTestId(TID.kit.connectOption).filter({ hasText: name });
  const connect = page.getByTestId(TID.wallet.connect).first();
  await entry.or(connect).first().waitFor({ timeout: 15_000 });
  if (!(await entry.isVisible())) await connect.click();
  await entry.click();
}

const burner: WalletKind<{ kind: "burner"; index: number }> = {
  async prepare(context, spec, world) {
    if (world.chainId !== BURNER_CHAIN_ID) throw new Error(`burners are for Base Sepolia (a fork of it, or a branch site), not chain ${world.chainId}`);
    await injectBurner(context, world.rpcUrl, spec.index);
  },
  choose: (page) => chooseAnnounced(page, BURNER_WALLET_NAME),
  entry: (page) => page.getByTestId(TID.kit.connectOption).filter({ hasText: BURNER_WALLET_NAME }),
  address: (spec) => burnerAddresses()[spec.index - 1] ?? null,
};

const injected: WalletKind<{ kind: "injected"; account: number }> = {
  async prepare(context, spec, world) {
    await injectForkWallet(context, world.rpcUrl, world.chainId, account(spec.account).privateKey);
  },
  choose: (page) => chooseAnnounced(page, FORK_WALLET_NAME),
  entry: (page) => page.getByTestId(TID.kit.connectOption).filter({ hasText: FORK_WALLET_NAME }),
  address: (spec) => account(spec.account).address as Address,
};

/** The app's own control that opens Privy's window: "Log in" anywhere, "Log in to get paid" on Give. */
function logInControl(page: Page): Locator {
  return page.getByTestId(TID.wallet.connect).first();
}

const privyTest: WalletKind<{ kind: "privy-test"; account: number }> = {
  async prepare(_context, _spec, world) {
    if (!world.stand.privy) throw new Error("this target's build has no Privy: bring a fork up with --privy-port (an origin Privy allows), or use a branch site");
  },
  choose: (page, spec) => signInPrivy(page, spec.account, logInControl(page)),
  entry: (page) => privyWindow(page).locator("input[type=email]"),
  answer: (page, spec) => signInPrivy(page, spec.account, logInControl(page)),
  approve: async (page) => void (await approveInPrivy(page)),
  address: (spec) => privyAddress(spec.account),
};

export const WALLETS = { none, dev, injected, burner, "privy-test": privyTest } as const;

/**
 * A scenario's wallet on a target. A scenario says "test account n" (`dev`); each target has its
 * own: the app's dev wallet on the stand, anvil's key n injected on a fork (the public build has no
 * dev wallet), burner n on a branch site. DEMO_WALLETS=burner uses burners on a fork too, to
 * rehearse a site run. Kinds the target cannot have are refused here, before any browser opens.
 */
export function walletOnTarget(spec: WalletSpec, target: "stand" | "fork" | "site"): WalletSpec {
  if (spec.kind === "none") return spec;
  if (spec.kind === "privy-test") {
    if (target === "stand") throw new Error("Privy test accounts sign in on a fork with Privy or a branch site, not the stand");
    return spec;
  }
  // On a branch site every key is a burner: anvil's public keys never sign on a public network.
  const burners = target === "site" || (target === "fork" && process.env.DEMO_WALLETS === "burner");
  if (spec.kind === "burner") {
    if (target === "stand") throw new Error("burners are for Base Sepolia; the stand is chain 31337");
    return spec;
  }
  if (target === "stand") return spec;
  if (spec.kind === "injected" && !burners) return spec;
  const n = spec.account;
  if (typeof n !== "number" || n < 1 || n > 5) {
    throw new Error(`test account ${String(n)} has no stand-in on ${target}: the dev wallet's "not set up yet" account lives on the stand only`);
  }
  // Account 5's "answers differently each time" is the dev wallet's: elsewhere it is a plain key.
  if (burners) return { kind: "burner", index: n };
  return { kind: "injected", account: n };
}

export function walletOf<S extends WalletSpec>(spec: S): WalletKind<S> {
  return WALLETS[spec.kind] as unknown as WalletKind<S>;
}

/**
 * Why a scenario cannot be played with burners (DEMO_WALLETS=burner on a fork, or a branch site),
 * or undefined when it can. The SDK and seed steps act as anvil's account 1 (craft.ts, seed.ts), so
 * a Hand they raise is not the burner persona's to thank; an injected key outside 1–5 has no burner.
 */
export function burnerUnfit(scenario: Scenario): string | undefined {
  const sdk = scenario.steps.find((step) => step.do === "raise-sdk" || step.do === "pass-sdk" || step.do === "give-sdk" || step.do === "seed");
  if (sdk) return `its "${sdk.do}" step acts as anvil's account 1, not as a burner`;
  const odd = Object.values(scenario.personas).find((p) => p.wallet.kind === "injected" && (p.wallet.account < 1 || p.wallet.account > 5));
  if (odd) return `${odd.name}'s injected key ${odd.wallet.kind === "injected" ? odd.wallet.account : ""} has no burner`;
  return undefined;
}

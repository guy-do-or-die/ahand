/**
 * The scenario format of the demo engine (tests/demo/README.md). A scenario is data: who takes
 * part (personas, each with a wallet kind), what each of them does in order (steps, each one verb
 * with its arguments), what each step must leave on the screen and on the chain (`expect`), and
 * what must hold for every persona from start to end (`watch`). Nothing in a scenario names a
 * selector, a click or a sentence: test ids are `TID` paths, sentences are dictionary keys.
 *
 * The same object is three things at once:
 *   - a Playwright test (scenarios.spec.ts), run headless in CI;
 *   - a live demo (DEMO=1): headed windows side by side, captions, a director panel;
 *   - an entry of the use-case catalogue (catalogue.ts writes CATALOGUE.md from it).
 *
 * Names a scenario uses in its values:
 *   - `@name`  an address: a persona's wallet, else that persona's fresh address; or a fresh address
 *              made under that name by a payee `{ fresh: "name" }`;
 *   - `#name`  the number of the Hand a raise step made `as: "name"`;
 *   - `$core`  the target's Core.
 * Amounts are test dollars as decimal strings ("45", "2.5"); the token has 6 decimals.
 */
import type { TID } from "../../../apps/web/src/testids";
import type { WordKey } from "./words";

/** How a persona signs, if at all. New kinds plug in through wallets.ts. */
export type WalletSpec =
  /** No wallet: opens links, passes at 0%, helps with a pasted address. */
  | { kind: "none" }
  /** The app's dev wallet (local builds only): anvil's public test account 1–5 or "not-set-up". */
  | { kind: "dev"; account: 1 | 2 | 3 | 4 | 5 | "not-set-up" }
  /** anvil's public test key n as an EIP-6963 wallet; the key stays in the test process (stand or fork, never a public network). */
  | { kind: "injected"; account: number }
  /** The engine's burner n for Base Sepolia (tests/demo/burners.ts), injected the same way. */
  | { kind: "burner"; index: number }
  /** Privy test account n (engine/privy.ts): signs in through Privy's window by email and its fixed code; a fork with Privy or a branch site only. */
  | { kind: "privy-test"; account: number };

export interface Persona {
  /** Shown on the persona's window and in captions. */
  name: string;
  /** What this persona is in the story: asker, holder, helper, visitor. */
  role: "asker" | "holder" | "helper" | "visitor";
  wallet: WalletSpec;
  /**
   * The lens (the footer's switch): on by default, so the proof the checks read is on screen
   * (marks, addresses, blocks, Core's words); false keeps the calm view an ordinary person opens.
   */
  lens?: boolean;
  /** A badge colour; the engine picks one when absent. */
  color?: string;
}

export type Visibility = "public" | "unlisted" | "dark";
export type Token = "usd" | "blacklist";

/** Where a holder's share or a helper's money lands. */
export type Payee =
  /** The persona's connected wallet. */
  | "wallet"
  /** The persona's own fresh address (named after the persona), pasted into "An address I have". */
  | "fresh-address"
  /** A fresh address under its own name, for a second payee of the same persona. */
  | { fresh: string };

/** `group.element` of apps/web/src/testids.ts: "raise.up", "hand.rail", "thank.payout". */
export type TidPath = { [G in keyof typeof TID]: `${G}.${keyof (typeof TID)[G] & string}` }[keyof typeof TID];

/** A transaction's payout as Core emitted it. */
export interface Payout {
  kind: "paid" | "waiting";
  payee: string;
  amount: string;
}

/**
 * What a step must leave behind. Screen checks wait (like Playwright's expect); chain checks read
 * with eth_call after the step. Named checks (`assert`) are code in expect.ts, for invariants
 * that do not fit one line; they are listed in NAMED_CHECKS.
 */
export type Expectation =
  /** An element on the acting persona's page (or `on`'s): visible, with a sentence, attributes, a count. */
  | {
      see: TidPath;
      on?: string;
      /** A sentence of the app; with values, the whole sentence with them filled in. */
      says?: WordKey | [WordKey, Record<string, string>];
      /** A sentence it must not hold. */
      notSays?: WordKey;
      text?: string;
      attr?: Record<string, string>;
      count?: number;
      /** Enabled (true) or disabled (false), for a control. */
      enabled?: boolean;
    }
  /** A button or link with this sentence is pressed to open something (a disclosure) before the next checks. */
  | { open: WordKey; on?: string }
  /** Core's state of a Hand and the terms it holds. */
  | { hand: string; state?: "open" | "thanked" | "refunded" | "expired"; reward?: string; minClaimBps?: number; token?: Token; raiser?: string; givenBy?: string }
  /** Core's own checkRoute on an address a step carried: each pass's payee (`@name` or null) and kept share. */
  | { route: string; is: { payee: string | null; keptBps: number }[] }
  /** Core's own checkGive on a give address a step carried. */
  | { give: string; core: "accepted"; payee?: string; claimBps?: number }
  /** A token balance now, or its change since the step began. */
  | { balance: string; token?: Token; is?: string; change?: string }
  /** What Core holds for a payee (`pending`). */
  | { pending: string; token?: Token; is: string }
  /** The step's own transaction (a thank, a send-back, a delivery): Core's events in order and its payouts. */
  | { tx: { events?: string[]; payouts?: Payout[] } }
  /** The origins a persona's browser reached so far, exactly: this stand's RPC, site and relay. */
  | { origins: ("rpc" | "site" | "relay")[]; on?: string }
  /** How many Withdrawn events Core emitted for a payee in a token since the scenario began. */
  | { withdrawn: string; token?: Token; count: number }
  /** The shape of an address a step carried. */
  | { link: string; shape: "unlisted" }
  /** A named check written in code (expect.ts); `arg` is what it needs (a link name, a sentence). */
  | { assert: NamedCheck; on?: string; arg?: string };

export type NamedCheck =
  /** The raise's tx rail went sent → in-block → safe → final, each step drawn done. */
  | "raise-rail-four-states"
  /** The raised terms on the chain: raiser, 30-day window, dataHash on the screen, finalized block past the raise. */
  | "raise-terms-on-chain"
  /** The acting persona's browser asked no wallet anything and showed no wallet prompt. */
  | "no-wallet-asked"
  /** The thank's receipt rows are the predicted rows with money in them, all paid and landed, and the tx's payouts. */
  | "receipt-is-prediction"
  /** The receipt's list of events (under "What the chain recorded") is the transaction's, in order. */
  | "receipt-events-are-chain"
  /** The answer card on /my carries the giveHash of the give address `arg` (Core's own giveHash). */
  | "answer-is-the-give"
  /** The helper's tab (the acting persona) shows the asker's reply `arg` in the thread, under the helper's own words. */
  | "reply-reached-helper"
  /** The raise sent one transaction only: no approve (a Hand with no reward). */
  | "raise-sent-one-transaction"
  /** The passport's every line is done and none failed. */
  | "passport-all-ok"
  /** The Hand's end moved by `arg` days with the step (Care's extend). */
  | "expiry-moved"
  /** The address `arg` (`@name`) has code now: a smart account set up by the thank. */
  | "has-code"
  /** The address `arg` (`@name`) has no code yet. */
  | "no-code";

/** Invariants checked for every persona at the end; they need the engine's request watch. */
export type Watch =
  /** No request or socket to a host other than 127.0.0.1 (aborted and listed when tried). */
  | "local-only"
  /** No page error and no console error. */
  | "no-errors"
  /** No `#` in the address bar after a page loaded (the link's secret is taken in and removed). */
  | "no-fragment-after-load";

/**
 * One verb per step. Links between personas travel only as a person would carry them: the verb
 * that makes an address stores it under a name (`as`), and a later verb opens it (`link`).
 */
export type Action =
  | {
      do: "raise";
      title: string;
      details?: string;
      /** What the asker types in a Russian show (DEMO_LANG=ru); the English when absent. */
      titleRu?: string;
      detailsRu?: string;
      reward: "5" | "20" | "50" | { custom: string };
      days?: 7 | 30 | 90 | 180;
      visibility?: Visibility;
      /** Open "Fine-tune" before raising (to show or check the helper's floor). */
      fineTune?: boolean;
      as: string;
    }
  /**
   * A Hand raised through the SDK as dev account 1, for what the raise screen does not offer: the
   * token that can block, a payout gas setting (`gasK`, which sets how long a route may grow).
   */
  | { do: "raise-sdk"; token?: Token; reward: string; title: string; mode?: Visibility; gasK?: number; as: string }
  /**
   * Passes through the SDK, `times` times or until the route is full. Only a pass that keeps a
   * share pays out and so weighs on the thank's gas: to fill a route, keep a share (`keepBps`, paid
   * to dev account 2).
   */
  | { do: "pass-sdk"; link: string; times?: number; until?: "full"; keepBps?: number; as: string }
  /** A give through the SDK by a smart account nobody has set up yet (ERC-6492, a fresh salt); its account is named `as`. */
  | { do: "give-sdk"; link: string; undeployed: true; as: string }
  /**
   * A fixture of the stand's seed (infra/stand/seed.ts). "resigned": a Hand of 80 raised by dev
   * account 1, passed by A (keeps 5%) and B (keeps 5%), answered twice by the giver: once through
   * B (`<as>-first`) and once on a route A re-signed straight to the giver, leaving B out
   * (`<as>-second`); A's and B's addresses are named `<as>-a` and `<as>-b`.
   */
  | { do: "seed"; fixture: "resigned"; as: string }
  | { do: "open"; link: string }
  | { do: "pass"; keepBps?: number; payee?: Payee; as: string }
  /**
   * `delivery: "by-hand"` when no relay can take the answer: the page says to send it back to
   * whoever sent the link, and the give address travels by hand under `as`.
   */
  | { do: "give"; words: string; payee?: Payee; as?: string; delivery?: "relay" | "by-hand" }
  /** The asker opens /my on the device that raised, unlocks, and waits for the answer (the one with `words`, or the only one). */
  | { do: "read-answers"; hand: string; words?: string }
  /** The asker replies to the answer open on /my. */
  | { do: "reply"; words: string }
  /**
   * The asker thanks: from the answer open on /my, else from /my of `hand`, else by pasting `link`
   * on /thank. `anyway`: the route was re-signed shorter; tick every dropped holder and thank it anyway.
   */
  | { do: "thank"; hand?: string; link?: string; anyway?: boolean }
  /** The asker pastes a give address on /thank and reads the prediction, without thanking. */
  | { do: "review-thank"; link: string }
  /** The raiser adds to the reward on Care. */
  | { do: "fund"; hand: string; amount: string }
  /** The raiser keeps the Hand open longer on Care. */
  | { do: "extend"; hand: string; by: 30 | 90 | "max" }
  /** The payee (the persona's connected wallet) takes what waits for it out to another address. */
  | { do: "take-out"; token: Token; to: string }
  /** Opens a path of the app: `{chain}` and `#name` (a Hand's number) are filled in. */
  | { do: "goto"; path: string }
  /** Connects the persona's wallet on the page it is on. */
  | { do: "connect" }
  /** Reloads the persona's page. */
  | { do: "reload" }
  /** Cuts the persona's browser off the chain's RPC, or gives it back. */
  | { do: "network"; on: boolean }
  /** On My hands, under the lens: reads this device's code for the connected account, named `as`. */
  | { do: "device-code"; as: string }
  /** On another device: rebuilds a Hand's link from a device code and the Hand's number; the link is named `as`. */
  | { do: "rebuild"; code: string; hand: string; as: string }
  /** Checks a link on /check. */
  | { do: "check-link"; link: string }
  /** Opens a link on /print. */
  | { do: "print"; link: string }
  /** exit.html opened from disk, as with the site down: the persona's injected wallet thanks a give address. */
  | { do: "exit-thank"; link: string }
  | { do: "send-back" }
  /** A stranger opens /waiting for an address and delivers what waits there. */
  | { do: "deliver"; for: string; token: Token }
  /** Nothing is pressed: the persona looks (the step's `expect` says at what). */
  | { do: "look" }
  /** Moves the chain's clock (anvil) forward; the browsers keep their own clock. */
  | { do: "clock"; days: number }
  /** A fault: the BlacklistToken blocks or unblocks an address. */
  | { do: "block"; address: string; blocked: boolean }
  /** A fault: one of the stand's services stops or starts again (restarted after the scenario whatever happens). */
  | { do: "service"; service: "relay" | "site"; on: boolean }
  /** A sentence on every screen and nothing else: the narrator speaks. */
  | { do: "say" };

export type Step = Action & {
  /** Who acts; absent for "clock", "block", "service" and "say". */
  who?: string;
  /** The caption shown while the step runs; the engine writes one from the verb when absent. */
  caption?: string;
  /** The caption in Russian (DEMO_LANG=ru); the verb's Russian caption when absent. */
  captionRu?: string;
  /** What the step must leave on the screen and the chain. */
  expect?: Expectation[];
  /** Checks on the step's form, run right before its last press (the swipe). */
  form?: Expectation[];
};

/** What must hold on the chain at the end. Read with eth_call, never from the page. */
export type Check =
  | { hand: string; state: "open" | "thanked" | "refunded" | "expired" }
  /** An address (`@name` or a persona key) received exactly this many test dollars during the scenario. */
  | { received: string; amount: string; token?: Token }
  /** The asker got the whole reward back. */
  | { askerWhole: string };

export interface Scenario {
  /** Stable id: the catalogue's anchor and the test's title prefix. */
  id: string;
  title: string;
  /** One paragraph for the catalogue: why this case matters. */
  story: string;
  /** The title and story in Russian, for a show with DEMO_LANG=ru. */
  titleRu?: string;
  storyRu?: string;
  /** Use-case ids it covers: U1…U28 and the screen flows UX §…, as scenarios/use-cases.ts names them. */
  covers: string[];
  /** Targets it can run on. A scenario with clock jumps or faults cannot run on a public network. */
  targets: ("stand" | "fork" | "site")[];
  tags?: string[];
  personas: Record<string, Persona>;
  steps: Step[];
  checks: Check[];
  /** Invariants for every persona's browser (stand and fork only: they rely on 127.0.0.1). */
  watch?: Watch[];
}

const NO_ACTOR = new Set(["clock", "say", "block", "service", "pass-sdk", "give-sdk", "seed"]);
const STAND_ONLY = new Set(["block", "service", "give-sdk"]);
const LOCAL_ONLY = new Set(["clock", "block", "service", "raise-sdk", "pass-sdk", "give-sdk", "seed", "exit-thank"]);

export function defineScenario(s: Scenario): Scenario {
  for (const step of s.steps) {
    if (step.who !== undefined && !(step.who in s.personas)) throw new Error(`${s.id}: step "${step.do}" names "${step.who}", who is not a persona`);
    if (!NO_ACTOR.has(step.do) && step.who === undefined) throw new Error(`${s.id}: step "${step.do}" needs a persona`);
  }
  if (s.steps.some((step) => LOCAL_ONLY.has(step.do)) && s.targets.includes("site")) throw new Error(`${s.id}: a public network's clock, tokens and servers are not ours to move`);
  // Only the stand has the token that can block, services a scenario may switch off, and the test
  // account factory; a fork of Base Sepolia has none of them.
  const standOnly = s.steps.some((step) => STAND_ONLY.has(step.do) || ("token" in step && step.token === "blacklist"));
  if (standOnly && s.targets.some((t) => t !== "stand")) throw new Error(`${s.id}: it uses what only the stand has (the token that can block, its services, its account factory); targets: ["stand"]`);
  if (s.watch?.length && s.targets.includes("site")) throw new Error(`${s.id}: the watch relies on 127.0.0.1; a branch site is elsewhere`);
  return s;
}

/** The same story with some personas, steps or checks replaced: a variant gets its own id. */
export function variantOf(base: Scenario, patch: Partial<Scenario> & Pick<Scenario, "id" | "title">): Scenario {
  return defineScenario({ ...base, ...patch, personas: { ...base.personas, ...patch.personas } });
}

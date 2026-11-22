/**
 * A model of one Hand's life as people live it, in xstate (tests/demo/README.md, "The Hand model"). Its
 * guards are Core's own rules (contracts/src/AHandCore.sol): thank, fund and extend only before
 * the end, by the raiser; send back only after it, by anyone; a Hand closes once. What the screens
 * add: a link is passed on and answered only while the Hand is open and its time is not up.
 *
 * The context is kept small on purpose (at most two passes, one answer, one top-up, one
 * extension), so the graph of states is finite and every path through it can be played in a
 * browser: xstate/graph walks it (paths.ts), and each path becomes a scenario (generate.ts).
 */
import { assign, setup } from "xstate";

export const LIMITS = { passes: 2, gives: 1, funds: 1, extends: 1 } as const;

export interface HandContext {
  /** Holders who passed the link on, each keeping a share. */
  passes: number;
  /** Answers given on the latest link. */
  gives: number;
  funds: number;
  extends: number;
}

export type HandEvent =
  | { type: "RAISE" }
  | { type: "PASS" }
  | { type: "GIVE" }
  | { type: "FUND" }
  | { type: "EXTEND" }
  /** The chain's clock moves past the Hand's end. */
  | { type: "TIME_UP" }
  | { type: "THANK" }
  | { type: "SEND_BACK" };

export const EVENTS: HandEvent[] = ["RAISE", "PASS", "GIVE", "FUND", "EXTEND", "TIME_UP", "THANK", "SEND_BACK"].map((type) => ({ type }) as HandEvent);

export const handModel = setup({
  types: { context: {} as HandContext, events: {} as HandEvent },
  guards: {
    canPass: ({ context }) => context.passes < LIMITS.passes && context.gives === 0,
    canGive: ({ context }) => context.gives < LIMITS.gives,
    canFund: ({ context }) => context.funds < LIMITS.funds,
    canExtend: ({ context }) => context.extends < LIMITS.extends,
    answered: ({ context }) => context.gives > 0,
  },
}).createMachine({
  id: "hand",
  initial: "idea",
  context: { passes: 0, gives: 0, funds: 0, extends: 0 },
  states: {
    idea: { on: { RAISE: "open" } },
    open: {
      on: {
        PASS: { guard: "canPass", actions: assign({ passes: ({ context }) => context.passes + 1 }) },
        GIVE: { guard: "canGive", actions: assign({ gives: ({ context }) => context.gives + 1 }) },
        FUND: { guard: "canFund", actions: assign({ funds: ({ context }) => context.funds + 1 }) },
        EXTEND: { guard: "canExtend", actions: assign({ extends: ({ context }) => context.extends + 1 }) },
        THANK: { guard: "answered", target: "thanked" },
        TIME_UP: "expired",
      },
    },
    // Core: thank, fund and extend revert with Expired; refund needs it.
    expired: { on: { SEND_BACK: "refunded" } },
    thanked: { type: "final" },
    refunded: { type: "final" },
  },
});

export type HandStateName = "idea" | "open" | "expired" | "thanked" | "refunded";

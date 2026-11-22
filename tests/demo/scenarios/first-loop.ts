import { defineScenario } from "../engine/scenario";

const TITLE = "Who can lend a ladder in Batumi this weekend?";
const WORDS = "I have a three-metre ladder near the boulevard; text me and I'll bring it.";

/**
 * The first run of the whole loop through the screens (was tests/e2e/first-loop.spec.ts, PLAN gate
 * after wave 4): the asker raises an unlisted hand of 50, a holder with no wallet passes at 0%, a
 * helper answers with dev account 4, the asker thanks from My hands; the money is read back.
 */
export default defineScenario({
  id: "first-loop",
  title: "The first loop: raise, pass at 0%, answer with a wallet, thank",
  story: "Nina raises 50 test dollars. Alex, with no wallet, passes the link on for nothing. Gina answers with her wallet, and Nina thanks her from My hands: all 50 land at Gina's address.",
  covers: ["U1", "UX §7.2", "UX §7.3", "UX §8.4", "UX §8.5", "UX §7.5"],
  targets: ["stand", "fork", "site"],
  tags: ["core-loop", "gate"],
  personas: {
    nina: { name: "Nina", role: "asker", wallet: { kind: "dev", account: 1 } },
    alex: { name: "Alex", role: "holder", wallet: { kind: "none" } },
    gina: { name: "Gina", role: "helper", wallet: { kind: "dev", account: 4 } },
  },
  steps: [
    { who: "nina", do: "raise", title: TITLE, details: "Three metres is enough. I can pick it up.", reward: "50", visibility: "unlisted", as: "ladder", expect: [{ link: "ladder", shape: "unlisted" }] },
    { who: "alex", do: "open", link: "ladder", expect: [{ see: "hand.dealCard", text: TITLE }, { see: "hand.rail", attr: { "data-value": "1" } }] },
    { who: "alex", do: "pass", as: "ladder-via-alex" },
    { who: "gina", do: "open", link: "ladder-via-alex", expect: [{ see: "hand.dealCard", text: TITLE }, { see: "hand.rail", attr: { "data-value": "2" } }] },
    { who: "gina", do: "give", words: WORDS, payee: "wallet", expect: [{ see: "give.delivered", says: ["give.delivered.one", { acks: "1" }] }] },
    { who: "nina", do: "read-answers", hand: "ladder", words: WORDS },
    {
      who: "nina",
      do: "thank",
      hand: "ladder",
      form: [{ see: "wallet.connected", attr: { "data-value": "@nina" } }, { see: "thank.cost", says: "kit.cost.line" }],
      expect: [
        { hand: "ladder", state: "thanked" },
        { tx: { payouts: [{ kind: "paid", payee: "@gina", amount: "50" }] } },
        { see: "thank.payout", attr: { "data-kind": "paid", "data-payee": "@gina", "data-amount": "50000000" } },
        { balance: "@gina", change: "50" },
      ],
    },
  ],
  checks: [{ hand: "ladder", state: "thanked" }, { received: "gina", amount: "50" }],
});

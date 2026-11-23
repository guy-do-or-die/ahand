import { defineScenario } from "../engine/scenario";

const TITLE = "Who can lend a ladder in Batumi this weekend?";
const WORDS = "I have a three-metre ladder near the boulevard; text me and I'll bring it.";
const REPLY = "Thank you! Saturday at ten, by the cathedral?";
const BOOK = "Read 'The Dispossessed'; it is about exactly this.";

/**
 * The whole life of a Hand through the screens (was the e2e suite's life spec): nine parts, every part ending on Core's views, the transaction's own
 * events, Core's checkRoute and checkGive, or balances at fresh addresses (they start at zero, so
 * amounts are exact). Nobody hands anything to anybody but the addresses a person would copy.
 */
export default defineScenario({
  id: "life",
  title: "The whole life: pass at 0% and 10%, help, reply, thank, waiting money delivered, time's up, no reward",
  story:
    "Nina raises a ladder hand. Alice passes it for nothing, Bob keeps 10% for an address he pastes, Gina helps with a pasted address, and Nina replies and thanks: Bob gets 5, Gina 45. A second hand in the token that can block: Alice's share waits while her address is blocked, and Dora, a stranger, delivers it once it is unblocked. A third hand runs out of time and Vic sends it back. A fourth carries no reward and pays nothing. No browser reaches anything but this machine.",
  covers: ["uc:chain", "uc:household", "uc:zero-reward", "uc:no-disputes", "uc:blocking-token", "uc:permissionless", "uc:walletless-pass", "flow:raise", "flow:my-hands", "flow:thank", "flow:hand-view", "flow:pass-on", "flow:give", "flow:waiting"],
  targets: ["stand"],
  tags: ["life", "core-loop", "refund", "blocked-payee", "zero-reward", "clock"],
  watch: ["local-only", "no-errors", "no-fragment-after-load"],
  personas: {
    nina: { name: "Nina", role: "asker", wallet: { kind: "dev", account: 1 } },
    alice: { name: "Alice", role: "holder", wallet: { kind: "none" } },
    bob: { name: "Bob", role: "holder", wallet: { kind: "none" } },
    gina: { name: "Gina", role: "helper", wallet: { kind: "none" } },
    dora: { name: "Dora", role: "visitor", wallet: { kind: "dev", account: 3 } },
    vic: { name: "Vic", role: "visitor", wallet: { kind: "dev", account: 5 } },
  },
  steps: [
    // 1. An unlisted hand: 50 test dollars, 30 days, the helper's floor 70%; the rail's four states.
    {
      who: "nina",
      do: "raise",
      title: TITLE,
      details: "Three metres is enough. I can pick it up.",
      reward: "50",
      days: 30,
      visibility: "unlisted",
      fineTune: true,
      as: "ladder",
      form: [{ see: "raise.minClaim", attr: { "data-value": "7000" } }],
      expect: [
        { see: "raise.up", says: "raise.up" },
        { assert: "raise-rail-four-states" },
        { sdk: "ladder", state: "open" },
        { link: "ladder", shape: "unlisted" },
        // The SDK opens the raised address and Core's checkRoute takes its empty route.
        { route: "ladder", is: [] },
        { hand: "ladder", state: "open", reward: "50", minClaimBps: 7000, token: "usd", raiser: "@nina" },
        { assert: "raise-terms-on-chain" },
        { balance: "@nina", change: "-50" },
      ],
    },
    // 2. Alice, no wallet, passes at 0%: no wallet prompt, nothing but the RPC and the site.
    {
      who: "alice",
      do: "open",
      link: "ladder",
      expect: [
        { see: "hand.dealCard", text: TITLE, attr: { "data-state": "open" } },
        { see: "hand.rail", attr: { "data-value": "1" } },
      ],
    },
    {
      who: "alice",
      do: "pass",
      as: "ladder-via-alice",
      expect: [
        { assert: "no-wallet-asked" },
        { origins: ["rpc", "site"] },
        { route: "ladder-via-alice", is: [{ payee: null, keptBps: 0 }] },
        { hand: "ladder", state: "open" },
      ],
    },
    // 3. Bob, no wallet, keeps 10% for an address he pastes.
    { who: "bob", do: "open", link: "ladder-via-alice", expect: [{ see: "hand.rail", attr: { "data-value": "2" } }] },
    {
      who: "bob",
      do: "pass",
      keepBps: 1000,
      payee: { fresh: "bob-share" },
      as: "ladder-via-bob",
      expect: [
        { assert: "no-wallet-asked" },
        { route: "ladder-via-bob", is: [{ payee: null, keptBps: 0 }, { payee: "@bob-share", keptBps: 1000 }] },
        { balance: "@bob-share", is: "0" },
      ],
    },
    // 4. Gina, no wallet, helps with a pasted address: delivered to 1 of 1 relay; Core accepts the give.
    { who: "gina", do: "open", link: "ladder-via-bob", expect: [{ see: "hand.rail", attr: { "data-value": "3" } }] },
    {
      who: "gina",
      do: "give",
      words: WORDS,
      payee: { fresh: "gina-pay" },
      as: "gina-give",
      expect: [
        { see: "give.delivered", says: ["give.delivered.one", { acks: "1" }], attr: { "data-value": "1/1" } },
        { assert: "no-wallet-asked" },
        { give: "gina-give", core: "accepted", payee: "@gina-pay", claimBps: 9000 },
        { route: "gina-give", is: [{ payee: null, keptBps: 0 }, { payee: "@bob-share", keptBps: 1000 }] },
        { origins: ["rpc", "site", "relay"] },
        { hand: "ladder", state: "open" },
      ],
    },
    // 5. Nina unlocks My hands, reads Gina's words, replies and thanks; the receipt is the prediction and the chain.
    { who: "nina", do: "read-answers", hand: "ladder", words: WORDS, total: 1, expect: [{ assert: "answer-is-the-give", arg: "gina-give" }] },
    { who: "nina", do: "reply", words: REPLY },
    {
      who: "nina",
      do: "thank",
      hand: "ladder",
      expect: [
        { see: "thank.done", says: "thank.done" },
        { assert: "receipt-is-prediction" },
        {
          tx: {
            // Core's order: Thanked, each Shake with its payout, then the Give with its payout; Alice's 0% pays nothing.
            events: ["Thanked", "Shaken", "Shaken", "Paid", "Given", "Paid"],
            payouts: [
              { kind: "paid", payee: "@bob-share", amount: "5" },
              { kind: "paid", payee: "@gina-pay", amount: "45" },
            ],
          },
        },
        { balance: "@bob-share", is: "5" },
        { balance: "@gina-pay", is: "45" },
        { balance: "@nina", change: "0" },
        { hand: "ladder", state: "thanked", givenBy: "gina-give" },
        { sdk: "ladder", state: "thanked" },
      ],
    },
    // 6. Gina's tab shows the reply.
    { who: "gina", do: "look", caption: "Gina's tab shows Nina's reply", expect: [{ assert: "reply-reached-helper", arg: REPLY }, { see: "give.thread", text: WORDS }, { see: "give.thanked", says: "give.thanked" }, { balance: "@gina-pay", is: "45" }] },
    // 7. A hand in the token that can block: the blocked share waits; unblocked, a stranger delivers it.
    { who: "nina", do: "raise-sdk", token: "blacklist", reward: "20", title: "Who can find me a used cargo bike?", as: "bike" },
    { who: "alice", do: "open", link: "bike" },
    { who: "alice", do: "pass", keepBps: 1000, payee: { fresh: "blocked" }, as: "bike-via-alice" },
    { who: "bob", do: "open", link: "bike-via-alice" },
    { who: "bob", do: "give", words: "My neighbour sells one, nearly new.", payee: { fresh: "helper2" }, as: "bike-give", expect: [{ see: "give.delivered", says: ["give.delivered.one", { acks: "1" }], exact: true, attr: { "data-value": "1/1" } }] },
    { do: "block", address: "@blocked", blocked: true },
    {
      who: "nina",
      do: "thank",
      link: "bike-give",
      expect: [
        { see: "thank.payout", says: "thank.waiting", count: 1 },
        { see: "thank.payout", says: "thank.waiting", attr: { "data-kind": "waiting", "data-payee": "@blocked", "data-amount": "2000000" } },
        { tx: { payouts: [{ kind: "waiting", payee: "@blocked", amount: "2" }, { kind: "paid", payee: "@helper2", amount: "18" }] } },
        { pending: "@blocked", token: "blacklist", is: "2" },
        { balance: "@blocked", token: "blacklist", is: "0" },
        { balance: "@helper2", token: "blacklist", is: "18" },
        { hand: "bike", state: "thanked" },
      ],
    },
    { do: "block", address: "@blocked", blocked: false },
    {
      who: "dora",
      do: "deliver",
      for: "@blocked",
      token: "blacklist",
      form: [{ see: "waiting.row", attr: { "data-amount": "2000000" } }, { see: "waiting.takeOut", count: 0 }],
      expect: [
        { see: "waiting.withdrawn", attr: { "data-amount": "2000000", "data-to": "@blocked" } },
        { pending: "@blocked", token: "blacklist", is: "0" },
        { balance: "@blocked", token: "blacklist", is: "2" },
        { withdrawn: "@blocked", token: "blacklist", count: 1 },
      ],
    },
    // 8. A third hand: the chain jumps past its end; the view reads Time's up by the chain's clock; Vic sends it back.
    { who: "nina", do: "raise", title: "Who has a spare tent for one night?", reward: "5", days: 7, as: "tent", expect: [{ balance: "@nina", change: "-5" }] },
    { who: "vic", do: "open", link: "tent", expect: [{ see: "hand.dealCard", attr: { "data-state": "open" } }, { see: "hand.timesUp", count: 0 }] },
    // The browsers keep this machine's clock (40 days behind the chain); only the chain moves, and the view follows it without a reload.
    { do: "clock", days: 8, expect: [{ see: "hand.dealCard", on: "vic", attr: { "data-state": "expired" } }, { hand: "tent", state: "expired" }, { sdk: "tent", state: "expired" }] },
    {
      who: "vic",
      do: "look",
      caption: "Vic's page says Time's up: anyone can send the reward back",
      expect: [
        { see: "hand.dealCard", says: "kit.deal.timeUp" },
        { see: "hand.dealCard", says: "kit.deal.sendBack" },
        { see: "hand.timesUp", says: "hand.sendBack.title", notSays: "kit.deal.timeUp" },
        { see: "hand.pass", count: 0 },
      ],
    },
    {
      who: "vic",
      do: "send-back",
      expect: [
        { see: "hand.closed", attr: { "data-value": "refunded" } },
        { see: "hand.dealCard", says: "kit.deal.refunded" },
        { hand: "tent", state: "refunded" },
        { balance: "@nina", change: "5" },
      ],
    },
    // 9. A fourth hand with no reward: one transaction (no approve), passed, answered, thanked; Thanked and Given, no payout.
    { who: "nina", do: "raise", title: "A thank-you for a good book tip", reward: { custom: "0" }, as: "book", expect: [{ assert: "raise-sent-one-transaction" }, { hand: "book", reward: "0" }] },
    { who: "alice", do: "open", link: "book", expect: [{ see: "hand.dealCard", says: "kit.deal.noReward" }] },
    { who: "alice", do: "pass", as: "book-via-alice", form: [{ see: "pass.noReward" }, { see: "pass.slider", count: 0 }] },
    { who: "gina", do: "open", link: "book-via-alice" },
    { who: "gina", do: "give", words: BOOK, payee: { fresh: "gina-book" }, as: "book-give", expect: [{ give: "book-give", core: "accepted" }, { see: "give.delivered", says: ["give.delivered.one", { acks: "1" }], exact: true, attr: { "data-value": "1/1" } }] },
    { who: "nina", do: "read-answers", hand: "book", words: BOOK, total: 1 },
    {
      who: "nina",
      do: "thank",
      hand: "book",
      form: [{ see: "thank.noReward" }],
      expect: [
        { assert: "receipt-events-are-chain" },
        { see: "thank.payout", count: 0 },
        { see: "thank.noMoney" },
        { tx: { events: ["Thanked", "Shaken", "Given"], payouts: [] } },
        { hand: "book", state: "thanked", givenBy: "book-give" },
        { balance: "@gina-book", is: "0" },
      ],
    },
  ],
  checks: [
    { hand: "ladder", state: "thanked" },
    { hand: "bike", state: "thanked" },
    { hand: "tent", state: "refunded" },
    { hand: "book", state: "thanked" },
    { received: "@bob-share", amount: "5" },
    { received: "@gina-pay", amount: "45" },
    { received: "@blocked", amount: "2", token: "blacklist" },
    { received: "@helper2", amount: "18", token: "blacklist" },
  ],
});

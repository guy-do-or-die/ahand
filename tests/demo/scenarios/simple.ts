/**
 * Scenarios made of the verbs life uses, one use case each, so each can be shown and failed on
 * its own.
 */
import { defineScenario } from "../engine/scenario";

const nina = { name: "Nina", role: "asker", wallet: { kind: "dev", account: 1 } } as const;
const gina = { name: "Gina", role: "helper", wallet: { kind: "dev", account: 4 } } as const;
const walletless = (name: string) => ({ name, role: "holder", wallet: { kind: "none" } }) as const;

export const zeroReward = defineScenario({
  id: "zero-reward",
  title: "A thank-you only: no reward, passed, answered, thanked; nothing is paid",
  story: "Nina asks for a book tip with no reward: one transaction, no approve. Alex passes it on (there is no share to keep), Gina answers, and Nina's thank records the answer and pays nothing.",
  covers: ["uc:zero-reward", "flow:raise", "flow:thank"],
  targets: ["stand", "fork", "site"],
  tags: ["zero-reward"],
  personas: { nina, alex: walletless("Alex"), gina },
  steps: [
    { who: "nina", do: "raise", title: "A good novel about how a commune might work?", reward: { custom: "0" }, as: "book", expect: [{ assert: "raise-sent-one-transaction" }, { hand: "book", reward: "0" }] },
    { who: "alex", do: "open", link: "book", expect: [{ see: "hand.dealCard", says: "kit.deal.noReward" }] },
    { who: "alex", do: "pass", as: "book-via-alex", form: [{ see: "pass.noReward" }, { see: "pass.slider", count: 0 }] },
    { who: "gina", do: "open", link: "book-via-alex" },
    { who: "gina", do: "give", words: "Read 'The Dispossessed'; it is about exactly this.", payee: "wallet" },
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
        { balance: "@gina", change: "0" },
      ],
    },
  ],
  checks: [{ hand: "book", state: "thanked" }, { received: "gina", amount: "0" }],
});

export const branching = defineScenario({
  id: "branching",
  title: "Two holders pass the same link, two helpers answer, one is thanked",
  story:
    "Nina sends her link to Alex and to Bea. Each passes it on: Alex for nothing, Bea keeping 5%. Gina answers through Alex's branch, Hana through Bea's. Nina sees two answers and thanks Gina's: Gina gets everything, Bea's branch nothing, and the Hand is closed for Hana's answer.",
  covers: ["uc:one-give", "uc:branching", "flow:my-hands"],
  targets: ["stand", "fork", "site"],
  tags: ["branching", "one-give"],
  personas: { nina, alex: walletless("Alex"), bea: walletless("Bea"), gina, hana: { name: "Hana", role: "helper", wallet: { kind: "none" } } },
  steps: [
    { who: "nina", do: "raise", title: "Who can fix a fridge that hums all night?", reward: "20", as: "fridge" },
    { who: "alex", do: "open", link: "fridge" },
    { who: "alex", do: "pass", as: "via-alex" },
    { who: "bea", do: "open", link: "fridge", caption: "Bea opens the same link Nina sent her" },
    { who: "bea", do: "pass", keepBps: 500, payee: { fresh: "bea-share" }, as: "via-bea" },
    { who: "gina", do: "open", link: "via-alex", expect: [{ see: "hand.rail", attr: { "data-value": "2" } }] },
    { who: "gina", do: "give", words: "I repair fridges; it is the fan. Tomorrow at nine?", payee: "wallet", as: "gina-give" },
    { who: "hana", do: "open", link: "via-bea", expect: [{ see: "hand.rail", attr: { "data-value": "2" } }] },
    { who: "hana", do: "give", words: "Try levelling it first; mine stopped humming.", payee: { fresh: "hana-pay" }, as: "hana-give" },
    {
      who: "nina",
      do: "read-answers",
      hand: "fridge",
      words: "I repair fridges",
      caption: "Nina sees both answers on My hands",
      expect: [{ see: "my.answer", count: 2 }, { give: "gina-give", core: "accepted" }, { give: "hana-give", core: "accepted", claimBps: 9500 }],
    },
    {
      who: "nina",
      do: "thank",
      hand: "fridge",
      caption: "Nina thanks Gina's answer: one Give per Hand",
      expect: [
        { tx: { payouts: [{ kind: "paid", payee: "@gina", amount: "20" }] } },
        { hand: "fridge", state: "thanked", givenBy: "gina-give" },
        { balance: "@bea-share", is: "0" },
        { balance: "@hana-pay", is: "0" },
      ],
    },
  ],
  checks: [{ hand: "fridge", state: "thanked" }, { received: "gina", amount: "20" }],
});

export const hiring = defineScenario({
  id: "hiring",
  title: "A referral chain for a job: three holders keep shares",
  story:
    "Nina looks for a senior engineer with 50 test dollars. Alex and Bea each keep 5% as they pass it on, Cem keeps 10%; Gina knows the candidate. Nina's thank pays all four in one transaction: 2.5, 2.5, 5 and 40.",
  covers: ["uc:hiring", "uc:long-route", "uc:walletless-pass"],
  targets: ["stand", "fork", "site"],
  tags: ["shares", "route-length"],
  personas: { nina, alex: walletless("Alex"), bea: walletless("Bea"), cem: walletless("Cem"), gina },
  steps: [
    { who: "nina", do: "raise", title: "Who knows a senior Rust engineer open to a move to Tbilisi?", reward: "50", as: "job" },
    { who: "alex", do: "open", link: "job" },
    { who: "alex", do: "pass", keepBps: 500, payee: { fresh: "alex-share" }, as: "job-1" },
    { who: "bea", do: "open", link: "job-1" },
    { who: "bea", do: "pass", keepBps: 500, payee: { fresh: "bea-share" }, as: "job-2" },
    { who: "cem", do: "open", link: "job-2" },
    { who: "cem", do: "pass", keepBps: 1000, payee: { fresh: "cem-share" }, as: "job-3" },
    { who: "gina", do: "open", link: "job-3", expect: [{ see: "hand.rail", attr: { "data-value": "4" } }] },
    {
      who: "gina",
      do: "give",
      words: "My former colleague fits; she is looking. I'll introduce you.",
      payee: "wallet",
      as: "job-give",
      expect: [
        { give: "job-give", core: "accepted", payee: "@gina", claimBps: 8000 },
        { route: "job-give", is: [{ payee: "@alex-share", keptBps: 500 }, { payee: "@bea-share", keptBps: 500 }, { payee: "@cem-share", keptBps: 1000 }] },
      ],
    },
    {
      who: "nina",
      do: "thank",
      hand: "job",
      expect: [
        { assert: "receipt-is-prediction" },
        {
          tx: {
            payouts: [
              { kind: "paid", payee: "@alex-share", amount: "2.5" },
              { kind: "paid", payee: "@bea-share", amount: "2.5" },
              { kind: "paid", payee: "@cem-share", amount: "5" },
              { kind: "paid", payee: "@gina", amount: "40" },
            ],
          },
        },
      ],
    },
  ],
  checks: [{ hand: "job", state: "thanked" }, { received: "@alex-share", amount: "2.5" }, { received: "@bea-share", amount: "2.5" }, { received: "@cem-share", amount: "5" }, { received: "gina", amount: "40" }],
});

export const appHop = defineScenario({
  id: "app-hop-margin",
  title: "An app hop passes the link on keeping a disclosed 2.5%",
  story: "A board app, Boardly, is a hop like any person: it passes Nina's link on keeping 2.5%, which the next person sees on the rail. Gina answers; the thank pays Boardly 0.5 and Gina 19.5.",
  covers: ["uc:app-hop"],
  targets: ["stand", "fork", "site"],
  tags: ["shares", "app"],
  personas: { nina, board: { name: "Boardly", role: "holder", wallet: { kind: "none" } }, gina },
  steps: [
    { who: "nina", do: "raise", title: "Who can walk my dog on weekday mornings?", reward: "20", as: "dog" },
    { who: "board", do: "open", link: "dog" },
    { who: "board", do: "pass", keepBps: 250, payee: { fresh: "board-margin" }, as: "dog-via-board" },
    { who: "gina", do: "open", link: "dog-via-board", expect: [{ route: "dog-via-board", is: [{ payee: "@board-margin", keptBps: 250 }] }] },
    { who: "gina", do: "give", words: "I live next door and walk mine at eight.", payee: "wallet" },
    { who: "nina", do: "thank", hand: "dog", expect: [{ tx: { payouts: [{ kind: "paid", payee: "@board-margin", amount: "0.5" }, { kind: "paid", payee: "@gina", amount: "19.5" }] } }] },
  ],
  checks: [{ hand: "dog", state: "thanked" }, { received: "@board-margin", amount: "0.5" }, { received: "gina", amount: "19.5" }],
});

export const blockedPayee = defineScenario({
  id: "blocked-payee-waits",
  title: "A blocked payee's share waits in Core; a stranger delivers it once unblocked",
  story:
    "A Hand in the test token that can block addresses. Alex keeps 10% for an address the token blocks before the thank. The thank does not fail: Alex's 2 wait in Core and Gina is paid. When the token unblocks the address, Dora, a stranger, delivers what waits, and it lands at Alex's address, never anywhere else.",
  covers: ["uc:blocking-token", "uc:permissionless", "flow:waiting"],
  targets: ["stand"],
  tags: ["blocked-payee", "pending", "permissionless"],
  personas: { nina, alex: walletless("Alex"), gina, dora: { name: "Dora", role: "visitor", wallet: { kind: "dev", account: 3 } } },
  steps: [
    { who: "nina", do: "raise-sdk", token: "blacklist", reward: "20", title: "Who can find me a used cargo bike?", as: "bike" },
    { who: "alex", do: "open", link: "bike" },
    { who: "alex", do: "pass", keepBps: 1000, payee: { fresh: "alex-share" }, as: "bike-via-alex" },
    { who: "gina", do: "open", link: "bike-via-alex" },
    { who: "gina", do: "give", words: "My neighbour sells one, nearly new.", payee: "wallet", as: "bike-give" },
    { do: "block", address: "@alex-share", blocked: true },
    {
      who: "nina",
      do: "thank",
      link: "bike-give",
      expect: [
        { see: "thank.payout", says: "thank.waiting", count: 1 },
        { tx: { payouts: [{ kind: "waiting", payee: "@alex-share", amount: "2" }, { kind: "paid", payee: "@gina", amount: "18" }] } },
        { pending: "@alex-share", token: "blacklist", is: "2" },
      ],
    },
    { do: "block", address: "@alex-share", blocked: false },
    {
      who: "dora",
      do: "deliver",
      for: "@alex-share",
      token: "blacklist",
      form: [{ see: "waiting.takeOut", count: 0 }],
      expect: [{ pending: "@alex-share", token: "blacklist", is: "0" }, { balance: "@alex-share", token: "blacklist", is: "2" }, { withdrawn: "@alex-share", token: "blacklist", count: 1 }],
    },
  ],
  checks: [{ hand: "bike", state: "thanked" }, { received: "@alex-share", amount: "2", token: "blacklist" }, { received: "gina", amount: "18", token: "blacklist" }],
});

export const publicPages = defineScenario({
  id: "public-pages",
  title: "A visitor with no wallet reads the contract page and a Hand's passport",
  story: "Sam has no wallet and no link. He opens the page about the contract, which names the Core this site trusts, and the passport of the first Hand on this network, which checks itself against Core. Nothing is sent, so this runs on any target, a branch site included, with no test money.",
  covers: ["flow:proof", "flow:about-pages"],
  targets: ["stand", "fork", "site"],
  tags: ["read-only", "evidence"],
  personas: { sam: { name: "Sam", role: "visitor", wallet: { kind: "none" } } },
  steps: [
    { who: "sam", do: "goto", path: "/core", caption: "Sam opens the page about the contract", expect: [{ see: "core.address", text: "$core" }, { see: "core.absent", count: 0 }] },
    { who: "sam", do: "goto", path: "/{chain}/1/proof", caption: "Sam opens the passport of Hand 1", expect: [{ see: "proof.tally", attr: { "data-done": "true" } }] },
  ],
  checks: [],
});

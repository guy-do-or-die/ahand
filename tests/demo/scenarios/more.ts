/**
 * The catalogue's harder cases: money that waits and is taken out, Care, a re-signed route, an
 * account not set up yet, a signer that answers differently each time, a second device, a reload,
 * a lost network, the passport and Check, a full route, a printed tag, and the exit page with the
 * site down. Recipes follow the smoke specs that test each screen (tests/e2e/smoke).
 */
import { defineScenario } from "../engine/scenario";

const nina = { name: "Nina", role: "asker", wallet: { kind: "dev", account: 1 } } as const;
const gina = { name: "Gina", role: "helper", wallet: { kind: "dev", account: 4 } } as const;
const walletless = (name: string, role: "holder" | "helper" | "visitor" = "holder") => ({ name, role, wallet: { kind: "none" } }) as const;

export const takeOut = defineScenario({
  id: "take-out",
  title: "A blocked payee takes what waits for it out to another address",
  story:
    "Alex keeps 10% for his own wallet as he passes Nina's link on, in the token that can block. The token blocks Alex before the thank, so his 2 wait in Core. Alex does not wait for the token: on Waiting he takes them out to another address of his, which the token does not block.",
  covers: ["uc:blocking-token", "flow:waiting"],
  targets: ["stand"],
  tags: ["pending", "take-out", "blocked-payee"],
  personas: { nina, alex: { name: "Alex", role: "holder", wallet: { kind: "dev", account: 2 } }, gina },
  steps: [
    { who: "nina", do: "raise-sdk", token: "blacklist", reward: "20", title: "Who can repair a desk lamp from the sixties?", as: "lamp" },
    { who: "alex", do: "open", link: "lamp" },
    { who: "alex", do: "pass", keepBps: 1000, payee: "wallet", as: "lamp-via-alex", caption: "Alex passes it on, keeping 10% for his own address" },
    { who: "gina", do: "open", link: "lamp-via-alex" },
    { who: "gina", do: "give", words: "I rewire old lamps; bring it on Friday.", payee: "wallet", as: "lamp-give" },
    { do: "block", address: "@alex", blocked: true },
    { who: "nina", do: "thank", link: "lamp-give", expect: [{ pending: "@alex", token: "blacklist", is: "2" }, { tx: { payouts: [{ kind: "waiting", payee: "@alex", amount: "2" }, { kind: "paid", payee: "@gina", amount: "18" }] } }] },
    {
      who: "alex",
      do: "take-out",
      token: "blacklist",
      to: "@alex-other",
      form: [{ see: "waiting.deliver", count: 0 }],
      expect: [
        { see: "waiting.withdrawn", attr: { "data-amount": "2000000", "data-to": "@alex-other" } },
        { pending: "@alex", token: "blacklist", is: "0" },
        { balance: "@alex-other", token: "blacklist", is: "2" },
        { balance: "@alex", token: "blacklist", change: "0" },
      ],
    },
  ],
  checks: [{ hand: "lamp", state: "thanked" }, { received: "@alex-other", amount: "2", token: "blacklist" }],
});

export const care = defineScenario({
  id: "care-fund-extend",
  title: "The asker adds to the reward and keeps the Hand open longer; nobody else can",
  story: "Nina's hand gets no answer in the first days. On Care she adds 10 test dollars to the reward (every link already out there stays good) and keeps it open 30 days longer. Vic opens the same Care page: only the account that raised a hand can do that.",
  covers: ["flow:care"],
  targets: ["stand", "fork", "site"],
  tags: ["care", "fund", "extend"],
  personas: { nina, vic: { name: "Vic", role: "visitor", wallet: { kind: "dev", account: 5 } } },
  steps: [
    { who: "nina", do: "raise", title: "Who can take a boat to the islands on Sunday?", reward: "20", days: 30, as: "boat" },
    { who: "nina", do: "fund", hand: "boat", amount: "10", expect: [{ hand: "boat", reward: "30", state: "open" }, { balance: "@nina", change: "-10" }, { see: "care.fundSwipe", enabled: false }] },
    { who: "nina", do: "extend", hand: "boat", by: 30, expect: [{ assert: "expiry-moved", arg: "30" }, { hand: "boat", reward: "30" }] },
    { who: "vic", do: "goto", path: "/care/{chain}/#boat", caption: "Vic opens the same Care page", expect: [] },
    { who: "vic", do: "connect", caption: "Vic connects: only the account that raised it can change it", expect: [{ see: "care.error", attr: { "data-value": "NotRaiser" } }, { see: "care.fundSwipe", count: 0 }, { see: "care.extendSwipe", count: 0 }] },
  ],
  checks: [{ hand: "boat", state: "open" }],
});

export const resigned = defineScenario({
  id: "resigned-route",
  title: "A shorter route re-signed to leave a holder out: the asker must tick them before thanking",
  story:
    "Nina's hand was passed by A (keeping 5%) and B (keeping 5%), and the helper answered. Then A signed a shorter route straight to the helper, leaving B out, and the helper answered again. Nina saw the first answer on this device, so Thank shows the second as re-signed and names B; nothing can be sent until Nina ticks that she knows B is left out. She thanks it anyway: A gets 4, the helper 76, B nothing.",
  covers: ["uc:branching", "flow:thank"],
  targets: ["stand", "fork"],
  tags: ["resigned", "branching"],
  personas: { nina },
  steps: [
    { do: "seed", fixture: "resigned", as: "kite" },
    { who: "nina", do: "review-thank", link: "kite-first", caption: "Nina pastes the first answer: this device remembers it", expect: [{ see: "thank.resigned", count: 0 }] },
    {
      who: "nina",
      do: "thank",
      link: "kite-second",
      anyway: true,
      caption: "Nina pastes the second answer: a shorter route that leaves B out",
      form: [
        { see: "thank.resigned", says: "thank.resigned" },
        { see: "thank.dropped", count: 1 },
        { see: "thank.dropped", attr: { "data-payee": "@kite-b" } },
        { see: "thank.swipe", enabled: true },
      ],
      expect: [
        { tx: { payouts: [{ kind: "paid", payee: "@kite-a", amount: "4" }, { kind: "paid", payee: "@kite-giver", amount: "76" }] } },
        { hand: "kite", state: "thanked", givenBy: "kite-second" },
        { balance: "@kite-b", change: "0" },
      ],
    },
  ],
  checks: [{ hand: "kite", state: "thanked" }],
});

export const notSetUp = defineScenario({
  id: "not-set-up-helper",
  title: "A helper whose smart account is not set up yet; the thank sets it up first",
  story:
    "Gina answers from a smart account that has no code on this network yet (ERC-6492). Core accepts her answer with its setup. Nina's Thank says so: two steps, the first sets up Gina's account, the second says thanks, with one swipe. Afterwards the account exists and holds the reward.",
  covers: ["uc:smart-wallets", "flow:thank"],
  targets: ["stand"],
  tags: ["erc-6492", "smart-account"],
  personas: { nina, alex: walletless("Alex") },
  steps: [
    { who: "nina", do: "raise", title: "Who can lend a projector for Friday night?", reward: "20", as: "tv" },
    { who: "alex", do: "open", link: "tv" },
    { who: "alex", do: "pass", as: "tv-via-alex" },
    { do: "give-sdk", link: "tv-via-alex", undeployed: true, as: "gina-account", caption: "Gina answers from a smart account nobody has set up yet", expect: [{ assert: "no-code", arg: "@gina-account", on: "nina" }] },
    {
      who: "nina",
      do: "thank",
      link: "gina-account",
      form: [{ see: "thank.setupBand", says: "thank.setup" }, { see: "thank.twoSteps" }],
      expect: [{ see: "thank.spent", attr: { "data-status": "read", "data-count": "2" } }, { assert: "has-code", arg: "@gina-account" }, { hand: "tv", state: "thanked", givenBy: "gina-account" }],
    },
  ],
  checks: [{ hand: "tv", state: "thanked" }, { received: "@gina-account", amount: "20" }],
});

export const entropySigner = defineScenario({
  id: "entropy-signer",
  title: "A signer that answers differently each time must save the link",
  story:
    "Vic's wallet signs differently every time (passkeys, MPC and many smart wallets do). The app cannot rebuild Vic's link later, so after the raise it keeps a locked copy and asks Vic to save the link. Vic copies it and ticks I saved the link; the copy on the device is gone, and the link Vic saved opens the Hand.",
  covers: ["flow:raise", "uc:smart-wallets"],
  targets: ["stand"],
  tags: ["signer", "locked-copy"],
  personas: { vic: { name: "Vic", role: "asker", wallet: { kind: "dev", account: 5 } }, alex: walletless("Alex") },
  steps: [
    { who: "vic", do: "raise", title: "Who can recommend a quiet café to work from?", reward: "5", as: "cafe", expect: [{ see: "raise.copyGone" }, { hand: "cafe", state: "open", raiser: "@vic" }] },
    { who: "alex", do: "open", link: "cafe", caption: "The link Vic saved opens the Hand", expect: [{ see: "hand.rail", attr: { "data-value": "1" } }] },
  ],
  checks: [{ hand: "cafe", state: "open" }],
});

export const rebuild = defineScenario({
  id: "rebuild-other-device",
  title: "My hands on a second device: the link rebuilt from the device code",
  story: "Nina raised on her laptop. On her phone, with the same wallet, she enters the laptop's device code and the Hand's number: My hands rebuilds the link (without its words, which are never on the chain), and it opens the Hand.",
  covers: ["flow:my-hands"],
  targets: ["stand", "fork", "site"],
  tags: ["devices", "my-hands"],
  personas: { nina, phone: { name: "Nina's phone", role: "asker", wallet: { kind: "dev", account: 1 } } },
  steps: [
    { who: "nina", do: "raise", title: "Who can lend a tent for the mountains?", reward: "5", as: "tent" },
    { who: "nina", do: "device-code", as: "laptop-code" },
    { who: "phone", do: "rebuild", code: "laptop-code", hand: "tent", as: "tent-rebuilt", expect: [{ see: "my.rebuildResult", says: "my.lens.rebuildWhy" }] },
    { who: "phone", do: "open", link: "tent-rebuilt", expect: [{ route: "tent-rebuilt", is: [] }] },
  ],
  checks: [{ hand: "tent", state: "open" }],
});

export const reloadForgets = defineScenario({
  id: "reload-forgets",
  title: "A reload forgets the link: the tab said so",
  story: "Alex opens Nina's link: the page says the link lives in this tab only. He reloads anyway. The unlisted Hand still shows its public face, but passing on and helping need the link again; a dark one shows nothing at all.",
  covers: ["flow:hand-view", "uc:dark"],
  targets: ["stand", "fork", "site"],
  tags: ["reload", "dark"],
  personas: { nina, alex: walletless("Alex") },
  steps: [
    { who: "nina", do: "raise", title: "Who can lend a bike pump today?", reward: "5", as: "pump" },
    { who: "alex", do: "open", link: "pump", expect: [{ see: "hand.tabOnly" }, { see: "hand.pass", enabled: true }] },
    { who: "alex", do: "reload", expect: [{ see: "hand.noLink", says: "hand.noLink" }, { see: "hand.pass", count: 0 }, { see: "hand.help", count: 0 }] },
    { who: "nina", do: "raise", title: "Who can lend a ladder, quietly?", reward: "5", visibility: "dark", as: "dark-ladder" },
    { who: "alex", do: "open", link: "dark-ladder" },
    { who: "alex", do: "reload", expect: [{ see: "shell.main", says: "hand.nothing.title" }, { see: "hand.dealCard", count: 0 }] },
  ],
  checks: [{ hand: "pump", state: "open" }],
});

export const offline = defineScenario({
  id: "offline-rpc",
  title: "The network drops: the Hand claims nothing, offers nothing, and comes back by itself",
  story: "Alex has Nina's Hand open when his network drops. The page says when it last read the chain and that things may have changed, and it greys out passing on and helping. When the network is back, the Hand is open again without a reload.",
  covers: ["flow:hand-view"],
  targets: ["stand", "fork", "site"],
  tags: ["offline", "fail-closed"],
  personas: { nina, alex: walletless("Alex") },
  steps: [
    { who: "nina", do: "raise", title: "Who has a spare umbrella near the station?", reward: "5", as: "umbrella" },
    { who: "alex", do: "open", link: "umbrella", expect: [{ see: "hand.dealCard", attr: { "data-state": "open" } }] },
    { who: "alex", do: "network", on: false, expect: [{ see: "hand.offline", says: "hand.offline" }, { see: "hand.pass", enabled: false }, { see: "hand.help", enabled: false }] },
    { who: "alex", do: "network", on: true, expect: [{ see: "hand.dealCard", attr: { "data-state": "open" } }, { see: "hand.pass", enabled: true }, { see: "hand.offline", count: 0 }] },
  ],
  checks: [{ hand: "umbrella", state: "open" }],
});

export const proofAndCheck = defineScenario({
  id: "proof-and-check",
  title: "A stranger checks a thanked Hand's passport and the answer's link",
  story: "After Nina thanked Gina, Sam, who took no part, opens the Hand's passport: every line checks against Core, and the giveHash matches. Then he pastes Gina's answer on Check and sees, step by step, what Core says of it.",
  covers: ["flow:proof"],
  targets: ["stand", "fork", "site"],
  tags: ["proof", "check", "evidence"],
  personas: { nina, alex: walletless("Alex"), gina, sam: walletless("Sam", "visitor") },
  steps: [
    { who: "nina", do: "raise", title: "Who can recommend a vet for a cat?", reward: "20", as: "cat" },
    { who: "alex", do: "open", link: "cat" },
    { who: "alex", do: "pass", keepBps: 500, payee: "fresh-address", as: "cat-via-alex" },
    { who: "gina", do: "open", link: "cat-via-alex" },
    { who: "gina", do: "give", words: "Dr. Beridze on Pekini street is gentle with cats.", payee: "wallet", as: "cat-give" },
    { who: "nina", do: "thank", hand: "cat" },
    { who: "sam", do: "goto", path: "/{chain}/#cat/proof", caption: "Sam opens the Hand's passport", expect: [{ assert: "passport-all-ok" }, { see: "proof.givehashMatches" }] },
    { who: "sam", do: "check-link", link: "cat-give", expect: [{ see: "check.handState", attr: { "data-value": "thanked" } }, { see: "check.passport" }] },
  ],
  checks: [{ hand: "cat", state: "thanked" }],
});

export const routeFull = defineScenario({
  id: "route-full",
  title: "A route at its length limit: no more passes, but anyone on it can still help",
  story:
    "Nina's Hand is raised with a high payout gas setting, so few passes fit one thank. The link travels until the route is full. Gina, at the end of it, reads that it can't go further; passing on is greyed out, helping is not. She helps, and Nina's thank fits.",
  covers: ["uc:long-route"],
  targets: ["stand", "fork"],
  tags: ["route-length", "gas"],
  personas: { nina, gina },
  steps: [
    { who: "nina", do: "raise-sdk", reward: "20", title: "Who can carry a sofa up four floors?", gasK: 5000, as: "sofa" },
    { do: "pass-sdk", link: "sofa", until: "full", keepBps: 100, as: "sofa-full" },
    { who: "gina", do: "open", link: "sofa-full", expect: [{ see: "hand.passesLeft", attr: { "data-value": "0" }, says: "hand.passesNone" }, { see: "hand.pass", enabled: false }, { see: "hand.help", enabled: true }] },
    { who: "gina", do: "give", words: "Two of us can do it on Saturday morning.", payee: "wallet", as: "sofa-give" },
    { who: "nina", do: "thank", link: "sofa-give", expect: [{ hand: "sofa", state: "thanked" }, { assert: "receipt-is-prediction" }] },
  ],
  checks: [{ hand: "sofa", state: "thanked" }],
});

export const lostAndFound = defineScenario({
  id: "lost-and-found-tag",
  title: "Lost and found: a dark Hand printed as a tag; a finder scans it and answers",
  story: "Nina prints a dark Hand with no reward as a small tag for her keys. Fred finds the keys, scans the tag (the link opens the Hand; nothing about it was ever public) and answers with an address he pastes. Nina thanks him.",
  covers: ["uc:lost-and-found", "uc:zero-reward", "uc:dark", "flow:about-pages"],
  targets: ["stand", "fork", "site"],
  tags: ["dark", "print", "zero-reward"],
  personas: { nina, fred: walletless("Fred", "helper") },
  steps: [
    { who: "nina", do: "raise", title: "Found these keys? They are mine.", reward: { custom: "0" }, visibility: "dark", as: "keys" },
    { who: "nina", do: "print", link: "keys", expect: [{ see: "print.tag", says: "print.tag.found" }, { see: "print.tooDense", count: 0 }] },
    { who: "fred", do: "open", link: "keys", caption: "Fred scans the tag", expect: [{ see: "hand.dealCard", says: "kit.deal.noReward" }] },
    { who: "fred", do: "give", words: "Found them by the fountain; I left them at the café counter.", payee: "fresh-address" },
    { who: "nina", do: "thank", hand: "keys", expect: [{ tx: { events: ["Thanked", "Given"], payouts: [] } }] },
  ],
  checks: [{ hand: "keys", state: "thanked" }],
});

export const exitWithoutSite = defineScenario({
  id: "site-down-exit",
  title: "The site is down: the asker thanks from the exit page opened as a file",
  story: "Nina's Hand was answered. Then the site goes down. Nina opens exit.html, the one-file page she saved, straight from disk with her wallet; she pastes Gina's answer and thanks. Gina is paid without the site.",
  covers: ["uc:exit"],
  targets: ["stand"],
  tags: ["exit", "fault", "site"],
  personas: { nina: { name: "Nina", role: "asker", wallet: { kind: "injected", account: 1 } }, alex: walletless("Alex"), gina },
  steps: [
    { who: "nina", do: "raise", title: "Who can lend a drill for an hour?", reward: "20", as: "drill" },
    { who: "alex", do: "open", link: "drill" },
    { who: "alex", do: "pass", as: "drill-via-alex" },
    { who: "gina", do: "open", link: "drill-via-alex" },
    { who: "gina", do: "give", words: "I have one; come by at six.", payee: "wallet", as: "drill-give" },
    { do: "service", service: "site", on: false, caption: "The site goes down" },
    { who: "nina", do: "exit-thank", link: "drill-give", expect: [{ tx: { payouts: [{ kind: "paid", payee: "@gina", amount: "20" }] } }, { hand: "drill", state: "thanked", givenBy: "drill-give" }] },
    { do: "service", service: "site", on: true, caption: "The site is back" },
  ],
  checks: [{ hand: "drill", state: "thanked" }, { received: "gina", amount: "20" }],
});

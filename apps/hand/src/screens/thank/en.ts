// The thank screen's words in English (UX-SPEC §7.5). Keys are dotted ids; ru.ts has the same keys.
// Keys with a `lens` segment are the specialist layer: Core's own names in mono are allowed there.
const en = {
  "thank.title": "Thank.",
  "thank.lead": "When someone can help, what they send back comes here. Paste it, and it is checked before anything else.",
  "thank.input.label": "What came back to you",
  "thank.input.placeholder": "https://…/#…",
  "thank.input.hint": "An address that ends in #… — from a message, or from My hands.",
  "thank.open": "Check it",
  "thank.again": "Check another",
  "thank.checking": "Checking this answer with the contract…",

  // Errors before anything is sent
  "thank.error.notGive": "This is a hand's own link, not an answer to it. Open it from the start page.",
  "thank.error.noForwarder":
    "The helper's account isn't set up on this network yet, and this site has no way to set it up without acting in your name. Ask the helper to answer again from an address they already use.",
  "thank.error.checkFailed": "The contract couldn't check this. Nothing was sent.",
  "thank.error.closed": "This hand is already closed.",
  "thank.error.thankedOther": "This hand was already thanked for another answer.",

  // Step 2 passed
  "thank.checked": "This answer checks out: everyone who passed it on is counted, and the helper confirmed it.",
  "thank.lens.checked": "checkGive · eth_call · block {block} · ok",
  "thank.lens.checkedSetup": "checkGive through the forwarder, setup counted in · block {block} · ok",
  "thank.lens.giveHash": "giveHash {hash}",
  "thank.lens.firstSeen": "First seen on this device {time}",

  // Re-signed (R-29)
  "thank.resigned":
    "This answer came by a shorter route than one you already saw. It drops: {holders}. Thanking it pays them nothing.",
  "thank.resigned.tick": "I know they're left out",
  "thank.resigned.share": "kept {share}",
  "thank.resigned.noShare": "kept nothing",
  "thank.resigned.anyway": "Thank this route anyway",
  "thank.resigned.overridden": "You chose to thank this route anyway.",
  "thank.branch": "Another answer came for this hand by a different route. Both routes are fair; you choose which one to thank.",

  // Payees
  "thank.payee.core": "That address is the contract itself; money sent there waits forever.",
  "thank.payee.raiser": "One share on this route lands at your own address.",
  "thank.key.raiser": "Pass {n} on this route handed the link to a key at your own address.",
  "thank.payee.token": "One share on this route lands at the token's own address, which usually keeps what it gets.",

  // Fit
  "thank.tooLong": "This route is too long to thank in one go.",
  // The worst case is never sent as the limit: the send carries no gas of its own (wallet/send.ts),
  // so the account's app estimates it. The line says so, so the number is not read as the cost.
  "thank.lens.fit":
    "Worst case {gas} gas · {bytes} bytes of calldata · limit 16 777 216 gas. The worst case is used only to check that this route fits one transaction; your wallet's own estimate is what is sent.",

  // An account not set up yet (R-28, D-62)
  "thank.setup": "The helper's account isn't set up on this network yet. Saying thanks sets it up first.",
  "thank.twoSteps":
    "Two steps: the first sets up the helper's account, the second says thanks. If you stop after the first, only its cost is spent.",
  "thank.lens.factory": "Factory {factory}",
  "thank.lens.setupRuns": "Setup runs through {forwarder} · not in your name",

  // Who gets what
  "thank.predicted.title": "Who gets what",
  "thank.predicted.note": "Worked out here from who passed it on and the reward held now.",
  "thank.predicted.passed": "Passed it on",
  "thank.predicted.helper": "Helped",
  "thank.predicted.formula": "how it's counted",
  "thank.predicted.total": "The whole reward",
  "thank.predicted.waitsIfBlocked":
    "If a payment can't get through, it is held until whoever it belongs to takes it, or anyone delivers it to them.",
  "thank.noReward": "This hand has no reward, so saying thanks moves no money. It closes the hand and records who helped.",
  "thank.lens.shakeFormula": "{reward} × {bps} ÷ 10 000 = {amount}",
  "thank.lens.giveFormula": "{reward} − {paid} = {amount} · claim {bps} bps",

  // The action
  "thank.warning": "Saying thanks pays the helper and everyone who passed it on. It can't be undone.",
  "thank.warning.noReward": "Saying thanks closes this hand for good. It can't be undone.",
  "thank.swipe": "Say thanks",
  "thank.connect": "To say thanks, connect the account that raised this hand.",
  "thank.costChecking": "Working out what it costs…",
  "thank.step": "Step {step} of {of}",
  "thank.step.setup": "Setting up the helper's account",
  "thank.step.thanks": "Saying thanks",

  // After
  // Never "who got what": Paid is what left the contract, and a token that takes its own cut
  // delivers less (brief 02, duty 19). A payout is the word for a Paid and for a Pending alike.
  "thank.done": "Thanked. Here's every payout — straight from the chain.",
  "thank.done.before": "This hand was thanked for this answer. Here's every payout — straight from the chain.",
  "thank.left": "{amount} left the contract for {payee}",
  "thank.waiting": "{amount} is waiting for {payee}",
  "thank.done.calm": "Thanked. Here is every payout.",
  "thank.done.before.calm": "This hand was already thanked for this answer. Here is every payout.",
  "thank.waiting.calm": "{amount} is held until the one it belongs to takes it.",
  "thank.waiting.why": "Their payout couldn't move, so it waits in the contract. They can take it out, or anyone can deliver it to them.",
  "thank.noMoney": "No money moved: this hand had no reward.",
  "thank.lens.events": "What the chain recorded",
  "thank.lens.event": "{event} · block {block} · log {index}",

  // What it cost, from the receipt (the contract takes nothing; this went to the network)
  "thank.spent": "Saying thanks cost about ${usd} · prices of {date}",
  "thank.spent.steps": "Both steps together cost about ${usd} · prices of {date}",
  "thank.spent.calm": "Saying thanks cost about ${usd}",
  "thank.spent.steps.calm": "Both steps together cost about ${usd}",
  "thank.spent.reading": "Reading what it cost from the network…",
  "thank.spent.unread": "Couldn't read what it cost from the network just now.",
  "thank.lens.tx": "The transaction",
  "thank.lens.tx.hash": "tx {hash}",
  "thank.lens.tx.from": "from {from}",
  "thank.lens.tx.block": "block {block} · {time}",
  "thank.lens.tx.blockOnly": "block {block}",
  "thank.lens.tx.gas": "gas used {gas} · effective price {gwei} gwei",
  "thank.lens.tx.l1": "L1 data fee {eth} ETH",
  "thank.lens.tx.fee": "fee {eth} ETH · ${usd} at ETH ${ethUsd} · prices of {date}",
  "thank.lens.tx.local": "Local test network: test ETH, at this chain's own price",
  "thank.proof": "See the proof",
  "thank.withoutUs": "Do it without us",
  "thank.withoutUs.lead": "The same call, for a terminal with Foundry's cast. Add how you confirm it: --ledger, --account or --private-key.",
  "thank.withoutUs.page": "All the ways to do it without this site",
  "thank.notConfirmed": "The network took it, but its record doesn't show every payment this route promised. Look at the proof before you trust it.",

  // Failures after asking
  "thank.reverted": "The network refused it.",
  "thank.reverted.kept": "The reward is still in the contract; only the cost of trying was spent.",
  "thank.firstStepOnly": "The helper's account is set up; the thanks didn't go. Only the first step's cost was spent.",
  "thank.onWay": "A thanks sent from this device is on its way: hand {id}. Nothing is sent again.",
  "thank.onWay.done": "That thanks went through: hand {id}.",
  "thank.onWay.open": "See what was sent to whom",
};

export default en;

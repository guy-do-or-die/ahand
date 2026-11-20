// The thank screen's words in English (UX-SPEC §7.5). Keys are dotted ids; ru.ts has the same keys.
// Keys with a `lens` segment are the specialist layer: Core's own names in mono are allowed there.
const en = {
  "thank.title": "Thank.",
  "thank.lead": "When someone can help, what they send back comes here. Paste it, and the contract checks it before anything else.",
  "thank.input.label": "What came back to you",
  "thank.input.placeholder": "https://…/#…",
  "thank.input.hint": "An address that ends in #… — from a message, or from My hands.",
  "thank.open": "Check it",
  "thank.again": "Check another",
  "thank.checking": "Checking this with the contract…",

  // Errors before anything is sent
  "thank.error.notGive": "This is a hand's own link, not someone's reply to it. Open it from the start page.",
  "thank.error.noForwarder":
    "The helper's account isn't set up on this network yet, and this site has no way to set it up without acting in your name. Ask the helper to reply from an address they already use.",
  "thank.error.checkFailed": "The contract couldn't check this. Nothing was sent.",
  "thank.error.notRaiser": "Only the account that raised this hand can say thanks. Connect that one.",
  "thank.error.closed": "This hand is already closed.",
  "thank.error.thankedOther": "This hand was already thanked for another reply.",

  // Step 2 passed
  "thank.checked": "The contract checked this reply: the route adds up and the helper confirmed it.",
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
  "thank.resigned.earlier": "Seen earlier on this device: {time}",
  "thank.branch": "Another reply came for this hand by a different path. Both paths are fair; you choose which one to thank.",

  // Payees
  "thank.payee.core": "That address is the contract itself; money sent there waits forever.",
  "thank.payee.raiser": "One share on this route lands at your own address.",
  "thank.payee.token": "One share on this route lands at the token's own address, which usually keeps what it gets.",

  // Fit
  "thank.tooLong": "This route is too long to thank in one go.",
  "thank.lens.fit": "Worst case {gas} gas · {bytes} bytes of calldata · limit 16 777 216 gas",

  // An account not set up yet (R-28, D-62)
  "thank.setup": "The helper's account isn't set up on this network yet. Saying thanks sets it up first.",
  "thank.twoSteps":
    "Two steps: the first sets up the helper's account, the second says thanks. If you stop after the first, only its cost is spent.",
  "thank.lens.factory": "Factory {factory}",
  "thank.lens.setupRuns": "Setup runs through {forwarder} · not in your name",

  // Who gets what
  "thank.predicted.title": "Who gets what",
  "thank.predicted.note": "Worked out here from the route and the reward the contract holds now.",
  "thank.predicted.passed": "Passed it on",
  "thank.predicted.helper": "Helped",
  "thank.predicted.keptNothing": "kept nothing",
  "thank.predicted.formula": "how it's counted",
  "thank.predicted.total": "The whole reward",
  "thank.predicted.waitsIfBlocked": "If a payout can't move, it waits in the contract for its owner to take out.",
  "thank.noReward": "This hand has no reward, so saying thanks moves no money. It closes the hand and records who helped.",
  "thank.lens.shakeFormula": "{reward} × {bps} ÷ 10 000 = {amount}",
  "thank.lens.giveFormula": "{reward} − {paid} = {amount} · claim {bps} bps",

  // The action
  "thank.warning": "Saying thanks pays everyone on this route. It can't be undone.",
  "thank.warning.noReward": "Saying thanks closes this hand for good. It can't be undone.",
  "thank.swipe": "Say thanks",
  "thank.connect": "To say thanks, connect the account that raised this hand.",
  "thank.costRefused": "The contract would refuse this now:",
  "thank.costChecking": "Working out what it costs…",
  "thank.step": "Step {step} of {of}",
  "thank.step.setup": "Setting up the helper's account",
  "thank.step.thanks": "Saying thanks",
  "thank.step.waiting": "Waiting for the network…",

  // After
  "thank.done": "Thanked. Here's who got what — straight from the chain.",
  "thank.done.before": "This hand was thanked for this reply. Here's who got what — straight from the chain.",
  "thank.left": "{amount} left the contract for {payee}",
  "thank.waiting": "{amount} is waiting for {payee}",
  "thank.waiting.why": "Their payout couldn't move, so it waits in the contract. They can take it out, or anyone can deliver it to them.",
  "thank.noMoney": "No money moved: this hand had no reward.",
  "thank.lens.events": "What the chain recorded",
  "thank.lens.event": "{event} · block {block} · log {index}",
  "thank.proof": "See the proof",
  "thank.withoutUs": "Do it without us",
  "thank.withoutUs.lead": "The same call, for a terminal with Foundry's cast. Add how you confirm it: --ledger, --account or --private-key.",
  "thank.withoutUs.page": "All the ways to do it without this site",
  "thank.notConfirmed": "The network took it, but its record doesn't show every payment this route promised. Look at the proof before you trust it.",

  // Failures after asking
  "thank.reverted": "The network refused it.",
  "thank.firstStepOnly": "The helper's account is set up; the thanks didn't go. Only the first step's cost was spent.",
  "thank.resumed": "A thanks for this reply was sent from this device. Following it…",
};

export default en;

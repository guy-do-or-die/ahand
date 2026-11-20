// The hand screen's words in English (UX-SPEC §8.1–8.3, §15). Keys are dotted ids; ru.ts has the
// same keys. Shared words (the verbs, "Checking the link…", the link and Core sentences of §12)
// live in i18n/common and are used from there.
const en = {
  "hand.title": "A hand.",
  "hand.helpNote": "The asker decides whether to thank. If they don't by {date}, the reward goes back to them.",
  "hand.helpNote.noReward": "The asker decides whether to thank. If they don't by {date}, the hand closes.",
  "hand.handsSoFar": "{n, plural, one {# hand so far.} other {# hands so far.}}",
  "hand.passesLeft": "Room for {n, plural, one {# more pass} other {# more passes}}.",
  "hand.passesNone": "This route can't go further. You can still help.",
  "hand.noLink": "To pass it on or help, open the link you were sent.",
  "hand.nothing.title": "No link here.",
  "hand.nothing.body": "A hand opens from the link you were sent. Paste it on the start page, or open the message it came in.",
  "hand.toStart": "To the start",
  "hand.addressed": "This link shows a route that ends at an address. It can't be passed on or answered from here.",

  "hand.offline.kept": "Your link is still here.",
  "hand.offline.retry": "Try again",
  "hand.offline.auto": "Trying again on its own every few seconds.",

  "hand.closed": "This hand is closed.",
  "hand.receipt.reading": "Reading how it ended from the chain's own records…",
  "hand.receipt.failed": "Can't read how it ended right now. The hand is closed all the same.",
  "hand.newer.look": "Look for a newer hand by this asker",
  "hand.newer.meta": "Reads the {span} of the network after this hand ended: {n, plural, one {# request} other {# requests}}.",
  "hand.newer.minutes": "{n, plural, one {# minute} other {# minutes}}",
  "hand.newer.hours": "{n, plural, one {# hour} other {# hours}}",
  "hand.newer.reading": "Reading… {done} of {n}",
  "hand.newer.stop": "Stop",
  "hand.newer.stopped": "Stopped after {done} of {n}. What was found so far stays here.",
  "hand.newer.failed": "Can't reach the network right now. What was found so far stays here.",
  "hand.newer.found": "The same address raised hand {number} later.",
  "hand.newer.foundMany": "The same address raised {count} hands later.",
  "hand.newer.open": "Hand {number}",
  "hand.newer.ownLink": "It has its own link. Ask whoever sent you this one.",
  "hand.newer.none": "Nothing newer in that stretch.",
  "hand.askSender": "Ask whoever sent you the link whether there is a newer one.",

  "hand.give.holder": "Someone answered this hand. Pass it back to whoever sent you the link.",
  "hand.give.raiser": "This is an answer to your hand.",
  "hand.give.toThank": "Open the answer",
  "hand.give.mine": "Did you raise this hand? Connect the account that raised it to read the answer.",

  "hand.timesUp": "Time's up. Anyone can send the reward back to the asker now.",
  "hand.timesUp.noReward": "Time's up. Anyone can close this hand now.",
  "hand.sendBack.noReward": "Close this hand",
  "hand.sendBack.needs": "Any connected account can do it. The reward goes back to the asker, whoever presses.",
  "hand.sendBack.cannot": "This account can't send anything yet. Connect another one.",
  "hand.sendBack.checking": "Trying it against the network first…",
  "hand.sendBack.done": "The reward went back.",
  "hand.sendBack.doneNoReward": "This hand is closed.",

  "hand.evidence": "What this link proves",
  "hand.lens.link": "Link · {kind} · {shakes, plural, one {# pass} other {# passes}} · shape {shape}",
  "hand.lens.claim": "checkRoute here · claimBps left {claim} · minClaimBps {min} · last key {key}",
  "hand.lens.data": "hands({id}).dataHash = {hash}",
  "hand.lens.passes": "passesLeft = {n} · payoutGasK {k}",
  "hand.lens.terms": "raiser {raiser} · token {token} · rootKey {root}",
  "hand.lens.statements": "Added by a holder, not the asker",
  "hand.lens.statementAt": "Pass {n}",
  "hand.lens.statementGive": "The answer",
};

export default en;

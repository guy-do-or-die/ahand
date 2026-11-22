// The hand screen's words in English. Keys are dotted ids; ru.ts has the
// same keys. Shared words (the verbs, "Checking the link…", the link and Core sentences)
// live in i18n/common and are used from there.
const en = {
  "hand.title": "A hand.",
  "hand.helpNote": "The asker decides whether to thank. If they don't by {date}, the reward goes back to them.",
  "hand.helpNote.noReward": "The asker decides whether to thank. If they don't by {date}, the hand closes.",
  "hand.soFar": "{n, plural, =0 {So far only the asker.} other {So far: the asker and # more.}}",
  "hand.passesLeft": "Room for {n, plural, one {# more pass} other {# more passes}}.",
  "hand.passesNone": "This route can't go further. You can still help.",
  "hand.noLink": "To pass it on or help, open the link you were sent.",
  "hand.nothing.title": "No link here.",
  "hand.nothing.body": "A hand opens from the link you were sent. Paste it on the start page, or open the message it came in.",
  "hand.toStart": "To the start",
  "hand.addressed": "This link shows a route that ends at an address. It can't be passed on or answered from here.",

  "hand.offline.auto": "Trying again on its own every few seconds.",

  "hand.closed": "This hand is closed.",
  "hand.receipt.reading": "Reading how it ended from the chain's own records…",
  "hand.receipt.failed": "Can't read how it ended right now. The hand is closed all the same.",
  "hand.newer.look": "Look for a newer hand by this asker",
  "hand.newer.meta": "Reads {n, plural, one {the one hand} other {the # hands}} raised after this one ({k, plural, one {# request} other {# requests}}). Any of them by the same address counts, even one raised while this one was still open.",
  "hand.newer.metaCapped": "Reads the newest {n, plural, one {# hand} other {# hands}} of the {total, plural, other {#}} raised after this one ({k, plural, one {# request} other {# requests}}). Any of them by the same address counts, even one raised while this one was still open.",
  "hand.newer.nothingAfter": "No hand has been raised after this one yet.",
  "hand.newer.countOffline": "Can't reach the network right now, so the hands raised after this one can't be counted.",
  "hand.newer.countRefused": "The network refused to count the hands raised after this one.",
  "hand.newer.retry": "Try again",
  "hand.newer.reading": "Reading… {done} of {n}",
  "hand.newer.stop": "Stop",
  "hand.newer.stopped": "Stopped after {done} of {n}. What was found so far stays here.",
  "hand.newer.failed": "Can't reach the network right now. What was found so far stays here.",
  "hand.newer.refused": "The network refused this read. What was found so far stays here.",
  "hand.newer.found": "The same address raised hand {number} after this one.",
  "hand.newer.foundMany": "The same address raised {count} hands after this one.",
  "hand.newer.open": "Hand {number}",
  "hand.newer.ownLink": "It has its own link. Ask whoever sent you this one.",
  "hand.newer.ownLinks": "Each has its own link. Ask whoever sent you this one.",
  "hand.newer.none": "None of them was raised by this asker.",
  "hand.askSender": "Ask whoever sent you the link whether there is a newer one.",

  "hand.give.holder": "Someone answered this hand. Pass it back to whoever sent you the link.",
  "hand.give.raiser": "This is an answer to your hand.",
  "hand.give.toThank": "Open the answer",
  "hand.give.mine": "Did you raise this hand? Connect the account that raised it to read the answer.",
  "hand.give.mineLogIn": "Did you raise this hand? Log in with the account that raised it to read the answer.",

  "hand.sendBack.title": "Send the reward back",
  "hand.sendBack.title.noReward": "Close this hand",
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

  // The network, while the page shows a Hand: said instead of "open".
  "hand.offline": "Can't reach the network right now. This was read at block {n} and may have changed.",
  "hand.offline.calm": "Can't reach the network right now. What you see here may have changed since.",
  "hand.offline.opening": "Can't reach the network right now. Your link is still open in this tab; nothing was sent.",
  "hand.retry": "Try again",

  // The way to the Hand's own proof.
  "hand.proofLink": "See the proof →",
  "hand.checkLink": "Check this link in detail →",

  // The labels the app writes over an error, in mono. Core's own names stay as written.
  "hand.code.network": "NETWORK",
  "hand.code.error": "ERROR",
  "hand.code.untrusted": "UNTRUSTED · CHAIN {chain} · CORE {core}",
  "hand.code.noCanonical": "NO MAIN CONTRACT",
  "hand.code.belowMinClaim": "LINK · INVALID · BELOWMINCLAIM",
  "hand.code.link.malformed": "LINK · MALFORMED",
  "hand.code.link.unsupported": "LINK · UNSUPPORTED",
  "hand.code.link.no-canonical-core": "LINK · NO-CANONICAL-CORE",
  "hand.code.link.non-canonical": "LINK · NON-CANONICAL",
  "hand.code.link.too-long": "LINK · TOO-LONG",
  "hand.code.link.another-hand": "LINK · ANOTHER-HAND",
  "hand.code.link.not-this-hand": "LINK · NOT-THIS-HAND",
  "hand.code.link.invalid": "LINK · INVALID",
  "hand.code.link.unmatched-data": "LINK · UNMATCHED-DATA",
};

export default en;

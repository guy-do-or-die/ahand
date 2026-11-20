// The limits screen's words in English. Keys are dotted ids; ru.ts has the same keys.
// Sixteen entries (ARCHITECTURE §11, UX-SPEC §11): each one plain sentence and one small example.
// None of them may be softened. Their order is set in index.tsx.
const en = {
  "limits.title": "What it can't promise.",
  "limits.lead": "aHand promises only what its code does. Here is what it doesn't do, said plainly, each with a small example.",
  "limits.example": "For example",

  "limits.voluntary.say": "Thanking is voluntary. The asker can get help and let the hand run out; the reward then goes back to them.",
  "limits.voluntary.example":
    "You name exactly the right person. The asker says “thanks!” in a chat, never presses Thank, and on the last day the whole reward goes back to them. Nothing in the contract can make them pay.",

  "limits.route.say":
    "Whoever passes it on relies on the asker and the helper. Anyone who held the link earlier, the asker included, can offer the helper a shorter route that leaves later people out, and the helper can accept it. The contract only makes this visible and provable.",
  "limits.route.example":
    "You pass the link on, and the next person passes it to the helper. The asker offers the helper a route without that person; the helper agrees; that person gets nothing. The receipt shows which route was paid.",

  "limits.second.say": "A second address is invisible. The contract only stops the asker's own address from being the helper; the asker answering from another address looks like any other helper.",
  "limits.second.example": "The asker answers their own hand from a second address and thanks it. On the receipt it looks like a normal deal.",

  "limits.length.say":
    "A very long route can't be thanked. More than about 369 passes, or about 70 paid shares in a token that runs the payee's own code on every payment, don't fit into one thanks. Only that branch is stuck, and anyone holding the link can pad a branch with empty passes.",
  "limits.length.here": "With this site's setting, that is {n, plural, one {# paid share} other {# paid shares}}.",
  "limits.length.example": "Someone passes the link to themselves 400 times before it reaches a helper. That branch can no longer be thanked; a helper reached by another branch still can.",

  "limits.balances.say":
    "Tokens that change balances by themselves don't fit. With a token that grows, shrinks or takes a cut on its own, the last people paid can get less, or their money waits until payments come out exact again. Any extra, and any token sent to the contract directly, stays in it forever.",
  "limits.balances.example": "A token starts keeping 1% of every payment. The helper, paid last, gets less than the receipt promised, or the payment waits.",

  "limits.blocked.say": "Money for a blocked address waits. If a token refuses to pay an address, that share waits in the contract, and only that address can send it somewhere else.",
  "limits.blocked.example": "The helper's address is on the token's block list. Everyone else on the receipt is paid at once; the helper's part waits until the helper takes it out to another address.",

  "limits.forever.say": "A pass or an answer can't be taken back. They have no deadline of their own and count for as long as the hand is open, even after it is extended.",
  "limits.forever.example": "You passed a link in March and regret it in April. The pass still counts; only the end of the hand ends it.",

  "limits.cap.say": "At most 180 days at a time. Each raise or extension reaches at most 180 days ahead. If the asker misses an extension, the reward goes back and every route collected so far is dead.",
  "limits.cap.example": "A hand open until 1 June isn't extended in time. On 1 June anyone can send the reward back, and every link passed around for months opens as closed.",

  "limits.lost.say": "Lose the link and only the way back remains. If the asker loses what opens the hand's link, nobody can be thanked; after the end the reward goes back.",
  "limits.lost.example": "The asker's only device is lost with the saved link, and the hand can't be rebuilt anywhere else. The hand waits out its time, then the reward goes back.",

  "limits.rescue.say": "Nobody can fix it or rescue anything. The contract has no owner, takes nothing and has no rescue switch. A mistake in it is permanent.",
  "limits.rescue.example": "If a flaw were found tomorrow, there would be no one to pause it and no way to move money out except by its own rules.",

  "limits.refund.say":
    "A send-back can be pushed into waiting. Anyone can send a hand back after its end, and someone who starts it with too little room to run can leave the asker's money waiting instead of delivered. Then one more step, taking it out, gets it.",
  "limits.refund.example": "An outsider sends an ended hand back on purpose with too little room. The reward shows up as waiting for the asker, who takes it out with one more press.",

  "limits.token.say":
    "If a token stops moving or changes its rules after a reward is locked, everything held in that token is stuck in the contract: rewards, waiting money and the way back to the asker. Nobody can rescue it.",
  "limits.token.example": "The makers of a token switch off all payments. Every reward in it, every share waiting in it and every send-back in it stay where they are.",

  "limits.usdc.say":
    "USDC has an issuer. It can freeze any address, the contract's own included, or the whole token. A frozen payee's money waits. If the contract itself is frozen, every hand in USDC is stuck, the way back included.",
  "limits.usdc.example": "The issuer freezes the helper's address: that share waits. The issuer freezes the contract: no hand in USDC can be thanked or sent back.",

  "limits.code.say":
    "This site's code reads your link. A server never receives what follows # in an address, but the code this site serves reads it in your browser, because that is how a link opens. A dishonest or look-alike site could copy a link, or write a different address for the money into a pass.",
  "limits.code.example":
    "You open a link on a copy of this site at an address one letter off. It shows the same card and quietly keeps your link. Check the address bar; the same code also runs from your own copy, with no site.",

  "limits.keys.say":
    "Another site can ask for the same keys confirmation. A hand's keys come from one fixed message your account confirms. A site that gets the same confirmation can rebuild your links and read the answers sent to you. It can never take the reward: only your account thanks or gets it back.",
  "limits.keys.example": "A site you don't know asks you to confirm the message about your aHand links. If you did, treat every link you made as seen by that site.",

  "limits.unaudited.say": "Unaudited: seven AI reviews and one AI scan found no defect; no professional audit has been done.",
  "limits.unaudited.example":
    "Confirmations from smart accounts were tried with only two kinds of them. Nobody has been paid to look for what the AI reviews might have missed.",

  "limits.next.core": "This contract",
  "limits.next.withoutUs": "Do it without us",
  "limits.next.defaults": "About these defaults",
};

export default en;

// The passport's words in English (UX-SPEC §10.1). Keys are dotted ids; ru.ts has the same keys.
// The sentence keys `proof.core` … `proof.refunded` are the SDK's (`Check.sentence`, proof.ts).
const en = {
  "proof.title": "The passport.",
  "proof.intro": "Every claim about hand #{hand}, checked again in this browser against the chain. A plain sentence first; open any line for the evidence.",
  "proof.readAt": "Read at block {block}",
  "proof.meta": "Chain {chain} · Core {core} · Hand {hand}",
  "proof.loading": "Reading the hand from the chain…",
  "proof.tally": "{ok, plural, one {# check holds} other {# checks hold}} · {nc, plural, =0 {nothing left unchecked} one {# can't be checked here} other {# can't be checked here}} · {fail, plural, =0 {no findings} one {# finding} other {# findings}}",
  "proof.openHand": "Open this hand",

  // The eleven parts of the timeline.
  "proof.section.core": "This contract",
  "proof.section.raised": "Raised",
  "proof.section.reward-time": "Reward and time",
  "proof.section.description": "Description",
  "proof.section.route": "The route",
  "proof.section.shares": "Shares",
  "proof.section.route-hash": "The route, rebuilt",
  "proof.section.give": "The answer",
  "proof.section.giver-amount": "The helper's amount",
  "proof.section.payouts": "Payouts",
  "proof.section.now": "Now",
  "proof.section.back": "The reward went back",
  "proof.section.closing": "Closing",

  // One sentence per check.
  "proof.core": "This is the contract built from the published code: its address follows from the factory, the salt and the code's hash, and its code is there. Unaudited.",
  "proof.raised": "The terms announced when the hand was raised are the terms the contract keeps.",
  "proof.rewardTime": "The reward and the end date add up from the raise and every top-up and extension.",
  "proof.description": "These are the asker's own words, unchanged since the hand was raised. Nobody checked whether they are true.",
  "proof.description.none": "This hand has no description to match.",
  "proof.closing": "The hand is closed, but no thanks and no return were found where its closing should be.",
  // A position on the route is a pass, as on /check and in the command-line check; "hand" is the
  // whole request. The `.to` sentences are for a pass that named where its part lands.
  "proof.route": "Pass {n} continued the share that reached it and said where its own part lands.",
  "proof.route.to": "Pass {n} continued the share that reached it and said where its own part lands: {who}.",
  "proof.keys": "Pass {n} was made with the very key that held the link.",
  "proof.askerHop.payee": "This pass named the asker's own address for its share: that share goes back to the asker.",
  "proof.askerHop.key": "This pass handed the link to the asker's own address.",
  "proof.askerHop.both": "This pass handed the link to the asker's own address and named it for its share: that share goes back to the asker.",
  "proof.askerHop.share": "This share went to the asker's own address.",
  "proof.share": "Pass {n} kept {amount}: the reward times its share, exactly as the contract counts it.",
  "proof.share.to": "Pass {n} kept {amount} for {who}: the reward times its share, exactly as the contract counts it.",
  "proof.share.none": "Pass {n} kept nothing: its share was zero, exactly as the contract counts it.",
  "proof.routeHash": "The route rebuilt here is the very route the helper answered.",
  "proof.giveClaim": "The helper's part is what the route left, and no less than the asker promised.",
  "proof.giveHash": "The answer rebuilt here is exactly the one the contract stored when the asker said thank you.",
  "proof.giveKey": "The answer was made with the last key of the route.",
  "proof.giver.key": "The helper's own key confirmed the answer.",
  "proof.giver.account": "The helper's account confirmed the answer, judged by the account's own code.",
  "proof.giverAmount": "The helper's part is {amount}: the reward minus the shares.",
  "proof.payout": "{amount} for {who}.",
  "proof.payout.paid": "{amount} left the contract for {who}.",
  "proof.payout.pending": "{amount} waits in the contract for {who}.",
  "proof.payouts": "Together the payouts are the whole reward, {amount}. Paid means it left the contract; a token that takes its own cut may deliver less.",
  "proof.now": "Waiting now for {who}: {amount}. Counted per token and address, across every hand, not per hand.",
  "proof.now.none": "Nothing waits now for {who}. Counted per token and address, across every hand.",
  "proof.refunded": "The reward went back to the asker after the end date: {amount}.",

  // What this page reads beside the hand's record: the blocks' own times, how the closing was
  // sent, and the token's own record of each payout.
  "proof.time.opened": "The opening time the contract keeps is the time of the very block that carries the raise.",
  "proof.time.closed.thank": "The closing time the contract keeps is the time of the very block that carries the thanks.",
  "proof.time.closed.refund": "The closing time the contract keeps is the time of the very block that carries the return.",
  "proof.sent.thank": "The thanks was sent by {who} in block {block}. Sending it cost them {eth} ETH, about ${usd} at the ETH price of {date}.",
  "proof.sent.refund": "The return was sent by {who} in block {block}. Sending it cost them {eth} ETH, about ${usd} at the ETH price of {date}.",
  "proof.sent.none": "How it was sent could not be read just now. Check it all again.",
  "proof.sent.info": "For information",
  "proof.move": "The token recorded the same move itself: {amount} from the contract to {who}.",
  "proof.move.none": "The token recorded no move of its own for this payout in the same sending.",
  "proof.core.caveat": "The factory, the salt and the code's hash come with this site. The command in the evidence rebuilds that hash from a clone of the code, without this site.",
  "proof.core.reproduce": "From a clone of the code, this prints the hash of the contract's code as compiled. It must equal initcodeHash above.",
  "proof.core.codeInfo": "Read from the chain just now, for information. These two are recorded, not the proof: the running code holds values filled in when it was put on the chain, so its hash can't be rebuilt from the source alone.",
  "proof.lens.runtimeHash": "runtime code hash",
  "proof.lens.factoryHash": "factory code hash",
  "proof.lens.noCode": "not read",
  "proof.lens.move": "Transfer · token {token} · to {to} · amount {amount} · log {index}",

  // Verdicts.
  "proof.verdict.ok": "Holds",
  "proof.verdict.finding": "Finding",
  "proof.finding": "This does not match. Expected {expected}, found {actual}.",
  "proof.nc": "Not checkable here",
  "proof.nc.core": "This site was built without the contract's deployment facts, so the address can't be derived here.",
  "proof.nc.description": "The words travel only inside links, and this page was opened without one. Nothing is wrong; there is just nothing here to compare.",
  "proof.nc.between": "Top-ups or extensions lie between the raise and now; reading them takes more requests. Read them below.",
  "proof.nc.confirmations": "The confirmations were not found in the call that thanked. The facts above are proven from the events without them.",
  "proof.nc.time": "The block's own time could not be read just now. Check it all again.",
  "proof.nc.other": "This browser had nothing to check it against.",
  "proof.giveHashMatches": "giveHash matches Core",

  // The evidence under each line (specialist layer: Core's own names).
  "proof.lens.evidence": "Evidence",
  "proof.lens.formula": "Formula",
  "proof.lens.inputs": "Inputs",
  "proof.lens.expected": "Expected",
  "proof.lens.actual": "Actual",
  "proof.lens.source": "Source",
  "proof.lens.block": "block {block}",
  "proof.lens.log": "log {index}",
  "proof.lens.computed": "computed here, in this browser",

  // The long read between the raise and the closing.
  "proof.between": "This hand was topped up or extended. Reading the stretch between takes {n, plural, one {# request} other {# requests}} to the network.",
  "proof.between.go": "Read it",

  // At the end.
  "proof.again": "Check it all again",
  "proof.again.running": "Checking…",
  "proof.download": "Download the proof",
  "proof.download.note": "A file with everything read here, the sending and the blocks' times included. With no network it can only show that the file agrees with itself; that its amounts and events really happened only the chain can say, and the command below asks it. The command-line check does not look at the two time lines yet.",
  "proof.withoutSite": "Check it without this site",
  "proof.withoutSite.body": "In a clone of the code, at the commit this site was built from, this one line runs the same checks against the chain:",
  "proof.withoutSite.bundle": "Or check the downloaded file against the chain. Without --rpc it only shows that the file agrees with itself; its amounts and events are then just what the file says:",
  "proof.withoutSite.noCommit": "This site doesn't say which commit it was built from; check out the code you trust.",
  "proof.print": "Print the receipt",

  // Failures to read.
  "proof.bad.chain": "This site doesn't read that network. Nothing was opened.",
  "proof.bad.core": "This address names a contract this site doesn't read. Nothing was opened.",
  "proof.bad.missing": "There is no hand with this number.",
  "proof.bad.offline": "Can't reach the network right now.",
  "proof.bad.kept": "Nothing was sent.",
  "proof.retry": "Try again",
};

export default en;

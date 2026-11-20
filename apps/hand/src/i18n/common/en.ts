// Words every screen shares, in English (UX-SPEC §5, §6, §12, §15). Keys are dotted ids; ru.ts
// has the same keys, which its type and the key-parity guard check.
//
// Families:
//   common.*        the shell, the vocabulary, the marks, states, time and the shared error lines
//   common.lens.*   the specialist layer (mono, Core's own names allowed; exempt from the banned words)
//   common.chain.<id>  a network this catalogue has a name for (chain.ts; any other chain shows the
//                   name its configuration gives)
//   link.<code>     a link that cannot be opened: the SDK's LinkError codes, plus link.untrusted and
//                   link.no-canonical (messageIdOf in packages/sdk/src/errors.ts)
//   core.<Error>    each of Core's refusals, and the three OpenZeppelin errors that can reach a caller
//
// Mono lines (the ribbon, the footer, the marks, the TxRail) are written in sentence case here;
// the mono style sets them in capitals.

const en = {
  // ── The shell (UX-SPEC §6) ────────────────────────────────────────────
  "common.notBuilt": "Not built yet",
  "common.ribbon": "Local test network · Test dollars",
  "common.chain.31337": "Local test network",
  "common.chain.84532": "Base Sepolia (test network)",
  "common.chain.8453": "Base",
  "common.footer": "Unaudited · Core {core} · No owner · No fee",
  "common.footer.limits": "What it can't promise",
  "common.footer.withoutUs": "Do it without us",
  "common.footer.defaults": "About these defaults",
  "common.footer.nav": "About this site",
  "common.language": "Language",
  "common.language.en": "English",
  "common.language.ru": "Русский",
  "common.lensToggle": "Show the evidence",
  "common.lensHint": "Press ? to show or hide the evidence under every sentence.",
  "common.theme": "Switch theme",
  "common.home": "aHand: back to the start",
  "common.skip": "Skip to the content",
  "common.loading": "Loading…",
  "common.notFound.title": "Nothing here.",
  "common.notFound.body": "This address leads nowhere on this site. A link you were sent opens from the start page.",
  "common.notFound.home": "To the start",
  "common.crash.title": "This screen stopped.",
  "common.crash.body": "Something broke while drawing it. Nothing was sent.",
  "common.crash.retry": "Try again",
  "common.offline.kept": "This screen didn't load. Everything open in this tab is still here; nothing was sent.",
  "common.tabOnly": "This link lives in this tab only. Reloading forgets it — keep the message it came in.",
  "common.gallery": "Opening the component gallery…",

  // ── Vocabulary (UX-SPEC §5): one concept, one word ────────────────────
  "common.word.hand": "hand",
  "common.word.raise": "Raise a hand",
  "common.word.reward": "reward",
  "common.word.passOn": "Pass it on",
  "common.word.keepShare": "Keep a share",
  "common.word.help": "Help",
  "common.word.canHelp": "I can help",
  "common.word.thank": "Thank",
  "common.word.sayThanks": "Say thanks",
  "common.word.goesBack": "goes back",
  "common.word.sendBack": "Send it back",
  "common.word.openUntil": "open until {date}",
  "common.word.waitingForYou": "Waiting for you",
  "common.word.takeOut": "Take it out",
  "common.word.deliver": "Deliver",
  "common.word.payee": "Where the money lands",
  "common.word.raiser": "the asker",
  "common.word.someone": "Someone",
  "common.word.public": "Public",
  "common.word.unlisted": "Unlisted",
  "common.word.dark": "Dark",
  "common.word.cost": "costs about {amount}",
  "common.word.connect": "Connect a wallet",
  "common.word.myHands": "My hands",
  "common.word.copy": "Copy",
  "common.word.copied": "Copied",
  "common.word.showQr": "Show QR",
  "common.word.print": "Print",
  "common.word.close": "Close",
  "common.word.back": "Back",

  // ── The three marks (UX-SPEC §2) ──────────────────────────────────────
  "common.mark.checked": "Checked here",
  "common.mark.onChain": "On chain",
  "common.mark.waiting": "Waiting",
  "common.token.usd": "Test dollars",
  "common.token.blacklist": "Test dollars that can block",

  // ── The four states of a send (TxRail, ARCHITECTURE §7) ────────────────
  "common.tx.sent": "Sent",
  "common.tx.inBlock": "In a block",
  "common.tx.recorded": "Recorded on Ethereum",
  "common.tx.final": "Final",
  "common.tx.standIn": "Local stand-in",
  "common.tx.standInWhy": "On this local network these two steps mean one and two blocks later.",

  // ── States of a hand (UX-SPEC §4, §8) ─────────────────────────────────
  "common.state.open": "Open",
  "common.state.expired": "Time's up",
  "common.state.thanked": "Thanked on {date}",
  "common.state.refunded": "The reward went back on {date}",
  "common.state.closed": "This hand is closed.",
  "common.state.wentBack": "The reward went back.",
  "common.state.lost": "The description didn't arrive with this link. Ask whoever sent it.",
  "common.state.checking": "Checking the link…",
  "common.state.noReward": "No reward: a thank-you only",

  // ── Time (UX-SPEC §15) ────────────────────────────────────────────────
  "common.time.offline": "Can't reach the network right now.",
  "common.noCore.title": "This contract is not on {chain} yet.",
  "common.noCore.body": "Its address is known before it is put anywhere, and on this network nothing is at that address yet. Until it is, nothing can be raised, passed or thanked here, and no money moves.",
  "common.noCore.more": "What is checked about this contract",
  "common.noCore.retry": "Check again",
  "common.lens.networkTime": "Network time · Block {block} · {time}",
  "common.lens.cap": "Cap 180 d · less 10 min, so it can't arrive too late",
  "common.lens.deviceTime": "First seen on this device {time}",

  // ── Shared error lines (UX-SPEC §6, §12) ───────────────────────────────
  "common.error.offline": "Can't reach the network right now. Nothing was sent.",
  "common.error.refused": "You said no. Nothing was sent.",
  "common.error.nothingSent": "Nothing was sent.",
  "common.error.nothingLeft": "Nothing left your account.",
  "common.error.unknown": "Something went wrong. Nothing was sent.",
  "common.error.wrongNetwork": "Your account is on another network. Switch it to {network} and try again. Nothing was sent.",
  "common.error.unknownNetwork": "The app you chose doesn't know the network {network}. Add the network in it, then connect again. Nothing was connected.",

  // ── A send whose fate is not known yet (wallet/send.ts: "unknown", "dropped") ──
  "common.send.unknown": "It isn't known yet whether this went out. Don't press again: this screen is checking and will say when it knows.",
  "common.send.dropped": "It didn't go through: nothing left your account. You can try again.",
  "common.send.inFlight": "Already sent from this device and on its way. Nothing is sent a second time.",
  "common.send.landed": "It went through after all.",
  "common.send.stopWaiting": "Stop waiting",
  "common.send.stopWaitingNote": "This only stops the screen from waiting. It sends nothing and cancels nothing: it may still go through, and the next visit checks again.",

  // ── A link that cannot be opened (LinkError codes and the two site-side ids) ──
  "link.malformed": "This link is damaged. Ask for it again.",
  "link.unsupported": "This link was made by a newer app.",
  "link.untrusted": "This link names a contract this site doesn't read. Nothing was opened.",
  "link.no-canonical": "This link names the main contract, and this site doesn't know one. Nothing was opened.",
  "link.non-canonical": "This link is written in a way its format doesn't allow. Ask for it again.",
  "link.too-long": "This route is too long to ever be thanked.",
  "link.another-hand": "The address shows one hand and the link is for another.",
  "link.not-this-hand": "This link doesn't belong to this hand: its route starts somewhere else.",
  "link.invalid": "This route doesn't add up: a share grows along the way.",
  "link.unmatched-data": "Part of this address doesn't match its link. Ask for it again.",

  // ── Core's refusals (AHandCore.sol, in its order; then OpenZeppelin's three) ──
  "core.ExpiryTooEarly": "That date has already passed on the network's clock. Nothing was sent.",
  "core.ExpiryTooLate": "At most 180 days from now. Nothing was sent.",
  "core.ZeroRootKey": "This hand has no link key, so nobody could pass it on. Nothing was sent.",
  "core.MinClaimTooHigh": "The helper's minimum can't be more than the whole reward. Nothing was sent.",
  "core.NotOpen": "This hand is already closed.",
  "core.NotRaised": "There is no hand with this number.",
  "core.NotRaiser": "Only the account that raised this hand can do that.",
  "core.Expired": "Time's up. This hand can only be sent back now.",
  "core.GiverIsRaiser": "You can't thank yourself.",
  "core.ZeroPayee": "This answer doesn't say where the money lands.",
  "core.InvalidClaim": "This route doesn't add up: a share grows along the way.",
  "core.AnonymousMargin": "Someone on this route kept a share without saying where it lands.",
  "core.InvalidKeySig": "One step on this route wasn't made by whoever held the link.",
  "core.InvalidRouteHash": "This answer was made for a different route.",
  "core.BelowMinClaim": "This route leaves the helper less than the asker promised. It can't go further.",
  "core.InvalidGiverSig": "The helper's confirmation doesn't check out.",
  "core.NotExpired": "Too early to send it back. The hand is still open.",
  "core.NotPayee": "Only the address the money waits for can send it elsewhere. Anyone can still deliver it there.",
  "core.ZeroDestination": "That is the zero address: money sent there is lost. Nothing was sent.",
  "core.NothingPending": "Nothing is waiting for this address.",
  "core.InexactTransfer": "The token moved a different amount than asked. Nothing was sent.",
  "core.NotCore": "Only the contract itself can do that.",
  "core.Reentered": "The contract refused a call made from inside another. Nothing was sent.",
  "core.SafeERC20FailedOperation": "The token refused to move the money. Nothing left your account.",
  "core.InvalidShortString": "The contract couldn't read a name it was given.",
  "core.StringTooLong": "A name given to the contract is too long.",
};

export default en;

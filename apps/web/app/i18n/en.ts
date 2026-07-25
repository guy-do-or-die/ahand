/**
 * English source catalog — the single place UI copy lives.
 *
 * Conventions (design handoff + task brief):
 * - Message id = the English source copy from the mocks; the value is what
 *   renders, so copy tuning happens here without touching call sites.
 * - Vocabulary: raise / pass on / help / solve / thank / pocket / pot.
 *   Banned: wallet, gas, transaction, sign, escrow — single exception:
 *   "Connect a wallet" on Onboarding. (The SSR scraper strings in the
 *   protected loader were rewritten to the same plain words; see
 *   DEVIATIONS.md.)
 * - Uppercasing is CSS (`text-transform`), never baked into the copy.
 * - Money is formatted with Intl.NumberFormat at call sites, never in copy.
 * - `{name}` placeholders are interpolated by Lingui at runtime.
 */
export const messages: Record<string, string> = {
  // Shared
  "you": "you",
  "aHand": "aHand",
  "aHand #{id}": "aHand #{id}",
  "Close": "Close",
  "Switch theme": "Switch theme",
  "Back home": "Back home",
  "copy": "copy",
  "copied": "copied",
  "Copied": "Copied",
  "esc to close": "esc to close",

  // Raise — compose
  "raise a hand": "raise a hand",
  "What are you looking for?": "What are you looking for?",
  "e.g. A Portuguese-speaking Solidity reviewer in Lisbon…": "e.g. A Portuguese-speaking Solidity reviewer in Lisbon…",
  "First line becomes the title. Add details below.": "First line becomes the title. Add details below.",
  "thanks in the pot": "thanks in the pot",
  "your call": "your call",
  "the final helper keeps at least": "the final helper keeps at least",
  "Up to {amount} can be shared across successful Shakes.": "Up to {amount} can be shared across successful Shakes.",

  // Raise — visibility selector (no mock; flagged in DEVIATIONS.md).
  // Familiar public/unlisted/private model (like YouTube) + plain captions.
  "who can see it": "who can see it",
  "public": "public",
  "unlisted": "unlisted",
  "private": "private",
  "dark": "dark",
  "light": "light",
  "Listed in Open Hands. Anyone can open and share it.": "Listed in Open Hands. Anyone can open and share it.",
  "Not listed. Anyone with the link can open and share it.": "Not listed. Anyone with the link can open and share it.",
  "Not listed. Link-only, no preview.": "Not listed. Link-only, no preview.",

  // Raise — OG preview + link survival (no mock; flagged in DEVIATIONS.md)
  "what your people see when they get the link":
    "what your people see when they get the link",
  "the link's getting long — room for about {hops} more shares":
    "the link's getting long — room for about {hops} more shares",
  "link preview": "link preview",
  "aHand · {amount} secured": "aHand · {amount} secured",
  "Paid when accepted · open until {date}": "Paid when accepted · open until {date}",
  "{solverKeep}+ to the final helper · successful Shakes share the rest · open until {date}": "{solverKeep}+ to the final helper · successful Shakes share the rest · open until {date}",
  "link survives ~{hops} passes in Telegram": "link survives ~{hops} passes in Telegram",
  "long link — only {hops} passes left in Telegram": "long link — only {hops} passes left in Telegram",
  "more than one link can carry — trim it a little": "more than one link can carry — trim it a little",
  "too long for one link — trim it a little": "too long for one link — trim it a little",
  "{n} / 1000": "{n} / 1000",

  // Raise — fine-tune
  "fine-tune": "fine-tune",
  "most goes to the final helper · open {days} days · {pct2}% to charity": "most goes to the final helper · open {days} days · {pct2}% to charity",
  "to charity": "to charity",
  "open for": "open for",
  "days": "days",

  // Raise — CTA + errors
  "Raise it": "Raise it",
  "Raising…": "Raising…",
  "${amount} secured · {refund} refundable · {charity} to charity": "${amount} secured · {refund} refundable · {charity} to charity",
  "If no Give is accepted within {days} days, {refund} returns to you. {charity} goes to charity.": "If no Give is accepted within {days} days, {refund} returns to you. {charity} goes to charity.",
  "held safe · paid when accepted · refundable after {days} days · {pct}% to charity": "held safe · paid when accepted · refundable after {days} days · {pct}% to charity",
  "something to fix": "something to fix",
  "Connect your pocket first.": "Connect your pocket first.",
  "Say what you need first.": "Say what you need first.",
  "The raise didn't go through — try again.": "The raise didn’t go through — try again.",
  "Something went wrong — nothing left your pocket.": "Something went wrong — nothing left your pocket.",
  "You closed the confirm — no harm done, nothing left your pocket.": "You closed the confirm — no harm done, nothing left your pocket.",
  "The chain hiccuped — try again in a moment.": "The chain hiccuped — try again in a moment.",
  "Too long for one link — trim it a little.": "Too long for one link — trim it a little.",

  // Raise — success
  "Your hand is up.": "Your hand is up.",
  "Send this link to someone who'd know. Every pass is remembered.": "Send this link to someone who’d know. Every pass is remembered.",
  "Send it on": "Send it on",
  "Copy the link": "Copy the link",
  "good travels · it comes back around": "good travels · it comes back around",
  "good travels · raise the next one": "good travels · raise the next one",

  // Hand view
  "finding the hand…": "finding the hand…",
  "No hand here.": "No hand here.",
  "Check the link — it doesn't point to a raised hand.": "Check the link — it doesn’t point to a raised hand.",
  "in the pot": "in the pot",
  "final helper keeps at least {amount}": "final helper keeps at least {amount}",
  "from {name}": "from {name}",
  "{n} hands so far": "{n} hands so far",
  "fresh — it starts with you": "fresh — it starts with you",
  "via {name}": "via {name}",
  "open": "open",
  "accepted": "accepted",
  "reclaimed": "reclaimed",
  "I can ask": "I can ask",
  "I can help": "I can help",
  "held safe · paid when accepted · {pct}% to charity": "held safe · paid when accepted · {pct}% to charity",
  "doesn't add up": "doesn’t add up",
  "This content doesn't match what was raised: {reason}": "This content doesn’t match what was raised: {reason}",
  "This link couldn't be read: {reason}": "This link couldn’t be read: {reason}",
  "Shaking and helping are switched off for this link.": "Shaking and helping are switched off for this link.",
  "This link is missing its key.": "This link is missing its key.",
  "Ask for the full link — the part after # — to see the hand and I can ask.": "Ask for the full link — the part after # — to see the hand and I can ask.",

  // Pass on
  "shake": "shake",
  "your share": "your share",
  "gift · 0%": "gift · 0%",
  "keep {pct}%": "keep {pct}%",
  "where your thanks lands": "where your thanks lands",
  "even if you shake it all on, a thank-you would reach you here": "even if you shake it all on, a thank-you would reach you here",
  "a note that travels with the hand": "a note that travels with the hand",
  "soon": "soon",
  "add an address and the link appears": "add an address and the link appears",
  "Send the hand": "Send the hand",
  "every Shake is remembered · thanks follows the hand": "every Shake is remembered · thanks follows the hand",
  // I can help
  "i can help": "i can help",
  "Tell them you're on it.": "Tell them you’re on it.",
  "You came straight from the raiser.": "You came straight from the raiser.",
  "You're {n} hands from the raiser.": "You’re {n} hands from the raiser.",
  "What can you do for them? Plain words, links welcome.": "What can you do for them? Plain words, links welcome.",
  "what you can do": "what you can do",
  "Write what you can do, and it goes straight back to them.": "Write what you can do, and it goes straight back to them.",
  "Send your reply back to whoever asked — they'll say thanks if it helps.": "Send your reply back to whoever asked — they'll say thanks if it helps.",
  "if accepted, you keep at least {amount}": "if accepted, you keep at least {amount}",
  "Tell them I'm on it": "Tell them I'm on it",

  // Mark solved / Thank
  "reading the proof…": "reading the proof…",
  "This link is missing its proof — ask the helper to resend it.": "This link is missing its proof — ask the helper to resend it.",
  "This proof couldn't be read: {reason}": "This proof couldn’t be read: {reason}",
  "your hand · #{id}": "your hand · #{id}",
  "Did this accept it?": "Did this accept it?",
  "via {name} · {n} Shakes": "via {name} · {n} Shakes",
  "came straight back to you": "came straight back to you",
  "proof {hash}": "proof {hash}",
  "Saying yes releases the thanks to {name} and every hand between you.": "Saying yes releases the thanks to {name} and every hand between you.",
  "add to the pot": "add to the pot",
  "extra thanks": "extra thanks",
  "Yes — accept": "Yes — accept",
  "Thanking…": "Thanking…",
  "Not quite — keep it open": "Not quite — keep it open",
  "Only the raiser can say thanks here.": "Only the raiser can say thanks here.",
  "The thanks didn't go through — try again.": "The thanks didn’t go through — try again.",
  "Accepted. Thanks, everyone.": "Accepted. Thanks, everyone.",
  "who got what": "who got what",
  "accepted it": "accepted it",
  "shaked it": "shaked it",
  "charity · {pct}%": "charity · {pct}%",
  "{n} people better off": "{n} people better off",
  "already accepted — the thanks went out": "already accepted — the thanks went out",
  "Pay it forward": "Pay it forward",

  // Pocket
  "your pocket": "your pocket",
  "thanks received · every good turn remembered": "thanks received · every good turn remembered",
  "Your pocket isn't connected yet.": "Your pocket isn’t connected yet.",
  "reading your receipts…": "reading your receipts…",
  "nothing here yet — shake a hand on or raise one": "nothing here yet — shake a hand on or raise one",
  "Accepted hand #{id}": "Accepted hand #{id}",
  "Shaked hand #{id} on": "Shaked hand #{id} on",
  "Raised hand #{id}": "Raised hand #{id}",
  "Thanked the chain — hand #{id}": "Thanked the chain — hand #{id}",
  "your raise": "your raise",
  "Take out": "Take out",
  "Raise a hand": "Raise a hand",
  "thanks looks best paid forward": "thanks looks best paid forward",

  // Landing
  "how it works": "how it works",
  "open hands": "open hands",
  "Connect": "Connect",
  "disconnect": "disconnect",
  // Headline renders as three segments so the amber marker can wrap the
  // middle one; revisit per-locale word order at translation time.
  "Raise a hand.": "Raise a hand.",
  "Your people": "Your people",
  "take it from there.": "take it from there.",
  "Ask for what you need. Friends shake it on, hand to hand, until someone gives the result — and the successful path shares the thanks.": "Ask for what you need. Friends shake it on, hand to hand, until someone gives the result — and the successful path shares the thanks.",
  "see open hands": "see open hands",
  "no feeds · no ads · 1% to charity · everyone who helps shares the thanks": "no feeds · no ads · 1% to charity · everyone who helps shares the thanks",
  "Looking for a sublet in Yerevan, June": "Looking for a sublet in Yerevan, June",
  "raise": "raise",
  "give": "give",
  "thank": "thank",
  "Say what you need. Put thanks in the pot.": "Say what you need. Put thanks in the pot.",
  "Send it to someone who'd know. It travels.": "Send it to someone who’d know. It travels.",
  "The one who does it keeps most of the pot.": "The one who does it keeps most of the pot.",
  "The successful Shakes share the rest.": "The successful Shakes share the rest.",

  // Onboarding (the one allowed "wallet")
  "get a pocket": "get a pocket",
  "Good hands, welcome.": "Good hands, welcome.",
  "You'll need a pocket — a safe place to hold the thanks you give and get.": "You’ll need a pocket — a safe place to hold the thanks you give and get.",
  "Connect a wallet — that's your pocket": "Connect a wallet — that's your pocket",
  "no app or crypto know-how needed — takes a few seconds": "no app or crypto know-how needed — takes a few seconds",
  "Email & socials": "Email & socials",
  "your pocket stays yours · we never touch it": "your pocket stays yours · we never touch it",
  "Just looking? Browse open hands": "Just looking? Browse open hands",

  // Open hands (flagged empty state)
  "The board isn't open yet.": "The board isn’t open yet.",
  "For now, hands travel hand to hand — by link only. Raise one and start a chain.": "For now, hands travel hand to hand — by link only. Raise one and start a chain.",
  "public board · on its way": "public board · on its way",

  "That address doesn't look right (0x…).": "That address doesn’t look right (0x…).",
  "That share is more than what's left to pass.": "That share is more than what’s left to pass.",
  "Couldn't build the new link: {reason}": "Couldn’t build the new link: {reason}",
  "Couldn't build the proof: {reason}": "Couldn’t build the proof: {reason}",

  // ── Clarity pass P0/P1 (people-not-hex, connect-gating, split preview) ──
  "% to charity": "% to charity",
  "Connect a pocket & reply": "Connect a pocket & reply",
  "Connect a pocket & send": "Connect a pocket & send",
  "Connect a pocket below — your thanks lands there, nothing to paste.": "Connect a pocket below — your thanks lands there, nothing to paste.",
  "If it's accepted through you, you can keep a small thank-you — or shake it all on.": "If it's accepted through you, you can keep a small thank-you — or shake it all on.",
  "No app or crypto know-how needed — it takes a few seconds.": "No app or crypto know-how needed — it takes a few seconds.",
  "Nothing moves until you tap yes — and it can't be undone.": "Nothing moves until you tap yes — and it can't be undone.",
  "When you say yes": "When you say yes",
  "YOU": "YOU",
  "a friend": "a friend",
  "change": "change",
  "coming": "coming",
  "held · returns if no Give is accepted": "held · returns if no Give is accepted",
  "keep a thank-you for yourself?": "keep a thank-you for yourself?",
  "keep it open for": "keep it open for",
  "lands in your pocket": "lands in your pocket",
  "paid out to everyone": "paid out to everyone",
  "pass it all on": "pass it all on",
  "passed through {n} hands to reach you": "passed through {n} hands to reach you",
  "straight from whoever raised it": "straight from whoever raised it",
  "the person who helped": "the person who helped",
  "the {n} hands that passed it share": "the {n} hands that passed it share",
  "their reply · {hash}": "their reply · {hash}",
  "who asked": "who asked",
  "your hand": "your hand",
  "your pocket is where thanks lands — connect it to reply": "your pocket is where thanks lands — connect it to reply",
  "your pocket is where thanks lands — connect it to send": "your pocket is where thanks lands — connect it to send",
  "your thanks for shaking": "your thanks for shaking",
  "your thanks for giving": "your thanks for giving",
  "yours to keep · {n} good turns so far": "yours to keep · {n} good turns so far",
  "{name} keeps": "{name} keeps",
  "{pct}% to charity": "{pct}% to charity",
};

// The raise screen's words in English. Keys are dotted ids; ru.ts has
// the same keys. Keys with a `lens` segment are the specialist layer: Core's own names stand there.
const en = {
  "raise.kicker": "Raise a hand",

  // 1. What are you looking for?
  "raise.what": "What are you looking for?",
  "raise.what.placeholder": "Who can recommend a quiet room in Tbilisi for a week?",
  "raise.what.hint": "The first line is the title: people see it first.",
  "raise.what.count": "Title: {n} of {max} characters",
  "raise.what.tooLong": "The title is too long: {n} of {max} characters. Move the rest to the details.",
  "raise.details.add": "Add details",
  "raise.details.label": "Details",
  "raise.details.placeholder": "Dates, budget, what matters to you.",
  "raise.details.count": "Details: {n} of {max} characters",
  "raise.details.tooLong": "The details are too long: {n} of {max} characters.",

  // 2. Reward
  "raise.reward.label": "Reward",
  "raise.reward.custom": "Your call",
  "raise.reward.customLabel": "Your amount, zero included",
  "raise.reward.none": "No reward: a thank-you only.",
  "raise.reward.locked": "Locked until you thank someone — or all of it back to you after {date}.",
  "raise.reward.issuer": "Held in USDC. Its issuer can freeze addresses; then that money waits.",
  "raise.reward.issuerTest": "Held in test USDC on {network}: it is worth nothing. Its issuer can freeze addresses; then that money waits.",
  "raise.reward.issuerStand": "Held in test dollars, standing in for USDC. USDC's issuer can freeze addresses; then that money waits.",
  "raise.reward.calm": "Held in USDC.",
  "raise.reward.calmTest": "Held in test USDC on {network}: it is worth nothing.",
  "raise.reward.calmStand": "Held in test dollars.",
  "raise.reward.lens.token": "Token {address} · {decimals} decimals, read from the token",

  // 3. Open until
  "raise.expiry.label": "Open until",
  "raise.expiry.days": "{n} days",
  "raise.expiry.until": "Open until {date}, by the network's clock.",
  "raise.expiry.how": "How the date is counted",
  "raise.expiry.nudge": "Long hands need a nudge. After you raise it, you'll get a button to add a calendar reminder.",
  "raise.expiry.lens.formula": "expiry = min(now + {days} d, now + MAX_EXPIRY_PERIOD − 600 s) = {expiry}",
  "raise.expiry.lens.now": "now = block {block} · {timestamp} · MAX_EXPIRY_PERIOD = {cap} s, read from the contract",

  // 4. Who can see it
  "raise.who.label": "Who can see it",
  "raise.who.public.site": "The site and link previews get the title and the details.",
  "raise.who.public.link": "Whoever has the link reads everything.",
  "raise.who.unlisted.site": "The site and link previews get the title.",
  "raise.who.unlisted.link": "Whoever has the link reads the details too.",
  "raise.who.dark.site": "The site and link previews get nothing.",
  "raise.who.dark.link": "Whoever has the link reads the title and the details.",
  "raise.who.shared": "The reward, the dates and your address are public in every mode. Dark is not secret writing.",
  "raise.who.halves": "How a link reads",
  "raise.who.halvesBody": "The site never receives what stands after # in the address. The code this site serves reads it in your browser, because that is how a link opens.",
  "raise.who.unfurl": "In a chat it looks like this",
  "raise.who.noPreviews": "On this test site a chat's link preview shows only the site's name.",
  "raise.who.generic": "Someone raised a hand. Open to see.",
  "raise.who.untitled": "Your title goes here",
  "raise.who.money": "{reward} reward · open until {date}",
  "raise.who.moneyNone": "No reward: a thank-you only · open until {date}",
  "raise.who.tooLong": "With these words the address would be too long for sites and link previews to open. Shorten them, or choose “Dark”: then the words travel inside the link.",

  // 5. Fine-tune
  "raise.fine.label": "Fine-tune",
  "raise.fine.calm": "the helper gets at least {pct}",
  "raise.fine.minClaim": "The helper gets at least {pct}",
  "raise.fine.minClaimWhy": "Whoever passes it on can keep a share only out of what is above this.",
  "raise.fine.room": "Room for each payout: {k}",
  "raise.fine.roomWhy": "Why 250: a payout in dollars takes about 168 thousand units of work after the next network upgrade, and 250 thousand leaves room to spare. The price: at worst it leaves room for {passes} paid passes instead of {more}.",
  "raise.fine.roomNow": "With {k}: room for {passes} paid passes at worst.",
  "raise.fine.lens.terms": "minClaimBps = {bps} · payoutGasK = {k}",

  // 6. Preview
  "raise.preview.label": "How it will look to whoever gets the link",

  // 7. The swipe and its steps
  "raise.swipe": "Raise your hand",
  "raise.swipe.needTitle": "Write what you're looking for first.",
  "raise.swipe.noClock": "Can't reach the network right now.",
  "raise.steps.label": "Steps",
  "raise.steps.connect": "Connect a wallet",
  "raise.steps.logIn": "Log in",
  "raise.steps.keys": "Your link",
  "raise.steps.lock": "Lock the reward",
  "raise.steps.allow": "1 of 2: allow",
  "raise.steps.raise2": "2 of 2: raise",
  "raise.steps.raise": "Raise",
  "raise.steps.tried": "Before anything is sent, we check that it will go through.",

  // The keys card
  "raise.keys.title": "Your link",
  "raise.keys.body": "Confirm once, so this device can bring your link and the answers to you back later. There is no key for you to keep, and this confirmation can't move money.",
  "raise.keys.warn": "Confirm it only on this site: another site that got the same confirmation could rebuild your links and read replies to you. It could not take the reward.",
  "raise.keys.twice": "The first time on this device it asks twice, to check that your account answers the same way both times.",
  "raise.keys.confirm": "Confirm",
  "raise.keys.back": "Not now",
  "raise.keys.what": "What exactly you are confirming",
  "raise.keys.lens.message": "Keys(string purpose, address raiser) · domain aHand keys / 1 · as your account shows it",

  // 8. States
  "raise.up": "Your hand is up.",
  "raise.pending": "Your last raise is still on its way.",
  "raise.pending.note": "Nothing is sent again: this screen follows the one already sent.",
  "raise.pending.batch": "Your account took this raise as one batch and has not named it on the network yet.",
  "raise.pending.aside": "You can raise another hand meanwhile. This screen looks for the one on its way each time it opens.",

  // 9. Share
  "raise.share.line": "Send it to people who might know someone. Passing it on is free for them.",
  "raise.share.qr": "Show QR",
  "raise.share.hideQr": "Hide QR",
  "raise.share.qrNote": "The code carries the whole link inside, as digits: it shows nothing before the #.",
  "raise.share.print": "Print a card",
  "raise.share.reminder": "Add a reminder",
  "raise.share.checked": "This link opens hand {id} with your words.",
  "raise.share.tabOnly": "This tab forgets the link on reload. On this device, “My hands” can rebuild it after one confirmation.",
  "raise.share.again": "Raise another hand",
  "raise.share.evidence": "What the contract recorded",
  "raise.share.lens.raised": "Raised · hand {id} · block {block} · tx {tx}",
  "raise.share.lens.size": "Link {bytes} bytes · shape {shape} · QR {qrBytes} bytes",
  "raise.show": "Show the link",
  "raise.show.why": "Your account rebuilds this hand's link after one confirmation.",

  // An account whose confirmations differ
  "raise.locked.band": "Your account can't rebuild this link later. Save it now. Until you do, this device keeps a locked copy, for one day at most.",
  "raise.locked.inbox": "Replies to this hand can be read on this device only.",
  "raise.locked.tick": "I saved the link",
  "raise.locked.leave": "Tick “I saved the link” before you leave.",
  "raise.locked.gone": "The copy on this device is gone. The link you saved is the only one.",

  // Errors
  "raise.error.short": "You need {amount} and a little ETH for the cost. Nothing was sent.",
  "raise.error.storage": "This browser keeps nothing for this site, so a hand can't be raised here. Nothing was sent.",
  "raise.error.reused": "This device already used this link key, so the raise was stopped. Nothing was sent.",
  "raise.error.cannotSend": "This account can't send from here. Nothing was sent.",
  "raise.error.reverted": "The raise didn't go through. The reward stayed with you.",
  "raise.error.lostSight": "We lost sight of your raise. Reload this page to look for it again: nothing is sent twice.",
  "raise.error.connectToLook": "Connect the account that sent this raise, and this screen will look for it. Nothing is sent again.",
  "raise.error.otherAccount": "This raise was sent from another account. Connect that one to look for it. Nothing is sent again.",
  "raise.error.copyLost": "This device can no longer open its locked copy of the link. After the hand's end, the reward can still be sent back to you.",
  "raise.error.otherTerms": "The contract recorded other terms than this screen sent. Don't share this hand; after its end, it can be sent back to you.",
  "raise.error.facts": "Can't read the contract's limits or the token right now. Nothing was sent.",

  // A raise whose fate is not known yet, or that never went
  "raise.error.unknown": "It isn't known yet whether your raise went out. Don't raise it again: this screen is checking and will show your hand once it finds it.",
  "raise.error.dropped": "Your last raise didn't go through: nothing left your account, and the reward is still yours. You can raise it again.",
  "raise.error.allowSent": "The permission step went out and its cost was paid, but the raise itself did not: no reward moved. The next try skips the permission step.",
  "raise.error.allowUnknown": "It isn't known whether the permission step went out. The raise itself was not sent and no reward moved. The next try checks the permission first.",
  "raise.error.allowDropped": "The permission step didn't go through and the raise was not sent: nothing left your account.",
  "raise.error.accountChanged": "The account changed from {was} to {now} in the middle of the raise, so it stopped. Nothing was sent.",
  "raise.error.accountChangedAllow": "The account changed from {was} to {now} after the permission step, so the raise stopped. The permission step went out from {was} and its cost was paid; no reward moved.",
  "raise.error.tooLarge": "A public hand's words must fit in {max} characters of its address; these take {bytes}. Shorten them, or choose Unlisted or Dark, where the details travel inside the link. Nothing was sent.",
  "raise.size": "In the address before #: {bytes} of at most {max} characters.",
  "raise.swipe.amount": "Raise your hand · {amount}",
  "raise.steps.allowAmount": "1 of 2: allow {amount}",
  "raise.pending.unknown": "Is your raise on its way?",
  "raise.pending.offline": "The screen keeps checking once the network answers.",
  "raise.my.checking": "Checking whether this raise went out…",
  "raise.my.dropped": "This raise didn't go through: nothing left your account.",
};

export default en;

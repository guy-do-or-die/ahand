// The defaults screen's words in English. Keys are dotted ids; ru.ts has the same keys.
// One row per choice of design/DECISIONS.md that a person can feel; the rows are listed in index.tsx.
const en = {
  "defaults.title": "About these defaults.",
  "defaults.lead":
    "Every number and choice below was set for this experimental build by the AI assistant that designed it. None of them is a decision of the project's owner. Each row carries its number in the experiment's table of decisions, so it can be found, argued with and changed.",
  "defaults.chosen": "Chosen for this experiment, not by the project's owner.",
  "defaults.open": "The owner has yet to rule on this one.",
  "defaults.row": "Row",

  "defaults.d21.title": "A helper with nothing installed can still answer.",
  "defaults.d21.body":
    "A one-time key confirms the answer and is thrown away, or a new address is made on the spot. Either way the answer is confirmed here, on a card with the real numbers and a deliberate swipe, not in an account app of the helper's own. The project's rules ask for that app's confirmation; this build departs from them on purpose, and keeps no key.",

  "defaults.d26a.title": "The helper gets at least {pct}.",
  "defaults.d26a.body": "Out of every reward, at least {pct} is kept for whoever helps. People who pass it on can keep shares only out of the rest. The asker can pick another minimum when raising.",

  "defaults.d26b.title": "A hand is open for {days, plural, one {# day} other {# days}}.",
  "defaults.d26b.body": "Unless the asker picks 7, 90 or 180 days. After that the reward can be sent back.",

  "defaults.d26c.title": "Each payment gets room for 250 thousand units of work.",
  "defaults.d26c.body":
    "A dollar payment needs about 168 thousand after the network's next upgrade, so 250 leaves about half again to spare. The price of that room: one thanks can pay at most 55 people who kept a share along the way, instead of 66.",

  "defaults.d27.title": "Only the network's dollar token.",
  "defaults.d27.body": "The contract takes any token. This build offers only the network's dollar: USDC on Base, test dollars here.",

  "defaults.d31.title": "A new link can be shared as soon as it is in a block.",
  "defaults.d31.body": "No waiting about 20 minutes for it to be final. If the network rolls that block back, the link is refused, not misused.",

  "defaults.d32.title": "A new hand is unlisted.",
  "defaults.d32.body": "Its title shows in link previews; the description and everything else travel only inside the link. Public and dark are one tap away when raising.",

  "defaults.d37.title": "The asker is always “Someone”.",
  "defaults.d37.body": "An address is not a person. This build shows no names and no relationship words, only addresses where they matter.",

  "defaults.d39.title": "A reload forgets an opened link.",
  "defaults.d39.body": "The link is read once and taken out of the address bar, so it isn't kept anywhere. Keep the message it came in.",

  "defaults.d40.title": "Answers travel through a relay on this computer.",
  "defaults.d40.body": "A helper's answer reaches the asker through a test relay running on this computer, then back along the route, then by pasting. No public relay is used in this build.",

  "defaults.d49.title": "Dollar costs use dated test prices.",
  "defaults.d49.body": "Every “costs about $…” is worked out from a snapshot taken on {date}, with ETH at ${eth}. It is not today's price.",

  "defaults.d61.title": "Time is the network's.",
  "defaults.d61.body":
    "Open, time's up and every countdown follow the time of the network's latest block, never this device's clock. The longest choice is 180 days less ten minutes, so a hand can't arrive too late.",

  "defaults.d62.title": "A helper's account can be set up at the thanks.",
  "defaults.d62.body":
    "If the helper's account doesn't exist on the network yet, the thanks first sets it up through a go-between contract that holds nothing and acts in no one's name. The asker pays only what the setup costs. Without one, the helper is asked to answer with a key and name the account for the money.",

  "defaults.d63.title": "A locked copy for accounts that answer differently each time.",
  "defaults.d63.body":
    "Some accounts give a different answer to the keys message every time. For them, the new hand's key is kept on this device, locked, from just before the raise until you tick “I saved the link”. It does not protect against this site's own code.",

  "defaults.d66.title": "A hand can carry no reward.",
  "defaults.d66.body": "A thank-you only. No money moves, and the card says so.",

  // The setting itself, in mono, as this build has it: Core's own names stay as written.
  "defaults.value.d21": "GIVE · ONE-TIME KEY OR NEW ADDRESS · NO KEY KEPT",
  "defaults.value.d26b": "expiry = block time + {days} d",
  "defaults.value.d31": "SHARE AT · IN A BLOCK",
  "defaults.value.d32": "MODE = UNLISTED",
  "defaults.value.d37": "ASKER = SOMEONE",
  "defaults.value.d39": "FRAGMENT · READ ONCE · REPLACESTATE",
  "defaults.value.d40none": "NIP-17 · NO RELAY CONFIGURED",
  "defaults.value.d61": "NOW = LATEST BLOCK · EXPIRY_MARGIN = 10 MIN",
  "defaults.value.d62none": "forwarder = NONE",
  "defaults.value.d63": "AES-GCM · NON-EXTRACTABLE DEVICE KEY · UNTIL SAVED",
  "defaults.value.d66": "reward = 0 ALLOWED",
};

export default en;

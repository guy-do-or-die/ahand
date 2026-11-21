// The waiting screen's words in English (UX-SPEC §9). Keys are dotted ids; ru.ts has the same keys.
// This is the one screen where "safe" may stand, and only in waiting.safe (the words guard allows it here).
// Keys with a `lens` segment are the specialist layer: Core's own names, in mono.
const en = {
  "waiting.title": "Money waiting for an address.",
  "waiting.intro": "When money can't reach its address at the moment a hand is thanked or sent back, it is held until it can. From here it can be taken out, or delivered.",

  // Whose money
  "waiting.look.label": "Whose money? Paste any address to look",
  "waiting.look.go": "Look",
  "waiting.look.readOnly": "Looking only reads. Nothing is sent.",
  "waiting.look.bad": "That isn't a whole address yet: 0x and forty characters.",
  "waiting.look.mine": "Show my own",
  "waiting.start": "Paste any address, or Connect a wallet, to see what waits for it.",
  "waiting.for": "For this address",

  // What waits
  "waiting.heading": "Waiting for this address",
  "waiting.reading": "Reading the contract…",
  "waiting.nothing": "Nothing is waiting for this address.",
  "waiting.offline": "Can't reach the network right now. Nothing was sent, and the money is where it was.",

  // The two actions
  "waiting.takeOut": "Take it out",
  "waiting.takeOut.where": "Where the money lands",
  "waiting.takeOut.here": "To this address",
  "waiting.takeOut.elsewhere": "To another address",
  "waiting.takeOut.toLabel": "Paste the address it should land at",
  "waiting.takeOut.only": "Only this address can send its money somewhere else.",
  "waiting.deliver": "Deliver",
  "waiting.deliver.note": "Whoever presses, it lands only at this address.",
  // Nobody connected: Deliver is still on the row, and its press opens "Connect a wallet"
  "waiting.deliver.visitor": "Anyone can deliver it. You'll be asked to Connect a wallet first; whoever presses, the money lands only at this address.",
  "waiting.cost.checking": "Working out what it costs…",

  // When nobody here can pay the cost
  "waiting.safe": "This money is safe where it is. Anyone can press Deliver; it always lands at this address.",
  "waiting.friend": "Send this page to anyone who can press Deliver:",

  // When it doesn't go
  "waiting.stuck": "The token won't move this money to this address right now.",
  "waiting.kept": "The money stays waiting; nothing was lost.",
  "waiting.stuck.said": "What the token said",
  "waiting.issuer": "Why would a token refuse? Its issuer can freeze an address, and then that money waits.",
  "waiting.failed": "It didn't go through.",

  // After it went
  "waiting.done": "Sent: {amount} reached the address below.",
  "waiting.done.to": "Landed at",

  // Do it without us
  "waiting.withoutUs": "Do it without us",
  "waiting.withoutUs.body": "The same action from a terminal, with no site. Anyone can run it; only the address the money waits for can change where it lands.",
  "waiting.withoutUs.more": "Every way to do it without us",

  // Hands this device knows
  "waiting.events.heading": "From hands this device knows",
  "waiting.events.reading": "Reading what those hands left…",
  "waiting.events.noHands": "This device knows no hands yet. The amounts above are read from the public record itself.",
  "waiting.events.none": "No hand this device knows left money waiting for this address.",
  "waiting.events.hand": "Hand {hand}",
  "waiting.events.waited": "{amount} started waiting here",
  "waiting.events.took": "{amount} taken out",

  // The lens: Core's own names
  "waiting.lens.perToken": "Waiting money is counted per token and address, not per hand: pending(token, payee).",
  "waiting.lens.view": "pending({token}, {payee}) = {amount} · block {block}",
  "waiting.lens.bounded": "Pending logs are read only in each hand's closing block, by its handId. Withdrawn carries no handId, so it is shown for what was taken out here.",
  "waiting.lens.pending": "Pending · block {block} · log {index} · tx {tx}",
  "waiting.lens.withdrawn": "Withdrawn · block {block} · log {index} · tx {tx}",
  "waiting.lens.calldata": "calldata",
};

export default en;

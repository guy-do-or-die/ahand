import { defineScenario } from "../engine/scenario";

/** The relay is off: the answer cannot travel by itself, so it goes back by hand, and the thank still pays. */
export default defineScenario({
  id: "relay-down",
  title: "The relay is down: the answer goes back by hand, and the thank still pays",
  story:
    "Nina raises a hand and Alex passes it on. Then the stand's relay goes down. Gina answers; her page says it could not reach the asker and asks her to send the answer back to whoever sent her the link. The address travels back by hand, Nina pastes it on Thank, and Gina is paid. No server was needed for the money.",
  covers: ["U18", "UX §8.5", "UX §7.5"],
  targets: ["stand"],
  tags: ["fault", "relay", "exit"],
  watch: ["no-fragment-after-load"],
  personas: {
    nina: { name: "Nina", role: "asker", wallet: { kind: "dev", account: 1 } },
    alex: { name: "Alex", role: "holder", wallet: { kind: "none" } },
    gina: { name: "Gina", role: "helper", wallet: { kind: "dev", account: 4 } },
  },
  steps: [
    { who: "nina", do: "raise", title: "Who can tune a piano in Kutaisi?", reward: "20", as: "piano" },
    { who: "alex", do: "open", link: "piano" },
    { who: "alex", do: "pass", as: "piano-via-alex" },
    { do: "service", service: "relay", on: false, caption: "The stand's relay goes down" },
    { who: "gina", do: "open", link: "piano-via-alex" },
    {
      who: "gina",
      do: "give",
      words: "I tune pianos; I can come on Tuesday.",
      payee: "wallet",
      delivery: "by-hand",
      as: "gina-give",
      caption: "Gina answers; no relay takes it, so the page gives her the answer to send back by hand",
      expect: [{ see: "give.fallback", says: "give.fallback" }, { see: "give.delivered", count: 0 }, { give: "gina-give", core: "accepted", payee: "@gina" }],
    },
    {
      who: "nina",
      do: "thank",
      link: "gina-give",
      caption: "Alex hands Gina's answer back to Nina; she pastes it on Thank",
      expect: [{ tx: { payouts: [{ kind: "paid", payee: "@gina", amount: "20" }] } }, { hand: "piano", state: "thanked", givenBy: "gina-give" }],
    },
    { do: "service", service: "relay", on: true, caption: "The relay is back" },
  ],
  checks: [{ hand: "piano", state: "thanked" }, { received: "gina", amount: "20" }],
});

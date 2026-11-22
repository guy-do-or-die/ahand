import { defineScenario } from "../engine/scenario";

/** Nobody answered in time: anyone may send the reward back, and the asker is whole. */
export default defineScenario({
  id: "times-up-send-back",
  title: "Time's up: a stranger sends the reward back",
  story:
    "Nina raises a hand for 7 days with 5 test dollars. Nobody helps. A week and a day later Vic, a stranger with a wallet, opens the link, sees Time's up and sends the reward back. Nina has all of it again, and Vic paid only gas.",
  covers: ["uc:no-disputes", "uc:permissionless", "flow:hand-view"],
  targets: ["stand", "fork"],
  tags: ["expiry", "refund", "permissionless", "clock"],
  personas: {
    nina: { name: "Nina", role: "asker", wallet: { kind: "dev", account: 1 } },
    vic: { name: "Vic", role: "visitor", wallet: { kind: "dev", account: 5 } },
  },
  steps: [
    { who: "nina", do: "raise", title: "Who has a spare tent for one night?", reward: "5", days: 7, visibility: "unlisted", as: "tent" },
    { who: "vic", do: "open", link: "tent", caption: "Vic opens the link: the hand is open" },
    { do: "clock", days: 8 },
    { who: "vic", do: "send-back", caption: "The page follows the network's clock: Time's up. Vic sends the reward back" },
  ],
  checks: [
    { hand: "tent", state: "refunded" },
    { askerWhole: "tent" },
  ],
});

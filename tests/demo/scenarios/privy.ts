import { defineScenario } from "../engine/scenario";

/**
 * Someone with no crypto app answers: they sign in with their email through Privy's window and
 * Privy makes them a wallet. A fork brought up with Privy (bun tests/demo/fork.ts up --privy-port
 * 3411): Privy's real service, a Privy test account (engine/privy.ts), Base Sepolia's Core copied
 * locally. The asker thanks from exit.html with her own wallet, so no one else needs Privy.
 */
export const privyEmail = defineScenario({
  id: "privy-email",
  title: "A helper with no crypto app signs in by email (Privy) and gets paid",
  story:
    "Nina raises 20 test dollars for a lost cat and sends the link to Gina. Gina has no crypto app: on Give she presses Log in to get paid, types her email in Privy's window and the code it sends, and Privy makes her a wallet. Her answer is signed by it without a window of its own. Nina thanks it, and the 20 land in Gina's Privy wallet.",
  covers: ["U15", "UX §8.4"],
  targets: ["fork"],
  tags: ["privy", "email", "walletless-helper"],
  personas: {
    nina: { name: "Nina", role: "asker", wallet: { kind: "dev", account: 1 } },
    gina: { name: "Gina", role: "helper", wallet: { kind: "privy-test", account: 1 } },
  },
  steps: [
    { who: "nina", do: "raise-sdk", reward: "20", title: "Has anyone seen a grey cat near the old market?", as: "cat" },
    { who: "gina", do: "open", link: "cat", caption: "Gina opens Nina's link: no wallet, no app" },
    {
      who: "gina",
      do: "give",
      words: "I saw a grey cat on the market's roof this morning; I can show you where.",
      payee: "wallet",
      as: "gina-answer",
      caption: "Gina answers and logs in to get paid: her email, the code, a wallet Privy keeps for her",
      expect: [{ give: "gina-answer", core: "accepted", payee: "@gina", claimBps: 10000 }],
    },
    { who: "nina", do: "exit-thank", link: "gina-answer", caption: "Nina thanks the answer with her own wallet" },
  ],
  checks: [
    { hand: "cat", state: "thanked" },
    { received: "gina", amount: "20" },
  ],
});

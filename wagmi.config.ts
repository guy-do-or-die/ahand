import { config } from 'dotenv';
import { defineConfig } from "@wagmi/cli";
import { foundry, react } from "@wagmi/cli/plugins";

import * as chains from "wagmi/chains";


config();

export default defineConfig({
  out: "src/contracts.ts",
  plugins: [
    foundry({
      deployments: {
        AHandBase: {
          [chains.base.id]: process.env.AHAND_BASE,
          [chains.baseSepolia.id]: process.env.AHAND_BASE_SEPOLIA,
          [chains.foundry.id]: process.env.AHAND_ANVIL,
        },
      },
    }),
    react(),
  ],
});

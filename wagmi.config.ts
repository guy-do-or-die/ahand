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
          [chains.optimism.id]: process.env.AHAND_OPTIMISM,
          [chains.optimismGoerli.id]: process.env.AHAND_OPTIMISM_GOERLI,
          [chains.base.id]: process.env.AHAND_BASE,
          [chains.baseGoerli.id]: process.env.AHAND_BASE_GOERLI,
          [chains.polygon.id]: process.env.AHAND_POLYGON,
          [chains.polygonMumbai.id]: process.env.AHAND_POLYGON_MUMBAI,
          [chains.scroll.id]: process.env.AHAND_SCROLL,
          [chains.scrollSepolia.id]: process.env.AHAND_SCROLL_SEPOLIA,
          [chains.foundry.id]: process.env.AHAND_ANVIL,
        },
      },
    }),
    react(),
  ],
});

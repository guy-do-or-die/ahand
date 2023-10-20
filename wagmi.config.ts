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
          [chains.polygon.id]: process.env.AHAND_POLYGON,
          [chains.polygonMumbai.id]: process.env.AHAND_POLYGON_MUMBAI,
          [chains.foundry.id]: process.env.AHAND_ANVIL,
        },
      },
    }),
    react(),
  ],
});

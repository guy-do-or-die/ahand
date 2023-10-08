import { config } from 'dotenv';
import { defineConfig } from "@wagmi/cli";
import { foundry, react } from "@wagmi/cli/plugins";
import * as chains from "wagmi/chains";

import { DEPLOYED_ADDRESS } from "./deployedAddress.ts"


config();

export default defineConfig({
  out: "src/contracts.ts",
  plugins: [
    foundry({
      deployments: {
        AHand: {
          [chains.base.id]: process.env.AHAND_POLYGON,
          [chains.baseGoerli.id]: process.env.AHAND_POLYGON_MUMBAI,
        },
      },
    }),
    react(),
  ],
});

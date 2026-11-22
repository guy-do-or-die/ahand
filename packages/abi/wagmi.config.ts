// @wagmi/cli's configuration of @ahand/abi: `bun run generate` (in packages/abi) writes src/generated.ts,
//   aHandCoreAbi, mockUsdAbi   the ABIs of forge's build in contracts/out (the foundry plugin)
//   DEPLOYMENTS                the checked records of contracts/deployments (plugins/deployments.ts)
// and `bun run check` fails when that file differs from what is committed. Build the contracts first
// (bun run build:contracts at the root): the foundry plugin reads contracts/out and builds nothing.
//
// React hooks are not generated here. A package of hooks (@ahand/react) gets its own wagmi.config.ts
// with the react plugin, its contracts taken from this package's ABIs, for example
// `contracts: [{ name: "AHandCore", abi: aHandCoreAbi }]`, so nothing here changes for it.
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

import { deployments } from "./plugins/deployments.js";

const PACKAGE = fileURLToPath(new URL(".", import.meta.url));
const CONTRACTS = join(PACKAGE, "../../contracts");

export default defineConfig({
  out: join(PACKAGE, "src/generated.ts"),
  plugins: [
    foundry({
      project: CONTRACTS,
      artifacts: "out",
      // Core is the protocol. MockUSD is the 6-decimal test token of the local chain (31337).
      include: ["AHandCore.sol/AHandCore.json", "MockUSD.sol/MockUSD.json"],
      // The plugin asks forge for the project's settings even when it builds nothing: name Foundry's
      // forge by path, as every script here does (a bare `forge` may be another program).
      forge: {
        path: join(process.env.FOUNDRY_BIN || join(homedir(), ".foundry/bin"), "forge"),
        build: false,
        rebuild: false,
      },
    }),
    deployments({
      records: join(CONTRACTS, "deployments"),
      artifact: join(CONTRACTS, "out/AHandCore.sol/AHandCore.json"),
    }),
  ],
});

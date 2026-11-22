# `@ahand/abi`

AHandCore's ABI as forge builds it, its deployment records, and the USDC of each network aHand runs
on. Exports: `src/index.ts`.

| Export | From |
| --- | --- |
| `aHandCoreAbi`, `mockUsdAbi` | forge's build in `contracts/out`, through the foundry plugin of [@wagmi/cli](https://wagmi.sh/cli) |
| `DEPLOYMENTS` | `contracts/deployments/<chainId>.json` (not `31337*`), through this package's wagmi plugin `plugins/deployments.ts` |
| `parseDeployment`, `DeploymentError`, `Deployment` and its types | `src/deployment.ts`, hand-written |
| `NETWORKS`, `networkOf`, `coreOf`, `usdcOf` | `src/networks.ts`, hand-written |

`aHandCoreAbi`, `mockUsdAbi` and `DEPLOYMENTS` live in `src/generated.ts`, which @wagmi/cli writes
from `wagmi.config.ts`; the ABIs keep the names it gives them (`<contract in camelCase>Abi`). Do not
edit that file by hand:

```sh
bun run build:contracts             # at the root: forge build in contracts/
bun run --cwd packages/abi generate # writes src/generated.ts

bun run check:abi                   # at the root: regenerates it and fails if git holds something else
```

The foundry plugin builds nothing: it reads `contracts/out` and calls Foundry's `forge` only by path
(`$FOUNDRY_BIN`, default `~/.foundry/bin`). The deployments plugin writes a record only after checking
its values against the Core this tree builds: every address in its EIP-55 checksum, the deterministic
deployer as factory, aHand's salt, the initcode hash of `contracts/out`'s AHandCore, and
`core = create2(factory, salt, initcodeHash)`. A record that fails stops the generation, and so
`check:abi`.

`bun run check:abi` has no check mode of @wagmi/cli to rely on: `scripts/check.ts` regenerates the file
and compares it with what git holds for it (the index; the commit, in CI), counting a file git does
not hold as stale. `bun run test:abi` makes the same comparison without git (`src/generated.test.ts`).

React hooks are not generated here. A package of hooks (`@ahand/react`) will have its own
`wagmi.config.ts` with @wagmi/cli's react plugin and its contracts taken from this package, for
example `contracts: [{ name: "AHandCore", abi: aHandCoreAbi }]`; nothing here changes for it.

The `generate` script runs `bunx --bun wagmi`, which finds @wagmi/cli in this package's
`node_modules/.bin`. Run it through `bun run --cwd packages/abi generate` (or the root scripts),
not `bunx wagmi` from elsewhere: outside this package bunx would fetch the npm package `wagmi`,
which is the React library, not the CLI.

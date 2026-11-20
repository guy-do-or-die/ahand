# Deploy

```sh
$ cast keccak "aHand.core/1"
0x4f0ff848a233427c84043ed87224bdfcb9f141e864d27833ac5d1344e3a3347d
$ cast compute-address 0x4e59b44847b379578588920cA78FbF26c0B4956C \
    --salt 0x4f0ff848a233427c84043ed87224bdfcb9f141e864d27833ac5d1344e3a3347d \
    --init-code-hash 0x9f4031e9df87b432822254b2e546d1fc8b88a6bb8798522e7b47d1ab5a08de65
0x65ac707E2AE7392583de5d6192C619F1D8862309
```

Code found at that address can only have come from that initcode. So "this is the Core built from commit X" is proven by one derivation, not by trusting a list the same site serves (D-10).

**Nothing has been deployed to any public network.** Only local anvil chains (31337) were used. Deploying to Base, and declaring a canonical Core for real networks, is the owner's act.

## CREATE2

`contracts/script/Deploy.s.sol` deploys `new AHandCore{salt: SALT}()` through the deterministic deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`, with `SALT = keccak256("aHand.core/1")` (D-9). Core's constructor takes no arguments, so the initcode, and with it the address, is the same on every chain where that deployer exists. The script is idempotent: a second run on the same chain keeps Core.

On chain 31337 only, the same script also deploys the test helpers: `MockUSD` and `BlacklistToken` (1 000 000 each minted to anvil accounts 1–5), `KeyAccountFactory` (counterfactual accounts for the "not set up yet" path) and `Forwarder` (Multicall3's `aggregate3` signature). On any other chain it deploys Core only (tested in `contracts/test/Deploy.t.sol`). The stand refuses any chain id but 31337 before deploying.

```sh
bash contracts/script/deploy.sh <rpc> [forge args]      # fills commit and dirty from git, deploys, then checks
bash contracts/script/check-deployment.sh <file> <rpc>  # every field against the chain and this clone
```

`check-deployment.sh contracts/deployments/31337-slot3.json http://127.0.0.1:18575` printed `deployment … holds on chain 31337` on 2026-11-20. `deploy.sh` was not run by this package (the stand runs `forge script` itself, under its lock).

## The deployment JSON

Written with `vm.writeJson` to `DEPLOY_OUT`, default `contracts/deployments/<chainId>.json`; Foundry may write only under `./deployments` (`fs_permissions` in `contracts/foundry.toml`). Stand slot N writes `31337-slot<N>.json`; files `31337*.json` are not committed. Parsed and validated by `parseDeployment` in `packages/abi/src/deployment.ts`. The fields, one line each, are in `contracts/deployments/README.md`:

`chainId`, `core`, `factory`, `salt`, `initcodeHash`, `runtimeHash` (information only: OpenZeppelin's EIP-712 fills seven immutables, so it differs per chain), `deployBlock`, `tokens` (`[{address, symbol, decimals, kind}]`, kind `usd` or `blacklist`, on 31337 only), `forwarder` and `accountFactory` (null except on 31337), `commit`, `dirty`, `solc` (0.8.35), `optimizerRuns` (200), `evmVersion` (prague), `oz` (5.6.1).

## Reproducing the initcode hash

```sh
cd contracts && "${FOUNDRY_BIN:-$HOME/.foundry/bin}/forge" build && "${FOUNDRY_BIN:-$HOME/.foundry/bin}/cast" keccak "$(jq -r .bytecode.object out/AHandCore.sol/AHandCore.json)"
0x9f4031e9df87b432822254b2e546d1fc8b88a6bb8798522e7b47d1ab5a08de65
```

This is the line `bun tools/ahand.ts core-check` and the `/core` screen print. It needs `jq`. The hash does not depend on the folder the clone sits in: `contracts/foundry.toml` sets `auto_detect_remappings = false` with two relative remappings, because Foundry otherwise wrote the clone's absolute path into Core's metadata and so into the initcode (found by the tools package, fixed in wave 2; `docs/build-notes/tools-cli.md`). The compiler settings that the hash depends on are those in `foundry.toml`: solc 0.8.35, optimizer 200 runs, `evm_version` prague, OpenZeppelin 5.6.1 under `contracts/lib`.

To check a running chain against this clone in one command:

```sh
bun tools/ahand.ts core-check --rpc <rpc> [--deployment <file>]
```

It recomputes the initcode hash from `contracts/out` (and checks that `out` was compiled from today's `AHandCore.sol`), derives the CREATE2 address, compares with the deployment file, reads the code, `eip712Domain()` and `MAX_EXPIRY_PERIOD`. On slot 3 every line was `ok`.

## The app's own build

The stand writes `build.json` beside the built app: the sha256 of every file, and the coreutils command that recomputes it from inside the folder (`tools/manifest.ts`, `hashDir`). `/core` fetches it at that moment and labels it "served by this site". A manifest tying a deployment, the commit, the compiler settings and an app hash together is `bun tools/ahand.ts manifest <chainId> --app <dist>`.

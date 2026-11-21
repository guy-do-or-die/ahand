# Deployments

`script/Deploy.s.sol` writes one JSON file here per deployment, only when run with `--broadcast`:
`<chainId>.json` by default, or the path in `DEPLOY_OUT` (local deploys use names like
`31337-<name>.json`). Off the local chain it never writes over an existing file unless
`DEPLOY_OVERWRITE=true`. Foundry may write only in this folder (`fs_permissions` in `foundry.toml`).
Files of the local chain, `31337*.json`, are ignored by git and not committed.

## `84532.json`: Base Sepolia

aHand's Core is `0x65ac707E2AE7392583de5d6192C619F1D8862309`, on Base Sepolia and on every chain
where it is deployed through the same deployer. The Core there was built from the same source as
this branch: its `initcodeHash` equals the hash of the AHandCore this tree builds, which the forge
test `DeploymentRecordTest` checks offline on every run of the gate, together with
`core = create2(factory, salt, initcodeHash)`. The recorded `commit` is on the history of the
`exp/e2e` branch, where that deployment was made; the source of Core is the same here.

The recorded `deployBlock` (61391126) is earlier than the block that created Core (61393192): the
field promises a block at or before the creation, and a log scan that starts earlier only reads more
blocks. The record is kept as it was written.

| Field | Meaning |
|---|---|
| `chainId` | the chain the file describes |
| `core` | AHandCore's address: `create2(factory, salt, initcodeHash)` |
| `factory` | the deterministic deployer, `0x4e59b44847b379578588920cA78FbF26c0B4956C` |
| `salt` | `keccak256("aHand.core/1")` |
| `initcodeHash` | `keccak256` of AHandCore's creation code; rebuild it from `commit` with the settings below |
| `runtimeHash` | `keccak256` of the code at `core`: information only (EIP-712 immutables make it differ per chain and address) |
| `deployBlock` | a block at or before the deployment: the next block when the run deployed Core; when Core was already there, the value an earlier run wrote to the same file, else `0` |
| `tokens` | on 31337: `[{address, symbol, decimals, kind}]`, kind `usd` (MockUSD) or `blacklist` (BlacklistToken); empty elsewhere |
| `forwarder` | on 31337: the test stand-in for Multicall3's `aggregate3`, through which a smart account not deployed yet is set up without the raiser's own account making that call; `null` elsewhere |
| `accountFactory` | on 31337: `KeyAccountFactory`, accounts not deployed yet; `null` elsewhere |
| `commit`, `dirty` | from `DEPLOY_COMMIT` and `DEPLOY_DIRTY` (`script/deploy.sh` sets both from git); `null` when not given |
| `solc`, `optimizerRuns`, `evmVersion`, `oz` | the build settings; `script/check-deployment.sh` compares them with `foundry.toml` and the OpenZeppelin package |

Check a file against its chain: `bash script/check-deployment.sh <file> <rpc-url>`, e.g.
`bash script/check-deployment.sh deployments/84532.json https://sepolia.base.org`.

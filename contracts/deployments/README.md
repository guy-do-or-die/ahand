# Deployments

`script/Deploy.s.sol` writes one JSON file here per deployment: `<chainId>.json` by default, or the
path in `DEPLOY_OUT` (a local stand of slot N writes `31337-slot<N>.json`). Foundry may write only in
this folder (`fs_permissions` in `foundry.toml`). Files of the local chain, `31337*.json`, are not
committed.

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
| `forwarder` | on 31337: the test stand-in for Multicall3's `aggregate3` (D-62); `null` elsewhere |
| `accountFactory` | on 31337: `KeyAccountFactory`, accounts not deployed yet; `null` elsewhere |
| `commit`, `dirty` | from `DEPLOY_COMMIT` and `DEPLOY_DIRTY` (`script/deploy.sh` sets both from git); `null` when not given |
| `solc`, `optimizerRuns`, `evmVersion`, `oz` | the build settings; `script/check-deployment.sh` compares them with `foundry.toml` and the OpenZeppelin package |

Check a file against its chain: `bash script/check-deployment.sh <file> <rpc-url>`.

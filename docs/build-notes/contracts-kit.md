# Build note: contracts-kit (wave 1)

Everything on chain around the Core, without touching it. `contracts/src/AHandCore.sol` sha256 was
`118f4d37f8a9d54d33245760b0f5871cbb79bf9bf4a7f152d89e84ef5713d738` before and after;
`git diff --stat -- contracts/src` is empty.

## What exists

| Path | What |
|---|---|
| `contracts/script/Deploy.s.sol` | `new AHandCore{salt: keccak256("aHand.core/1")}()` through the deterministic deployer. On 31337 only: MockUSD and BlacklistToken (1 000 000 each minted to anvil accounts 1 to 5), Forwarder, KeyAccountFactory. Writes the §3 JSON with `vm.writeJson` to `DEPLOY_OUT` (default `deployments/<chainId>.json`). Idempotent. |
| `contracts/script/deploy.sh` | `bash script/deploy.sh <rpc> [forge args]`: fills `commit`/`dirty` from git, deploys, then runs the check below |
| `contracts/script/check-deployment.sh` | `bash script/check-deployment.sh <file> <rpc>`: every field present; chain id; `core` = create2(factory, salt, initcodeHash) and has code; salt; runtime hash; EIP-712 domain aHand/core; initcodeHash = the AHandCore in `contracts/out`; solc/optimizer/evm/OZ = foundry.toml and `lib/openzeppelin-contracts`; on 31337 the helpers and tokens have code and read back |
| `contracts/deployments/README.md` | the JSON's fields, one line each |
| `contracts/test/mocks/KeyAccount.sol` | `KeyAccount` (ERC-1271, accepts a plain signature by its owner; `execute` for the owner) and `KeyAccountFactory` (`createAccount(owner, uint256 salt)` by CREATE2, idempotent; `getAddress`) |
| `contracts/test/mocks/Forwarder.sol` | `aggregate3(Call3[])` with Multicall3's signature and behaviour (reverts `"Multicall3: call failed"` unless `allowFailure`) |
| `contracts/test/Deploy.t.sol` | 13 tests: CREATE2 address, code, EIP-712 domain, mints, idempotence, Core-only off 31337, every JSON field and the derivation from the JSON alone, a path outside `./deployments` refused; the undeployed KeyAccount Give (`InvalidGiverSig` before, passes after the forwarder ran the factory in the same call, then thanked and paid), the forwarder failing like Multicall3, a hostile "setup call" through the forwarder moving nothing of the sender's |
| `contracts/foundry.toml` | one `fs_permissions` entry added: `./deployments` read-write |
| `contracts/exit/ahand.sh` | `status`, `refund`, `pending`, `withdraw`, `extend`, `fund`, `thank`; env `RPC`, `CORE`, `FOUNDRY_BIN`; after `--` straight to `cast send` |
| `contracts/exit/README.md` | the three exits (refund, withdraw, thank) on a block explorer, field by field, plus how to read `hands()` and Core's refusals |
| `contracts/exit/selftest.sh` | fresh anvil, deploy, then refund, pending, withdraw (to payee and elsewhere), extend, fund and thank through `ahand.sh`, each asserted from Core's views |
| `packages/abi/scripts/generate.ts` | writes `src/index.ts` and `abis/*.json` from `contracts/out`; `--check` exits 1 when stale |
| `packages/abi/src/index.ts` (generated) | `AHandCoreAbi`, `MockUSDAbi`, `BlacklistTokenAbi`, `KeyAccountFactoryAbi`, `KeyAccountAbi`, `ForwarderAbi`; re-exports the deployment type |
| `packages/abi/src/deployment.ts` (+ `.test.ts`) | `Deployment`, `DeploymentToken`, `TokenKind`; `parseDeployment(json)` that refuses a missing or malformed field, a null helper on 31337 and a helper set elsewhere |

## Choices the design did not make

- **Test contracts by CREATE2 too** (salts `keccak256("aHand.test/<Name>")`), so a rerun on the same chain keeps them and mints nothing twice. Their addresses change whenever their source bytes change (metadata hash), so nobody should hard-code them: read the JSON.
- **Default sender on 31337**: with no sender given, the script broadcasts as anvil's public account 0, so `forge script ... --rpc-url <anvil> --broadcast` works as written. On any other chain the caller must name a signer.
- **`deployBlock`** is `block.number + 1` at simulation (checked against the receipt: Core landed in block 1 of a fresh anvil, the JSON says 1). When Core was already there, it keeps what an earlier run wrote to the same file, else 0 (a lower bound: scan from genesis).
- **`commit`/`dirty`** come from `DEPLOY_COMMIT`/`DEPLOY_DIRTY` (forge cannot run git without `ffi`, which the brief's "nothing else" in foundry.toml rules out); null when absent. `script/deploy.sh` sets them; `dirty` means `src/` or `foundry.toml` differ from the commit.
- **`solc`, `optimizerRuns`, `evmVersion`, `oz`** are constants in the script (forge may not read foundry.toml from a script with the permissions allowed); `check-deployment.sh` fails if they drift.
- **Token `kind`**: `usd` (MockUSD; the integrator renamed it from `mock` so the deployment JSON, the helper chain and the app config share one word) and `blacklist` (BlacklistToken). Both tokens report symbol `mUSD` (BlacklistToken inherits MockUSD and mocks are not mine): the stand's config `label` must tell them apart.
- **Forwarder is not payable** (Multicall3's `aggregate3` is): same selector and ABI shape for value-0 calls, and it can never hold ether by mistake. It mimics Multicall3's revert string instead of bubbling errors, so SDK code tested on the stand behaves the same against Multicall3 on Base.
- **KeyAccount has `execute`** (owner only), so money paid to a test account is not stuck; ERC-1271 answers `0x00000000` instead of reverting on an unreadable signature.
- **`KeyAccountAbi`** is exported too (one more than the brief's five), for `owner()` and `execute`.
- **The shell kit judges state by the latest block's timestamp** (duty 13), refuses before sending when the state makes the call pointless, checks that `CORE` answers EIP-712 `aHand`/`core` before any send, and names Core's custom errors in the plain words of brief 02 §3. `fund` takes whole tokens (12.5) and approves exactly that amount only when the allowance is short and the sender is known (`--from` or `--private-key`); otherwise it approves first. `extend` takes unix seconds or `+Nd/+Nh/+Nm` from the latest block.
- **selftest port**: the first free of 18945..18954 (or `SELFTEST_PORT`); it takes the stand's forge lock (`infra/stand/.run/forge.lock`, mkdir, stale after 120 s) around `forge script`, and removes its deployment file, anvil and lock on exit.
- Deleted `packages/abi/src/addresses.base.json` and `addresses.base-sepolia.json` (two USDC addresses that only the old generator's `AHAND_CHAIN` switch read; nothing in the new workspaces uses them; `apps/web`, out of the workspaces, already imported a `DeployedAddresses` that HEAD's index did not export).

## What I ran (2026-11-20, this worktree)

| Command | Result |
|---|---|
| `cd contracts && ~/.foundry/bin/forge test` | 217 passed, 0 failed (8 suites; 13 of them in Deploy.t.sol) |
| `WRITE_VECTORS=true forge test --match-contract "SdkVectorsTest\|SdkGasTest" && git diff --exit-code -- test/fixtures` | 3 passed, no difference |
| fresh anvil on 18945, `DEPLOY_OUT=deployments/31337-slot9.json forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:18945 --broadcast` | file written with all 16 fields, forwarder and accountFactory set, deployBlock 1 |
| `cast code <core>`; `cast compute-address <factory> --salt <salt> --init-code-hash <initcodeHash>` | 10 733 bytes of code; the derived address equals `core` |
| same with `DEPLOY_OUT=/tmp/x.json` | refused by fs_permissions during simulation; block number unchanged, no file |
| `bash script/check-deployment.sh deployments/31337-slot9.json http://127.0.0.1:18945` | all checks ok |
| `bash script/deploy.sh http://127.0.0.1:18945` on the same chain | Core and tokens kept, no second mint, commit and dirty filled |
| `bash contracts/exit/selftest.sh` | exit 0; 25 PASS lines (refund, pending, withdraw both ways, extend, fund, thank, and six refusals in plain words, two of them Core's own `NotPayee` and `NotRaiser`) |
| `bun -e "import('./packages/abi/src/index.ts')..."` from the root | `true true true true true` |
| `bun packages/abi/scripts/generate.ts --check`; `cd packages/abi && bun test`; `bunx tsc --noEmit -p packages/abi` | up to date; 11 pass; no errors |
| `forge fmt --check` on the four new Solidity files | clean |

## Not verified

- Anything on a real network: the deterministic deployer's presence on Base, the explorer forms of `exit/README.md` (written from the ABI, not tried on Basescan), Multicall3 at `0xcA11…CA11`.
- `ahand.sh` with `--ledger`, `--account` or any signer other than `--private-key`; on macOS (`date -r` fallback written, not run).
- Nothing in this package is visible in a browser, so no screenshots were taken.

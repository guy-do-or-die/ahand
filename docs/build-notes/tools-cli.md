# Build note: tools-cli (wave 2)

`bun tools/ahand.ts`: aHand from a clone, with no site, no published package and no server.

## What exists

- `tools/ahand.ts`: five commands, `help` lists them.
  - `inspect <address-or-link> [--rpc URL] [--core 0x…]`: head (version, kind, chain, Hand, Core), the address's shape, sizes (bytes, base64url characters, QR digits, address characters), `secret: present (16 bytes)` for a live link, then with an RPC each pass (key → next key, payee, share, claim before → after, a stated dataHash), where the route ends, what the giver gets, `passesLeft`, what is attached in and outside the link, the Hand's own words after they matched their hash, and the Hand's state by the latest block's timestamp. Without an RPC it prints the head and sizes and says the route needs the chain.
  - `thank-calldata <give-address> --rpc URL [--forwarder 0x…] [--core 0x…] [--out FILE]`: opens the give link against the chain, refuses a closed or expired Hand (by chain time), asks Core's `checkGive` by `eth_call`, prints the payouts, Core's give hash, the worst gas (`worstThankGas`, with the giver's ERC-1271 check measured by `estimateGas` when the giver has code or will have it), the ready `ahand.sh thank … -- --gas-limit N` line and the calldata (also written to `--out`). A 6492-wrapped signature (viem's parser) on an account with no code: Core is asked in one `eth_call` through the forwarder (`aggregate3([setup, checkGive with the inner signature])`), then it prints `setup <cast> send <forwarder> --data … --rpc-url …` first and the thank calldata with the inner signature second. Core's refusal is printed as one sentence (the same sentences as `ahand.sh`), exit 1.
  - `pass <live-address> --rpc URL [--share-bps N --payee 0x…]`: signs a Shake with the link key (no wallet), keeps the received shape (faced keeps its `d`, bare stays bare), reads the written link back and says on stderr what it pays ("checked here"), and prints the new address alone on stdout.
  - `manifest <chainId> [--deployment FILE] [--app DIR] [--out FILE]`: reads `contracts/deployments/<chainId>.json` (or a stand file holding `deployment`), writes `<chainId>.manifest.json` beside it: the 16 fields of §3, `commitFrom`, `tree {commit, dirty}`, `compiler {solc, optimizer, optimizerRuns, evmVersion, viaIR, bytecodeHash, remappings, pathDependent}`, `initcode {tree, matches, sourceMatches, sourceSha256, reproduce}`, `sdk {version}`, `app {hash, files, reproduce}` or null.
  - `core-check --rpc URL [--deployment FILE]`: checks that `contracts/out` was compiled from today's `AHandCore.sol` (the metadata's keccak256), recomputes the initcode hash, derives `create2(0x4e59…956C, keccak256("aHand.core/1"), initcode)`, compares with the deployment file when there is one (its own derivation, its initcode, its chain), checks code, `eip712Domain()` = aHand / core / this chain / this address, reads `MAX_EXPIRY_PERIOD`, and prints the command that reproduces the initcode hash.
- `tools/manifest.ts`: `hashDir(dir, skip = ["build.json"])` → `{hash, files[{path, sha256, bytes}]}`, the list written as `sha256sum` writes it and sorted by the path's bytes, so `hashDirCommand(dir)` (find | sort | sha256sum | sha256sum) gives the same hash with coreutils; `coreBuild`, `coreAddressOf`, `reproduceCommand`, `treeState`, `readDeployment`, `manifestOf`.
- `tools/tests/`: `fixtures.ts` (helper chain per file on ports 15251–15253, raise, live/give addresses, a 6492 giver over `KeyAccountFactory`, the CLI as a child process), `inspect-pass.test.ts`, `thank.test.ts`, `core-manifest.test.ts`: 21 tests.

## Choices the design did not make

- **Imports by path, not `@ahand/sdk`.** `ahand.ts` imports `packages/sdk/src/{link,address,gas,hash,verify,types,data}.ts` directly. The package index re-exports the ten modules other agents are rewriting this wave; by path, the CLI depends only on the modules frozen with the link format, during the wave and after. `@ahand/abi` is imported by name.
- **Which Core is trusted.** `--core` (or `$CORE`), else the Core this clone builds (`create2` of `contracts/out`'s initcode: D-10's anchor), else `contracts/deployments/<chainId>.json`. A link naming any other Core is refused (fail closed, as `getHandFor`); `--core` opens it on purpose. Before any read the Core must answer `eip712Domain()` as aHand / core for this chain and address.
- **`--share-bps` is the holder's share of the whole reward**, i.e. `claimBps − nextClaimBps` (UX-SPEC §10.1 item 6). A share above `claim − minClaimBps` is refused with the largest allowed one. Payee zero and payee = Core are refused; payee = raiser or token is noted on stderr (`payee.ts` is being rewritten this wave, so the five comparisons are not imported).
- **`pass` and `thank-calldata` refuse an expired or closed Hand** (by the latest block). Nothing would come of a pass; Core refuses the thank.
- **Output channels.** `pass` writes the new address, which holds the new secret, alone on stdout so it can be piped; everything else on stderr. `inspect` never prints the input back. Texts from links are escaped for the terminal (control and bidi characters as `\uXXXX`, `\n`).
- **The setup line names cast by its absolute path** when `$FOUNDRY_BIN` or `~/.foundry/bin` has it (bare `forge` here is another program) and ends with `<your signing option>`: the CLI holds no key.
- **The worst gas goes into the `ahand.sh` line** as `--gas-limit`, so payees get their whole `payoutGasK`.
- **Manifest provenance.** The deployment's `commit`/`dirty` are kept; when the file has none, the tree's are used only if the tree builds the very initcode the file names, and `commitFrom` says which. Remappings are written with the clone's folder as `<repo>/`, so a manifest never carries a home path.
- **`hashDir` skips a top-level `build.json`** (the stand writes it from this hash) and refuses symbolic links.
- **English only.** A developer tool beside `ahand.sh`, which is English; the design asks Russian for the app's copy.

## What I ran (all on this machine, 2026-11-20)

| Command | Result |
|---|---|
| `cd tools && bun test` | 21 pass, 0 fail in 10 runs in a row; one run before them showed 1 fail whose output I did not keep and could not reproduce |
| `cd tools && bunx tsc --noEmit -p .` | 0 errors |
| inspect on a faced live address with `--rpc` | route, sizes, words, state by chain time; the output contains the seed in none of hex, base64url, digits, nor the link text (test) |
| `pass --share-bps 1000 --payee <acct 3>`, then `pass` at 0% | opened by the SDK: 1 then 2 Shakes, share 1000 bps to that payee, `d` kept; a bare address stays bare with its words inside |
| `thank-calldata` (key giver, one 10% pass) + `bash contracts/exit/ahand.sh thank FILE -- --gas-limit N --private-key <raiser>` | Hand closed, `thanks().giveHash` = the hash printed, holder +10.000000 mUSD, giver +90.000000 mUSD |
| `thank-calldata` on a 6492 give (undeployed `KeyAccount`) with `--forwarder` | setup line printed before the thank line; thank before setup leaves the Hand open; setup sent by account 9 deploys the account; then `ahand.sh thank` closes the Hand and the account receives the whole 100 mUSD |
| the same give link after the account was deployed beforehand | thanks with the inner signature, no setup line; Hand closed |
| a Give whose signer did not sign | `ahand: Core refused: InvalidGiverSig. …`, exit 1 |
| `core-check` on a fresh helper deployment; on a stand file; with no deployment file | exit 0 |
| `core-check` with a file naming another Core / another initcode / chain 8453; an RPC that is down | exit 1, one sentence each |
| `manifest 31337 --app DIR` | every §3 field, commit (40 hex), dirty, compiler, initcode match, SDK 0.1.0, app hash = `hashDir` |
| `hashDir` twice / after one byte / against `find … sha256sum \| sha256sum`; with a `build.json` added | same / different / equal / unchanged |
| The wave gate's line: `bun packages/sdk/tests/helpers/anvil.ts --serve --port 15260 --write-stand <tmp>`, then `bun tools/ahand.ts core-check --rpc http://127.0.0.1:15260` | exit 0 (also with `--deployment <the stand file>`); the serve process and its anvil stopped by pid afterwards |

## Found while building (for the integrator and the owner)

1. **The initcode hash depends on the folder the clone sits in.** `contracts/out/AHandCore.sol/AHandCore.json` records a remapping Foundry auto-detected with an absolute path (`/home/…/exp-e2e/contracts/lib/openzeppelin-contracts/:forge-std/=…`). Remappings are in the metadata, the metadata hash is appended to the code, so the initcode hash, and Core's CREATE2 address, change with the path. Run: the same `src/` and `foundry.toml` built in a scratch folder gave `0xc149…8f3b` instead of `0xebbc…1f77`. With `auto_detect_remappings = false` and one explicit remapping, two scratch clones at different depths both gave `0xf83e…e0f3`. So D-10's "anyone can reproduce it from the commit" does not hold today. `core-check` prints a warning when it sees an absolute remapping; the manifest records `pathDependent: true`. The fix is outside this package (see needs); it changes the Core address on every chain and the vector fixtures, so it needs the integrator and, for real networks, the owner.
2. **`contracts/exit/ahand.sh` reports a failed transaction as success.** With an explicit `--gas-limit` (which the worst gas needs), `cast send` does not simulate; a refused thank is mined with `status 0 (failed)`, and `send()` prints it and exits 0. Seen live: thanking a 6492 give before its setup. The test accepts either behaviour and checks the Hand stayed open.

## Not verified

- Any real network, Multicall3 as the forwarder, a real wallet or a hardware signer with the printed lines (only `--private-key` with anvil's public keys).
- An account with an EIP-7702 delegation as giver, and a giver whose `isValidSignature` is costly (the measured extra gas is from `KeyAccount` only).
- A Core given with `--core` that is not the canonical one (the refusal path is tested; opening such a link is not).
- The reproduce command in a real fresh `git clone` (scratch copies of `contracts/src`, `foundry.toml` and the same `lib` were used).

## Applied by the wave 2 integrator

- `contracts/foundry.toml` now has `auto_detect_remappings = false` and two explicit relative remappings (`@openzeppelin/contracts/`, `forge-std/`). Core's initcode hash is `0x9f40…de65` both in the worktree and in a copy of `src/` + `foundry.toml` built three folders deeper; the CREATE2 address on anvil is now `0x65ac707E2AE7392583de5d6192C619F1D8862309` (was `0x5137…CbB0`). `core-check` no longer warns. `forge test` (217) and the vector rewrite (no fixture diff) pass.
- `contracts/exit/ahand.sh` `send()`: a mined transaction with `status 0 (failed)` now prints "the transaction was mined and reverted", replays it as a call on the block before to name Core's error, and exits 1. `tests/thank.test.ts` asserts exit 1 and `Core refused: InvalidGiverSig.` for the thank sent before the ERC-6492 setup.

# Evidence: what ran on 2026-11-20, and what it shows

**A rehearsal on a local chain. This is not the plan's M4 gate evidence** (that gate names
Sepolia and two real devices, D-58). **No real wallet, camera, messenger, public relay or public
network was used.** Every money movement below happened on anvil (chain 31337) on this machine,
signed by anvil's public test keys or by keys made on the spot.

The tree described: branch `exp/e2e`, commit `1f73eab` (`git status` clean apart from the files of
this package: `docs/evidence.md`, `docs/build-notes/evidence.md`, `tests/e2e/shots.spec.ts`,
`tests/e2e/shots/`). The stand's deployment file records `commit 1f73eab…, dirty: false`.

## How it was run

From a clean state: `stand.ts down --all`, then `infra/stand/.run` and `apps/hand/dist` deleted,
then every command below once, in this order, from the worktree root, between 10:22 and 10:40
(Yerevan). Slot 0 for the stand, slot 9 for the clock test. The package suites ran with their
test ports moved into 20000–20049 (`SELFTEST_PORT=20000 RELAY_TEST_PORTS=20010-20014
DELIVER_TEST_PORTS=20015-20024 TOOLS_TEST_PORT_BASE=20025 STAND_STATIC_TEST_PORT=20040
FIXTURES_TEST_PORT=20042 STAND_TEST_SLOTS=0,9`). Foundry is `~/.foundry/bin` 1.8.6, Bun 1.4.4,
Playwright 1.65.1 with Chromium 1255. Every exit code was 0. (Since review round 1 the stand's
slots can be moved too, with `STAND_PORT_BASE`, and the app's and face's fixed test ports with
`HAND_TEST_PORT_BASE` and `FACE_TEST_PORT_BASE`; see the README. This run predates them.)

| # | Command | Seconds | Last lines, as printed |
|---|---|---|---|
| 1 | `sha256sum contracts/src/AHandCore.sol && bun run check:core` | 0 | `118f4d37f8a9d54d33245760b0f5871cbb79bf9bf4a7f152d89e84ef5713d738  contracts/src/AHandCore.sol` · `contracts/src/AHandCore.sol: OK` |
| 2 | `cd contracts && forge fmt --check && forge test` | 17 | `Ran 8 test suites in 16.22s (30.63s CPU time): 217 tests passed, 0 failed, 0 skipped (217 total tests)` |
| 3 | `cd contracts && WRITE_VECTORS=true forge test --match-contract "SdkVectorsTest\|SdkGasTest"`, then `git diff --exit-code -- contracts/test/fixtures` | 1 | `[PASS] test_vectors_sdkFixturesAreWhatCoreSays()` · `[PASS] test_gas_sdkRulesAreWhatCoreSpends()` · `[PASS] test_gas_worstGasKeepsEveryPayoutItsLimit()` · `3 tests passed, 0 failed`; both fixture files rewritten at 10:23, `git diff` empty |
| 4 | `cd packages/sdk && bunx vitest run` | 48 | `Test Files  22 passed (22)` · `Tests  417 passed (417)` |
| 5 | `bun test` in `packages/abi` | 0 | `11 pass` · `0 fail` |
| 6 | `bun test` in `packages/deliver` | 7 | `34 pass` · `0 fail` |
| 7 | `bun test` in `apps/hand` | 8 | `327 pass` · `0 fail` · `Ran 327 tests across 31 files` |
| 8 | `bun test` in `apps/face` | 3 | `24 pass` · `0 fail` |
| 9 | `bun test` in `infra/stand` | 13 | `30 pass` · `0 fail` (the two-stands test ran on slots 0 and 9) |
| 10 | `bun test` in `infra/relay` | 0 | `7 pass` · `0 fail` |
| 11 | `bun test` in `tools` | 14 | `42 pass` · `0 fail` · `Ran 42 tests across 6 files` |
| 12 | `bun run check:abi` | 0 | `packages/abi is up to date with contracts/out` |
| 13 | `bash contracts/exit/selftest.sh` | 11 | `selftest passed: refund, pending, withdraw (to the payee and elsewhere), extend, fund and thank` (25 `PASS` lines) |
| 14 | `bun run typecheck` (and each of the 9 projects alone) | 78 | `packages/sdk: 0 errors` … `tests/e2e: 0 errors`; `TYPECHECK-OK` |
| 15 | `bun run build` | 1 | `dist/exit.html  572.78 kB │ gzip: 238.76 kB` · `✓ built in 227ms`; `index.html`, `gallery.html`, `exit.html` in `apps/hand/dist` |
| 16 | `bun infra/stand/stand.ts up --slot 0`; `status`; `curl -sI :18300/` | 4 | `site: face on http://127.0.0.1:18300 (face answered /healthz)` · `chain time 1798611984 at block 4: 40.00 days ahead of this machine` · `Referrer-Policy: no-referrer` and the §11 CSP · deployment `commit 1f73eab…, dirty: false` |
| 17 | `bun infra/stand/loop.ts --slot 0` | 1 | six lines, each `ok`: `usd`, `pending`, `refund`, `zero-reward`, `second-token`, `undeployed-account` (quoted in the table below) |
| 18 | `bun infra/stand/seed.ts --slot 0 --json` | 1 | 13 fixtures: refunded 7, expired 8, thanked 9, unlisted 10, dark 11, public 12, twoPasses 13, lost 14, give 15, resigned 16, undeployed 17, noReward 18, blocked 19 |
| 19 | `STAND_SLOT=0 bunx playwright test tests/e2e/smoke` | 240 | `95 passed (4.0m)` (14 files) |
| 20 | `STAND_SLOT=0 bunx playwright test tests/e2e/first-loop.spec.ts` | 13 | `1 passed (12.4s)` |
| 21 | `STAND_SLOT=0 bunx playwright test tests/e2e/guards` | 330 | `47 passed (5.5m)` (a11y 27, failclosed 11, wallclock 4, hygiene 3, russian 2) |
| 22 | `STAND_SLOT=0 bunx playwright test tests/e2e/drill.spec.ts` | 14 | `3 passed (13.3s)` |
| 23 | `stand.ts down --slot 0 && stand.ts up --slot 0`, then `life.spec.ts` | 50 | `1 passed (45.4s)` |
| 24 | the same again, on another fresh slot 0 | 45 | `1 passed (41.7s)` |
| 25 | `stand.ts up --slot 9`, then `STAND_SLOT=9 … clock.spec.ts`, then `down --slot 9` | 22 | `2 passed (17.6s)`; slot 9's three ports free afterwards |
| 26 | `stand.ts down --slot 0 && bun infra/stand/drill.ts --slot 0` | 9 | 13 `ok` lines over three stages · `drill passed: with face, the relay and then the whole site off, links opened and passed, and thank, refund and withdraw moved the money as Core says` · `no stand on any slot` |
| 27 | `stand.ts up --slot 0`, `seed.ts`, then `bun tools/ahand.ts core-check --rpc http://127.0.0.1:18545 --deployment contracts/deployments/31337-slot0.json` | 5 | 6 `ok` lines · `Core 0x65ac707E2AE7392583de5d6192C619F1D8862309 is the AHandCore this tree builds.` |
| 28 | `bun tools/ahand.ts verify --rpc http://127.0.0.1:18545 --core 0x65ac…2309 3` (the thanked fixture of that seed) | 1 | `18 checks: 17 ok, 1 not checkable here, 0 failed` (the description: "the words travel only in the link; none was given here") |
| 29 | `STAND_SLOT=0 bunx playwright test tests/e2e/shots.spec.ts` (this package's screenshots, same slot 0 stand as step 27) | 510 | `29 passed (8.5m)`; 215 PNGs in `tests/e2e/shots/`: 25 screens × 2 themes × 2 languages × 2 widths, the flip's back × 8, the sweep's end after a real thanks × 2, face's preview card × 4 and the generic card |
| 30 | `stand.ts down --slot 0`; `status`; `bun install --frozen-lockfile`; `sha256sum` | 2 | `no stand on any slot` · `Checked 264 installs across 387 packages (no changes)` · `118f4d37…d738` |

## Property → what shows it → what was seen tonight → what it does not show

The production bar of brief 05 §2, translated to this Core (core-v3: no charity, no `policyAdmin`,
`refund`, `extend`, `fund`). Rows marked **not shown** could not be shown on a local chain.

| Property | Shown by | Result tonight | Residual limit |
|---|---|---|---|
| Core is unchanged | step 1; step 2 | sha256 `118f4d37…d738`, `check:core` OK, before and after every run; `forge test` 217 passed, 0 failed | Slither, Halmos and Echidna (the M1 gate) were not re-run tonight; the journal of 19.11 records them. Unaudited |
| **The SDK matches the vectors Core writes today** | step 3 then step 4: Core rewrites `contracts/test/fixtures/sdk-vectors.json` and `sdk-gas.json`; the SDK's `core-vectors.test`, `link.test`, `data.test`, `gas.test` read those files | 3 forge tests passed and wrote both files; `git diff --exit-code` empty; SDK 22 files, 417 tests passed, among them `core-vectors.test` 21, `data.test` 10, `gas.test` 19, `link.test` 57 | Vectors cover what `SdkVectors.t.sol` and `SdkGas.t.sol` emit; a Core behaviour no vector exercises is covered only by the SDK's own anvil tests |
| Signatures in Core's 65-byte form; domain read from `eip712Domain()` | step 4 (`sign.test` 14, `tx.test` 30, `wallet.test` 7); step 27 | passed; core-check: `eip712Domain() answers "aHand", "core", chain 31337` | The other forms (64-byte, v 0/1, high s) are made in tests, not by real wallets |
| Worst gas before `thank`, and "one transaction can no longer carry it" | step 4 (`gas.test` 19, `live-core.test` 4); step 19 (`thank.spec` shows "costs about") | passed; drill stage 2: `worst gas 679935` for a one-pass Give | The L1 data part of Base's cost (`GasPriceOracle`) was not read: anvil has none |
| Cost said in dollars on Base and Ethereum | step 4 (`money.test` 8) | passed | Prices are the dated snapshot `packages/sdk/src/prices.json`, not a live price |
| **A cycle with no reward** | step 17 `zero-reward`; step 19 `thank.spec` "a hand with no reward…"; steps 23–24 (life's ninth step) | `hand 4: raised with reward 0 (no approve) → passed (5% of nothing) → given → thanked; Core: thanked …; events Thanked, Shaken, Given; no Paid, no Pending, no balance moved`; the smoke and both life runs passed | Whether the app should offer a Hand with no reward at all is left to the owner (D-66) |
| **A cycle in a second token through the SDK** | step 17 `second-token` | `hand 5 in BlacklistToken (0x94e1…943b), nobody blocked: raised 40 mUSD → passed (5%, then 0% anonymous) → given → thanked; … receipt Thanked, Shaken, Paid, Shaken, Given, Paid; Paid 2 + 38 = balances moved` | Both test tokens are 6-decimal and call themselves `mUSD`; a token with other decimals was not cycled. The app offers one token (D-27) |
| Pending payout, delivered later by anyone | step 17 `pending`; step 13; step 26 stage 3; step 22 test 3; life's waiting-money step | `withdraw refused while blocked; unblocked → withdraw by 0xf39F…2266 delivered 5, pending() 0, Withdrawn emitted`; drill: `pending 5000000 -> 0, payee +5000000` | Only `BlacklistToken`'s blocklist was used, not USDC's |
| **A helper whose account was not deployed is thanked** (R-28, D-62) | step 17 `undeployed-account`; step 19 `thank.spec` "the undeployed account: the set-up band, two steps, then code, a thanked hand and the helper's money"; step 4 `tx.test` | `Core's checkGive refuses it bare (InvalidGiverSig) and accepts it with the setup through the forwarder; setupCall sent, then thankCall with the inner signature → Core: thanked …; the account has code; … Paid 20 mUSD to it`; the smoke passed | The forwarder is the stand's test contract and the account is the test `KeyAccount`. **Not shown:** the atomic batch of setup and thank in a real wallet (EIP-5792; no such wallet here, so the app's two-step path ran); **not shown:** Multicall3's `aggregate3` as the forwarder (it is not on anvil and no public network was used); real smart-wallet factories (Coinbase, Safe) |
| A re-signed Give is shown and refused by default (R-29) | step 19 `thank.spec` "the re-signed pair…"; step 4 `resign.test` 10 | passed: only ticking the dropped holder unlocks the thanks | First seen is stored on the raiser's device, not as an EAS attestation (D-25) |
| Payee defaults to the signer; zero and Core refused | step 4 `payee.test` 6, `sign.test`; step 19 `give.spec` | passed | — |
| Honest states of a send; no automatic resend | step 19 `wallet.spec` "an approve goes Sent → In a block → the two further states"; `thank.spec` | passed | On anvil "Recorded on Ethereum" and "Final" are tagged `LOCAL STAND-IN` (D-52) |
| **An interrupted raise is recovered (both kinds of signer)** | step 19 `raise.spec` "a reload while the raise waits for a block sends nothing again, and the screen resumes" (a signer that repeats: dev account 1) and "an account that answers differently: the link survives the reload from the locked copy; no seed in clear storage; the tick empties escrow" (dev account 5, which never signs the same twice) | both passed | A reload in the few milliseconds between the wallet returning the hash and the app storing it is not recovered (known defect, PROGRESS wave 6). The locked copy is D-63, a deviation. Real smart wallets and MPC signers were not used |
| **Time is read from the chain** (D-61) | step 25 `clock.spec` on a fresh slot 9 (the chain moved 40 more days); step 21 `wallclock.spec` (the browser's clock two years behind and two years ahead); step 19 `wallet.spec` "the network's time runs at least 39 days ahead of the browser's"; step 16 | clock 2 passed, wallclock 4 passed, wallet passed; stand: `40.00 days ahead of this machine` | Base's block times were not seen; `apps/hand/tests/guards/clock.test` checks `src` by text, not every library |
| **A closed Hand points to a newer one** (R-27, D-64) | step 19 `hand.spec` "a refunded hand looks for a newer one by the same asker with exactly the requests it announced; a found hand opens with no actions"; step 4 `chain.test`; step 11 (`find.test`) | passed | A bounded look: at most 216 windows of 2 000 blocks after the end, by the same raiser address only. RPC log-range limits of public providers were not met |
| Giver on another device, no wallet, writes nothing on chain; Give delivered by NIP-17 | steps 23–24 (five people in separate contexts); step 20; step 17 `usd` | life passed twice; loop: `delivered to 1 of 1 relay and read from the Hand's inbox` | **Not shown:** public relays and the "3 of 5 relays OK" rule (only the stand's own relay; "delivered" = at least one OK) |
| The whole life: raise → pass → give → thank → payout; expiry → refund; pending → withdraw | steps 20, 23, 24; step 17 | first loop passed in 12.4 s; life passed in 45.4 s and 41.7 s, each on a fresh stand; loop's six parts ok | One browser (Chromium), dev wallet only, phone width, English; the Russian run covers the first five steps (step 21 `russian.spec`) |
| Fail closed on a bad link; another Core; a newer format | step 21 `failclosed.spec` 11 | passed | — |
| No seed, live link or twelve words leak (console, storage, query, requests) | step 21 `hygiene.spec` 3; step 7 (`tests/guards/secrets.test`) | passed | Checked in Chromium on 127.0.0.1 only |
| WCAG 2.2 AA on every route, 390 and 1280, light and dark | step 21 `a11y.spec` 27 (no known exception) | passed | axe only; no screen reader was used |
| Exit without the site | step 13; step 26 stage 3; step 22 "site off too: exit.html opened from disk refunds an expired Hand and delivers a pending payout" | selftest passed; drill: `ahand.sh refund (sent by a stranger): Hand 4 closedAt 1798616307 … raiser +12000000`; drill spec passed | Basescan's forms were not used; `ahand.sh` ran with test keys only |
| Survival drill: face, relay, then the whole site off | step 26; step 22 | 13 `ok`, `drill passed`; 3 passed | The paymaster leg of M4.3 does not exist (D-28: no paymaster) |
| Reproducible Core: initcode hash and CREATE2 address | step 27 | `initcode hash 0x9f4031e9…de65 (11627 bytes, built from AHandCore.sol sha256 118f4d37…)`, `create2(0x4e59…956C, keccak256("aHand.core/1") …) = 0x65ac707E2AE7392583de5d6192C619F1D8862309` | **Not shown:** the deterministic deployer on Base or any public chain. The address depends on `contracts/foundry.toml`'s remappings (PROGRESS wave 2) |
| A thanked Hand proves itself from the chain | step 28 | 18 checks, 17 ok, 1 not checkable (no description given) | `--give` and the bundle path were not run tonight (wave 5 ran them) |
| No "gasless" and no "XMTP" in the app | `grep -rioE "gasless\|xmtp" apps/hand/src apps/hand/dist infra/stand/.run/0/dist` | 0 hits | — |
| "Unaudited" is visible | step 19 `proof.spec` (the /core sentence, word for word); step 28 (`… Unaudited.`) | passed; printed | — |
| UI offers one dollar token; token risks said | step 19 `about.spec` (/limits, 16 entries) | passed | Listed tokens take their decimals from the deployment file, not from the token contract (a deviation, `docs/app-duties.md` duty 12) |
| CI runs forge, SDK and app checks | `.github/workflows/check.yml` | **not shown**: never run (no GitHub Actions here); its parts ran as steps 1–15 | — |
| On Base | — | **not shown**: no public network was used tonight (ground rule) | Every gas, price and finality number on Base is a reading of records, not a run |

## Not shown, and why

- **The atomic batch of setup and thank in a real wallet.** It needs a wallet that answers
  EIP-5792 `wallet_sendCalls` atomically; only the dev wallet exists here, so the app sent the two
  calls one after the other.
- **Multicall3 as the forwarder.** anvil has no Multicall3; the stand deploys its own forwarder
  with the same `aggregate3` shape. No public network was allowed.
- **Public relays.** Ground rule: nothing outside 127.0.0.1. Only the stand's in-memory relay.
- **Base**, or any public network: ground rule.
- **A real wallet extension, a camera reading a printed code, a messenger's preview robot, a
  real phone, WebKit, a screen reader.** None was available or allowed; Chromium alone ran.

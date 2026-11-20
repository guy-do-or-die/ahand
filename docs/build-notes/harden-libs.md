# harden-libs: the libraries against the app duties

Wave 6, 2026-11-20. Package owner: the `harden-libs` agent. Stand slot 2; test ports 19050–19099.

The SDK, delivery, stand, relay, tools and contracts kit were read as an outside reviewer would,
with the 23 duties of brief 02 §1 and the IN-27 list beside them. For each duty the table names
the code that meets it and the test that proves it, or the screen that owns it, or why it is not
met. Test names are quoted as `file › describe › it`, shortened where the file has one describe.

## What changed

| Change | Files | Why |
|---|---|---|
| `forCore` and `keySigForCore`: every link key's signature (each Shake's and the Give's) is brought to Core's 65-byte form (v 27/28, low s) before `thankCall` writes it; `checkRouteOnChain` and `checkGiveOnChain` ask Core with the same bytes. Bytes that are no key's signature in any form pass unchanged, so Core refuses them with its own error and position. The giver's own signature is only unwrapped from ERC-6492, never re-encoded (it may be a contract's) | `packages/sdk/src/tx.ts`, `packages/sdk/src/chain.ts` | Duty 3. Before, a Shake signature that arrived as ERC-2098 64 bytes or with v 0/1 (a route assembled outside `openLink`) went to Core as it came and the thank reverted with `InvalidKeySig`. Links never carried such bytes (the wire form is expanded on read), so nothing that worked changes |
| `raiserHops(raiser, signedShakes)`: the Shakes that pay the raiser or hand the link to the raiser's address | `packages/sdk/src/payee.ts` | Duty 11 asked to flag a hop whose payee **or key** is the raiser's; `payeeProblem` covered the payee only. The app does not call it yet (see Needs) |
| New tests (see the table): a wrapper naming the token as its factory moves nothing; link key signatures in other forms; fresh secrets only from `crypto.getRandomValues`; `findLaterHands` with `maxWindows` and an over-large window counted; a zero-reward refund's passport; `raiserHops` | `packages/sdk/tests/{tx,chain,proof,payee,random}.test.ts` | Duties 3, 4, 11, 15, 17, the payout check, IN-27 "keys only from a CSPRNG" |
| Two hints printed to people said `cd contracts && forge build`; on this machine bare `forge` is another program. They now say `"${FOUNDRY_BIN:-$HOME/.foundry/bin}/forge" build` | `tools/ahand.ts`, `tools/lib/cli.ts` | "Every script calls Foundry by path" |
| Test ports can be moved by environment, defaults unchanged: `RELAY_TEST_PORTS`, `DELIVER_TEST_PORTS` (from-to), `TOOLS_TEST_PORT_BASE`, `STAND_STATIC_TEST_PORT` (`FIXTURES_TEST_PORT` and `STAND_TEST_SLOTS` existed) | `infra/relay/tests/relay.test.ts`, `packages/deliver/tests/helpers.ts`, `tools/tests/*.ts`, `infra/stand/tests/stand.test.ts` | Four agents run the same suites at once; each package's tests had fixed ports outside this package's range |
| `.github/workflows/check.yml` runs the root `check` script. Its first line says it has never run | `.github/workflows/check.yml` | PLAN wave 6. It is not git-ignored (`!.github/` in `.gitignore`), so `git status` lists it |

Nothing in `contracts/` changed; Core's hash was checked before and after.

## The 23 duties (brief 02 §1)

| # | Duty | Where it is met | Proven by |
|---|---|---|---|
| 1 | Sign over the nested `Hand` taken from the link and proven, not from the chain; the link names the Hand (chain id, handId, terms) | `sign.ts` `shakeTypedData`, `giveTypedData`, `signShake`, `signGiveWithKey`; `link.ts` `openLink`: the terms `getHand` returns are accepted only if the first Shake's signature recovers to the root key under them, or the pin (`pinOf`) of a 0-Shake link matches, or the Give's key signature does; the chain id is always in the head | `link.test › names its Hand's terms: another Hand under the same number and root key is refused`; `link.test › the pin › is the first 16 bytes of what a wallet would sign for the Hand alone under Core's domain`; `sign.test › each link key signs its Shake to the bytes Core accepted`; `link-vectors.test` |
| 2 | Treat the minutes before `raise` is final as unsafe | The pin binds a 0-Shake link to the exact terms, so after a reorg it is refused, not misused (D-31); `chain.ts` `finalityOf` | `link.test › names its Hand's terms…`; `chain.test › how settled a block is › is in a block, then safe one block later, then final two blocks later`. The app's part: the TxRail on /raise |
| 3 | Only 65-byte signatures with v 27/28 | `sign.ts` `toCoreSignature` (used by `signShake`, `signGiveWithKey`, `keys.ts`); `wallet.ts` `signGive`; `tx.ts` `keySigForCore`, `forCore`, `thankCall`; `chain.ts` `checkRouteOnChain`, `checkGiveOnChain`; link wire signatures expanded on read | `sign.test › the one form of a key's signature Core takes › is reached from the short form, from v as 0 or 1 and from the higher s`; `wallet.test › signGive › a key's answer comes back in Core's 65-byte form, from any of the forms wallets give`; **new** `tx.test › link keys' signatures in another form (duty 3) › are brought to Core's 65-byte form before thankCall writes them, and Core then takes the thank` and `› leaves bytes that are no key's signature as they came…` |
| 4 | One secret per live link; a fresh root key per Hand, derived safely by the raiser's own Hand number | `link.ts` `encodeLive`, `passOn` (one seed, a fresh one per pass); `keys.ts` `masterOf`, `rootSeed`, `inboxSecret`, `newBook`, `matchRoot` (separate HKDF infos `aHand.root/1` and `aHand.inbox/1`, book + n, D-15, D-16) | `link.test › carries one secret: the new seed only, and a Give link none`; `keys.test › the same signature, book and n give the same seed; another book or n another`; `keys.test › rootSeed and inboxSecret differ, and the inbox secret is 32 bytes`; `keys.test › matchRoot finds n from the root key Core keeps, and nothing for another book`; **new** `random.test`. Reserving n before signing and the equality guard are the app's: /raise (`screens/raise/flow.ts`) |
| 5 | Count the Shakes, say how many passes are left, refuse past 369 by default | `gas.ts` `passesLeft`, `LONGEST_ROUTE`; `link.ts` refuses longer routes unless the application raises the limit | `gas.test › is 66 for payouts of 200 thousand gas, 369 by size alone, and zero past the limit`; `link.test › takes no more Shakes than one transaction can carry, unless the application says otherwise`. Shown on /hand and /pass |
| 6 | Offline check in Core's order, then Core's `checkGive` before trusting a Give | `verify.ts` `checkRoute`, `checkGive`; `steps.ts` `runSteps`, `checkOrder`; `chain.ts` `checkGiveOnChain` | `steps.test › runSteps against Core's own revert, on the helper chain` (14 cases); `verify.test › the routes Core refuses are refused with Core's error`; `chain.test › asks Core's checkRoute and checkGive and turns a refusal into CoreRefused with its position`. Called on /give (`give/answer.ts`) and /thank (`thank/check.ts`) |
| 7 | Never open or pass on a route below `minClaimBps` | `link.ts` route end check in `encodeLive`/`passOn` ("leaves the giver less than the Hand's minimum") | `link.test › is never passed on for less than the Hand's minimum for the giver: no Give could end such a route`. The early warning about a greedy share is the app's: /pass |
| 8 | Show a re-signed Give and who dropped out; refuse by default; no Give without the wallet's confirmation; record first seen | `resign.ts` `judgeGive`, `seenGiveOf`, `routeKeys` (by Hand and route, never by signer, D-24) | `resign.test › judgeGive` (9 cases: first, same, branch, middle cut that rejoins, tail cut by a one-time key, same signer elsewhere, anonymous tail, anonymous middle, every Give seen). Refusal, override and first-seen are the app's: /thank. **Not met as written**: first seen is stored on the device, not as an EAS attestation (D-25), and the two wallet-less paths sign without a wallet prompt (D-21) |
| 9 | Default payee = signer; claim shown as a share | `sign.ts` `giveTypedData` in Core's field order | `sign.test › a wallet is asked for the same Give and its answer is passed on untouched`. The default and the share wording are the app's: /give, `ui/LandSheet.tsx` |
| 10 | Refuse Core's own address as payee; zero refused by Core; a margin needs a payee | `payee.ts` `payeeProblem`, `payeeRefused`; `link.ts` refuses a Give with no payee; `verify.ts` `AnonymousMargin` | `payee.test › refuses zero and Core, and only flags the raiser and the token`; `steps.test › a margin kept for no one: AnonymousMargin(0)`. Shown by `ui/AddressInput.tsx` |
| 11 | Flag a hop whose payee or key is the raiser's | `payee.ts` `payeeProblem` ("raiser" for a payee typed in); **new** `raiserHops` for every Shake of a received route | `payee.test › raiserHops (duty 11)` (2 tests). **Partly met in the app**: the payee typed in is flagged; a received route's hops are not yet shown (see Needs) |
| 12 | Validate what Core cannot: bps scale, a nonzero wrong root key; token decimals from the token; USDC only | The root key is derived and checked with `matchRoot`/equality before raise, never typed; `tx.ts` `raiseCall` takes bps as integers | The app's: /raise (share chips, no free bps field) and the configuration (`config/schema.ts`: tokens with decimals copied from the deployment JSON, which `Deploy.s.sol` writes from the token). **Not met as written**: decimals are not read from the token contract at run time; they come from the deployment file the stand wrote |
| 13 | A short default expiry; remind to extend well before; read `MAX_EXPIRY_PERIOD`; keep a margin; one clock | `chain.ts` `chainNow`, `readHand().stateAt(now)` (a block's timestamp only), `expiryAfter`, `EXPIRY_MARGIN` = 600, `readLimits`. No `Date.now` in `packages/sdk/src` | `chain.test › keeps an expiry ten minutes below the cap`; `› raises at expiryAfter(chainNow, 180 days, cap) without a revert; cap + 1 and a past time are refused`; `› is open one second before the expiry and expired at it; refunded after the refund`; `› reads the chain's time, which runs ahead of this machine's`; `fixtures.test › no Date.now in seed.ts, loop.ts or craft.ts`; grep below. Reminders and the ten-minute warning: /care |
| 14 | A default `payoutGasK` with headroom; never 0 silently | `infra/stand/stand.ts` `configOf` defaults `payoutGasK: 250` (D-26); `gas.ts` counts it per payout | `stand.test › chain, Cores, deployment facts, tokens, helpers, relay, site, prices`; `gas.test › counts a payout only where a margin is kept, and always the Give's`. 0 is used only by stand tests |
| 15 | Show a closed Hand as closed and point to a newer Hand | `chain.ts` `findLaterHands`: `Raised` by raiser topic, at most `maxWindows` (216) windows of at most 2 000 blocks, `requests` known before any request, stoppable | `chain.test › finds a later Hand of the same raiser in exactly the requests it announced` (now also counts the capped and the over-large-window cases); `fixtures.test › the refunded Hand's raiser has later Hands, found from the block where it ended`; `find.test › prints its request count before the first log request, makes exactly that many…`. Screen: /hand (`hand/Closed.tsx`) |
| 16 | Count the worst gas and calldata before `thank`; warn or refuse past 16 777 216 gas or ~128 KiB | `gas.ts` `worstThankGas`, `TX_GAS_LIMIT`, `TX_BYTES_LIMIT` | `gas.test › says when one transaction can no longer carry the thank: too much gas, or too many bytes`; `live-core.test › is thanked with the worst gas the SDK counts: real transactions use that much and no more`. Used on /thank (`thank/check.ts`) |
| 17 | An undeployed smart-wallet giver: deploy first, in the same batch | `tx.ts` `setupCall` (always `forwarder.aggregate3`, never the sender's own name), `innerGiverSig`, `thankCall` (always the inner signature); `chain.ts` `checkGiveOnChain(…, setup)`; `wallet.ts` `unwrap6492`, `askSigner` | `tx.test › wraps the setup call in the forwarder's aggregate3, never in the sender's own name`; `tx.test › a giver whose account is not deployed yet (ERC-6492) › is refused bare, accepted with the setup, and closes the Hand as thanked by [setupCall, thankCall]`; **new** `tx.test › a wrapper whose "factory" is the token (duty 17, D-62) › moves nothing of the sender's through the forwarder, though the same call in the sender's own name would` (both `transfer` and `transferFrom` with a live allowance to Core, sent and mined as reverted; balances unchanged); `thank.test › a Give wrapped per ERC-6492…`; `loop.ts` part `undeployed-account`. Screen: /thank (`thank/Flow.tsx`) |
| 18 | Pass the raiser's own `dataHash` with `thank` if wanted | `tx.ts` `thankCall(…, dataHash?)`, `gas.ts` `thankCalldata` | `tx.test › writes each call so that Core's own ABI reads it back`. **Not offered by the app**: /thank always sends zero (the duty says "if wanted"; no screen asks) |
| 19 | Never show `Paid` as the amount received | `chain.ts` `receiptOf` names rows by event; `proof.ts` says "left Core" | The app's: the receipt (`ui/ReceiptTable`, /thank, /proof) |
| 20 | Show `pending` as waiting, offer `withdraw`; anyone may deliver it | `chain.ts` `readPending`; `tx.ts` `withdrawCall` | `chain.test › shows a blocked payee's share as Pending, which withdraw delivers`; `loop.ts` part `pending`; `drill.ts` stage 3. Screen: /waiting |
| 21 | Prove a thanked Give by rebuilding its hash against `thanks(id).giveHash` | `proof.ts` `collect`, `passportOf`, `thankInputOf`, `verifyBundle` | `proof.test › a thanked Hand with two passes… › every check is ok…`; `› tampering one field of the bundle fails at that check first`; `› returns nothing when the embedded Give does not hash to the stored giveHash…`; `verify.test` (tools) |
| 22 | The `dataHash` convention; check a description against the stored hash | `data.ts` `DATA_FORMAT`, `dataHashOf`, `isDataOf`; `describe.ts` `describeHand`, `readDescription`; `address.ts` `faceOf` | `data.test › hashes to what abi.encode(format, names, values) hashes to in Solidity`; `address.test › refuses a title that is not the Hand's, at the site and at the reader`; `describe.test` round trips |
| 23 | Counters are not reputation; a payee is not a participant without a receipt | The SDK reads no counter (`handsCount` is in the ABI, no function reads it); `proof.ts` names payees only from `Shaken`/`Given`/`Paid`/`Pending` | No screen reads a counter (`grep -rn handsCount apps/hand/src` finds nothing). Participants are shown from receipts on /proof and /thank |

### Payout check, zero amounts and a reward of zero

`proof.ts` `payoutCheck` expects one `Paid` or `Pending` after each amount above zero and none
after zero; a payout event after zero fails the check. Proven by
`proof.test › the zero-share pass has its share at 0 and no payout expected; the others are paid`,
`proof.test › a thanked Hand with no reward › passes with no payout rows at all`, and **new**
`proof.test › a refunded Hand › with a reward of zero: no payout event is expected, none is there,
and every check is ok`. `chain.ts` `receiptOf` applies the same rule.

## IN-27

| Item | Where | Proven by, or why not |
|---|---|---|
| Check every static condition of a route when a link arrives; never sign further on a broken branch | `link.ts` `openLink`, `passOn` | `link.test › the routes and Gives Core refused › …: no link of it opens and passes`; `› refuses every single flipped bit…` |
| Show a re-signed Give, who dropped out; refuse by default; no Give without wallet confirmation | `resign.ts` `judgeGive` | as duty 8; the two wallet-less paths are deviation D-21 |
| First Give's time through EAS | not met | D-25: stored on the raiser's device as "seen on this device" (`apps/hand/src/screens/my/inbox.ts`); EAS was cut from the first mainnet |
| `payee` defaults to `signer`; check the address (not zero, not Core) | `payee.ts` | as duties 9 and 10 |
| A stale link: "the Hand is closed", the author's newer Hand | `chain.ts` `findLaterHands` | as duty 15 |
| An undeployed smart-wallet giver: deploy as the first call of the thank batch | `tx.ts`, `chain.ts`, `wallet.ts` | as duty 17 |
| Don't offer negative-rebase or fee-on-transfer tokens | the configuration: one dollar token (D-27); Core refuses an inexact transfer (`InexactTransfer`) | `tx.test › raise: ZeroRootKey, MinClaimTooHigh, InexactTransfer, Reentered`. The choice of token is the configuration's, not code's |
| A payout gas limit at raise, per token | one default, 250, for the one token offered (`stand.ts` `configOf`, D-26) | **Not per token**: the configuration has one `payoutGasK` default; with one token offered this is the same thing. A second token would need a per-token field |
| The root key is not the person's burden | `keys.ts` (D-15); the locked copy for signers that do not repeat is the app's (`store/db.ts` `escrow`, D-63) | `keys.test`; the app's /raise smokes |
| Link keys only from the system's cryptographic generator | `link.ts` `newSeed` (viem `generatePrivateKey`), `keys.ts` `newBook`, `describe.ts` salt | **new** `random.test › fresh secrets come from crypto.getRandomValues only › newSeed, newBook and a Hand's salt ask the generator and never Math.random or the clock`. The root key is derived from a wallet signature instead (D-15, a recorded departure); `deliver` chat keys come from nostr-tools' `generateSecretKey` |
| Warn about a far expiry; remind to extend | `chain.ts` `expiryAfter` | as duty 13; the reminder (`.ics`) is /care |
| Gas preflight for long routes; a limit on link length | `gas.ts` `worstThankGas`, `passesLeft`; `link.ts` Shake limit | as duties 5 and 16 |
| The chain id in every link | `link.ts` head: `chainId` varint always written | `link-vectors.test`, `address.test › names the Hand of its link, the canonical Core by leaving its address out…` |
| A derived root key counts by the raiser's own Hand number | `keys.ts` book + n (D-16) | `keys.test › the same signature, book and n give the same seed; another book or n another` |
| Never send `raise` twice | the app's: /raise keeps the intent and hash before waiting (`screens/raise/flow.ts`) and nothing is resent automatically | the app's raise smoke |

## The points looked at hardest

- **Signatures in Core's form before any write.** Fixed (see above). Shake signatures read from a
  link were already 65 bytes; a route assembled by hand was not normalised before.
- **Terms from the link, proven.** `getHandFor` reads `hands(id)`, but `openLink` accepts those terms
  only when the link's own signature or pin fits them, so the chain cannot substitute other terms.
- **`getHandFor` fails closed.** An untrusted chain or Core, or a chain without a client, throws
  `UntrustedCore`; a Hand never raised throws `NotRaised` (`chain.test › which Core a link may name`;
  `errors.test › reads a contract outside the trusted list as link.untrusted`).
- **The clock.** `grep -rn "Date.now" packages/sdk/src` finds nothing; `new Date` and
  `performance.now` do not appear either. The stand reads the machine's clock in one place, to set
  anvil's start time; `foundry.ts` reads it for the lock's age, which is not a Hand's time.
- **The newer Hand.** `run` makes exactly `requests` `eth_getLogs` calls, never a window over 2 000
  blocks, and stops at the first `false` from `onProgress`.
- **Keys.** Separate infos, the book, `n` as 4 bytes; no SDK function returns a seed except
  `rootSeed` (asked by name) and `passOn` (the new link's own seed); nothing in `packages/sdk/src`
  or `packages/deliver/src` logs (`grep -rn "console\." …` finds nothing). `tools/ahand.ts recover`
  prints no secret unless `--print-link` (`recover.test`).
- **Delivery** counts an acknowledgement only for an `OK true` with the event's own id within the
  timeout (`transport.test › acknowledgements`, 5 tests) and contacts no relay that is not configured;
  no relay address is built into `packages/deliver` or the SDK (`grep` for `wss://` finds none).
- **The stand** reads only the deployment JSON that `Deploy.s.sol` writes (never console text; the
  deploy log is kept for people), signs only with anvil's public test keys (`@ahand/sdk/testing`
  `ANVIL_KEYS`) or keys made on the spot, and refuses any chain id but 31337 before deploying, after
  deploying, in `seed.ts` and in `time.ts` (`stand.test › refuses any chain but 31337`).
  `Deploy.s.sol` itself deploys Core on any chain (it is the real deploy script) but deploys and
  mints test contracts only on 31337 (`Deploy.t.sol › test_otherChainsGetCoreOnly`).
- **Foundry by path.** Every call goes through `infra/stand/foundry.ts` (`foundryPath` throws rather
  than falling back to PATH) or `$FOUNDRY_BIN`/`$CAST` in the shell scripts. The grep's remaining
  hits are comments, usage text and `cast send` lines printed for people.

## Checks run (all on this machine, 2026-11-20)

| Command | Result |
|---|---|
| `sha256sum contracts/src/AHandCore.sol` (first and last) | `118f4d37…d738` both times |
| `cd contracts && $FOUNDRY_BIN/forge test` | 217 passed, 0 failed (before and after) |
| `WRITE_VECTORS=true $FOUNDRY_BIN/forge test --match-contract "SdkVectorsTest\|SdkGasTest" && git diff --exit-code -- test/fixtures` | 3 passed; no difference |
| `cd packages/sdk && bunx vitest run` | 22 files, 417 passed, 0 failed (410 before this package) |
| `bun test` in `packages/deliver` (`DELIVER_TEST_PORTS=19054-19069`) | 34 pass, 0 fail |
| `bun test` in `tools` (`TOOLS_TEST_PORT_BASE=19070`) | 42 pass, 0 fail |
| `bun test` in `infra/stand` (`STAND_TEST_SLOTS=2 STAND_STATIC_TEST_PORT=19080 FIXTURES_TEST_PORT=19082`) | 30 pass, 0 fail. The "two stands side by side" test ran with one slot (2), the only slot this package may use |
| `bun test` in `infra/relay` (`RELAY_TEST_PORTS=19050-19053`) | 7 pass, 0 fail |
| `bun infra/stand/stand.ts up --slot 2`, `bun infra/stand/loop.ts --slot 2`, `down` | exit 0; all six parts ok (usd, pending, refund, zero-reward, second-token, undeployed-account) |
| `bun infra/stand/drill.ts --slot 2` | exit 0; 13 ok lines over three stages; the stand down afterwards |
| `bash contracts/exit/selftest.sh` (`SELFTEST_PORT=19090`) | exit 0: refund, pending, withdraw (to the payee and elsewhere), extend, fund and thank |
| `bunx tsc --noEmit -p` sdk, deliver, stand, relay, tools | 0 errors |
| `grep -rn "console.log" packages/sdk/src packages/deliver/src`; `grep -rn "Date.now" packages/sdk/src` | nothing |
| `git status --short` | lists `?? .github/workflows/check.yml` |

Not run: `.github/workflows/check.yml` itself (no GitHub Actions here), the root `bun run check` as
a whole (its parts above were run one by one, except the app's tests and build, which belong to
other packages of this wave), and anything against a real wallet or network.

## Needs (files this package does not own)

- `apps/hand/src/screens/thank/check.ts` (or wherever /thank lists the route): call
  `raiserHops(hand.raiser, signedShakes)` from `@ahand/sdk` and flag each hop it returns, with the
  same flag sentence `ui/judge.ts` uses for the "raiser" payee problem. This completes duty 11.
- The integrator, for the gate: when several agents share the machine, run the package suites with
  the port variables above.

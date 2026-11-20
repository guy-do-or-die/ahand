# sdk-proof — the passport, the bundle, Core's check order as data

Wave 3. Files: `packages/sdk/src/{proof,steps}.ts`, `packages/sdk/tests/{proof,steps}.test.ts`.

## What exists

**`steps.ts`.** Core's check order as data and an offline walk over it.

- `checkOrder(shakes, withGive)`: the steps in Core's order: `GiverIsRaiser`, `ZeroPayee` (Give), then per Shake `InvalidClaim`, `AnonymousMargin`, `InvalidKeySig`, then the Give's `InvalidClaim(n)`, `InvalidRouteHash`, `BelowMinClaim`, `InvalidKeySig(n)`, `InvalidGiverSig`. Without a Give it is `checkRoute`'s order. `ON_CHAIN_ONLY` names thank's first three (`NotOpen`, `NotRaiser`, `Expired`), which need the chain and are not run here.
- `runSteps(domain, hand, signedShakes, signedGive?, askSignerCode?)` → `StepResult[]`: pass, fail or not-reached for every step; `firstFailure(results)` is the step Core reverts at.
- `GIVE_GATE`, `SHAKE_STEPS`, `GIVE_STEPS` are exported as constants, so a screen can show the order itself.

**`proof.ts`.** The passport in two steps.

- `collect(client, core, handId, { giveLink?, outside?, build?, readBetween?, chunk? })` reads, at one block: `hands(id)`, `thanks(id)`, Core's code, the logs of the raise's second and of the closing's second (`handLogsAt`), `pending(token, payee)` for each payee of the closing, the closing transaction's input, and whether the giver has code. When `hands(id)` shows a reward or expiry other than `Raised`'s, `record.between = { fromBlock, toBlock, requests, read: false }` is set and nothing more is read; `readBetween(client, record)` (or `readBetween: true` at collect time) reads it. Throws Core's `NotRaised` for a number no Hand has.
- `passportOf(record)` → `Promise<Check[]>`. Ids, in order, for a thanked Hand: `core`, `raised`, `reward-time`, `description`, `route.<i>` and `keys.<i>` per Shake, `share.<i>` per Shake, `route-hash`, `give-claim`, `give-hash`, `give-key`, `giver`, `giver-amount`, `payout.shake.<i>` and `payout.giver` for amounts above zero only, `payouts`, `now.<payee>`. Refunded: `core`, `raised`, `reward-time`, `description`, `refunded`, `payout.raiser` (above zero), `now.<raiser>`. Open: the first four. A closed Hand with no closing event gets a failed `closing`.
- Sentence keys for the screen (`Check.sentence`): `proof.core`, `proof.raised`, `proof.rewardTime`, `proof.description`, `proof.closing`, `proof.route`, `proof.keys`, `proof.share`, `proof.routeHash`, `proof.giveClaim`, `proof.giveHash`, `proof.giveKey`, `proof.giver.key`, `proof.giver.account`, `proof.giverAmount`, `proof.payout`, `proof.payouts`, `proof.now`, `proof.refunded`.
- Facts come from events and views: every Shake and the Give are rebuilt from `Shaken`, `Given` and the Hand's terms; `routeHash` and `giveHash` are recomputed and compared with `Given.routeHash` and `thanks(id).giveHash`. Signatures are the extra: `thankInputOf` searches the input for the `thank` selector at every byte offset and accepts a decoding only for this Hand number and a Give that hashes to the stored giveHash; failing that, a give link whose Give hashes the same serves (its 6492 wrapper unwrapped). With neither, `keys.*`, `give-key` and `giver` are `"not-checkable"`, never failed. A giver whose key did not make the signature but whose address has code is judged "signed by its account" (`proof.giver.account`).
- `exportBundle(record)` (JSON, `format: "aHand.proof/1"`, bigints as decimal strings, bytes as hex), `readBundle(json)` (validated with zod; throws "not an aHand proof bundle"), `verifyBundle(json)` = `passportOf(readBundle(json))`, no network.
- Also exported: `routeOf(record)` (the route and Give rebuilt from events, the input FactsReader takes), `handOf(view)`, `marginOf(reward, claim, next)`, `BUNDLE_FORMAT`.

Nothing in either file reads a clock.

## Choices the design did not make

- **`passportOf` and `verifyBundle` return a Promise.** ARCHITECTURE §4 wrote `Check[]`. Recovering a signer in viem is async (it imports the curve lazily) and the SDK may not import `@noble/curves` itself (Bun links packages in isolation). It is still pure: no network, no clock. The wave 1 stub of `runSteps` was already async for the same reason.
- **`thankInputOf(txInput, hand, giveHash)` takes the Hand's terms, not only its number.** The Give's hash is over the terms; with the number alone the hash check the design requires cannot be made.
- **`HandRecord` gained fields**: `thank` is always present (zero hashes when not thanked), `between`, `pending`, `coreHasCode`, `giverHasCode`, `closingTx`, `outside` (the address part outside the link, for unlisted Hands). `BuildFacts` gained `factory`, `salt`, `initcodeHash` (the brief names them); without them `core` is not-checkable.
- **Signatures are separate checks** (`keys.<i>`, `give-key`, `giver`) from the facts (`route.<i>`, `give-hash`), so "not checkable here" never hides a fact that is proven. Two checks were added: `give-claim` (Given's claim is what the route left and at least the minimum) and `closing` (only when a closed Hand's closing event is missing).
- **Payout rows exist only for amounts above zero**, or when a payout event follows a zero amount (then it fails). A Hand with no reward has no `payout.*` rows; `payouts` still checks the sum against the reward.
- **`now.<payee>` is informational** (`ok: true`): pending is counted per token and address across all Hands, so no value of it is wrong for one Hand.
- **A description that did not arrive is `not-checkable`**, not failed: the words travel only in links.
- **A give link that leaves its Core out** is opened as naming the record's Core; a link that names its Core is opened as it is.
- **`runSteps` takes an optional `askSignerCode`** (as `checkGive` does); without it a signature its key did not make fails `InvalidGiverSig`, as Core fails it for an address without code. The Give's `InvalidClaim` and `InvalidKeySig` carry `position = number of Shakes`, as Core's error does.

## What I ran (2026-11-20, on this machine)

| Command | Result |
|---|---|
| `cd packages/sdk && bunx vitest run tests/proof.test.ts tests/steps.test.ts` | 2 files, 29 passed, 0 failed |
| `cd packages/sdk && bunx vitest run` | 21 files, 410 passed, 0 failed |
| `cd packages/sdk && bunx tsc --noEmit -p .` | 0 errors |
| `sha256sum contracts/src/AHandCore.sol` | `118f4d37…d738` |

The two test files start their own helper chains (anvil 1.8.6, 40 days ahead) on ports 16201 and 16202 and stop them; nothing listened on 16200–16249 afterwards. What the live tests do, all through the SDK against the deployed Core:

- A thanked Hand (unlisted description, two passes, the second keeping 0) gives every check `ok: true`, in the order above; `share.1` is 0 and has no `payout.shake.1`; `description` reads "attached" from the give link; signatures come from the thank's input.
- **FactsReader**, deployed from `contracts/out` with the record's rebuilt route, returns the same raiser, giver, payees and amounts as the passport.
- Bundle: `readBundle(exportBundle(r))` equals `r`; `verifyBundle` equals `passportOf`. Tampering a Shake's margin fails first at `share.0`, the Given amount at `giver-amount`, the stored giveHash at `give-hash`, the Given payee at `give-hash`, a Shake's nextKey at `keys.0`.
- A thanked Hand with no reward: no failed check, no `payout.*` row.
- ERC-6492: a Give by a KeyAccount not deployed yet, thanked by `setupCall` through the forwarder, then `thankCall`: no failed check, `giver` = "signed by its account"; the same from the give link alone (thank input removed).
- A raiser that is a KeyAccount sends the thank as `execute(core, 0, thankCalldata)` on chain: `thankInputOf` finds it, every check ok. The same input with the embedded Give's dataHash changed: `thankInputOf` returns nothing, the passport shows `keys.0`, `give-key`, `giver` as not-checkable and no failure. A wrong Hand number and a stray selector in junk are not taken either.
- A refunded Hand: the seven-check list, every check ok. A funded and extended Hand in BlacklistToken whose giver's payee is blocked: `between` needs 1 request, `reward-time` is not-checkable until `readBetween`, then ok; `payout.giver` reads `Pending`.
- `runSteps` names the same first failing step and position as Core's own `checkGive`/`checkRoute` (by `eth_call`) and the SDK's `checkGive`, for 13 cases: GiverIsRaiser, ZeroPayee, the Give's InvalidClaim(0) and InvalidClaim(1), InvalidRouteHash, BelowMinClaim, a Shake's InvalidClaim(0) and InvalidClaim(1), AnonymousMargin(0), InvalidKeySig(0) and (1) of Shakes, InvalidKeySig(n) of the Give (with and without Shakes), InvalidGiverSig, and the all-pass case (Core's giveHash equals the SDK's).

## Not verified

- Anything but anvil: no real RPC's log limits, no Base, no EIP-5792 batch or ERC-4337 bundle as the thank's carrier (only `execute(address,uint256,bytes)` was run on chain; a batch is the same search).
- The stretch between on a long Hand (only a 1-request read was run; the request count is arithmetic over 2 000-block windows).
- An EIP-7702 delegated giver in the passport (its key signature would be recovered as a key's; not run).
- No screen uses this yet (`proof-pages` is wave 5), so there was nothing to screenshot.

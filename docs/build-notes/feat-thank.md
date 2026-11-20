# feat-thank — Thank: check, judge, set up, pay, receipt from events

Wave 4. `/thank` as UX-SPEC §7.5, on slot 4 in `--dev` mode.

## What was built

- `apps/hand/src/screens/thank/`
  - `model.ts` (+ `model.test.ts`, 12 tests): Core's payout arithmetic (`mulDiv` rounded down, the helper gets the rest), payee findings (Core refused; the raiser and the token flagged), decoding a receipt's logs into the SDK's `HandLog`, `verifyThanked` (success only when the transaction's own logs hold `Thanked`, `Given` with the signer and payee sent, and one `Paid`/`Pending` of the right amount and payee per nonzero payout, in Core's order via `receiptOf`), landed flags, dropped holders' shares.
  - `check.ts`: steps 1, 2, 3, 5 in order. `openAddress` with `getHandFor` (fails closed); Core's `checkGive` by `eth_call`; an ERC-6492 wrapper is unwrapped: an account with code is asked with the inner signature, one without code through the forwarder with its setup counted in (and the thank then carries `setupCall` first); no forwarder in the configuration → its own sentence and stop. Then the Give goes into the `inbox` store with its first-seen time and is judged with `judgeGive` against the Gives already held for the Hand (re-opened from their stored give links). Worst gas via `worstThankGas`, with the giver's code gas estimated from the chain when the giver is a contract or is set up in the same go.
  - `Flow.tsx`: Deal card, Core's answer with its source (mark), the route rail, the re-signed band (dropped holders crossed out by full address and share, a tick each, "Thank this route anyway" enabled only when all are ticked, the swipe disabled until it is pressed), the branch note, payee refusal and flags, "too long", the set-up band with the two-step sentence (shown unless the connected wallet reports atomic batches), the predicted table, NotRaiser stop, cost line (simulated as the raiser), the warning, the 🙏 swipe, `useSend` with `onIntent` storing the intent in the inbox record before waiting and `between` re-asking Core's `checkGive` with the inner signature, the TxRail, failure sentences ending "Nothing left your account." (or the first-step-only sentence after a landed setup).
  - `Predicted.tsx`: who gets what, each row opening its formula; a Hand with no reward shows only the sentence that the thanks moves no money (no "$0").
  - `Receipt.tsx`: `ReceiptTable` with `landed` flags set as a second `eth_getLogs` of the receipt's block finds each row; one line per payout, "left the contract for" (`Paid`) or "is waiting for" (`Pending`), never "received"; the event list; "See the proof" (→ `/<chain>/<hand>/proof`, wave 5); "Do it without us" with `castLine` for each call.
  - `en.ts`, `ru.ts`.
- `tests/e2e/smoke/thank.spec.ts` (7 tests), `tests/e2e/lib/feat-thank/fixtures.ts` (craft wrappers, BlacklistToken block), `tests/e2e/lib/feat-thank/shots.ts` (screenshots, not a test).

## Choices the design left open

- **The checking line** reads "Checking this with the contract…", not UX-SPEC's "Checking this answer with the contract…": the task says nothing is called an answer before Core's check passes, and the smoke asserts the word never shows on a refused Give. The lead sentence also avoids the word.
- **NotRaiser** is shown as soon as a connected account differs from `hands(id).raiser` (Core's own sentence), with the swipe disabled; `useSend`'s simulation would also refuse it.
- **Resume after a reload**: the thank intent is kept as an extra `thank` field on the Give's `inbox` record (`ThankRecord extends InboxRecord`); opening the same give link again follows the stored hash and sends nothing. A Hand already thanked for this very Give shows its receipt read from the chain (`handLogsAt(closedAt)`).
- **Dropped holders** are crossed out in a list inside the re-signed band, not on the `ChainRail` (the kit's rail has no crossed-out hand).
- **Receipt sentences** are a list under `ReceiptTable`: the kit's table labels rows "passed it on / helped", not "left the contract for / waiting for".
- **"Check it"** is a QuietButton: the one swipe of the screen is the 🙏 "Say thanks".
- Hint and gas fit line: the fit (`thank.lens.fit`) shows only with the lens on.

## What I ran

| Command | Result |
|---|---|
| `bun infra/stand/stand.ts up --slot 4 --dev` | up (anvil 18585, relay 18587, Vite 18341) |
| `STAND_SLOT=4 bunx playwright test tests/e2e/smoke/thank.spec.ts` | 7 passed, twice (the second after the last edits) |
| `cd apps/hand && bun test` | 269 pass, 2 fail — both in other packages' words (`give`, `without-us`); the thank words pass |
| `bunx tsc --noEmit -p apps/hand` | 0 errors |
| `bunx tsc --noEmit -p tests/e2e` | 0 errors in my files (2 in feat-give and feat-waiting files) |
| `STAND_SLOT=4 bun tests/e2e/lib/feat-thank/shots.ts <shots>` | 16 screenshots, EN and RU at 390 px, no horizontal overflow; looked at |
| `sha256sum contracts/src/AHandCore.sol` | `118f4d37…d738` |

What the smoke proves on the chain: payout rows equal each payee's token balance change; the undeployed account has code afterwards, `hands(id).closedAt > 0`, `thanks(id).giveHash ≠ 0` and its balance grew by the helper's row; the no-reward thank logs exactly `Thanked`, `Given` with no payout row and no "$0"; the re-signed second Give names account 3 and "kept 5%", the swipe stays disabled until the tick and "anyway"; an altered giver signature shows `InvalidGiverSig`'s sentence and no "answer"; the blocked payee's row is "waiting" and equals the rise of `pending(token, payee)`; account 2 is stopped with NotRaiser and the Hand stays open.

## Not verified

- An atomic EIP-5792 wallet (the dev wallet reports no atomic support, so only the two-step path ran); a real injected wallet; Multicall3 as forwarder; a chain with no forwarder configured (the sentence exists, not run); a route too long to fit; a payee that is Core's own address (code and unit test only); the resume-after-reload path (written, not exercised in a browser); the "branch" verdict in the browser; the desk project.
- The handover from `/my` through `store/memory.ts`: read on mount, but `/my` was being built at the same time.

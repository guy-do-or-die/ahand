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

## Review round 1 fixes (2026-11-20)

Two findings, both minor, both reproduced before the fix and both covered by tests that failed first.

### 1. The fine print under "who gets what" spoke of an owner, in uppercase mono

- Reproduced: `IF A PAYOUT CAN'T MOVE, IT WAITS IN THE CONTRACT FOR ITS OWNER TO TAKE OUT.` (`shots/round-1/fix-feat-thank/before-en-predicted-viewport.png`).
- `en.ts`, `ru.ts`: "If a payout can't move, it waits in the contract until whoever it belongs to takes it out — or anyone delivers it to that address." / «Если выплата не сможет пройти, она подождёт в контракте, пока её не заберёт тот, кому она причитается, — или кто угодно не доставит её на этот адрес.»
- `Predicted.tsx`: the sentence is set as `ah-label` (the human voice), not `ah-meta` (mono is for exact data only, UX-SPEC §2).
- The same word stood in the Russian `thank.waiting.why` («Владелец может её забрать…»); it now reads «Тот, кому она причитается, может её забрать…». The English line never had it.
- Tests: `words.test.ts` (no thank sentence in either language speaks of an owner; the exact copy), and in the smoke `expectFinePrint` (the sentence is there, has class `ah-label`, computed `text-transform: none`, a font family that is not mono), in English and in Russian.

### 2. The done state never showed what the thanks cost

- `model.ts`: `spentOf(receipt)` (sender, block, gas used, the price paid, an OP Stack receipt's L1 data fee when there is one, the fee in wei), `totalSpent`, `usdOfWei` (the SDK's `usdText` at the snapshot's ETH price).
- `Spent.tsx` (`ThankSpent`), shown in `Receipt.tsx` under the payouts: one sentence for everyone, "Saying thanks cost about $0.33 · prices of 10 Nov" / «Спасибо стоило около $0,33 · цены на 10 нояб», and behind it the disclosure "The transaction" / «Транзакция» (open under the lens like every other): `tx <hash>`, `from <address>`, `block <n> · <the block's time>`, `gas used <n> · effective price <gwei>`, `fee <ETH> · $<usd> at ETH $<snapshot> · prices of <date>`; on a local chain one more line says the ETH is test ETH at that chain's own price.
- The receipt the send waited for is used as it is (`SendResult.receipt`); nothing is asked again for it except its block's timestamp. A thanks that took two steps (the helper's account set up first) asks the chain for the first step's receipt and shows both transactions and their sum: "Both steps together cost about $1.05". A Hand found already thanked for this Give (the receipt read back from logs) asks for the transaction's receipt by its hash.
- Until the receipts are read the line says "Reading what it cost from the network…"; if they cannot be read, "Couldn't read what it cost from the network just now." and no number.
- Tests: `model.test.ts` (4 new: the fee, the L1 fee as bigint and as hex, two steps, dollars), and in the smoke: each transaction line equals its own receipt on the chain (sender, block, gas used, fee), and the total equals the ETH that left the asker's account between "ready" and "done", for one step and for two; the estimate (`thank-cost`) is gone in the done state; the already-thanked path; Russian.

### Choices

- **The human sentence says dollars only; gas, the price, the fee and the word "transaction" stay behind the disclosure.** UX-SPEC §5 bans those words on the human layer; the new keys carry a `lens` segment, as the words guard requires.
- **Dollars are the fee actually paid, in ETH, times the dated snapshot's ETH price**, as the finding asked. On the stand the gas price is anvil's own (about 1 gwei), so the dollars there are larger than the Base and Ethereum estimates shown before sending; the lens line "Local test network: test ETH, at this chain's own price" says why.
- **Both steps are counted.** Showing only the thanks transaction would under-report a two-step thanks.
- **Test ids `thank-spent`, `thank-spent-sentence`, `thank-spent-tx`** are constants in `Spent.tsx`, because `testids.ts` is not this package's file. They follow its naming and can move there unchanged.
- `tests/e2e/lib/feat-thank/fixtures.ts`: `craft` now honours `STAND_FILE` (as `readStand` and `seed` already do), so the smoke runs against a helper chain on any port.
- The smoke's "no `$0` anywhere" on a hand with no reward is now a pattern for an amount of nothing (`$0`, `$0.00`), since "cost about $0.33" is not one.

### What I ran (round 1)

The stand's slots have fixed ports outside this fix's range (24700–24749), so the pieces were started by hand: the wave 1 helper chain `bun packages/sdk/tests/helpers/anvil.ts --serve --port 24700 --write-stand … --write-config …` (anvil, block time 1 s, clock 40 days ahead), the stand relay on 24702, and the app built with `vite build` and served by `infra/stand/static.ts` on 24701 (with the real CSP). A Vite dev server was tried first and dropped: other fixers' edits reloaded the page in the middle of a test.

| Command | Result |
|---|---|
| `STAND_FILE=… STAND_BASE_URL=http://127.0.0.1:24701 bunx playwright test tests/e2e/smoke/thank.spec.ts` before any change | 7 passed (baseline) |
| the same with the new assertions, before the fix | failed at the fine print (the old sentence) |
| the same after the fix, built app | 9 passed (phone), 9 passed (`--project desk`) |
| `cd apps/hand && bun test src/screens/thank` | all pass (model 16, words 3; `failure.test.ts` is another fixer's) |
| `cd apps/hand && bunx tsc --noEmit -p .` / `bunx tsc --noEmit -p tests/e2e` | 0 errors in this package's files |
| `STAND_FILE=… bun tests/e2e/lib/feat-thank/shots.ts <dir>` | 23 screenshots, no horizontal overflow; 12 copied to `shots/round-1/fix-feat-thank/` and looked at |
| `sha256sum contracts/src/AHandCore.sol` | `118f4d37…d738` |

### Not verified (round 1)

- A receipt with an L1 data fee (an OP Stack chain): unit-tested only; anvil's receipts carry none. An OP Stack operator fee, if a chain charges one, is not read.
- "Couldn't read what it cost" (the network failing after the thanks): written, not exercised in a browser.
- An atomic EIP-5792 batch (one transaction for both steps): the dev wallet reports no atomic support.

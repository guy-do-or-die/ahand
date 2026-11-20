# feat-raise — Raise: from a thought to a link (wave 4)

## What exists

- `apps/hand/src/screens/raise/index.tsx` — /raise per UX-SPEC §7.2: poster textarea (first line = title), "Add details", reward chips 5 · 20 · 50 · "Your call" (MoneyInput, zero allowed; at zero "No reward: a thank-you only."), the locked line, the USDC issuer line (stand variant "test dollars, standing in for USDC") with a link to /limits, "open until" chips 7/30/90/180 (30 chosen, each counted with `expiryAfter(useNow().timestamp, days, MAX_EXPIRY_PERIOD)`; 180 = cap − 600 s), the >60-day nudge, three visibility cards (unlisted chosen) with the shared line, the two-halves disclosure and a chat-unfurl preview, "Fine-tune" (70 %, room 250 with its reason and 55/66 passes computed by the SDK's `passesLeft`), the Deal card preview, the swipe with a step counter, CostLine and the simulated refusal shown before any press.
- `flow.ts` — the swipe's flow in the order the brief gives: balance/allowance/ETH; keys card + keys confirmation (asked twice the first time per account and device, verdict in `books` via `setRepeats`; the master is kept in tab memory only); `reserveNumber()`; `rootSeed`/`inboxSecret` (or `newSeed()` + random inbox secret for non-repeating accounts); root key checked against every root key of the device's list (read from `hands()` for raised records, derived for this raiser's numbers); `describeHand`; the intent record; `lockSeed` before sending (non-repeating only); approve (skipped at zero or enough allowance) + raise through `useSend`; the raise hash stored in `onIntent` before waiting. On the receipt: `Raised` of this tx → Hand terms (checked against what was sent) → `encodeLive` with pin → `toAddress`. After a reload: `unfinished()` finds a `sent` record (or an `up` one still holding a locked copy), `resumeRaise` follows the stored hash only (never sends), rebuilds from `openSeed`; a reverted raise drops the copy. `rebuild()` brings back a repeating account's link after one confirmation. `saved()` = `dropSeed`.
- `link.ts` — pure parts with unit tests (`link.test.ts`, 11 tests): expiry, passes, root-key uniqueness, `Raised` decoding, writing the first link in each shape, reading it back with `openAddress` + `readDescription`, and the QR's bare-digits address via `carryFor(opened, "bare")`.
- `share.tsx` — "Your hand is up.", TxRail, copy row (from memory), Share (only where `navigator.share` exists), Show QR, Print a card / Add a reminder (`/print`, `/care/<chain>/<id>`; the address is handed over through `store/memory`), "checked here" read-back line, evidence of the `Raised` terms. Non-repeating accounts: the band, the required "I saved the link" tick (Print/Reminder/leave disabled and a beforeunload prompt until ticked), then "The copy on this device is gone…".
- `parts.tsx` — chip row with test ids, visibility cards, unfurl, a disclosure for controls.
- `en.ts`, `ru.ts` — every sentence, UX-SPEC wording where given.
- `tests/e2e/smoke/raise.spec.ts`, `tests/e2e/lib/feat-raise/raise.ts` (helpers), `tests/e2e/lib/feat-raise/shots.ts` (screenshots tool).

## Choices the design did not make

- Inbox key computed with viem (`privateKeyToAccount(secret).publicKey` x-coordinate) instead of importing `@ahand/deliver`: the dev server cannot load `@ahand/deliver` in the browser (see "Needs"). A unit test proves equality with `publicKeyOf` for 20 random secrets.
- A raise refused or declined before its raise call was sent removes its intent record and locked copy; the reserved `n` is still never given back.
- Fine-tune offers min claim 50/70/90/100 % and room 200/250/300.
- Reward chip 20 preselected (the spec names no default).
- The cost/refusal preview simulates with a stand-in root key and description hash (the real ones exist only after the keys step); the real calls are simulated again by `useSend`.
- The root-key check reads `hands(id)` for every raised record of this Core on the device (one read each).
- The smoke raises its own Hands through the screen instead of calling the seed: nothing in /raise consumes a fixture.

## Run, with results (slot 1, `--dev`)

- `STAND_SLOT=1 bunx playwright test tests/e2e/smoke/raise.spec.ts` → 4 passed (three green runs; one run failed only because feat-hand's hand screen crashed while being edited — see below). Covered: unlisted $50 with account 1, "Your hand is up.", hands(id) reward/dataHash, expiry ≥ chain time before swipe + 30 d and ≤ openedAt + 30 d, copied address opened by craft and in a second context (title and "$50" in `hand-deal-card`); dark at 180 days (expiry ≤ openedAt + cap − 600, no revert), public, zero reward (nonce +1 only: no approve; preview shows the no-reward line), dataHash equal each time, three distinct root keys; pause → send → reload → "Your last raise is still on its way." → resume → handsCount +1 exactly (also after 3 more blocks), link rebuilt after one confirmation; account 5: same reload, link from the locked copy opens (craft and second context), IndexedDB searched for the seed as hex/base64url/digits before and after the tick (absent), escrow empty after the tick.
- `bun test src/screens/raise` (apps/hand) → 11 pass.
- `bun test tests/guards` (apps/hand) → raise keys pass parity/ICU/banned words; clock and secrets guards pass. One failure belongs to `without-us` (exit-page's catalogue).
- `bunx tsc --noEmit -p apps/hand` / `-p tests/e2e` → no error under screens/raise or my test files.
- Screenshots in `knowledge/plan/research/2026-11-20-experiment/shots/build/feat-raise/` (compose filled and share step; EN/RU; 390 px light/dark; 1280 px), looked at; no horizontal overflow at 390 after fixing one long disclosure label.

## Not verified

- A real wallet, EIP-5792 batch path (dev wallet does steps), the Share sheet (headless Chromium has no `navigator.share`), a camera reading the QR, /print and /care themselves (other packages), the built (non-dev) app, axe.
- Reload between `sendTransaction` returning and `onIntent` writing the hash (a few ms) would lose sight of the raise; a batch reloaded before the wallet reports its hash is not resumed.

## Review round 1 (fixes)

Five findings, all reproduced on a live chain and dev server before any change (pictures `before-*` and `after-*`, `smoke-*` in `knowledge/plan/research/2026-11-20-experiment/shots/round-1/fix-feat-raise/`).

1. **A raise sent as one wallet batch lost its record and locked seed** (major). `flow.ts` now keeps the record as `sent` with the wallet's batch id (`RaiseRecord = HandRecord & { batchId? }`) the moment the wallet hands the id over, before any hash is known. From then on nothing is deleted here: only a receipt that says "reverted" ends a sent raise; a stopped follow, a lost connection or the wallet's own word that the batch failed leave the record and the locked copy in place ("We lost sight of your raise…"). `forget()` runs only when the raise itself never reached the wallet. `unfinished()` finds a `sent` record by hash or by batch id; `resumeRaise()` follows a hash as before, or asks the connected account's wallet for the batch through `useSend().resume` and stores the hash once the wallet names it. Nothing of a wallet survives a reload (`storage: null`), so the pending screen says "Connect the account that sent this raise…", offers "Connect a wallet", refuses another account by name, and looks again when the right one connects. The pending screen also got a way out ("Raise another hand") once a look has failed, because a kept record would otherwise hold `/raise` forever. `raisedIn()` takes the raiser (and the root key when known): a batch can share its transaction with other accounts' calls.
2. **"Asked by 0x0000…0000" before an account is connected.** The preview says "Asked by: your address, once connected" / «Автор: твой адрес, когда подключишь» in the human voice. The earlier attempt to hide the card's own row (`[&_.ah-deal__foot]:hidden`) never worked: Tailwind turns `_` in an arbitrary variant into a space. The row is now hidden by `raise.css` (`display: none`, so it is also out of the accessibility tree), and the words are passed as the card's children. `DealCard` still requires an address; see "Needs".
3. **No length cap.** Title 160 characters, details 1000 (as `/give`), counted as characters of the normalised text, each with a visible counter; over the cap the sentence stands under the field, the swipe is disabled and says why. The details field also stops natively at 1000; the poster at 1161. `link.ts` `weigh()` measures what the address would show before `#` (the real packing, the Hand's number counted at twenty digits) against 8000 characters; over it, public and unlisted are refused with a sentence that offers the dark shape. `raise()` checks all three again before asking the account anything. With the caps as they are the 8 KB refusal cannot be reached from the screen (the heaviest words give about 6.3 KB); it is covered by unit tests with a long site address.
4. **The keys card's toggle ran off the phone.** The toggle reads "What exactly you are confirming" / «Что именно ты подтверждаешь» (right edge 288 px / 257 px at 390); the typed-data line is the first line inside, wrapping anywhere.
5. **No level-one heading.** The compose state's question is an `h1` that holds the field's `label`; "Your hand is up." is an `h1` too (it was an `h2`), so every state of `/raise` has exactly one.

### Choices made in this round

- **Where the batch id lives.** `store/db.ts` is not this package's. The `hands` store has no schema beyond its key, so the field is kept through a local type and needs no migration; adding `batchId?: string` to `HandRecord` is listed under "Needs".
- **What ends a sent raise.** Only the chain's receipt. A wallet reporting `failure` with no receipt is not trusted enough to delete a locked seed; the cost is a record that waits, and the pending screen's way out.
- **`forget()` after a failure that came before the wallet took the raise** stays for every reason (refused, said no, failed check, offline, cannot send), not only the three the review named: in all of them nothing left. Not covered: a wallet that fails with an unknown error after it has already broadcast.
- **Caps are refusals, not silent cuts**, except the fields' native stops, which only keep a runaway paste out of the page.
- **New test ids** (`raise-title-count`, `raise-details-count`, `raise-too-long`, `raise-preview-raiser`, `raise-keys-what`, `raise-pending-connect`, `raise-pending-another`) are a local table in `index.tsx`; see "Needs".
- A batch is one step on screen ("Raise") once the wallet has taken it; before that the counter still reads "1 of 2: allow", because the screen learns that the wallet batches only inside `useSend`.

### Run (helper chain on 24500, Vite dev server on 24501, unit chain on 24510)

- `RAISE_TEST_PORT=24510 bun test src/screens/raise` (apps/hand) → 29 pass, 0 fail. `flow.test.ts` (new, 7 tests) runs `raise()` through the real `sendCalls`/`resume` on anvil with a batching wallet double; before the fix 5 of its first 6 failed (record gone, `common.error.unknown`).
- `STAND_FILE=… STAND_BASE_URL=http://127.0.0.1:24501 bunx playwright test tests/e2e/smoke/raise.spec.ts` → 7 passed, twice. New: the compose state (heading, preview, caps, keys card); a public hand at the caps (4 000 < before `#` ≤ 8 000, served with 200, opened by craft); and the batch path in a real browser with an injected EIP-5792 wallet (`tests/e2e/lib/feat-raise/batch-wallet.ts`, a test double): record `sent` with the batch id and no hash, escrow 1, reload, connect prompt, another account refused, the right account, hand up from the locked copy, `handsCount` +1, the account's nonce +2, one `wallet_sendCalls`.
- `bun test tests/guards` (apps/hand) → the raise catalogues pass parity and banned words; one failure is `ui/Flip.tsx` in the new lint guard (not this package).
- `bunx tsc --noEmit -p apps/hand` and `-p tests/e2e` → no error in this package's files.

### Not verified

- A real wallet's EIP-5792 batch (the browser test uses a double that sends the calls one after another, not atomically), a real smart account, a 4337 bundle sharing a receipt (unit test only).
- face answering a capped address (the smoke runs against the Vite dev server; it checks the length and a 200).
- The Russian of the new sentences was read, not reviewed by the owner. axe was not re-run.

### Needs (files of other packages)

- `apps/hand/src/store/db.ts`: add `batchId?: string` to `HandRecord` ("the wallet's id of the batch that carries the raise, kept until its hash is known"); then `flow.ts` drops its local `RaiseRecord` type.
- `apps/hand/src/ui/DealCard.tsx`: make `raiser` optional and leave the "Asked by" row out when it is absent; then `raise/index.tsx` drops the zero-address filler and `raise.css`.
- `apps/hand/src/testids.ts`: add the seven ids above to `TID.raise`.

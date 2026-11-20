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

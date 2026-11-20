# care-print (wave 5): care for a Hand, printing, the clock test

## What was built

- `/care/<chain>/<hand>` (`apps/hand/src/screens/care/`): the Deal card from `hands(id)` (with the words if this tab holds a link of the same Hand), then three sections.
  - **Add to the reward**: an amount, the `allowance`/`balanceOf` read on every block, `approve` + `fund` (two steps) or `fund` alone, sent through `useSend` (simulated first). "Every link already out there stays good." stands under the title and after success.
  - **Keep it open longer**: chips `+30`, `+90` (from the current end) and "up to 180 days from today" (from `useNow`), each through the SDK's `expiryAfter` with `MAX_EXPIRY_PERIOD` read from Core (`extend.ts`). The target is taken again from the latest block at the press. The app's own warning under ten minutes of network time (`care-last-minutes`). Lens: cap line and formula.
  - **Reminder**: an RFC 5545 file made in the page (`calendar.ts`): one VEVENT at the end, a VALARM `-P3D` (`-P1D` when the Hand's whole life is 7 days or less). DTSTAMP is the chain's time. Download through a `blob:` URL; no service.
  - Only the raiser's account is offered a send; any other connected account sees `core.NotRaiser` and no swipe. Closed/expired/missing Hands show `core.NotOpen` / `core.Expired` / `core.NotRaised`. Each action has a `CostLine` and "Do it without us" with the `cast send` line(s).
- `/print` (`apps/hand/src/screens/print/`): the link in `store/memory.ts` (or one pasted into the page's box) is opened against the trusted Core, re-encoded bare with everything inside (`carryFor(opened, "bare")` + `encodeLive`, same seed and route), written as digits (`toAddress(..., form: "digits")`), and read by the kit's `qrOf`. The tag (85 × 55 mm, code 31 mm) and the A6 card (Deal card + code 50 mm + "Scan to see how you can help. Passing it on is free.") are offered by the real code's size (`fit.ts`); otherwise "Too dense to print small. Show it on a screen." with the on-screen `Qr`. Only live links (with a seed, no Give) are printed.
- Receipt variant: `/print?receipt=<chain>/<hand>` prints the `ReceiptTable` from Core's events (`handLogsAt(closedAt)` + `receiptOf`), a code to `/<chain>/<hand>/proof`, and `bun tools/ahand.ts verify --rpc <rpc> --core <core> <id>`.
- `design/print.css`: named pages (`ahand-tag` 85×55 mm, `ahand-card` 105×148 mm, `ahand-receipt` A4), only the `[data-print-target]` sheet printed (everything else `display: none` via `:has()`), tokens forced to ink on white in every theme.
- Tests: `screens/care/care.test.ts`, `screens/print/print.test.ts` (bun, offline, including a real unlisted address re-encoded to bare digits and reopened); `tests/e2e/smoke/care.spec.ts` (7 tests); `tests/e2e/clock.spec.ts` (2 tests); helpers in `tests/e2e/lib/care-print/care.ts`.

## Choices the design did not make

- **Print size rule**: the given anchor "v13 at 31 mm" is turned into one rule: a printed module ≥ 31/77 mm = 0.403 mm (v13's 69 modules + 2×4 quiet modules); that is 3 dots at 190 dpi. The card's code is 50 mm, so the card takes up to v24. Measured here: a short dark link at 0 passes = v9 (tag and card); an unlisted link after 10 passes = v20 (card only).
- **Default format** is the tag when it is offered (smallest, and the done check prints it); the card is one chip away.
- **A chip is off unless it moves the end by at least 60 s**: at the cap, the "today" chip would otherwise move the end by one second per block forever.
- **The reminder's event is at the end, the alarm before it** (not an event three days before), so the calendar shows the real closing time.
- **Built stand for my runs**: in `--dev` mode, other agents' edits triggered Vite full reloads mid-test (seen: the wallet state vanished during a fund). I ran slot 5 as `stop dev` → `build` → `start static` and rebuilt after each change (5 s). Slot 8 was started built (`up --slot 8`, face).
- `/care` reuses `screens/print/link.ts` (`openHeldLink`, `peekHeld`) to read the words of a held link: same package, not another owner's screen.
- Receipt query is read with a regex, not `URLSearchParams`: the secrets guard forbids `new URLSearchParams(x)` outside `location.search`.

## Ran, with results

- `bun test` in `apps/hand`: 308 pass, 1 fail — the colour guard, on `screens/check/ruler.test.ts` and `screens/landing/paste.test.ts` (other packages' files, `#EBCD` / `#abc` in test strings); none of mine.
- `bunx tsc --noEmit -p apps/hand`, `-p tests/e2e`: 0 errors.
- `STAND_SLOT=5 bunx playwright test tests/e2e/smoke/care.spec.ts`: 7 passed (twice, built slot 5): fund +10 → `hands(id).reward` +10 000 000 exactly, the earlier link opens (SDK and browser, "$35") and passes; +30 → expiry = old + 30 d exactly; "today" → within 60 s of chain time + cap − 600 and never above; all chips off at the cap; `.ics` parsed as VCALENDAR/VEVENT/VALARM, DTSTART = expiry, `TRIGGER;RELATED=START:-P3D`, no request but RPC/blob; account 2 sees NotRaiser and no swipes; print media shows the tag 85 mm wide, ink on white under a dark scheme; ten passes: no tag, the sentence; receipt sheet with the verify line; RU at 390 px with no horizontal overflow.
- Fresh slot 8: `bun infra/stand/stand.ts up --slot 8`, then `STAND_SLOT=8 bunx playwright test tests/e2e/clock.spec.ts`: 2 passed (seed, +40 d jump, 30-day and 180-day raises on /raise, extend on /care, expiries within the margin; the pre-jump Hand reads "Time's up").
- Screenshots looked at: `knowledge/.../shots/build/care-print/` (care EN/RU, NotRaiser, tag EN/RU, ten passes, receipt), 390 px.
- Both stands brought down; ports free. Core sha256 unchanged.

## Not verified

- A real printer, a PDF render of the named pages, or a camera scanning a printed code; only `emulateMedia('print')` in Chromium.
- The desk project, axe, a screen reader.
- The last-ten-minutes warning on screen (unit-tested only); the ExpiryTooLate/Expired sentences from a real send (they come from `useSend`'s simulation, not exercised by a refused send here).
- The reminder in a real calendar app.

## Review round 1 fixes

- **Nothing stays armed after a confirmed send.** After a confirmed fund the amount box is emptied (the `MoneyInput` is remounted by a round counter, the reading reset), so the swipe reads "Add to the reward" and is disabled until a new amount is typed. After a confirmed extend no chip is chosen (`chosen` becomes undefined), so the swipe reads "Keep it open longer" and is disabled until a chip is pressed. The effect that re-chose "the first chip that moves" was removed: with +30 unable to move, no chip can (+30's target is either 30 days later or the same cap as "max"), so it only ever re-armed a send. The "This one wouldn't move the end later." line now shows only when a chosen chip cannot move or none can.
- **The raiser's words on this device.** `/care` reads the words from two places, each checked against Core's `dataHash` (`words.ts`, `kept.ts`): a held link of this Hand (as before), then the device's `hands` store (`useMyHand`), described again with `describeKept` exactly as /my checks them, with the inbox key from `useSecrets` once the account is unlocked and without one in any case. Checked: the Deal card carries the title and details, and a dim line says "Your words, as this device keeps them. They match what the contract keeps." Not yet checkable (inbox key unknown): the words stand above the card as this device's, with "…checked against the contract once you unlock." and /my's own `UnlockBar`, so the raiser can unlock right there; the card claims nothing. Key known and no match: "The words kept on this device don't match…", never on the card.
- `data-testid="care-words"` (data-value `device | unknown | mismatch`) is a local constant: `testids.ts` is not this package's.
- **Own-ports stand** (`tests/e2e/lib/care-print/stand.ts`): the round's ports were 24750–24799, outside every stand slot, and other fixers hold slots at the same time. The script does what `stand.ts up` does with the stand's own exported pieces (anvil flags, Deploy.s.sol under the forge lock, `configOf`, `standOf`, relay, build, static.ts) on a chosen base port, records its pids and kills exactly those on `down`. `craft`, `myRaise` and clock.spec's time jump now honour `STAND_FILE` (`standArgs()`); clock.spec used `--slot` for the jump, which would have moved slot 0's chain when run against another stand.

### Ran, round 1

- Own stand on 24750 (chain) / 24751 (relay) / 24752 (site), built from HEAD's `care/index.tsx`: the three new assertions failed (fund box still "10"; one chip still `aria-checked` after +30; no `care-words`, the card said "Someone raised a hand.").
- Rebuilt with the fix: `STAND_FILE=… STAND_BASE_URL=http://127.0.0.1:24752 bunx playwright test tests/e2e/smoke/care.spec.ts --project=phone`: 8 passed. A disabled swipe pressed again moved nothing on the chain (reward and expiry read back unchanged). `tests/e2e/clock.spec.ts`: 2 passed on the same stand.
- `bun test src/screens/care src/screens/print`: 18 pass (4 new for `checkKept`). `tsc --noEmit` for apps/hand and tests/e2e: no error in these files.
- Screenshots looked at: `shots/round-1/fix-care-print/` (fund/extend done, words locked, words checked, and the earlier set).
- Stand brought down by pid; ports 24750–24752 free; the deployment file removed; Core sha256 unchanged.

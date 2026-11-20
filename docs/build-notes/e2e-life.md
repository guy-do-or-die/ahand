# e2e-life — The whole life of a Hand in the browser (wave 5)

## What exists

- `tests/e2e/life.spec.ts` — one test in nine `test.step`s plus a closing check, five isolated browser contexts at 390×844 (the Raiser = dev account 1, Alice and Bob and Gina with no wallet, a Visitor with dev accounts 5 and 3). People pass nothing to each other but the addresses they copy. Every step ends on Core's views (`hands`, `thanks`, `pending`), on the decoded receipt of the transaction the screen names (`thank-done[data-hash]`), on Core's own `checkRoute`/`checkGive` (through `craft open`), or on token balances at fresh random payee addresses (they start at zero, so the amounts are exact).
  1. Raise on /raise: 50 test dollars, 30 days, unlisted, 70% checked in Fine-tune. The TxRail's values are recorded by a MutationObserver and must be exactly `sent → in-block → safe → final`. The chain's `finalized` block must have reached the raise. The terms, `dataHash`, the raiser's balance (−50) and the expiry window are checked.
  2. Alice opens the address and passes at 0%. No wallet prompt appears: no connect sheet or dev account entry ever in the DOM, and no signing or sending JSON-RPC method in her requests. Her origins are exactly {site, RPC}. Core accepts the new route.
  3. Bob passes at 10% to an address he pasted. The route read back by the SDK is checked.
  4. Gina helps with a pasted payee and a sentence. She sees "Delivered to 1 of 1 relay." (`1/1`). Core's `checkGive` accepts at claim 9000. Her origins are exactly {site, RPC, the stand's relay}.
  5. The Raiser opens /my/<chain>/<hand>, unlocks, and sees one answer with Gina's words, whose giveHash equals the link's. The reply arrives at "1 of 1". Thank leads to /thank. The receipt's rows equal the predicted rows with money in them: Bob $5, Gina $45, all "paid" and landed. The transaction's Core events are exactly `Thanked, Shaken, Shaken, Paid, Given, Paid`, and the payouts equal the rows. The balances are 5 and 45, `thanks(id).giveHash` is Gina's, and the raiser's balance is unchanged by the thank.
  6. Gina's still-open tab shows the asker's reply in the thread.
  7. A Hand in BlacklistToken: Alice keeps 10% for a fresh payee, Bob helps, and the payee is blocked. The Raiser pastes the give address into /thank. The blocked row reads "is waiting for", and the events show `Pending 2` and `Paid 18`. `pending` is 2. After the unblock, dev account 3 opens `/waiting?for=…` and presses Deliver. `waiting-withdrawn` shows 2, `pending` is 0, the balance is 2 and there is one `Withdrawn` log.
  8. A 7-day Hand raised on /raise and opened by the Visitor reads `open`. `infra/stand/time.ts --slot N 691200` moves the chain 8 days. With no reload and the browser on the machine's clock, the view turns `expired` with "Time's up…", and the pass action disappears. Dev account 5 presses "Send it back". The view shows `refunded`, `closedAt` > 0, and the raiser's token balance equals its balance before the raise.
  9. A Hand with no reward (custom 0): exactly one transaction leaves the raiser (no approve) and the reward is 0. Alice sees no slider; Gina answers. The thank goes through /my → /thank. Core's events are exactly `Thanked, Shaken, Given`, there is no Paid or Pending, the screen's event list equals the chain's, there are no payout rows, and the no-money note is shown.
  - Closing check, for every person: no request to a host other than 127.0.0.1 (every such request is intercepted with `context.route`/`routeWebSocket`, aborted and listed, and the list must be empty); only host 127.0.0.1 seen; no page error and no console error; the page watch ran and never saw a `#` in `location.href` after `load`.
- `tests/e2e/lib/e2e-life/people.ts` — `person()`: the context with interception, a request log with JSON-RPC methods, the page watch (it reports through `exposeBinding`, so counts survive navigations and the address itself never crosses over), console and page errors, and the dev server's socket kept silent (feat-hand's `quietDevServer`) in dev mode. `coreEventsOf()` decodes Core's logs from one transaction receipt; `payoutsOf()`.
- `tests/e2e/lib/e2e-life/shots.ts` — screenshots of the raise screen while the raise waits for its block (blocks paused), and of the share step, in EN and RU, light and dark, at 390 px.

## Fixes made (owned paths)

- **/raise did not show the "Sent" state** (UX-SPEC §7.2 item 8 and the life's "four states"). From the moment the raise was sent until its block, the screen showed only the step counter. The TxRail first appeared at "In a block". `screens/raise/index.tsx`: `onSent` now sets `raiseSent`, and while working the TxRail (`raise-tx-rail`) is drawn under the steps from "Sent" on. It is reset on each swipe. With the fix, the recorded sequence is the four states; before it, it was three.
- No other screen needed a change for the life to pass: steps 2–9 passed through the wave 4 screens as they were.

## Choices the design did not make

- **Step 7 raises through the SDK** (`craft make --token blacklist`, as account 1): /raise offers only the chain's dollar token, by design ("the chain's dollar token"). Every other action of that Hand is a screen. Blocking and unblocking the payee is a test-side token call (account 0), as in the thank smoke.
- **Payees are fresh random addresses**, not test accounts, so a balance equals exactly what landed.
- **The "no wallet prompt" check** = no connect sheet or dev wallet entry ever rendered, plus no `eth_send*`/`eth_sign*`/`wallet_sendCalls` request from that person.
- **The jump is 8 days on a 7-day Hand**, done after steps 1–7 and before step 9, so it moves no open Hand of the life past its end except the third.
- **In dev mode a warm-up context visits each route once** before the people start, because Vite may reload a page while it prepares a screen's modules, and a reload forgets a link.

## Run, with results

| Command | Result |
|---|---|
| `STAND_SLOT=1 bunx playwright test tests/e2e/life.spec.ts` on a fresh `--dev` stand, four times, each from `down` + `up --slot 1 --dev` | passed each time (1.0–1.4 min). The last two runs include the error-free console check |
| The same on slot 1 **built**, through face (`stand.ts up --slot 1`) | passed (52 s) |
| `bunx tsc --noEmit -p apps/hand` / `-p tests/e2e` | 0 errors |
| `cd apps/hand && bun test src/screens/raise tests/guards` | 128 pass, 1 fail: `colour.test.ts` flags hex-like strings in `screens/check/ruler.test.ts` and `screens/landing/paste.test.ts`, written by proof-pages and about-pages in this wave, not mine |
| The ten smoke files of waves 1–4 on slot 1 (dev), one run | 46 passed, 4 failed, 9 did not run (see below) |
| Rerun of `smoke/thank.spec.ts` + `smoke/give.spec.ts` alone | 12 passed |
| `stand.ts build --slot 1`, then `smoke/exit.spec.ts` | 7 passed |
| Screenshots `shots/build/e2e-life/raise-{sent,final}-{en,ru}-phone-{light,dark}.png` | looked at (EN light, RU dark): the TxRail at ОТПРАВЛЕНО/SENT under the steps, no horizontal overflow (scrollWidth 390) |

Smoke failures on the shared dev stand, and why none is a regression of this package:
- `exit.spec` needs `dist/exit.html`, which a `--dev` stand has not built; after `stand.ts build --slot 1` it passes.
- `thank.spec` (re-signed) and `give.spec` (relay restart): the trace shows the page navigated to /thank in the middle of the test. That is Vite reloading after other agents saved files; those smokes do not silence the dev socket. Both files pass when rerun.
- `gallery.spec` axe: a colour-contrast violation on `.ah-receipt__mark .ah-mark--waiting` inside the ReceiptTable, which the twist package is rewriting in this wave.

Every server I started was stopped: `stand.ts status --slot 1` shows the chain, relay, site and dev server down.

## Problems found outside my paths (for wave 6)

- `apps/hand/tests/guards/colour.test.ts` fails on hex-like test strings in `screens/check/ruler.test.ts:93` and `screens/landing/paste.test.ts:61` (the guard should skip `*.test.ts`, or those tests should use other strings).
- ReceiptTable's waiting mark has a serious axe contrast violation (gallery smoke): twist's paths.
- In `/pass`, the "Make the address show less" checkbox's accessible name contains "the address", so `getByLabel("The address")` is ambiguous. That is not an app defect; the spec uses `getByRole("textbox", { name: "The address" })`. Specs that will run on a non-dark Hand should do the same.
- Smoke specs that run on a `--dev` stand without `quietDevServer` (thank, give, raise, my, waiting) can fail when another agent saves a file. On a built stand this cannot happen.

## Not verified

- Only the dev wallet; no real extension wallet, no atomic EIP-5792 batch, no public relay.
- Desk width (1280) was not run for the life (the phone project only).
- The life was not run in Russian (e2e-guards' `russian.spec` covers the first five steps).

# e2e-guards (wave 5): the guards

Tests only; no app code was edited. Files: `tests/e2e/guards/{failclosed,wallclock,hygiene,a11y,russian}.spec.ts`,
helpers in `tests/e2e/guards/lib/` (`guard.ts` spec-side; `record.ts` the recorder and search;
`forge.ts` a child-process tool), and `tests/e2e/FINDINGS.md`.

## What each guard does

- **failclosed** (11 cases, 10 tests): flipped byte, faced address without its `d`, another hand's
  number, another Core and a newer version (asserted to differ), a route below the hand's minimum,
  a give address with an altered giver signature (on /thank), a re-signed answer that drops a holder
  (on /thank, same device), an expired hand (Hand view, and /pass and /give reached in the same
  tab), Core's address as payee on /pass and /give, an address made for another host pasted on the
  landing page. Each asserts the sentence, its message id where the screen exposes one, and that
  no swipe can be pressed (`expectNoWayOn`: every visible `*-swipe` is disabled or absent).
- **wallclock**: `page.clock.setFixedTime` two years back and two years ahead; the open fixture
  reads open, the expired one "Time's up", and the 7-day and 180-day chips each raise a hand whose
  `hands(id).expiry` is within 120 s of `openedAt + 7 d` or `openedAt + cap − 600`.
- **hygiene**: a self-test plants a seed (hex in upper case with 0x, base64url inside JSON, digits
  in sessionStorage, base64url on the console) and the search finds exactly those; then a whole
  life in three recorded contexts (raise on /raise, pass at 10% to a pasted address, answer with
  "I have none — make one", thank on /thank) is searched: every request (URL, headers, body), every
  WebSocket frame both ways, every console line and page error, and the three contexts'
  localStorage, sessionStorage and IndexedDB, for both live links' seeds in three forms, both whole
  addresses and their fragments, the twelve words (phrase, every run of three, quoted list) and the
  made address's private key. Signatures (the link's own, by value, and any 65-byte hex run) may
  appear only in JSON-RPC bodies to the RPC origin; the test also asserts they did appear there,
  so the search is not empty-handed. Then dev account 5: chain paused, escrow polled to one record,
  dumped while sent, again after "up", searched, ticked, empty.
- **a11y**: axe 4 tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22a, wcag22aa` on 23 arrivals
  (every route of `routes.ts` except `/gallery` and `/dev/wallet`, plus states of the Hand view and
  /thank with an answer), each at 390 and 1280, light and dark. Keyboard-only passage through pass
  and give with a focus-ring check (outline ≥ 2px). Reduced motion: no running animation after
  1.5 s on landing, Hand view, /raise.
- **russian**: locale ru-RU, raise → open → pass → help (dev account 4) → thank, asserting UX-SPEC's
  Russian sentences and that no English catalogue value (literal runs ≥ 14 characters outside
  `{…}`, compared case-insensitively, values equal in both languages skipped) appears on any of
  the nine screens visited. A self-test shows the same search finds English on /raise in en-US.

## Choices the design did not make

- **Known axe violations as exact exceptions, plus one fixme.** Marking all 23 route tests fixme
  would have switched the guard off. Instead each route test fails on any serious/critical violation
  not listed in `KNOWN` (each entry names its FINDINGS row) and also fails when a listed one is no
  longer seen, so wave 6 must drop the entry when it fixes the row. The real gate, "no exception at
  all", is one `test.fixme` that names rows A-1 to A-4.
- **Below the minimum** has no SDK encoder (all refuse it), so `forge.ts below-min` packs the bytes
  with the SDK's own `pack` (exported from `link.ts` for exactly this, not from the index) after
  signing a real Shake on a dark hand with `minClaimBps` 9 000.
- **Landing, another site**: the design's sentence is a warning ("The link opens anywhere"), and the
  landing offers "Open here" after it. The guard asserts the sentence, that the tab stays on this
  site with no fragment, and that no request goes to the other host; it does not require the
  "Open here" button to be absent.
- **Expired, /pass and /give**: "no way on" accepts a disabled swipe as well as an absent one, plus
  "Time's up." on screen (see O-1).
- **Re-signed**: "no way on" means both the swipe and "Thank this route anyway" are disabled until
  each dropped holder is ticked; the guard does not tick.
- **Altered giver signature** is checked on /thank (where Core is asked), not on the holder's Hand
  view, which by design shows "Someone answered this hand. Pass it back." without asking Core.
- **Storage is outside the signature rule**: the inbox and outbox hold give links by design (ARCHITECTURE §11).
- **Not serial**: failclosed's tests are independent, so one failure does not skip the rest.
- **Ports**: the brief gave 18050–18099 but also slot 2, whose ports are fixed by the stand
  (18565, 18567, 18321). Only slot 2's ports were used; nothing listened on 18050–18099.

## What was run, with results

- `bun infra/stand/stand.ts up --slot 2 --dev`; seeding by each spec's `beforeAll`.
- `STAND_SLOT=2 bunx playwright test tests/e2e/guards` → **46 passed, 1 skipped** (the a11y fixme,
  rows A-1–A-4), 6.0 min. Every spec was also run alone during the build.
- The a11y route tests failed 23 of 23 on the first run (the shell's A-1 and A-2 on every route);
  the violations were read from the JSON attachments and written to FINDINGS.md.
- `bunx tsc --noEmit -p tests/e2e`: no error under `tests/e2e/guards`.
- Screenshots (EN and RU, 390 px) of a damaged link, another Core and the other-site warning:
  `knowledge/plan/research/2026-11-20-experiment/shots/build/e2e-guards/`, looked at.
- `bun infra/stand/stand.ts down --slot 2` at the end.

## Not verified

- Only `--dev` (Vite) on slot 2, phone project; not on a built stand, not the `desk` project (a11y
  sets 1280 itself). Other packages were editing the app during the runs; results are of that state.
- No screen reader; axe and the keyboard passage only. The keyboard test covers pass and give, not
  raise or thank.
- Hygiene covers one path (unlisted hand, 10% pass to a pasted address, twelve-words helper). Not
  the dark or public modes, the wallet helper, chat replies, a reload, or the exit page.
- The clock guard moves the browser's `Date`; it does not change the machine's or the dev
  wallet's process clock, nor `performance.now`.

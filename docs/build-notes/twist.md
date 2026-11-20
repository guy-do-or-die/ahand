# twist — Every hand turns over (wave 5)

## What was built

- `apps/hand/src/ui/Flip.tsx`: a two-sided card. The front is a real `<button aria-expanded aria-controls>`, and the back (`role="group"`) is its next sibling in the document. A receipt row (`variant="row"`) turns as one card: a 360 ms `rotateY` with `backface-visibility: hidden` on both faces. A hand on the rail (`variant="rail"`) turns where it stands and its back opens as a sheet under the rail (see "Review round 1" below). Under `prefers-reduced-motion` there is no motion, and the sides swap at once. A tap on the back turns it again. The back is rendered only while it is shown, so its checks run when someone turns the card. The card holds which side is up, unless the caller passes `flipped` and holds it itself. The file also holds the twist's EN/RU words, `useReducedMotion` and `useTicks`. Refusal sentences come from `i18n/common` (`core.<Error>`).
- `ShakeBack.tsx`: the share kept, as a percentage and as money at today's reward (no money line when the reward is 0 or unknown); where the money lands; the key that held the link; the next key. Then the three steps of `runSteps` for this pass tick one by one, with plain sentences. Last comes Core's `checkRouteOnChain` answer, with the block it was read at and `lastKey · claimBps`. Shared pieces live here: `coreAnswer`, `useProof`, `ProofBody`, and `pinnedTo`. `pinnedTo` makes every read of one answer at a single block number, so the "block n" on the card is the block the answer was read at.
- `GiveBack.tsx`: the helper's claim and money (Core's rest: the reward less every margin), the signer, the payee and the last key. Then the seven Give steps tick. For an open Hand, Core's answer is `checkGive` (through the forwarder for a 6492-wrapped signature, as /thank does it). For a thanked Hand, it is `thanks(id)`, and the card compares the stored hash with the giveHash rebuilt here: "giveHash matches Core" only when they are equal.
- `ChainRail.tsx` (props unchanged): when `route` fits the hands (the asker, one per Shake, the helper if there is a Give), every hand is a Flip, and one hand is turned at a time. The asker's back shows the Hand's EIP-712 terms and `handHash`, then `hands(id)` read at a block: "Terms match Core" or "Terms differ".
- `ReceiptTable.tsx` (props unchanged): every row is a Flip. Its back shows the formula with the real numbers (`reward × (claimBps − nextClaimBps) ÷ 10 000` from the Shaken event's fields, or the reward less every margin for the helper, or the whole reward for a refund) and each event's name, block, log index and transaction. With `landed`, the table draws the Sweep. With no `landed`, there is no sweep.
- `Sweep.tsx`: `useSweep(flags)` sweeps rows strictly in order. A row is swept only after its own flag is true and the row above has finished. After the helper's row is swept, 🙏 bows twice. Under reduced motion, the end state shows at once.
- `design/twist.css`: tokens only, no shadow.
- `gallery/twist.tsx`: the sections `Flip` and `Sweep`. Routes are signed in the page with sample keys (keccak of fixed words) for Hand 4242424242, which was never raised. So the checks are real, and Core's answer is the real "NotRaised". There is also a route with one pass made by a wrong key, a rail without a route, a receipt with sample events, and two sweep replays (flags one by one, and all at once).

## Choices the design did not make

- **The sweep is a 5 px stroke along the foot of each row.** It is not a full-height band behind the text. In the dark theme the row's words are paper-coloured, so a full band would put light text on amber for the length of the sweep. axe flagged this (color-contrast on the waiting mark), and it breaks the rule "amber only as a fill with ink on it".
- **A receipt row is one cell (`<td colSpan=2>`) holding the flip button.** The button holds the label and the amount. A `<tr>` cannot be a button, and a turning card cannot span two cells. The tfoot keeps `th`/`td`.
- **The keyboard focus stays on the front button.** In a receipt row the button faces away while the card is turned, so the focus ring is drawn on the outer `.ah-flip`, which does not rotate. On the rail the hand stays up, and the ring is drawn around the hand itself. Focus is not moved into the back.
- **The lens does not turn cards.** Turning every card at once would rebuild the layout; the lens promise is that "the layout does not change".
- **"made by the key that held the link"**, not "signed by …" (UX-SPEC §3). "sign" is banned on the human layer, and i18n/common already says it this way.
- **A pass that kept nothing shows no `0x0000…0000`** in the receipt: Core logs the zero address as its payee.
- **The rail aligns to the top when it can turn**, so the sheet that opens under it starts right under the hands.

## What was run (slot 3, `--dev`, on this machine)

| Command | Result |
|---|---|
| `STAND_SLOT=3 bunx playwright test tests/e2e/smoke/twist.spec.ts` | 10 passed (phone); with `--project=desk`, 10 passed |
| `STAND_SLOT=3 bunx playwright test tests/e2e/smoke/thank.spec.ts tests/e2e/smoke/gallery.spec.ts` | 20 passed (the gallery's whole-page axe includes the twist) |
| `STAND_SLOT=3 bunx playwright test tests/e2e/smoke/hand.spec.ts tests/e2e/smoke/my.spec.ts` | 13 passed |
| `cd apps/hand && bun test` (colour, clock, words guards included) | 316 pass, 0 fail |
| `bunx tsc --noEmit -p apps/hand`, `-p tests/e2e` (my files) | 0 errors |

The smoke covers:

- **Gallery.**
  - Flipping a pass shows the share, the payee and three passing checks in Core's order, then Core's answer, whose block number lies between two chain reads.
  - A broken pass fails at `InvalidKeySig` with Core's sentence.
  - The helper's card shows seven passing checks.
  - A receipt row shows its formula with the real numbers.
  - The sweep is never ahead of its flags, and it goes row by row even when every flag arrives at once.
  - Under reduced motion: `transition-duration: 0s`, the transform is already `matrix3d(-1,…)`, no running animations, and `animation-name: none` on the bands and the bow.
  - Keyboard: Tab reaches each of the 4 hands, Enter and Space turn a card, and `aria-expanded` follows.
  - axe finds nothing serious or critical in light/EN and dark/RU, and no element has a `box-shadow`.
- **Hand view, on seeded Hands.**
  - twoPasses: "5% · $3.00", checkRoute ok at a block, and the terms match Core.
  - thanked give link: "giveHash matches Core", and the receipt row's event carries the thank's transaction hash.

Screenshots, all looked at: `knowledge/plan/research/2026-11-20-experiment/shots/build/twist/` (gallery EN/RU, light/dark, at 390 and 1280; Hand view at 390 in EN/light and RU/dark).

## Not verified

- No screen reader was used; only the DOM order and the ARIA attributes were checked.
- I did not take a screenshot of the sweep on the real /thank screen. thank.spec passes with the table drawing the sweep, but I did not look at the sweep there.
- Safari/WebKit and real touch devices were not tested (Chromium only).
- No pure unit test file was written: my owned paths include no `*.test.ts`. The logic (formulas, sweep order, share money) is asserted end to end in the twist smoke.

## Review round 1: the rail stays on screen when a hand turns

**The finding** (polish): at 390 px, after the asker's card was flipped, the YOU chip and the empty slot slid off the rail with no cue. Reproduced before changing anything, on the Hand view of the seeded `unlisted` Hand at 390×844: the rail's box is 24–366 px; with the asker turned, YOU stood at 370–400 px and the slot at 424–450 px. The same happened at 1280 px for a two-pass route (the rail's column is 540 px wide there: YOU at 685–715 px, the box ending at 700 px), so the fix is not for phones only.

**The cause**: the back was a 320 px card inside the hand's own list item, so the item grew and pushed everything after it out of the rail's box.

**The fix**, in `Flip.tsx`, `ChainRail.tsx` and `twist.css`:

- The rail that can turn is a CSS grid. Its first row is the route (hand, line, hand, …, YOU, slot). The back of the turned hand is the second row: one sheet under the whole rail, as wide as the rail's box (`100cqi` of the rail's wrapper, which is a size container), and pinned to the box (`position: sticky; left: 0`) while a long route scrolls sideways above it. Nothing on the rail moves when a hand turns.
- The document order did not change: the back is still the next sibling of the button that turned it (UX-SPEC §13). The list item, `.ah-flip` and `.ah-flip__card` only stop making boxes of their own on the rail (`display: contents`).
- The hand itself still turns: 360 ms of `rotateY`, edge-on at the half, where it becomes its other side (ink fill, paper letters) with a 2 px stem down to its sheet. The sheet unrolls from the rail downwards with a clip, which moves no box, so the page can measure it and scroll to it while it opens.
- One hand is turned at a time on a rail (`ChainRail` holds which, through Flip's new `flipped` prop). Turning another hand turns the first one back; its sheet leaves at once.
- When a hand is turned back, the rail, and only the rail, scrolls sideways until the YOU chip shows, with the slot after it where both fit.
- When a card turns, the page shows all of its back if the front and the back fit on the screen together; otherwise it puts the front at the top. While the reader does not touch the page, it follows the back as the checks make it longer.

**Forks decided**

- *A sheet under the rail at every width, not only on phones.* The finding names the phone, but the 320 px card also pushed YOU off a 540 px rail at 1280 px with two passes. One layout at every width is one code path and one thing to test; the cost is that the desktop no longer shows a card turning inside the rail. Reversible: the old rule set is in git.
- *CSS in the same document order, not a portal.* A portal would put the sheet after the list in the document; UX-SPEC §13 asks for the back to follow its button. `display: contents` and a grid keep the order and need no measuring in script.
- *One hand at a time.* Two sheets would share the one row under the rail. Stacking them would need each sheet to say whose it is; one at a time needs nothing, and the ink hand with its stem says whose the sheet is.
- *The ink fill as the "turned" side.* It is the cue the finding asked for, made of tokens only (ink, paper); no amber, no shadow.

**Tests** (in `tests/e2e/smoke/twist.spec.ts`; both new ones were run against the old sources first and failed there):

- "turning a hand leaves the rail where it was…": on the `unlisted` Hand, YOU, the slot and the hand keep their place when the asker turns; the back is one box under every hand, as wide as the rail, inside the page; the page gets no sideways overflow; the back is still the button's next sibling.
- "a 320 px phone and a route longer than the screen…": on the `twoPasses` Hand at 320 px, YOU starts off the rail's right edge; turning a second hand turns the first back (`data-flipped`, `aria-expanded`, one back shown); the sheet stays inside the rail's box; turning back brings YOU into view.
- Changed: the reduced-motion test now checks the hand and the sheet (no animation, the hand already filled) and keeps the `rotateY` check on a receipt row; the keyboard test reads the focus ring from the hand (2 px solid at 2 px); the first gallery test also checks that the turn is the `ah-hand-over` animation.

**What was run** (own chain on port 25045, relay 25047, Vite dev 25001; the stand's steps with other ports, since a slot's ports are outside this task's range)

| Command | Result |
|---|---|
| `STAND_FILE=… STAND_BASE_URL=http://127.0.0.1:25001 bunx playwright test tests/e2e/smoke/twist.spec.ts` | 12 passed (phone); with `--project=desk`, 12 passed |
| the same with `-g "320 px"` and the first new test, on the sources of `HEAD` | both failed (YOU outside the rail; the first hand still turned) |
| `… tests/e2e/smoke/gallery.spec.ts tests/e2e/smoke/hand.spec.ts` | 25 passed |
| `… tests/e2e/smoke/my.spec.ts` | 7 passed |
| `bunx tsc --noEmit -p apps/hand`, `-p tests/e2e` | 0 errors |
| `cd apps/hand && bun test` | 460 pass, 0 fail (the last run; an earlier one had 1 failure in `wallet/send.test.ts`, a file of another package that was being changed at the time) |

Screenshots, all looked at: `knowledge/plan/research/2026-11-20-experiment/shots/round-1/fix-twist/` (`00` is the rail before the fix; then 390 px EN light closed, mid-turn, turned and full page; 390 px RU dark; 320 px long route turned, scrolled with the sheet pinned, and turned back with YOU in view; 1280 px turned and its focus ring; a thanked Hand in the dark theme; the gallery's Flip section).

**Not verified, and what is left**

- Chromium only. `display: contents` on list items, container query units and `:has()` were not tried in Safari or Firefox. Where `cqi` is not known, the sheet falls back to the whole route's width (`width: 100%`).
- No screen reader was used. The order in the document and the ARIA attributes are checked by the tests.
- On the Hand view the bottom action bar (`sticky bottom-0`, in `screens/hand`) covers about the last 90 px of the screen, so the foot of a long sheet opens under it and the reader scrolls a little further. Flip uses `scrollIntoView`, which keeps clear of a covered edge when the page declares it with `scroll-padding-bottom`; the Hand view does not declare it.
- The turn of the answer card's rail on `/my` was not looked at in a browser (`my.spec` passes; the rail's parent there is a stretching column, the same as on the Hand view).


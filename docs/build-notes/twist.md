# twist — Every hand turns over (wave 5)

## What was built

- `apps/hand/src/ui/Flip.tsx`: a two-sided card. The front is a real `<button aria-expanded aria-controls>`, and the back (`role="group"`) is its next sibling in the document. Turning the card is a 360 ms `rotateY` with `backface-visibility: hidden` on both faces. Under `prefers-reduced-motion` there is no transition, and the sides swap at once. A tap on the back turns it again. The back is rendered only while it is shown, so its checks run when someone turns the card. The file also holds the twist's EN/RU words, `useReducedMotion` and `useTicks`. Refusal sentences come from `i18n/common` (`core.<Error>`).
- `ShakeBack.tsx`: the share kept, as a percentage and as money at today's reward (no money line when the reward is 0 or unknown); where the money lands; the key that held the link; the next key. Then the three steps of `runSteps` for this pass tick one by one, with plain sentences. Last comes Core's `checkRouteOnChain` answer, with the block it was read at and `lastKey · claimBps`. Shared pieces live here: `coreAnswer`, `useProof`, `ProofBody`, and `pinnedTo`. `pinnedTo` makes every read of one answer at a single block number, so the "block n" on the card is the block the answer was read at.
- `GiveBack.tsx`: the helper's claim and money (Core's rest: the reward less every margin), the signer, the payee and the last key. Then the seven Give steps tick. For an open Hand, Core's answer is `checkGive` (through the forwarder for a 6492-wrapped signature, as /thank does it). For a thanked Hand, it is `thanks(id)`, and the card compares the stored hash with the giveHash rebuilt here: "giveHash matches Core" only when they are equal.
- `ChainRail.tsx` (props unchanged): when `route` fits the hands (the asker, one per Shake, the helper if there is a Give), every hand is a Flip. The asker's back shows the Hand's EIP-712 terms and `handHash`, then `hands(id)` read at a block: "Terms match Core" or "Terms differ".
- `ReceiptTable.tsx` (props unchanged): every row is a Flip. Its back shows the formula with the real numbers (`reward × (claimBps − nextClaimBps) ÷ 10 000` from the Shaken event's fields, or the reward less every margin for the helper, or the whole reward for a refund) and each event's name, block, log index and transaction. With `landed`, the table draws the Sweep. With no `landed`, there is no sweep.
- `Sweep.tsx`: `useSweep(flags)` sweeps rows strictly in order. A row is swept only after its own flag is true and the row above has finished. After the helper's row is swept, 🙏 bows twice. Under reduced motion, the end state shows at once.
- `design/twist.css`: tokens only, no shadow.
- `gallery/twist.tsx`: the sections `Flip` and `Sweep`. Routes are signed in the page with sample keys (keccak of fixed words) for Hand 4242424242, which was never raised. So the checks are real, and Core's answer is the real "NotRaised". There is also a route with one pass made by a wrong key, a rail without a route, a receipt with sample events, and two sweep replays (flags one by one, and all at once).

## Choices the design did not make

- **The sweep is a 5 px stroke along the foot of each row.** It is not a full-height band behind the text. In the dark theme the row's words are paper-coloured, so a full band would put light text on amber for the length of the sweep. axe flagged this (color-contrast on the waiting mark), and it breaks the rule "amber only as a fill with ink on it".
- **A receipt row is one cell (`<td colSpan=2>`) holding the flip button.** The button holds the label and the amount. A `<tr>` cannot be a button, and a turning card cannot span two cells. The tfoot keeps `th`/`td`.
- **The keyboard focus stays on the front button while it faces away**, and the focus ring is drawn on the outer `.ah-flip`, which does not rotate. Focus is not moved into the back.
- **The lens does not turn cards.** Turning every card at once would rebuild the layout; the lens promise is that "the layout does not change".
- **"made by the key that held the link"**, not "signed by …" (UX-SPEC §3). "sign" is banned on the human layer, and i18n/common already says it this way.
- **A pass that kept nothing shows no `0x0000…0000`** in the receipt: Core logs the zero address as its payee.
- **The rail aligns to the top when it can turn**, so a turned card grows downwards and the other hands stay level.

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

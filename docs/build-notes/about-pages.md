# about-pages (wave 5): landing, what it can't promise, about these defaults

## What was built

- `/` (`screens/landing/`): the hero line from the brand cover ("Raise a hand. *Your people* take it from there.", the marked words in amber) with ✋ idling; the lead paragraph; the ✋ swipe to `/raise`; quiet links to `/my` and `/without-us`; the **Open a link** box; three gesture cards (✋ 🤝 🙏) that turn over to Core's own call in mono (`raise(...) → handId`; `Shake {...}` and `checkRoute(...)`; `thank(...)` and `refund(handId)`), with a lens note on each back. Under the cards: "Thanking is voluntary: the asker decides." and a link to `/limits`.
- `paste.ts` (pure, `paste.test.ts`, 8 tests): reads a pasted address, a bare link, `#link`, or QR digits. An address made for another site is rebuilt under this site (the Hand's path and its `d` only, nothing else kept) and the screen first shows the UX-SPEC sentence "This address was made for {host}. …" with "Open it here". The link then goes into `store/memory.ts` (`via: "paste"`) and the router goes to the Hand's path (or `/` with `view: "hand"` for a bare link). Text that is no link shows an error band and opens nothing. A numbered address with no link opens the public view.
- `/limits` (`screens/limits/`): sixteen entries, each one sentence and one example: the twelve of brief 02 §2 in the brief's order, starting with "Thanking is voluntary"; the two token entries in UX-SPEC §11's exact words; this build's two (the site's code reads links; another site can ask for the same keys confirmation); the unaudited sentence last. The lens adds each entry's source (R-numbers, audit ids) in mono.
- `/defaults` (`screens/defaults/`): fifteen rows, D-21, D-26 (×3: 70%, 30 days, 250 with its price of 55 paid passes instead of 66), D-27, D-31, D-32, D-37, D-39, D-40, D-49, D-61, D-62, D-63, D-66. Each row has its number, a plain title and body, the setting in mono (read from the configuration where it holds it: `minClaimBps`, `expiryDays`, `payoutGasK`, tokens, relays, prices and their date, forwarder), and "Chosen for this experiment, not by the project's owner." / «Выбрано для этого эксперимента, а не владельцем проекта.» Rows in DECISIONS "Left for the owner" also say "The owner has yet to rule on this one."

## Choices the design did not make

- **Other-site paste: two steps, not one.** The sentence is shown on the landing and the link opens only on "Open it here"; opening at once would hide the sentence. The link is opened under this site's origin (the address is rebuilt from the Hand's path and `d`), so it routes here even when the other site has a path prefix of its own.
- **A bare link or QR digits** are held as `<this site>/#<link>`, so Copy and Share on the Hand view give a whole address.
- **The gesture cards are this package's own flip**, not `ui/Flip.tsx`: when I started, Flip did not exist; when I finished, it existed but was not exported from `ui/index.ts` and has only `rail` and `row` variants. The cards follow the same contract (a button with `aria-expanded`, the back right after it in the document, 360 ms `rotateY`, sides swapped under reduced motion; the lens shows the backs).
- **Banned words in the limits**: brief 02's "second wallet", "signs", "gas-heavy", "no fee" are said as "second address", "confirms/accepts", "too little room to run", "takes nothing". The audit example cannot name "Coinbase Smart Wallet, Safe 1.4.1" on the human layer (both hit the guard), so it says "two kinds of smart account" and the names stand in the lens line.
- **Defaults beyond the brief's list**: D-27 (dollar token only), D-31 (share at "in a block"), D-39 (a reload forgets the link) were added because a person feels them.
- **Ports**: the brief names slot 6 (18360/18361/18605/18607) and also the range 18250–18299; slot 6 was used because the done check runs `STAND_SLOT=6`. Nothing ran on 18250–18299.
- **axe scope**: the smoke runs axe on `#main` (the screen). The shell has serious findings of its own (below).

## What was run

| Command | Result |
|---|---|
| `bun test src/screens/landing/paste.test.ts` (in apps/hand) | 8 pass |
| `bun test tests/guards src/screens/landing` (in apps/hand) | 126 pass, 0 fail (words: key parity, ICU, banned words for all catalogues; colour; secrets; clock) |
| `bunx tsc --noEmit -p apps/hand`, `-p tests/e2e` | no error in the owned paths |
| `bun infra/stand/stand.ts up --slot 6 --dev`, then `STAND_SLOT=6 bunx playwright test tests/e2e/smoke/about.spec.ts` | 13 passed (phone, 45 s): hero and flips (Core's calls on the backs); seeded unlisted address pasted → `/31337/<id>?d=…`, Deal card with its title, no `#` in the URL; same link under `https://ahand.elsewhere.example` → the sentence (EN and RU), then "Open it here" → the Hand; QR digits of the dark fixture → the Hand with its title; junk → error band; `/limits` 16 entries in EN and RU with both token entries; `/defaults` every row "not by the project's owner" (EN) and the Russian equivalent, D-21/26/32/40/49/61/62/63/66 present; axe no serious or critical on the three screens in both languages |
| Full-page axe (script, phone) | the screens are clean; the shell is not (see needs) |
| Screenshots EN/RU at 390 and 1280, light and dark | `knowledge/plan/research/2026-11-20-experiment/shots/build/about-pages/`; no horizontal overflow at 390 |
| `stand.ts down --slot 6` | every service stopped; nothing listens on 18360/18361/18605/18607 |

## Not verified

- The built app (only `--dev`); the desk Playwright project; a real screen reader; reduced motion in a browser (CSS only).
- The landing's `/raise` swipe was checked only as navigation.

## Needs (outside my paths)

- `apps/hand/src/shell/Shell.tsx`: axe "serious" on every page: `color-contrast` on the unselected language button (`text-ink/55`, line 52; use `text-ink/70` or more), and `label-content-name-mismatch` on the logo link (`aria-label="aHand: back to the start"` while the visible text is "aHand"; and the language buttons, `aria-label="English"` with visible "EN"): put the visible text at the start of the label, or drop the `aria-label` and add `sr-only` words.
- `apps/hand/src/ui/index.ts` (twist): export `Flip`; with a `card` variant, the landing's `GestureCard` can switch to it.

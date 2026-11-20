# Build note: app-design (wave 2)

The design system and the shared UI kit of `apps/hand`, with a gallery. Written 2026-11-20 by the
agent that built it. What is listed as run was run on this machine; what was not is said so.

## What exists

- `apps/hand/src/design/`: `tokens.css` and `tokens.ts` (the five raw colours, and nowhere else),
  `components.css` (the owner's system carried over, then "New pieces"), `index.css` (Tailwind 4,
  the three self-hosted font families), `theme.ts`, and the empty `twist.css` and `print.css` that
  wave 5 fills.
- `apps/hand/src/ui/`: the kit of ARCHITECTURE §7, exported from `ui/index.ts`.
  Ported: `SwipeButton`, `QuietButton`, `ChipRow`, `RewardBar` (the old `PotBar`), `ChainRail`,
  `ReceiptTable`, `Sheet`, `MetaLine`, `Emoji`, `Logo`, `Identity`, `ThemeToggle`, `CopyRow`.
  New: `DealCard`, `Mark`, `TxRail`, `Disclose`, `MoneyInput`, `AddressInput`, `LandSheet` (and
  `LandPicker`, the same three choices inline), `CostLine`, `ErrorBand`, `Qr`.
  Logic kept apart from the components, so it is tested without a browser: `judge.ts` (amounts
  and addresses), `receipt.ts` (SDK rows to lines), `qr-code.ts`, `land.ts` (twelve words),
  `format.ts`, `words.ts`, `ambient.tsx`.
- `apps/hand/src/gallery/`: its own Vite entry (`gallery.html`). Both themes side by side;
  `?lang=ru`, `?theme=light|dark`, `?lens=on`; `twist.tsx` is the stub wave 5 fills.
- `tests/e2e/smoke/gallery.spec.ts`: 13 browser tests.

## How a screen uses the kit

```tsx
import { DealCard, ChainRail, ReceiptTable, LandSheet, Qr, Mark, Disclose } from "../../ui";
```

- **Language and lens come from the page.** A component reads `<html lang>` and
  `<html data-lens="on">` (the shell sets both). A screen passes neither. `<Ambient lang lens>`
  overrides them for a subtree; `DealCard` also takes `lang` directly.
- **The kit's own sentences** are in `ui/words.ts`, English and Russian, typed so a sentence
  missing in one language does not compile. A screen's own sentences stay in its `en.ts`/`ru.ts`
  and reach the kit as props (labels, button texts).
- **No component reads the clock.** `DealCard` takes `state` (the SDK's `stateAt(now)`), `expiry`
  and `closedAt`; with `state` undefined it shows the dates and claims nothing (UX-SPEC §15).

Props fixed now, because later waves pass them:

| Component | Props |
|---|---|
| `ChainRail` | `hands: RailHand[]` (`{ role: "asker" \| "passer" \| "helper"; address?; name? }`), `route?: RailRoute` (`{ chainId, core, hand, signedShakes, signedGive?, reward?, decimals? }`), `you?`, `next?`, `caption?` |
| `ReceiptTable` | `rows: ReceiptRow[]` (the SDK's `receiptOf(logs).rows`), `landed?: boolean[]` (one flag per SDK row), `decimals`, `caption?` |
| `DealCard` | `state`, `description` (`attached` with title and content, `lost`, `none`), `reward`, `decimals`, `expiry`, `closedAt?`, `claimBps?`, `raiser`, `raiserName?`, `handId?`, `block?`, `lang?`, `timeZone?`, `heading?`, `children` |
| `LandPicker` / `LandSheet` | `purpose: "give" \| "share"`, `account?`, `onConnect`, `ctx: { core, raiser, token }`, `initialAddress?`, then `onChange(landing?)` / `onDone(landing)`, `onClose` |
| `Qr` | `value`, `maxVersion?` (25), `label?`; the same reading as a function: `qrOf(value, maxVersion)` |
| `TxRail` | `reached: "sent" \| "in-block" \| "safe" \| "final"`, `local?` |
| `AddressInput` | `label`, `ctx`, `initial?`, `onReading(reading)`, `hint?` |
| `MoneyInput` | `label`, `decimals`, `initial?`, `max?`, `onReading(reading)`, `hint?` |
| `CostLine` | `cost` (the SDK's `costOf`), `prices`, `gas?` |

`Landing` is `{ choice, payee, signing, flagged? }`, where `signing` says how a Give would be
confirmed: `{ kind: "account", address }`, `{ kind: "one-time", keep }` (the screen makes the
one-time key and drops it) or `{ kind: "words", account }` (viem's account object made from the
twelve words, held in memory only).

## Decisions I made, and why

1. **The kit carries its own words and takes its language from `<html lang>`.** The shell was
   being written at the same time, so importing its catalogue would have tied two unfinished
   packages together. The shell already sets `lang` and `data-lens` on `<html>`, so the two met
   without either importing the other. Cost: the marks' names exist in `ui/words.ts` and may also
   exist in `i18n/common`; the kit never reads the latter.
2. **Quiet text is ink at 60%, not 45–55%.** Measured: ink at 55% on paper is 4.2:1 and fails
   WCAG AA; 60% is 4.9:1 on paper, 5.0:1 on card. Brief 06 allows 50–70%. One token, `--ink-quiet`.
3. **The two shadows of the old stylesheet are gone** (the rule is "no shadows anywhere" and the
   check greps for the word): the compose underline is a background line, the chosen chip's focus
   is the page's own 2px ink ring.
4. **`Sheet` is a native `<dialog>` opened as a modal.** The browser keeps focus inside, returns
   it, closes on Escape and puts it above everything, so no script does that and nothing can
   cover its focus ring. The old "first Escape leaves the field" nicety is not kept.
5. **`Identity` resolves nothing.** It shows an address in mono and, before it, a name only when
   the caller says it is proved. The old one called wagmi inside; a kit that needs a wallet
   provider cannot be shown in a gallery, and UX-SPEC §4 makes the proof the caller's duty.
6. **`ThemeToggle` only sets `<html data-theme>`.** The shell watches that attribute and keeps the
   choice in its preferences; a second store in the kit would be one too many.
7. **`ReceiptTable` shows amounts only from `Paid` and `Pending`.** Each line is a `Shaken`,
   `Given` or `Refunded` with the payout that follows it in Core's order. A pass that kept nothing
   says "kept nothing"; a thank of a hand with no reward says "a thank-you only"; no zero is ever
   written as money. `Pending` wears the waiting mark. With `landed`, a line counts as read when
   every SDK row behind it is; unread lines are dimmed and say "not read yet" to a screen reader.
8. **`RewardBar` is 4px by default** (UX-SPEC §2); the mock's 8, 10 and 12px stay as sizes. A
   meter without a name says nothing to a screen reader, so `label` is required.
9. **`TxRail` shows one LOCAL STAND-IN tag under steps three and four** instead of one per step:
   two tags do not fit a 390px screen in either language. A screen reader hears it with each step.
10. **The Russian fourth step is «Навсегда»**, not «Окончательно»: twelve mono letters do not fit
    a quarter of a phone's width, and "for good" is what final means to a person.
11. **`Qr`: the code is too dense above version 25**, and then nothing is drawn. The tile is ink
    on paper in both themes and at least three pixels a module (it sets its own minimum width).
12. **Money on the human layer is `$40` in both languages** (as the spec's Russian copy writes
    it), with the language's own separators, cut to cents and never rounded up. Mono numbers
    (a block, gas) are grouped with a space in both languages: `1 234`.
13. **Tabular figures stay only where figures stand in a column** (the receipt, the chips). In
    Schibsted Grotesk the tabular feature also widens commas and full stops, which broke
    sentences like "it's free; there is no share to keep".
14. **A file is never named like a component in another case.** `qr.ts` beside `Qr.tsx` made Bun
    look for `qr.tsx`; it would also collide on a case-blind disk. The logic is `qr-code.ts`.
15. **The logo's two CSS blocks for image lockups were dropped** from `components.css`: the
    lockup is composed in HTML and nothing uses those classes.

## A fault found by running, and fixed

The words kept for screen readers inside the chain rail (`sr-only`, absolutely placed) were not
contained by the rail, so a ten-hand route made the whole page 930px wide on a phone. A phone
browser then widens its layout to fit, which hid the fault from a naive "scroll width against
window width" check and made every tap land on the wrong element. The rail is now positioned, and
the spec compares the page's width with the device's own 390px.

## Verified by running

| Check | Result |
|---|---|
| `cd apps/hand && AHAND_CONFIG=$PWD/src/config/config.example.json bunx vite --port 18321`, then `/gallery.html` | 200; every section renders; no console error or warning in the screenshot runs |
| `STAND_BASE_URL=http://127.0.0.1:18321 bunx playwright test tests/e2e/smoke/gallery.spec.ts` | 13 passed (phone, 390×844) |
| the same with `--project desk` | 13 passed (1280×800) |
| `grep -rnE "#[0-9a-fA-F]{3,8}" apps/hand/src --include=*.tsx --include=*.css` | five lines, all in `design/tokens.css` |
| `grep -rn "box-shadow" apps/hand/src/design apps/hand/src/ui` | nothing |
| `bunx tsc --noEmit -p apps/hand`; `bunx tsc --noEmit -p tests/e2e` | no error |
| `cd apps/hand && bun test` | 147 passed (29 of them the kit's, in `src/ui/*.test.ts`; the shell's guards for clock, colour and words pass over the kit's files) |
| `vite build` into a scratch folder | builds `index.html` and `gallery.html`; fonts are files of the build; no outside URL in it |

What the browser tests assert: each of the 23 sections is visible in the light and in the dark
panel; the two panels stand side by side at 1280 and nothing runs off at 390 (also in Russian
with the lens on); the Deal card's sentences for open, expired, thanked, refunded, lost
description, no block yet and no reward, and that the no-reward card and the no-reward receipt
contain no "$0"; a figure opens to its source and the lens opens all; the Russian headline is
drawn with Onest and the English one with Schibsted Grotesk (asked of Chromium itself:
`CSS.getPlatformFontsForNode`), Russian mono with IBM Plex Mono; the address field refuses the
zero address and the configured Core's, flags the asker's, accepts another; zero is a valid
amount; the 428-byte link gets a code of version 13–15 at three pixels a module or more, the
1 500-byte one is called too dense and not drawn; the twelve words are shown, the choice is
complete only after the tick, and none of the words is in `localStorage`, `sessionStorage`,
cookies, the address or any IndexedDB; a sheet is a dialog, full screen on a phone and 560px on a
desk, its action off until an address may be paid; axe (WCAG 2.0–2.2 A and AA, best practice)
reports no serious or critical issue in English, in Russian and with the lens on, nor inside an
open sheet.

Screenshots, looked at one by one: `knowledge/plan/research/2026-11-20-experiment/shots/build/app-design/`
(`full-390-*`, `full-1280-*`, and the close-ups).

## Not verified, or not built

- **No real QR scan.** The code's version, size and quiet zone are tested; no camera read it.
- **The 428-byte link in the gallery is sample bytes**, not a link of a real Hand (the gallery
  has no chain). The size is the real one from ARCHITECTURE §0.
- **`ChainRail`'s `route` does nothing yet** but mark the rail (`data-flippable`): the flip is
  wave 5. Its type is my reading of what wave 5 needs (`runSteps`, `checkRouteOnChain`, money).
- **`ReceiptTable` was built against the SDK's `ReceiptRow` type**, while `receiptOf` itself was
  being written by another package. If `receiptOf` returns only payouts, the table still shows
  them (as plain lines with an address); if it fills `Shaken`/`Given` rows differently from the
  type's comments, the labels need another look.
- **The sweep and the flip** are not here (wave 5); `landed` only dims unread lines.
- **Status dots (ok, warn, bad) for the lens are not built**: they would need raw colours beyond
  the five, and no component of this wave needs them.
- **Emoji are the platform's.** The screenshots show Noto Color Emoji (this machine); on other
  systems they differ by design.
- **The receipt's amounts keep tabular figures**, which sets commas and full stops wide
  ("$0 .80" up close). It is the owner's own table style; a reviewer may prefer it changed.
- Only Chromium was run.

## For the integrator

Nothing is required for the kit to work. Things worth knowing:

- `apps/hand/src/hooks/useEnsIdentity.ts` and `apps/hand/src/lib/ens.ts` are no longer used by
  the kit. A screen that wants a name calls the hook itself and passes `name` to `Identity` or
  `raiserName` to `DealCard`, only for a name that resolves both ways.
- `apps/hand/src/lib/format.ts` (`formatUsd`, `truncateAddress`) is the old app's; the kit uses
  `ui/format.ts` (`money`, `day`, `shortAddress`, bigint amounts). One of the two should go once
  the screens are written.
- `design/tokens.ts` no longer exports `POCKET_EMOJI` (nothing used it).
- I ran Vite with `AHAND_VITE_CACHE=node_modules/.vite-design`, so it did not share a cache with
  the shell's Vite on 18311.

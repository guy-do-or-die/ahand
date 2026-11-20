# harden-app (wave 6)

Fixes of the guards' findings and the other packages' notes, then the app's headers, bundle,
secrets, clock, accessibility, honesty and phone checks. Slot 1, built app through face.
Written 2026-11-20.

## One line per fix

| Row / source | Fix | Files |
|---|---|---|
| FINDINGS O-1 (a Hand past its end still showed the /give form with "If they thank you, you get at least $15") | /give on a Hand that is not open shows the Deal card, the refusal band and a Back button, and nothing else: no form, no amount, no swipe | `src/screens/give/index.tsx` |
| FINDINGS O-2 (after a link opened on `/`, reloading or typing the root showed "No link here." forever) | the Hand view with no link left in memory takes the `view: "hand"` mark off its history entry (new `router.unmarkHandView()`): the first reload still says "No link here." (a reload forgets the link, and the screen says so), the next one shows the start page | `src/router.ts`, `src/screens/hand/index.tsx` |
| found here: /give said "you get at least $0" while the Hand was still being read | the form appears only after the chain has answered; before that the screen shows the card's place ("Opening…" / offline line) | `src/screens/give/index.tsx` |
| §11: the CSP was not in a `<meta>` tag | new `csp.ts` (one writer of the §11 policy); Vite plugin `cspMeta()` puts it into index.html and gallery.html after the referrer tag, build only, without `frame-ancestors` (ignored in a meta, and Chromium logs that as an error); `vite preview` sends the same headers as face | `csp.ts`, `vite.shared.ts`, `vite.config.ts`, `tests/csp.test.ts` |
| found here: exit.html through face logged six CSP violations: its inlined fonts are `data:` URLs and `font-src 'self'` refused them | face's policy for exit.html (the page that already gets `anyRpc` and its script hash) adds `font-src 'self' data:`; the app's pages keep `font-src 'self'` | `apps/face/src/headers.ts`, `apps/face/tests/units.test.ts` |
| §13 targets: "Skip to the content" was 39 px tall | `min-h-[44px]` | `src/shell/Shell.tsx` |
| §13 targets: a receipt row's flip face was 40 px tall | `.ah-flip--row .ah-flip__front { min-height: 44px }` | `src/design/twist.css` |
| §13 targets: the hit area of the figure buttons ("at least $50", 21 px words) reached 43 px | the `::after` hit area is 12 px above and below (was 11): 45 px; marks 48 px | `src/design/components.css` |
| §13 targets: three block links under 44 px ("What it can't promise →" on the landing 23 px, "← All my hands" 17 px, "In plain words" on /core 19 px) | `inline-flex min-h-[44px] items-center` | `src/screens/landing/index.tsx`, `src/screens/my/HandPage.tsx`, `src/screens/core/index.tsx` |
| clock guard covered only screens/, ui/, chain/, shell/ | it now also scans every other file of src/ (wallet, lib, i18n, config, gallery, the top-level files); store/ keeps its own one-helper rule | `tests/guards/clock.test.ts` |
| bundle check was a manual grep | `tests/bundle/audit.ts <dist> <config.json>`: lists every http/ws address with why it is there, fails on a third-party origin, a `.map` file or `sourceMappingURL`, anvil's mnemonic or any of its ten keys in a non-local build, and a page without the CSP meta; `audit.test.ts` proves each failure is caught | `tests/bundle/audit.ts`, `tests/bundle/audit.test.ts` |

From the other packages' notes:

- e2e-life, colour guard on hex-like test strings: no longer fails (`bun test` 0 failed); nothing to do.
- e2e-life, ReceiptTable waiting mark contrast: not reproduced; the gallery smoke's axe test passes on the built stand (see the run below). The mark's text is ink.
- feat-thank, NotRaiser / resume: no app defect named; nothing changed.
- feat-raise, **not fixed**: a reload in the milliseconds between the wallet returning the raise's hash and `onIntent` writing it loses sight of that raise (the record stays `intent`). Fixing it needs the raise record to keep the block it started at and a bounded `Raised(raiser)` log search on resume, plus a resume screen; that is a change to the raise flow larger than this wave's window and is left with its reason. The money is not lost: the Hand is on chain and anyone can send it back after its end; a repeating signer can rebuild the link on /my.

## Checked by reading

- **Secrets.** `link-intake.ts` reads `location.href` once, keeps the fragment only in `store/memory.ts` (module memory) and `replaceState`s the address without it. `memory.ts` writes nowhere. Copy and Share take the address from memory (`CopyRow` → clipboard, `navigator.share` → the system sheet, which is the user's own act). No `console.*`, `localStorage` or `sessionStorage` anywhere in src outside the gallery. The only `fetch` is `/build.json` on /core. The only query read is `/waiting?for=` (an address, read only); `pass` navigates to the `?d=` that stood before `#` (public data by design). The error boundary renders three catalogue sentences and never the error; `main.tsx` silences React's error reporting.
- **The locked copy.** `store/db.ts lockSeed` stores `{intent, iv, ciphertext}` only: AES-GCM under a non-extractable vault key, the intent as associated data. `raise/flow.ts` writes it at step 7, before `ports.send` (step 8); drops it on "I saved the link" (`saved`), on a reverted raise (both in `raise` and in `resumeRaise`), and on any failure before sending (`forget`). The hygiene guard's escrow test passed live (below).
- **Clock.** No `Date.now()`, `new Date()` or `performance.now()` in src outside `store/db.ts deviceClock()`, which only stamps "first seen on this device" times (thank's judge, /my inbox lines, the dev wallet's labelled device clock). `care/calendar.ts` and `ui/format.ts` build dates from chain timestamps.
- **Honesty.** Every screen `TxRail` gets `local={!config.chain.hasL1}` (raise ×3, thank, care, waiting); only gallery samples omit it. `/thank` builds `[setupCall(setup), thankCall]` with `setup.forwarder = config.forwarder` (`thank/check.ts`), and the SDK's `setupCall` targets the forwarder's `aggregate3`: the setup is never a call from the raiser to the factory. With no forwarder, /thank stops with `thank.error.noForwarder`.

## What I ran, with results

All on this machine, slot 1, built app through face, unless said otherwise.

| Command | Result |
|---|---|
| `STAND_SLOT=1 bunx playwright test tests/e2e/guards` (before any change, as a baseline) | 47 passed |
| `STAND_SLOT=1 bunx playwright test tests/e2e/guards tests/e2e/smoke` (after the changes, rebuilt) | 141 passed, 1 failed: `smoke/care.spec.ts:196` expects «до 180 дней от сегодня»; the `words` package changed `care.extend.max` to «до {n} дней с сегодняшнего дня» during the run. Not an app defect; see needs |
| fresh slot 1 (`down`, `up`), then `STAND_SLOT=1 bunx playwright test tests/e2e/life.spec.ts` | 1 passed (43.6 s). The life spec fails on any console error of any person's page, so it logged no CSP violation |
| `curl -sI` on face: `/`, `/exit.html` | §11 CSP and `Referrer-Policy: no-referrer`; exit.html with its script hash, the any-RPC sources and `font-src 'self' data:` |
| `stand.ts stop --slot 1 site`, `start --slot 1 static`, `curl -sI` `/`, `/31337/1`, `/exit.html` | the same §11 CSP and Referrer-Policy; static's exit.html still has `font-src 'self'` (see needs) |
| `curl -s /` | the `<meta http-equiv="Content-Security-Policy">` with the same policy less `frame-ancestors` |
| a non-local build (`chain.local=false`, rpc/relay/site on `*.ahand-test.example`) + `bun apps/hand/tests/bundle/audit.ts <dist> <config>` | clean: configured RPC, relay, site; library texts only (namespace, doc links of viem/ox/abitype/wagmi/React, Tailwind licence, viem's 4byte hint and ENS-avatar gateways, never fetched); exit.html's `http://127.0.0.1:` server hint; 0 `.map`, no `sourceMappingURL`, no anvil mnemonic or key |
| phone walk (my script, Playwright, 390×844, EN and RU, 27 screens incl. /give on an expired Hand and exit.html) | no horizontal overflow on any screen; no off-site request; no console error on the app's pages; exit.html through face: 6 font CSP violations before the face fix, 0 after; through static.ts still 6 (needs). Remaining "small" boxes are the figure and mark buttons, whose `::after` hit area is 45–48 px, and the care money input, whose 44+ px box focuses it. Screenshots in `knowledge/plan/research/2026-11-20-experiment/shots/build/harden-app/` (`<screen>-<lang>-390.png`) |
| O-2 live (script): open a dark Hand's bare link on `/`, reload, reload | "No link here.", then the landing |
| clock live (script): unlisted and expired Hand views with the browser clock at −2 y, now, +2 y | `shell-main` text identical in all three, for both |
| `cd apps/hand && bun test` | 327 pass, 0 fail (clock guard over all of src included) |
| `bunx tsc --noEmit -p apps/hand`; `cd apps/face && bun test && bunx tsc --noEmit -p .` | 0 errors; 24 pass; 0 errors |
| `sha256sum contracts/src/AHandCore.sol` | `118f4d37…d738` |

Slot 1 is down at the end (chain, relay, site stopped, ports free). No guard had a `fixme` mark when I started (A-1…A-4 were fixed in the wave 5 integration), so there is no fixme to remove; the tests that pass with my fixes are the whole of `tests/e2e/guards` (47) and, for O-1, `failclosed.spec.ts` test 9.

## Choices the design left open

- **The CSP meta has no `frame-ancestors`** (it cannot work in a meta and Chromium logs it as an error); framing is refused by face's header.
- **No CSP meta in exit.html.** It is meant to be opened from disk or any host against an RPC the reader types; a meta would have to carry its own script hash after the single-file inlining and could block a wallet's injection on `file://`. Face and static send it a header.
- **exit.html may load `data:` fonts.** It carries its fonts inside the one file; a font cannot send data anywhere. The app's pages keep `font-src 'self'`.
- **/give before the chain answers shows no form** rather than an amount-less sentence: the catalogue has no such sentence (the words package owns it) and a form whose promise is unknown should not be filled.
- **O-2: unmark on show, not on load.** The first reload still says "No link here." (UX-SPEC: a reload forgets the link and the screen says so); only the entry's mark goes, so the start page comes back on the next load.

## Not verified

- A real phone keyboard (actions under the keyboard): Chromium's mobile emulation has no on-screen keyboard; the main swipes sit in the page flow, not fixed, so they scroll above it, but this was not seen.
- A screen reader; WebKit; reduced motion beyond the guard's own test; focus visibility beyond axe and the guard's keyboard passage.
- Emoji clipping was checked by looking at the EN/RU screenshots (hand, give, raise views); I saw none, but did not look at all 54 images.
- The raise reload gap of feat-raise (above): not fixed.

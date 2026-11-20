# exit-page: exit.html and the "Do it without us" screen (wave 4)

## What exists

- `apps/hand/exit/` — the page that moves money with no site. Plain TypeScript, no framework, no router, no wagmi:
  - `main.ts`: five cards. 01 the network: the RPC address (the build's first one is the starting value), Core and forwarder (both from the build), a check that Core answers with EIP-712 `aHand`/`core` on that chain at its own address, warnings for another chain or Core, and the network's time line (`NETWORK TIME · BLOCK n`, polled). Wallets: EIP-6963 discovery plus `window.ethereum`. 02 a Hand by number: the ten fields of `hands(id)` with Core's names, the exact value and a plain meaning; the state (open / time's up / thanked / refunded / missing) judged by the latest block's timestamp; `giveHash` when closed; the `cast call` line. 03 send it back: `refund`, the button enabled from the end on. 04 waiting money: `pending(token, payee)`, then `withdraw` (to the payee by default; elsewhere only if the payee's own account is connected). 05 thank from a give address: opened with the SDK against the typed Core only, Core's `checkGive` asked by `eth_call` (through the forwarder after the setup call when the giver's account has no code), who gets what by Core's arithmetic, the worst gas with dollars at the build's dated prices; for an account not set up yet, step 1 (setup through the forwarder) and step 2 (thank), each with its own button; after step 1 Core is asked again, directly.
  - Every action shows three ways: the wallet's button, the `cast send` line (the thank's with `--gas-limit` = worst gas), and, one tap away, the explorer's Write Contract fields (in the format of `contracts/exit/README.md`) and the raw calldata. A send is always simulated first; the receipt is read from the page's own RPC, never the wallet's.
  - Opened from `file://`, the page says "Opened from a file, a browser wallet can't see this page." and shows `cd <folder> && python3 -m http.server 8000 --bind 127.0.0.1` and the address to open.
  - `logic.ts` (pure, 17 tests in `logic.test.ts`), `wallet.ts`, `dom.ts`, `words.ts` (EN and RU with the same keys; Core's refusals and link errors reuse `src/i18n/common`), `exit.css` (tokens + the app's voices and shapes; the latin and cyrillic woff2 subsets only, inlined).
- `apps/hand/src/screens/without-us/`: the UX-SPEC §11 guide in EN and RU: this file (with a download link `/exit.html`, saved as `ahand-exit.html`), one command with `contracts/exit/ahand.sh` (and `tools/ahand.ts thank-calldata` for the thank), a block explorer field by field for refund, withdraw and thank, and Core's address and network.
- `tests/e2e/smoke/exit.spec.ts` + `tests/e2e/lib/exit-page/provider.ts` (an injected EIP-1193 provider, announced by EIP-6963 and set as `window.ethereum`, forwarding to anvil's unlocked accounts from the test process).
- `apps/hand/exit.html` and `vite.exit.config.ts` unchanged from wave 1 (single file, `emptyOutDir: false`, `AHAND_OUT_DIR`).

## Choices the design did not make

- No React on exit.html: the brief says SDK and viem only; a 60-line DOM helper is smaller than a framework. Output: one file, 572 kB (239 kB gzip), of which 146 kB are the inlined fonts.
- The page is bilingual (switch at the top, start from the browser's language). The spec allows Core's words; the people who need this page most are not all English readers.
- Fonts: only latin + cyrillic subsets of Schibsted, Onest and Plex Mono, so the file stays self-contained without carrying every script.
- The serve command uses `python3 -m http.server` (present on most machines) on port 8000, bound to 127.0.0.1.
- The explorer fields and calldata are folded under one toggle per action (open state survives re-renders); the cast line stays open, as it is the way that needs no wallet.
- Withdraw "elsewhere" is enabled only when the payee's own account is connected; otherwise the page says Core's `NotPayee` sentence.
- Thank requires the connected account to be the raiser before the button enables (Core would refuse `NotRaiser` anyway).
- The withdraw smoke asserts the whole pending amount for the payee, not only the fixture's: waiting money is per token and payee, and earlier seeds on the same chain add to it.

## Run, with results (2026-11-20, slot 7, dev stand)

- `bun infra/stand/stand.ts build --slot 7` → `.run/7/dist` holds index.html, gallery.html, exit.html; `grep -c 'src="http\|href="http'` → 0; no `<script src>` or `<link href>` at all. (The first attempt failed on another package's half-written `screens/thank`; it passed later.)
- `STAND_SLOT=7 bunx playwright test tests/e2e/smoke/exit.spec.ts` → 7 passed (phone) in the final run; one earlier run failed on an exact pending amount (fixed, see Choices); `--project=desk` → 7 passed (before the last two test edits). The file is opened by its `file://` address. It: refunds the expired fixture (closedAt ≠ 0, giveHash 0); unblocks the blocked payee and withdraws the pending amount (pending → 0); thanks the give fixture (giveHash = the fixture's); thanks the undeployed-account fixture in two presses (account has code after press 1, Hand closed thanked after press 2); with no provider shows status, cast lines, calldata, the file sentence, and makes no request except to the RPC; runs the refund's cast line (plus `--private-key` of a stranger) in a shell against a second expired fixture, which Core then shows refunded; renders /without-us in EN and RU and GETs `/exit.html` → 200 from the dev stand.
- `cd apps/hand && bun test exit/` → 17 pass. `tsc --noEmit -p apps/hand` and `-p tests/e2e`: no errors in my paths.
- Screenshots (looked at): `knowledge/plan/research/2026-11-20-experiment/shots/build/exit-page/` — exit.html at 390 px EN (light) and RU (dark) and 1280 px EN with all sections filled; /without-us at 390 px EN and RU. No horizontal overflow (checked by script) after fixing the long-address sentences and the copy button over text.

## Not verified

- A real browser extension wallet (only the injected test provider); an EIP-5792 batch (the page does two steps, by design of the brief).
- The page served over http by a local server with a real wallet; the CSP of face/static for the new file was not re-checked by me (wave 3 checked the stub's hashes mechanism).
- The download from /without-us on a built site through face (checked only against the Vite dev server, which serves the dev HTML of exit.html, not the single file).
- Any network but anvil; Multicall3 as forwarder; a block explorer form.

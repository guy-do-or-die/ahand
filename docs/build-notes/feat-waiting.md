# feat-waiting — /waiting: take it out or have it delivered

Wave 4, slot 6 (`--dev`). The agent that started this package earlier left only the wave 1 stub, so everything below was built and run in this pass.

## What exists

- `apps/hand/src/screens/waiting/index.tsx`: the screen (UX-SPEC §9).
  - Whose money: the address in `?for=` first, else the connected account. "Look" takes any pasted address and opens `/waiting?for=<address>` (read only).
  - One row per configured token with something waiting: the token's label, the amount, and `⏳ WAITING`, which opens `pending(token, payee) = n · block b`. This is read again on every block. When nothing waits in any token, the page says "Nothing is waiting for this address."
  - "Take it out" (amber, 🫴) appears only when the connected account is the payee. It goes to "this address" or to "another address" typed into `AddressInput`; the zero address and Core's address are refused, and the token's address is flagged.
  - "Deliver" (ink, 🫱) appears for any other connected account and for a visitor. It calls `withdraw(token, payee, payee)`. With no account that can send, its press sends nothing and opens "Connect a wallet"; after connecting the row goes on to the cost line (or to "Take it out", when the account turns out to be the payee). See "Review round 1" below.
  - Both actions use `useCost` (a simulation) and `CostLine` before anything can be pressed, and send through `useSend`. If the simulation says no, the button stays disabled and the page shows the sentence. Each action has "Do it without us" with the `cast` line (copied whole, shortened on screen), the calldata and a link to `/without-us`.
  - Nobody connected, an account that cannot send, or an ETH balance of 0: the page shows the "Your money is safe where it is…" card and a copyable `/waiting?for=<payee>` link for a friend. (With an ETH balance of 0 the row offers no button; in the other two cases it offers Deliver.)
  - When the token refuses (a simulation failure that is not Core's, a mined revert, `SafeERC20FailedOperation` or `InexactTransfer`), the page says: "The token won't move this money to this address right now. The money stays waiting; nothing was lost." Under it, "What the token said" opens the token's own answer in mono (open in place under the lens), and the issuer line leads to `/limits`. Core's own refusals use their `core.*` sentence.
  - After success: the TxRail, then the `Withdrawn` event decoded from the receipt with `⛓ ON CHAIN` (block, log, tx), the amount that left the contract, and where it landed.
  - "From hands this device knows": the Hands in the `hands` and `passed` stores, on this chain and on trusted Cores. For each closed Hand: `readHand`, then `handLogsAt(closedAt)` (the SDK's read filtered by handId), keeping only the `Pending` logs for this payee. `Withdrawn` carries no handId, so it is listed only for withdraws made on this page. The lens says so, and also says that waiting money is counted per token and address.
- `screens/waiting/logic.ts` with `logic.test.ts` (10 tests): parsing `?for=`, who may do what (`offerOf`), the known-Hands list, the meaning of each failed send, and decoding `Withdrawn` from a receipt.
- `en.ts` and `ru.ts`: every sentence, using UX-SPEC's wording where it gives one. "safe" / «в безопасности» appear only in `waiting.safe`.
- `tests/e2e/smoke/waiting.spec.ts`: 5 tests (see below).
- `tests/e2e/lib/feat-waiting/pending.ts`: my own fixture. It makes money wait for dev account 2 (raise in the BlacklistToken, pass with account 2 as payee, help, block 2, thank, unblock 2). The seed's blocked payee is account 7, which the dev wallet does not offer.
- `tests/e2e/lib/feat-waiting/shots.ts`: screenshots in EN and RU at 390 and 1280 px. The script fails if the page is wider than the window.

## Choices the design left open

- **The friend link is `/waiting?for=<address>`.** The fragment is reserved for links, and `routes.ts` (not mine) has no path parameter. The address is public, but whoever hosts the site sees which address was looked up in the request. Face does not log queries. The query is only read (a regex over `location.search`); nothing writes one, which keeps the secrets guard's rule.
- **Deliver is not shown when the payee is connected.** "Take it out → To this address" is the same call. When another account is connected, a quiet line says only the payee can send the money elsewhere.
- **The cost check is not run for a visitor.** There is no account to ask the chain as; the row prices the call once one is connected.
- **Stopped before sending, not failed after.** When the simulation is refused, the button is disabled and the sentence is shown. A send that fails later is classified the same way.
- **The cost check is not run for a connected account with no ETH.** That case shows the "safe" card instead of a disabled button.
- **Withdrawn history is not searched on chain.** `Withdrawn` has no handId topic, and the rule "never scan by payee" forbids it.

## What I ran (on slot 6, this machine)

| Check | Result |
|---|---|
| `STAND_SLOT=6 bunx playwright test tests/e2e/smoke/waiting.spec.ts` | 5 passed (phone); also 5 passed with `--project=desk`. Run several times on the same stand (fixtures are fresh each run) |
| What the smoke asserts | The pasted blocked payee's row equals `pending(token, payee)` read from the chain. With nobody connected: no actions, the "safe" sentence, and the friend link equal to `origin/waiting?for=payee`. A `passed` record put into IndexedDB makes the Hand's `Pending` event appear. Account 5 while blocked: Deliver is disabled, with the token sentence and the `/limits` line, and pending is unchanged. Then the seed's own `unblock.cast` line is run with Foundry's cast, account 5 presses Deliver, the `Withdrawn` card appears, pending is 0 and the payee's balance grew by exactly the amount. With account 5 connected, Take it out is not offered. Account 2 (payee): zero refused, then Take it out to account 9; account 9's balance grows by the amount, account 2's balance is unchanged, and pending is 0. The "Do it without us" line opens without horizontal overflow at 390 px. Every `eth_getLogs` the pages made has a handId in `topics[1]` (at least one was made) |
| `bunx tsc --noEmit -p apps/hand` | no error under `screens/waiting` (other packages' files had errors mid-wave) |
| `bunx tsc --noEmit -p tests/e2e` | no error in my files |
| `cd apps/hand && bun test src/screens/waiting` | 10 pass |
| words guard (`--test-name-pattern waiting`) | 4 pass (key parity, prefix, ICU, banned words) |
| secrets + clock guards | 18 pass (the first version failed the query-string rule with `new URLSearchParams`; fixed) |
| `sha256sum contracts/src/AHandCore.sol` | `118f4d37…d738` |
| Screenshots | 20 files in `knowledge/plan/research/2026-11-20-experiment/shots/build/feat-waiting/`, looked at. Fixed after looking: the full cast line pushed the 390 px page sideways |

## Not verified, or not done

- The success screen is asserted by the smoke but was not screenshotted (the shots stop before any button that moves money).
- A real ETH balance of 0 (the dev accounts all hold ETH) was not driven in a browser; it is covered only by `offerOf`'s unit test.
- The "Hands this device knows" list was driven with one `passed` record written by the test, not one written by `/pass` (feat-hand's package).
- No real wallet, no network but anvil.
- The token's label comes from the stand's configuration in English ("Test dollars that can block"), so it shows in English on the RU page. That is config data, not this screen's words; see needs.

## Review round 1 (2026-11-20)

Two findings, both reproduced live before any change (screenshots `before-*.png` in `knowledge/plan/research/2026-11-20-experiment/shots/round-1/fix-feat-waiting/`).

1. **"/waiting tells a visitor to press Deliver, but the button exists only after connecting" (minor).** Reproduced in EN and RU: with nobody connected the page's buttons were Connect, Look, the Waiting mark and Copy, and the card said "Anyone can press Deliver". Fixed the fuller way the review named:
   - `offerOf` now describes what the row offers. A visitor (nobody connected, or an account that can't send) gets `deliver: true, connectFirst: true`. A connected account with nothing to pay with gets neither button.
   - The row always renders Deliver for a visitor, enabled. The line above it reads "Anyone can deliver it. You'll be asked to Connect a wallet first; whoever presses, the money lands only at this address." / «Доставить может кто угодно. Сначала попросим «Подключить кошелёк»; кто бы ни нажал, деньги придут только на этот адрес.» The words guard allows "wallet" only inside that exact phrase, so the review's "connect any wallet" was not used.
   - The press sends nothing and opens the shared `ConnectSheet`. After an account is picked, the same row prices the call for it and shows the cost line and an enabled Deliver, or the token's refusal, or "Take it out" when the account is the payee. Nothing is sent until the second, informed press.
   - "Do it without us" is on the visitor's row too: the `cast` line needs no account here.
   - Focus: a `<dialog>` removed from the page does not give the focus back (it went to `body`; the shots script caught it). The row now does it: back on the button when it can be pressed (the sheet was left with Escape), else on the row's actions (a labelled group), so the next stop is the cost and the button.
2. **"The raw engine line 'Execution reverted with reason: BLACKLISTED.' stands on the human layer" (polish).** Reproduced: the mono line stood in the band above the plain sentence, in both languages. Now the band carries only the sentence and what was not lost. The token's answer is under a `Disclose` "What the token said" / «Что ответил токен», below the band, closed by default and open in place under the lens. `tokenSaid` in `logic.ts` takes the token's own reason out of the engine's sentence ("BLACKLISTED"); a sentence that names no reason is shown whole. Core's own refusal names still ride in the band, as on every other screen (`ErrorBand`'s `code`); that was not part of the finding.

### What I ran for it

The slot stands were other packages'; this pass used its own ports: the helper chain `packages/sdk/tests/helpers/anvil.ts --serve --port 24650 --write-stand … --write-config …`, the app built with that config and served by `infra/stand/static.ts` on 24652. A Vite dev server (24651) was used first and dropped: other fixers' edits reloaded the page mid-test.

| Check | Result |
|---|---|
| The new assertions against the unfixed screen | failed where expected: `waiting-deliver` not found for a visitor |
| `STAND_FILE=… STAND_BASE_URL=http://127.0.0.1:24652 bunx playwright test tests/e2e/smoke/waiting.spec.ts` | 6 passed (phone) and 6 passed with `--project=desk`, several times, on the production build |
| What the smoke now also asserts | A visitor's row has an enabled Deliver, the "Connect a wallet first" line and "Do it without us". Deliver, then Escape: nothing connected, pending unchanged, focus on Deliver. Deliver, then dev account 5 in the sheet: the sheet closes, focus is back in the row, account 5 is connected. While blocked: the band has no "BLACKLISTED" and no "reverted"; "What the token said" opens to "BLACKLISTED", closes again, and is open under the lens. After the unblock: the visitor's first press stops at "costs about" with pending unchanged; the second press lands the money (pending 0, the payee's balance up by the amount). A visitor who picks the payee's own account gets Take it out and no Deliver |
| `cd apps/hand && bun test src/screens/waiting` | 13 pass (`offerOf` for a visitor, for an account that can't send, for no ETH; `tokenSaid`) |
| `cd apps/hand && bun test tests/guards` (words, secrets, clock and the rest) | all pass except `lint.test.ts`, which names `ui/Flip.tsx` (another package's file, mid-fix) |
| `bunx tsc --noEmit -p apps/hand`, `-p tests/e2e` | no error in this package's files |
| `tests/e2e/lib/feat-waiting/shots.ts` | exit 0: 40 screenshots (EN and RU at 390 and 1280, EN at 390 dark; eight states each). In every state: no horizontal overflow, no serious or critical axe violation (WCAG 2.2 AA tags), focus back in the row after connecting from Deliver. Looked at |
| `sha256sum contracts/src/AHandCore.sol` | `118f4d37…d738` |

The spec and `shots.ts` now also run on a helper chain (`STAND_FILE`, `--site`): the spec passed `--slot` to its own fixture program even when `STAND_FILE` named the chain.

### Not verified

- `tests/e2e/life.spec.ts` and `tests/e2e/guards/a11y.spec.ts` (not this package's) were not run after the change. `life` connects before pressing Deliver, which still works the same way; the a11y guard opens `/waiting?for=<account 2>` as a visitor, the state checked here with axe in `shots.ts`.
- A real wallet in the sheet (only the dev wallet's accounts were picked), and an account with no ETH in a browser.
- The token's answer in the form USDC gives ("Blacklistable: account is blacklisted") is covered by `tokenSaid`'s unit test only.

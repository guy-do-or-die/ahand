# Build note: feat-hand (wave 4)

Package `feat-hand`: the Hand view, the pass, and sending a Hand back after its end. Written 2026-11-20 by an AI agent of the overnight experiment. Nothing was committed. (An earlier agent started this package and stopped; it had left only the wave 1 stubs, so everything here was written in this run.)

## What exists

- `apps/hand/src/screens/hand/`
  - `held.ts`: the logic, free of React, of the configuration and of the network. Which arrival a place is (`arrivalOf`), opening a held link (`openHeld`), the sentence for every failure (`failureOf`), the route as people (`routeHands`), holders' own lists (`holderStatements`), the share's range (`keepMax`, `shareOf`), the pass with its read-back (`makePass`, `readBackOf`), and the bounded look for a newer Hand (`laterPlan`).
  - `held.test.ts`: 16 offline tests. Hands are made in the test, opened in all three shapes, passed at 0% and at 10%, read back, broken (one byte, a newer version byte, no main contract), and refused (lighter shape, below the minimum, a share with nowhere to land).
  - `useHeld.ts`: the build's side. `LINK_OPTIONS`, `getHand` (the SDK's `getHandFor` over the build's trusted list), `useOpening`, `useDecimals`, `cardDescription`.
  - `index.tsx`: the screen, for every arrival.
    - A held link opens with `openHeld`, then `useHand` reads `hands(id)` on every block. The state is `stateAt(useNow().timestamp)`.
    - The screen shows the Deal card, the ChainRail (with the `route` prop) and "{n} hands so far."
    - Its actions are 🤝 Pass it on → `/pass` and 🙌 I can help → `/give`, with the honest line under the help button, "Room for {n} more passes." under three, and the line "this tab only".
    - "What this link proves" is a disclosure that the lens opens. Holders' own lists appear only in the lens.
  - The states of UX-SPEC §8.2–8.3:
    - description lost (still passable);
    - public view (a numbered or faced address with no link; the title only after `faceOf` matched `d`; no actions; "To pass it on or help, open the link you were sent.");
    - a give link, opened by a holder ("pass it back", with copy and share, and a way for the asker to connect) or by the asker ("This is an answer to your hand." → `/thank`);
    - past the end and still open (`SendBack.tsx`): `refund` through `useSend`, for any connected account, with `CostLine`, `TxRail` and the `cast` line under "Do it without us";
    - closed (`Closed.tsx`): the receipt from `handLogsAt` + `receiptOf`, the quiet button "Look for a newer hand by this asker", which shows its request count before it runs, can be stopped, and opens a found Hand's public view only, and always "Ask whoever sent you the link whether there is a newer one."
  - `en.ts`, `ru.ts`: every sentence in both languages; UX-SPEC's wording where it gives one.
- `apps/hand/src/screens/pass/`
  - The pass screen has a slider from 0% (chosen) up to `claim − minClaimBps`, in steps of 0.5%, with the money beside it. A Hand with no reward gets no slider and the line UX-SPEC gives instead.
  - Above 0%, the kit's `LandSheet` (purpose `share`) opens; at 0% nothing else is asked.
  - "Make the address show less" (only towards bare) and 🤝 "Make my link" follow.
  - Then the copy row, Share (where the browser has a share sheet), Show QR (the bare address as digits, everything inside), and the payee and share read back from the written link with ✓ CHECKED HERE.
- `tests/e2e/smoke/hand.spec.ts`: 8 tests (below).
- `tests/e2e/lib/feat-hand/helpers.ts`: the craft tool as a child process, a request log (origins and JSON-RPC methods), and `quietDevServer`.
- `tests/e2e/lib/feat-hand/shots.ts`: screenshots of every state, EN/RU, 390 and 1280 px. It is a tool, not a test.

## Choices the design left open

1. **The two screens share `screens/hand/held.ts` and `useHeld.ts`.** Both are this package's own, and no other screen imports them. The pass re-opens the link from memory (`store/memory.ts`) and does not receive it from the Hand view: screens talk through routes and memory.
2. **Which link a place shows.** A link that arrived with an address belongs to the path it arrived on. A bare link belongs to `/`, or, pasted alone, to the number it names. On any other path, such as a newer Hand opened from a closed one, the view is the public one: a link held for one Hand is never shown under another's number.
3. **After a pass, memory holds the new link** (`remember(…, via: "handover")`), as `store/memory.ts` describes. Copy and Share use the address the pass returned. The screen does not reopen it ("See what they will see" opens the Hand view with the new link). Whoever had the old link still has it; the screen says so.
4. **The slider's step is 0.5% (50 bps), and its last stop is rounded down to a step.** Every stop is therefore a share Core takes. 0.5% of a $50 reward is $0.25.
5. **The QR carries a separate encoding.** It holds the same route and seed, with every attachment inside (`carryFor(written, "bare")`), written bare as digits, as ARCHITECTURE §9 asks. The copy row keeps the received shape, or bare if "show less" was ticked.
6. **`failureOf`.**
   - `LinkError("invalid")` whose message says "less than the Hand's minimum" uses Core's `BelowMinClaim` sentence. UX-SPEC §12 gives it its own sentence, and the SDK has no separate code.
   - A viem `BaseError` (transport or RPC) reads "Can't reach the network right now."
   - Anything else reads `common.error.unknown`, never a verdict on the link.
   - The three sentences UX-SPEC keeps apart (doesn't read / newer app / no main contract) come straight from `messageIdOf`.
7. **No pass on a closed or past-end Hand, and none before the first block.** The pass screen says why. The Hand view shows its actions only when `stateAt` says `open`. Before the first block arrives, the card shows the dates and the kit's "Can't reach the network right now.", and offers no action.
8. **The newer-Hand look.**
   - The range is the block the closing events are in, from `handLogsAt(closedAt)`, through the latest block at the moment the count is shown. The read made is the one announced: `findLaterHands(...).requests`, and the test counts the `eth_getLogs` calls.
   - The span is said in minutes under two hours, in hours otherwise.
   - Every Hand found is listed as "Hand {n}", which opens its public view.
9. **A closed Hand's heading is "This hand is closed."** in both closed states, because the Deal card already says "The reward went back on {date}." / "Thanked on {date}." The receipt follows.
10. **"Send it back" on a Hand with no reward reads "Close this hand".** Nothing goes back, and Core's `refund` only closes it. The expired line follows the kit: "Anyone can close this hand now."
11. **A give link on the Hand view is not checked with Core's `checkGive`.** That judgement belongs to `/thank` (ARCHITECTURE §6 step 9). The view only proves the route and the key signature (`openLink`). The holder's band also offers "Connect" with "Did you raise this hand? …", because a dev-wallet connection does not survive a page load, and a real asker may arrive unconnected.
12. **The rail.** The amber YOU and the dashed next slot are shown only on a live link of an open Hand. A give link adds the helper's 🙌 with its payee.
13. **The public view reads `faceOf(origin + path + search)`**, with `window.location.origin` and no fragment. With no `d` it reads the Hand through `getHand`, which also refuses an untrusted Core.
14. **Smoke plumbing for `--dev` mode.** Vite reloads every open page whenever any agent edits any file of the shared app, and a reload forgets the link by design. The smoke therefore answers the Vite HMR WebSocket (same origin as the site) with a silent route (`context.routeWebSocket`). This changes nothing on a built stand.

## What was run (all on this machine, slot 2 in `--dev` mode: anvil 18565, relay 18567, Vite 18321)

| Command | Result |
|---|---|
| `bun infra/stand/stand.ts up --slot 2 --dev` | chain, Core, tokens, relay, Vite up in 2.5 s; clock 40 days ahead |
| `bun test src/screens/hand/held.test.ts` (apps/hand) | 16 pass, 0 fail |
| `bun test tests/guards src/screens/hand` (apps/hand) | 133 pass, 1 fail. The failure is the `without-us` catalogue's banned-word test (exit-page's files, mid-edit); `hand` and `pass` pass every guard (keys, ICU, banned words, clock, secrets) |
| `bunx tsc --noEmit -p apps/hand` | 0 errors (whole project, at the time of the run) |
| `bunx tsc --noEmit -p tests/e2e` | 0 errors in `hand.spec.ts` and `lib/feat-hand/` |
| `STAND_SLOT=2 bunx playwright test tests/e2e/smoke/hand.spec.ts` | 8 passed (phone), run several times; also 8 passed with `--project=desk` (1280×800) |
| `bun tests/e2e/lib/feat-hand/shots.ts --slot 2 --out …/shots/build/feat-hand` | 42 screenshots, EN and RU, 390 and 1280 px; no horizontal overflow reported on any; looked at with the Read tool |

What the smoke asserts, by running:

1. **The fresh fixture with no wallet.**
   - The fixture (`unlisted`) opens with its title and state `open`, a rail of 1, the help note and the tab line.
   - `page.url()` holds no `#`.
   - A 0% pass reads back as no payee and 0 bps, ✓ checked here.
   - The new address, opened in a new browser context, shows the title, a rail of 2 and "2 hands so far."
   - Every request of the context went to the site's origin or the RPC's origin, WebSocket openings included.
2. **A 10% share.**
   - On the `dark` fixture, the slider tops out at 3 000 bps and reads "10% — about $5 if this route is thanked".
   - The swipe stays off until the share has a landing.
   - Core's own address pasted: `data-reading="refused"`, "That is the contract's own address.", and "Use this address" stays disabled.
   - Account 7's address pasted and made: the read-back shows that payee and 1 000 bps. `craft open` (the SDK outside the browser) reads the same pass: payee and keptBps 1000, shape bare. A second context shows the payee's short address on the rail.
3. **Broken links.**
   - The `lost` fixture shows its band and still passes (1 shake read back).
   - `tamper flip` → `link.malformed` "This link is damaged…"
   - `tamper other-core` → `link.untrusted` "…doesn't read…", and not "newer app".
   - `tamper version` → `link.unsupported` "…made by a newer app.", and not "doesn't read".
   - None of the three shows a Deal card.
4. **The `expired` fixture, with `page.clock.setFixedTime` two years before the machine's time.**
   - The card's state is `expired` and "Time's up. Anyone can send the reward back to the asker now." is shown, with no pass action.
   - Dev account 3 connects and presses "Send it back". The view turns to closed/refunded, with "The reward went back on…" and $15.00 in the receipt.
   - On the chain: `hands(id).closedAt > 0`, and the raiser's test-dollar balance rose by exactly the reward.
5. **The `refunded` fixture.**
   - The count is announced (`data-value`), "Look for a newer hand by this asker" is pressed, and the number of `eth_getLogs` calls made equals the announced count.
   - The `thanked` fixture's Hand (a later Hand by the same raiser) is among those found.
   - Pressing it opens `/31337/<id>` as the public view, with no pass and no help action.
6. **The `give` fixture's give link.**
   - A holder sees "Someone answered this hand. Pass it back…", a copy row and a rail of 3, with no pass action.
   - After connecting dev account 1 (the asker) on the same page, it reads "This is an answer to your hand.", and the button leads to `/thank`.
7. **The `public` fixture's faced address without its link.** It shows the public view with the matched title, "To pass it on or help, open the link you were sent.", no actions and no tab line.
8. **The `noReward` fixture.**
   - The card says "No reward: a thank-you only" and "it's free; there is no share to keep".
   - The body text never matches `$0`, and `location.href` holds no `#`.
   - `/pass` shows the no-reward line and no slider.

## Not verified

- A built stand (face or `static.ts`). Every run was against Vite in `--dev` mode.
- A real wallet extension. `navigator.share`: headless Chromium has none, so the Share button stays hidden there. A QR scanned by a camera: the QR is drawn (v13 for a 10% bare pass) but was not read back by a scanner.
- Holders' own statement lists in the lens. No fixture carries a Shake with a `dataHash`, so that branch ran only in the offline unit test, which covers an empty list.
- The "addressed" link kind on the Hand view: no fixture makes one.
- `/thank` opening the give link from memory after "Open the answer": only the navigation is asserted; the thank screen is feat-thank's.
- `useDecimals` for a token the configuration does not list: never met, because both stand tokens are configured.
- A newer-Hand look longer than one window, and its Stop button. On the stand the stretch is a few hundred blocks, one request.
- Russian plural forms were checked by eye in the screenshots (e.g. «Уже 1 рука.», «ещё руки: 11»), not by a test.

## Notes for the integrator

- `TID.hand.wentBack` is now used only by the success line of "Send it back". The view moves to the closed state on the next block, so the closed view carries `TID.hand.closed` with `data-value`.
- The kit's `LandSheet` puts no test ids on its own elements (`TID.land.*` are unused there). The smoke reaches them by role and label: "An address I have", "The address", "Use this address". Adding the ids inside the kit would make specs sturdier.

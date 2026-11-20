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
   - A viem `BaseError` (transport or RPC) reads "Can't reach the network right now.", under the code `NETWORK`, and is marked `network`: the screens keep the link and try again (review round 1, below).
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

- A built stand through face. (In review round 1 the smoke also ran against a build served by `static.ts`; see below.)
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

## Review round 1 (2026-11-20, an AI agent of the overnight experiment; nothing committed)

Four findings, all reproduced on the committed code first (each new smoke test was run against `git show HEAD:` copies of the four source files and failed there), then fixed. Pictures are in the vault, `plan/research/2026-11-20-experiment/shots/round-1/fix-feat-hand/` (`N-before-…` and `N-after-…` per finding).

### 1. A network failure no longer loses an opened link

- **Before.** With the RPC unreachable a dark link showed `ContractFunctionExecutionError / Can't reach the network right now. / To the start`; the fragment had already left the address bar, so the reload or the one button lost the link. A second case was found while fixing: when `hands(id)` answered and the latest block did not, the screen stayed on "Checking the link…" for ever.
- **Now.**
  - `failureOf` gives a transport or RPC failure the code `NETWORK` and marks it `network: true`. Nothing else is ever marked so.
  - `useOpening` has a fourth status, `unreachable`, with `retry`. The held link is untouched in memory; a retry opens it again without asking for it. A try that is still running is not started twice, and while later tries run the status stays `unreachable`, so the screen does not flicker.
  - `Unreachable.tsx`: the Deal card's outline, the band "Can't reach the network right now. Your link is still here." with the code `NETWORK` and "Try again", the line "Trying again on its own every few seconds.", and the tab-only line (the reason not to reload). No "To the start".
  - `retryWhileVisible` (in `held.ts`, tested offline) calls the retry every 4 s while the tab is visible, stops while it is hidden, and tries at once when it is looked at again.
  - The same view stands where the link opened and the Hand's own read failed, or no block has ever arrived while the watcher says offline. There, on its own, the screen only asks the watcher for the latest block (every new block re-reads `hands(id)` by itself); "Try again" also starts the read afresh, for a chain whose blocks have stopped.
  - `/pass` and the public view (no link, so no "still here" sentence) do the same.
- **Not changed.** A Hand that was already on screen when the network went away stays as it was read, with its last state and its actions; pressing "Pass it on" then meets the band on `/pass`. UX-SPEC §15 wants the state withdrawn when the network can't be reached; the watcher marks `offline` on a single failed poll, so doing that from the screen would make the actions blink on a weak connection. It belongs to the chain layer (`useNow` could withhold the time after a few failed polls).

### 2. On a phone both actions are on the first screen

- **Before.** At 390×844 the pass button began at y = 902–912 and "I can help" at 1006.
- **Now.** Below 768 px an open Hand's two actions stand side by side in a bar pinned to the bottom of the screen (`ActionBar`, `position: sticky; bottom: 0`): both buttons at y 776–832 of 844, 175×56 px, in English and Russian, light and dark. The kit's densest pair variant (`ah-swipe--card`) is used, with the label allowed to wrap, so the words end on the solid part of the fill (checked: at 390 and at 320 px).
  - Sticky, not fixed: at the foot of the page the bar rests at the end of the Hand and covers none of the footer.
  - `padding-bottom: max(12px, env(safe-area-inset-bottom))`; `index.html` already has `viewport-fit=cover`.
  - Only when the Hand is open and the link is live; a closed, expired or public view has no bar.
  - While a text field has the focus, or the visible window is at least 150 px shorter than the window at the page's own scale (a keyboard, not a zoom), the bar steps aside and the two buttons stand in the page as on wide screens: they are never absent.
  - While the bar stands, `scroll-padding-bottom` on the root keeps a focused control from being scrolled under it (UX-SPEC §13).
  - One set of buttons is in the document at any time (`hand-pass`, `hand-help` keep their ids), chosen by a media query in script, so every existing spec finds exactly one.
- **A choice.** The honest line "The asker decides whether to thank…" stays in the page, where the buttons stand on wide screens, and is not in the bar. UX-SPEC §8.2 says "under the help button, always"; in the bar it would take three more lines of the first screen. The Deal card on the first screen already says "If you help and they thank you" and "If nobody is thanked by {date}".

### 3. An address that is not its link's own Hand is said as that

- **Before.** The SDK's `openAddress` weighs the public part first: a link under another Hand's address read "Part of this address doesn't match its link", and a path naming another chain read "another hand".
- **Now.** `openHeld` compares `seenIn(before)` with `peekLink(fragment)` before anything else, with no network read:
  - a path, or a link, naming a chain or Core the build does not read → `UntrustedCore`, the "doesn't read" sentence;
  - a path naming another Hand than the link → `another-hand`;
  - the right Hand with a public part that is not its own → `unmatched-data`, from the SDK as before.
- **A choice.** The finding said "a different chain or Core gives the untrusted sentence". That is what happens whenever the path's or the link's contract is outside the build's list (always, in a build with one trusted Core). When both are contracts the build reads and they differ, the sentence is "another hand", because "doesn't read" would be false there.
- The SDK is unchanged.

### 4. The share sentence on `/pass` has no gaps

- **Before.** `tabular-nums` on the whole sentence made "." and "," as wide as a digit in this face: "$2 . 50", «$2 , 50 , если».
- **Now.** The class is gone from the sentence (the screen has no other use of it). `4-before-share-sentence-*.png` are the same element with the class put back, for the picture.

### Files

- `apps/hand/src/screens/hand/`: `held.ts`, `held.test.ts` (26 tests), `useHeld.ts`, `index.tsx`, `Unreachable.tsx` (new), `en.ts`, `ru.ts` (three sentences: `hand.offline.kept`, `.retry`, `.auto`).
- `apps/hand/src/screens/pass/index.tsx`.
- `tests/e2e/smoke/hand.spec.ts` (11 tests): three more bad addresses in the broken-links test; the share sentence's figures; a network that fails as a dark link opens; a link that opens while the latest block can't be read; the phone's first screen in both languages. The network is cut in the browser (`page.route` aborts every request to the RPC), not by stopping the chain: a stand can stop its chain and cannot start it again with its Hands, and every later spec file needs them.
- `tests/e2e/lib/feat-hand/round1.ts` (new, a tool): the four findings looked at live, with the chain really stopped. It saves anvil's state, kills anvil, opens a link, starts anvil again from the saved state, and sees the Hand appear in the same document.
- `tests/e2e/lib/feat-hand/helpers.ts`: `craft` names the stand by `STAND_FILE` when one is set.

### What was run

On this machine, on a chain and site of this agent's own in its port range: the wave 1 helper chain on 24550, Vite on 24551, a build served by `static.ts` on 24552; `STAND_FILE` and `STAND_BASE_URL` name them.

| Command | Result |
|---|---|
| the five new or extended smoke tests against the committed source files | each failed: `hand-unreachable` never appears (twice); `hand-pass` 65% in the viewport; `link.unmatched-data` where `link.another-hand` is expected; `tabular-nums` |
| `bun test src/screens/hand tests/guards` (apps/hand) | 155 pass, 0 fail |
| `bunx tsc --noEmit -p apps/hand`, `-p tests/e2e` | no error in this package's files (other packages' files had errors of their own while their fixers worked) |
| `bunx playwright test tests/e2e/smoke/hand.spec.ts` (dev server, phone) | 11 passed |
| the same with `--project desk` | 11 passed |
| the same against the build served by `static.ts` (with its CSP) | 11 passed |
| `tests/e2e/guards/failclosed.spec.ts` on the same chain | 11 passed |
| `tests/e2e/guards/a11y.spec.ts` on the same chain | 27 passed |
| `bun tests/e2e/lib/feat-hand/round1.ts --stand … --out …` | exit 0, twice: anvil killed, the band in English and Russian at 390 and 1280 px and on `/pass`, anvil started again from its saved state, the Hand and the slider back in the same documents, the link then passed on. 34 pictures in the folder (5 before, 29 after); 14 of them were opened and looked at by the agent, among them every kind of state at least once |

### Not verified

- A real phone, a real on-screen keyboard, the home-indicator inset: Chromium at 390×844 and 320×568 only. The keyboard test focuses a text field put into the page.
- The sticky bar in WebKit.
- A slow network (answers that take longer than a block): `useBlockRead` keeps only the answer to its latest ask, so a read slower than the block time never lands. That is the chain layer's, and older than this round.
- `tests/e2e/guards/russian.spec.ts` failed on this chain at "Кто-то ищет": the Deal card's intro was being changed by another fixer at the time; nothing of this package is involved.

### For the integrator

- Three test ids are written as literals because `testids.ts` is not this package's: `hand-unreachable`, `hand-retry`, `hand-action-bar`. They belong in `TID.hand`.
- `tests/e2e/guards/lib/guard.ts` always passes `--slot` to its tools, so the guards cannot run against a `STAND_FILE` chain. For this round a `stand.json` naming this agent's chain was put into `infra/stand/.run/2/` for the two guard runs and removed afterwards.

# feat-my: My hands (wave 4)

`/my` and `/my/<chain>/<hand>` as UX-SPEC §7.3, in `apps/hand/src/screens/my/`.

## What was built

- `index.tsx`: picks the list or one Hand from the route params.
- `List.tsx` (`/my`): the Hands in the device's `hands` store (the only source; no log is read to find a raiser's Hands). Each item shows its title, a reward bar (the helper's least share of the reward; "No reward: a thank-you only" for none), time left by `useNow`, the number of answers Core accepted, and the "N days left. Keep it open longer?" band to `/care` under seven days. It also has the empty state, "This list lives on this device only…", "Add a hand by its number", the Hands passed on from this device with their live state, and, under the lens, "This device's code" and "Rebuild a link from another device's code".
- `HandPage.tsx` (`/my/<chain>/<hand>`): the Deal card with live state, "Show the link again", buttons to `/thank`, `/care` (twice) and `/print`, the answers, and lens facts (rootKey, inbox.n1, code and n).
- `session.ts`: "Unlock links and replies". One keys confirmation per tab session. The master is kept in memory only. When this device does not yet know whether the account repeats its confirmations, it asks twice, compares the two, and stores the verdict with `setRepeats`. An account that repeats gets its seed and inbox secret derived from (book, n). An account that does not repeat uses the inbox secret stored in its record and the locked copy (`openSeed`). When that copy is gone, the screen says the link cannot be shown again.
- `rebuild.ts`: rebuilds the link from (book, n) and the stored words. It checks `keyOfSeed(seed)` against `hands(id).rootKey` and says so plainly when they differ (`my.link.keyBad`). The stored words are attached only when, together with the inbox key, they give Core's `dataHash`; otherwise the link is bare and the screen says why. Every rebuilt address is opened in the app with `openAddress` before it is shown.
- `answers.ts`: opens a give link against the Hand, then asks Core's `checkGiveOnChain`. A 6492-wrapped signature from an account that is not deployed is checked through the forwarder with its setup call; an account deployed since is checked with the inner signature. Anything refused gets the sentence of its `messageIdOf` id.
- `inbox.ts`: listens on each unlocked Hand's inbox through `packages/deliver` (`nostrTransport(config.relays)`), once per Hand per tab. A "give" envelope is written to the `inbox` store. Notes from the helper and the raiser's own replies stay in memory. A reply is a "note" sent from the Hand's inbox key to the answer's `replyTo`.
- `Answer.tsx`: the answer card. It shows the helper's words labelled "Their words", the route as a ChainRail, and who would get what by Core's own arithmetic (`logic.ts predictSplit`; the formula is under the lens). It has a "Thank" button (`rememberText(giveLink, "handover")`, then `/thank`) and the reply box. A refused message gets its own dashed card with its sentence.
- `en.ts` and `ru.ts`, with UX-SPEC wording where the spec gives it.
- Tests: `my.test.ts` (12 unit tests: the code format, hand numbers, time left, the split, seed↔rootKey, matchRoot, rebuilding in all three modes, a bare rebuild). `tests/e2e/smoke/my.spec.ts` (5 tests). Helpers in `tests/e2e/lib/feat-my/`:
  - `raise.ts` raises a Hand as a device does: a random book, n = 0, and it prints what the store keeps.
  - `shots.ts` takes the screenshots.
  - `vite.config.ts` is explained below.

## Decisions the design left open

- **A Hand added by its number** is stored with `book: "0x"` and `n: -1` (place unknown), `mode: "dark"` and `title: ""`. If the account is unlocked, the device first tries `matchRoot` against its own book for the numbers it has handed out; on a match the place is stored, so the bare link can be shown again. "Rebuild from another device's code" also stores (book, n) for a Hand in the list that has none, or adds the Hand to the list. That way its answers can be heard there as well.
- **The reward bar** on `/my` shows the helper's least share (`minClaimBps`) of the reward, with that sentence beside it. Showing time as a bar would have been a second meaning for the same piece.
- **Answers are judged when shown**, not when they arrive. They are judged again when the Hand's state changes, because an answer to a closed Hand is no longer one. The count on `/my` counts only what Core accepted. One card is shown per giveHash.
- **The keys confirmation is bound to the build's canonical Core** (or its first trusted Core on the build's chain).
- **Words on the Hand page before unlock** are shown as "kept on this device, checked after unlocking". They reach the Deal card only after the dataHash check (UX-SPEC §4).
- Test ids missing from `testids.ts` that I added under the same naming: `my-rebuild-hand`, `my-rebuild-result`, `my-rebuild-error`, `my-rebuild-open`, `my-link-refused`, `my-answer-count`. The Deal card on the Hand page uses `hand-deal-card`.

## Needs (files I do not own)

1. **`apps/hand/vite.shared.ts`: without this fix, no screen that imports `@ahand/deliver` loads, in dev or in the build.** `conditions = ["source", ...defaultClientConditions]` applies `source` to every package. nostr-tools 2.26.1 declares `"source": "./utils.ts"` (and the same for `pure`, `nip44`, `nip59`), but those files are not in the published package. Vite therefore fails with `Failed to resolve import "nostr-tools/utils" from packages/deliver/src/envelope.ts`. The exact change, the one my stand-in config applies:
   - `export const conditions = [...defaultClientConditions];`
   - add `export const workspaceAlias = [{ find: /^@ahand\/(sdk|abi|deliver)$/, replacement: resolve(here, "../../packages/$1/src/index.ts") }];`
   - in `vite.config.ts` and `vite.exit.config.ts`: `resolve: { conditions, alias: workspaceAlias }`.
   - Then delete `tests/e2e/lib/feat-my/vite.config.ts`.
2. `apps/hand/src/testids.ts`: add the six ids above to `TID.my`.
3. `apps/hand/src/store/db.ts`: an optional `origin?: "raised" | "added" | "rebuilt"` on `HandRecord` would replace the `n: -1` / `book: "0x"` convention for added Hands.

## What I ran

| Command | Result |
|---|---|
| `bun test src/screens/my` (apps/hand) | 12 pass |
| `bun test tests/guards` + my tests | 128 pass, 2 fail, both in other packages' catalogues (`give` placeholders, `without-us` banned word); `my` passes every guard |
| `bunx tsc --noEmit -p apps/hand` | 0 errors |
| `bunx tsc --noEmit -p tests/e2e` | no error in my files |
| `STAND_SLOT=5 STAND_BASE_URL=http://127.0.0.1:17200 bunx playwright test tests/e2e/smoke/my.spec.ts` (Vite on 17200 with the stand-in config, slot 5's chain and relay) | **5 passed**, run three times |
| `STAND_SLOT=5 bunx playwright test tests/e2e/smoke/my.spec.ts` (the stand's own Vite) | **fails**: Vite import error, need 1 |

What the smoke proves live, each against slot 5's anvil and relay:

- A Hand is raised on chain and written to the store with `store/db.ts put`. After a reload, connect (dev account 1) and unlock, the list shows title, bar, days left and the care band. "Show the link again" writes `…/31337/<id>?d=…#…`, which `craft open` reads as the same Hand, open, with words attached. A fresh tab opens it.
- A give from `craft give` is delivered by `craft deliver-send` and appears as `my-answer` with its giveHash, once Core accepted it. The `tamper --how giver-sig` copy appears as refused with "The helper's confirmation doesn't check out." The count on `/my` is 1. Thank leads to `/thank`.
- A typed reply shows "Delivered to 1 of 1 relay." `craft deliver-listen --secret <chatSecret>` receives the note, with `replyTo` = the Hand's inbox key.
- The seed's `TEST_BOOK` and a seeded unlisted Hand rebuild a bare link. `craft open` gives the same handId with description `lost`, and the screen says why.
- "Add a hand by its number" refuses account 2's Hand (`my.add.notYours`) and adds account 1's. A `passed` record shows its live state.
- Dev account 5 (its confirmations differ) unlocks with the "answers differently" line. "Show the link again" says the locked copy is gone. An answer still arrives, through the stored inbox secret.
- Every RPC request is read: no `eth_getLogs` without a handId topic (these screens make none at all).

Screenshots, all looked at: `knowledge/plan/research/2026-11-20-experiment/shots/build/feat-my/` (phone 390 px EN and RU, desk 1280; empty, list, Hand with an answer and a refused one, lens with a rebuild). After the first look I moved the formula and the giveHash under the lens and put answers before refused messages.

## Not verified

- The production build (`vite build`). It fails for the same reason as need 1 until that is applied.
- The locked copy still present for a non-repeating account (the link shown from `openSeed`). Only the "copy dropped" branch was run.
- A 6492-wrapped answer on this screen. The code is the same path as `craft wrap-6492` and /thank, but I did not run it here.
- What /thank does with the handed-over link (feat-thank's screen). The Hand view opened in a fresh tab was checked only by its address.
- A real wallet or passkey, a public relay, axe on these screens.

## Applied by the integrator (wave 4)

The resolver fix in "Needs" is applied: `apps/hand/vite.shared.ts` drops the `source` condition and both Vite configs read `@ahand/{sdk,abi,deliver}` from their sources by alias (`workspaceAlias`). The stand-in Vite config under `tests/e2e/lib/feat-my/` is deleted; the smoke passes against the stand's own built app on slot 0.

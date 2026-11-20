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

## Review round 1 fixes

### 1. Locked, the screen said there were no answers (major)

Reproduced live before any change: with a give already delivered to the Hand's inbox on the relay, `/my` connected and locked showed `No answers yet` (`shots/round-1/fix-feat-my/before-list-locked-en.png`), and the new smoke test failed on it.

What the screen may say is now one value, `inboxSight` (`logic.ts`): `no-relay`, `locked`, `no-key`, `reading`, `unreachable`, `read`. Only `read` lets a screen say there are none.

- `locked`: "Answers are locked — unlock to check." / «Ответы закрыты — открой доступ, чтобы проверить.» in the list and on the Hand's page. Answers this device already holds from an earlier visit are still counted and shown: "1 answer here — unlock to check for more." in the list, "Unlock to check for new answers." over the cards.
- `read` means an unlocked read that the relays answered. `reads.ts` keeps, per inbox key and relay, whether the relay ended the stored messages of that subscription (NIP-01 `EOSE`) or could not be read. The transport of `packages/deliver` does not report this, so `inbox.ts` hands it a WebSocket class that watches the frames going by (`TransportOptions.WebSocket`) and changes none. `read` needs every relay to have answered or failed, at least one answered, the arrived answers written to the store, read back and judged by Core. Until then the line is "Checking for answers…".
- `unreachable` (no relay answered): "No relay can be reached right now, so answers can't be checked."
- `no-key` (unlocked, but the device has no reply key for the Hand: added by its number with no place in a code, or a non-repeating account with no stored inbox secret): "This device doesn't hold this hand's reply key, so it can't read its answers." Before, this case also read "No answers yet", and the Hand's page told an unlocked account to unlock.
- `no-relay` builds: the list says "No answers pasted here yet"; the Hand's page keeps its no-relay sentence and no longer adds "Nothing has arrived yet." under it.
- `useAnswers` returns `{ reads, settled }` and re-reads the store only when an answer was written to it (`useStoredVersion`), not on every thread line or relay mark. An answer the network could not check (`offline`, another package's change in `answers.ts`) keeps the line at "Checking for answers…".
- `data-state` on `my-answer-count` and on `my-answers` carries the sight for tests.

### 2. English quotes around the helper's words on Russian screens (polish)

Reproduced (`before-answer-quotes-ru.png`). Two catalogue keys, `my.answer.quoted`: `“{words}”` in `en.ts`, `«{words}»` in `ru.ts`; both places in `Answer.tsx` use it. `ui/format.ts` is not this package's file, so the helper went into the catalogue.

### Forks decided

- **How to know a relay was read: a settle timer, a second probe socket, or watching the transport's own socket.** Watching: it is the same subscription, so the relay's end-of-stored mark comes after every stored message on it; a timer would say "none" to a slow relay, a probe could finish before the listener's own socket. The better home is a callback on `listen` in `packages/deliver` (see needs).
- **Several relays: read when one answered, or when all have answered or failed.** All: a helper's answer may sit on the one relay that has not answered yet.
- **Locked with answers already stored: hide them, or count them.** Count them and say more may wait: they are real, Core-checked, and a give link holds no secret.
- **Ports.** The stand's slots have fixed ports (18300–18637) outside the range this fix was given, so `tests/e2e/lib/feat-my/own-stand.ts` brings up the helper chain, the stand's relay and the built app on any base port, and `my.spec.ts` and `shots.ts` take `STAND_FILE` / `--stand`.

### Needs (files not owned)

- `packages/deliver/src/transport.ts`: `listen(secret, onEnvelope, since?, onRead?)` calling `onRead(relayUrl, ok)` on `EOSE` / on a socket closed before it. `reads.ts` and the watched socket could then go. Not required for the fix to work.
- `apps/hand/src/testids.ts`: nothing new; `data-state` was added to two existing ids.

### What was run (round 1 fix)

Stand of its own on 24600 (anvil), 24601 (relay), 24602 (built app, static.ts): `bun tests/e2e/lib/feat-my/own-stand.ts up --base 24600 --dir <scratch>`.

| Command | Result |
|---|---|
| the new smoke tests on the unfixed build | failed as the finding says: `my-answer-count` read "No answers yet" while locked; the RU card held `“…”` |
| `bun test src/screens/my` (apps/hand) | 21 pass (9 new: the sight, the list and page lines, the words, the read book against a fake socket) |
| `bunx tsc --noEmit -p apps/hand`, `-p tests/e2e` | no error in this package's files (errors in `screens/hand` came and went while another fixer worked there) |
| `bun test tests/guards` (apps/hand) | 128 pass, 1 fail: the new lint-directive guard, on `screens/hand` and `ui/Flip.tsx`; none in `screens/my` |
| `STAND_FILE=… STAND_BASE_URL=http://127.0.0.1:24602 bunx playwright test tests/e2e/smoke/my.spec.ts --repeat-each 2` | 14 passed (7 tests twice) |
| `bun tests/e2e/lib/feat-my/shots.ts --stand … --site http://127.0.0.1:24602 --out …/shots/round-1/fix-feat-my` | 21 screenshots; looked at the RU and EN phone ones |

What the smoke now proves live: locked, both languages, list and page say locked and never "none", with an answer already on the relay; while unlocking, every text the count line shows is recorded and none is "No answers yet"; the hand nobody answered says "No answers yet" / "Nothing has arrived yet." only at `read`; after a reload the held answer reads "1 answer here — unlock to check for more."; with the relay's WebSocket closed by the browser the line is the unreachable sentence; a Hand added by number says `no-key` once unlocked; the helper's words are `“…”` in EN and `«…»` in RU on both the answer and the refused card.

Not verified: more than one relay live (the two-relay rule is unit-tested only); a relay that accepts the connection and never ends the stored messages (the line stays "Checking for answers…"); a no-relay build in a browser (unit-tested lines only); a private window where the store refuses the write (the answer is then lost, as before this fix, and the line would read "No answers yet"); the `desk` project.

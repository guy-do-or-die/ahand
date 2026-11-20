# feat-give — Give: help, sign, deliver, fall back (wave 4)

## What exists

`apps/hand/src/screens/give/`:

- `index.tsx`: the /give screen (UX-SPEC §8.5). It reads the opened link from `store/memory.ts`. With no link it goes back to the Hand view (`/` with `view: "hand"`). A link that is not live (a give link, an addressed route) gets a sentence and a Back button. The screen shows the Deal card with the claim at the giver's place, then:
  1. the words, normalised, at most 1 000 characters;
  2. the kit's `LandPicker`, inline, in the order connected account, an address I have, I have none;
  3. "Before you agree": network, contract, hand number, claim in % and money, payee, and who confirms;
  4. the swipe, then progress in four steps;
  5. the result: the delivery line or the fallback, the give address (Copy, Share where the system offers it, QR as digits), the set-up sentence, the thread, the payee line with a link to /waiting, and the lens "What was checked".

  A hand with no reward gets the no-reward wording and the landing line. A hand that is closed, or past its time by the network's clock, cannot be answered.
- `answer.ts`: the pipeline, in this order: Give (dataHash 0) → `signGiveWithKey` with the link key → the giver's own confirmation → offline `checkGive` with `askSigner` → Core's `checkGive` by `eth_call` (through the forwarder with the setup when the answer is ERC-6492-wrapped) → `encodeGive` → bare address, as text and as digits. A wrapped answer with no forwarder in the configuration stops before any check (`no-forwarder`). Refusals map to `core.*` sentences, network errors to the offline sentence.
- `deliver.ts`: one outbox per tab over IndexedDB's `outbox` store (a memory store where storage is refused). It uses the configured relays and retries every 10 s. Also: `useEntry`, `useThreadSent` and `useReplies`. A reply counts only from the Hand's `inbox.n1` key and only when it names this Hand.
- `flow.ts`: pure rules (words, claim money, delivery state, sender check, signature kind, key file).
- `open.ts`: `openAddress` against the trusted Cores.
- `en.ts` / `ru.ts`: the words; the UX-SPEC sentences are kept word for word.
- `flow.test.ts`: 14 tests, offline. Core's eth_call is replaced by a function there, and only there; the smoke asks the real Core.

Tests: `tests/e2e/smoke/give.spec.ts` (5 tests). Helpers in `tests/e2e/lib/feat-give/`:

- `asker.ts`: `give-of` reads the Give in a link, including `dataHash`; `reply` answers from the Hand's inbox key.
- `storage.ts`: dumps IndexedDB, localStorage and sessionStorage.
- `shots.ts`: screenshots.
- `vite.fixed.config.ts`: see "Needs".

## Choices the design left open

- The picker sits inline on the page, not in the LandSheet modal. It has the same three choices. One swipe and one page read better on a phone than a sheet with its own swipe followed by a second swipe.
- The one-time key is made inside the swipe's click handler. When "Keep this answer's key" is ticked, the key file is downloaded inside that same press (a user gesture). The key is then used once and dropped with the function. If the answer is then refused, the file exists for nothing; that is harmless.
- The words travel in the `give` envelope's `text`, never in the Give. Share sends the words and then the address on its own line.
- Replies are shown only from the Hand's inbox key. The giver's answers are sent to the inbox.
- "Delivered" means at least one acknowledgement (as ARCHITECTURE §8 says). The outbox retries every 10 s while the page is open; after a reload the opened link is gone, but the outbox entries remain.
- With no forwarder: the sentence of §8.5, and a button that re-mounts the picker without the account and with the account's address pre-filled. The person then picks "An address I have".
- In the smoke, /give is reached by `pushState`, not by pressing "I can help". This way the test does not depend on feat-hand's screen, which was being built at the same time.

## What I ran

- `bun test` in apps/hand: 270 pass, 1 fail. The failure is `without-us: no banned word` (exit-page's words, not mine).
- `bunx tsc --noEmit -p apps/hand`: no errors in `screens/give`. Another package's file had errors at the time.
- `STAND_SLOT=3 bunx playwright test tests/e2e/smoke/give.spec.ts`: **5 passed**, twice. The run checked:
  - With a pasted payee and no wallet: `tools/ahand.ts thank-calldata` exits 0, and `inspect` shows the Give with signer and payee. The screen says "Delivered to 1 of 1 relay." The inbox receives the give link with the words, and the thread works both ways.
  - With account 4: signer = payee = account 4.
  - With "not set up yet": the set-up sentence. craft reports `wrapped6492: true`, Core with the setup `accepted`, and bare `InvalidGiverSig`.
  - With "I have none": the swipe is disabled until the box is ticked. Afterwards neither the phrase, nor any three consecutive words, nor the private key is in storage.
  - With the relay stopped: the fallback, Copy puts the address on the clipboard, and the QR shows. After `start --slot 3 relay` the screen reaches "Delivered" with no press, and the inbox receives the give.
  - For every produced Give, `dataHash` is 0x0 (read back with `asker.ts give-of`).
- Screenshots are in `knowledge/plan/research/2026-11-20-experiment/shots/build/feat-give/`: EN/RU at 390 px, RU dark, 1280 px, set-up, and fallback. I looked at all of them.

## Not verified

- **The smoke ran against Vite with `tests/e2e/lib/feat-give/vite.fixed.config.ts`, not with the stand's own Vite.** The stand's Vite cannot load @ahand/deliver at all (see "Needs").
- Not run: the built app, a real wallet or a real relay, the no-forwarder path in a browser (the stand has a forwarder; the unit test covers the stop), Share (headless Chromium has no `navigator.share`), and a screen reader.
- The asker's side of the thread is a test helper. feat-my's real reply screen was not available.

## Needs (files I do not own)

1. `apps/hand/vite.shared.ts`. The `source` condition applies to every package, and nostr-tools 2.26.1 lists `"source": "./nip44.ts"` for files it does not ship. So **any screen that imports `@ahand/deliver` fails to load** (dev and build). Change it to:
   - `conditions = [...defaultClientConditions]`, and
   - a `resolve.alias` in `vite.config.ts` and `vite.exit.config.ts`: `{find: /^@ahand\/(sdk|abi|deliver)$/, replacement: <root>/packages/$1/src/index.ts}`.

   That is exactly what `tests/e2e/lib/feat-give/vite.fixed.config.ts` does; delete that file once this is applied.
2. `tools/ahand.ts inspect`: print the Give's `dataHash` (one row under "giver gets"). Today it is asserted with `asker.ts give-of`.
3. feat-my: reply to a giver from the Hand's own inbox secret. That is the only sender /give shows.
4. The app shell: open the giver's outbox (`screens/give/deliver.ts giverOutbox()`) at start, so that retries continue on every screen and not only on /give.

## Applied by the integrator (wave 4)

The resolver fix in "Needs" is applied: `apps/hand/vite.shared.ts` drops the `source` condition and both Vite configs read `@ahand/{sdk,abi,deliver}` from their sources by alias (`workspaceAlias`). The stand-in Vite config under `tests/e2e/lib/feat-give/` is deleted; the smoke passes against the stand's own built app on slot 0.

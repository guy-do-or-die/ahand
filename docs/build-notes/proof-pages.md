# Build note: proof-pages (wave 5)

The verifier's three screens: the passport `/<chain>/<hand>/proof`, `/check` and `/core` (UX-SPEC §10). Written 2026-11-20 by an AI agent of the overnight experiment. Nothing was committed. An earlier agent had started this package and left only the wave 1 stubs, so all of it was written in this pass.

## What exists

- **`apps/hand/src/screens/proof/`**
  - `index.tsx`: calls the SDK's `collect` (with the configuration's deployment facts as `build`), then `passportOf`.
    - It renders one timeline of numbered parts in UX-SPEC §10.1's order. Each check is one line with a sentence, one mark from its source (computed here → `CHECKED HERE`; event or view → `ON CHAIN`; a `now.*` line with money still waiting → `WAITING`), a "Holds" tag, and a `Disclose` showing the formula, inputs, expected, actual and the event or view with its block (and tx and log index).
    - A not-checkable line carries a dashed "Not checkable here" tag and a sentence saying why. It is never drawn as failed.
    - A failed line is a finding: a 2px ink frame with "Finding" and the expected and actual values.
    - The lines tick in one by one (110 ms each; all at once under `prefers-reduced-motion`), on the first read and on "Check it all again".
    - "Download the proof" saves `exportBundle` as `ahand-proof-<chain>-<hand>.json`. "Print the receipt" goes to `/print`.
    - "Check it without this site" gives `git checkout <commit> && bun install && bun tools/ahand.ts verify --rpc <rpc> --core <core> <hand>` and `bun tools/ahand.ts verify --bundle <file>`.
    - When `record.between` needs a long read, the page shows how many requests it takes and asks first (`proof-long-read`), then calls `readBetween`.
  - `model.ts` (pure; tests in `model.test.ts`): maps each check to its part, its mark and its verdict, and builds the CLI lines.
  - `proof.css`.
- **`apps/hand/src/screens/check/`**
  - `index.tsx` runs in three columns.
    1. With no network: a ruler of the link's bytes (head, each pass, secret / last key / pin, the answer, the words) and the size of the open `?d=` part. The secret part is drawn hatched and never printed.
    2. The link is opened by `openAddress`/`openLink` through `getHandFor` (one `hands(id)` read), then `runSteps` walks Core's order in the browser. Each step has a sentence and Core's name with its position.
    3. Core's own answer comes by `eth_call` (`checkRoute`, or `checkGive` for an answer, with the forwarder setup for a 6492-wrapped confirmation).
    - The two answers are compared. If they agree, the page says "Both columns agree"; if not, a finding (`check-finding`).
  - `ruler.ts`: measures the link format v1 from its documented layout and returns offsets only. `ruler.test.ts` measures links the SDK itself wrote, of every kind, and requires the segments to cover each byte exactly once.
  - `model.ts`: compares the two answers. An account's confirmation (not a key's) failing only at `InvalidGiverSig` is left to Core.
- **`apps/hand/src/screens/core/`**
  - `index.tsx` shows:
    - the address and the chain;
    - code size, `eip712Domain()` and `MAX_EXPIRY_PERIOD()` read at one block, each marked on chain with that block;
    - the CREATE2 derivation from the configuration's factory, salt and initcode hash, compared with the Core in use;
    - the commit and the dirty flag;
    - the reproduce command;
    - `/build.json`, fetched with `cache: "no-store"` at that moment and labelled "Served by this site", or "There is no build to hash" on a dev server;
    - the twelve accepted limits, word for word;
    - the unaudited sentence from UX-SPEC §10.3.
  - `facts.ts`: `derive`, `reproduceLine`, `readServedBuild`. `facts.test.ts` pins `reproduceLine` to the CLI's `reproduceCommand` (tools/manifest.ts) word for word.
  - `limits.ts`.
- **Tests**:
  - `tests/e2e/smoke/proof.spec.ts` (6 tests);
  - `tests/e2e/lib/proof-pages/verify-bundle.ts`: the SDK's `verifyBundle` in a child process, because spec files may not import workspace packages;
  - `tests/e2e/lib/proof-pages/shots.ts`: screenshots, EN/RU at 390 and 1280 px.

## Choices the design did not make

- **Parts and marks.** A refunded Hand's `refunded`, `payout.raiser` and `now.*` lines form one fifth part, "The reward went back", so the short list ends with the refund (§10.1). `closing` (a closed Hand with no closing event) gets its own part. `data-index` on `proof-check` is the part's number from 1 to 11. The check id is in `data-value`, the verdict in `data-verdict` and the mark in `data-mark`.
- **The passport passes no give link to `collect`.** The bundle therefore holds no link. The description line of a non-empty description reads "not checkable here" ("the words travel only inside links"), as the SDK decides.
- **`/check` and the secret.** The box is an uncontrolled `<textarea>` and is emptied the moment it is read. The text lives only in the handler's memory. Nothing of the link is rendered except lengths and what its head names: chain, Hand number and number of passes. The ruler module returns no byte values at all.
- **"With no network" on `/check`** covers the ruler and the head. `runSteps` needs the Hand's terms, so it runs after one `hands(id)` read and is labelled "Checked here". `NotOpen`, `NotRaiser` and `Expired` are named as chain-only and not run.
- **A link the SDK refuses** (for example a route Core would refuse, which `openLink` throws as `link.invalid`) shows the SDK's sentence. No steps appear for it, because the SDK does not hand back the parts of a refused link.
- **The limits' words.** The twelve limits are under `core.lens.limit.<n>` (title) and `.body`. These are specialist-layer keys, exempt from the banned words, because the record's wording uses "wallet", "gas" and "sign". English is verbatim from brief 02 §2. Russian is my translation (not reviewed by the owner).
- **Mono** is used for addresses, hashes, block numbers, byte counts, Core's names, commands and section labels of machine data only.
- **`/check` shows Core's name of each step** (`InvalidClaim(1)`) under its sentence, so a specialist sees Core's order without opening anything.

## What I ran (2026-11-20, slot 4, `--dev`, this machine)

| Command | Result |
|---|---|
| `bun infra/stand/stand.ts up --slot 4 --dev` | chain 18585, relay 18587, Vite 18341 |
| `bun infra/stand/seed.ts --slot 4 --json --only …` | fixtures made |
| `STAND_SLOT=4 bunx playwright test tests/e2e/smoke/proof.spec.ts` | 6 passed (phone); run three times in total, all green (the first run had 5 tests) |
| same with `--project=desk` | 6 passed, twice |
| `cd apps/hand && bun test tests/guards src/screens/{proof,check,core}` | 141 pass, 0 fail (words, clock, secrets, colour guards included) |
| `bunx tsc --noEmit -p apps/hand`, `-p tests/e2e` | no error in my paths |
| `bun tools/ahand.ts verify --rpc http://127.0.0.1:18585 --core 0x65ac…2309 2` (the CLI being built by cli-verify) | 18 checks: 17 ok, 1 not checkable; the page shows the same tally for the same Hand |
| `sha256sum contracts/src/AHandCore.sol` | `118f4d37…d738` |

What the spec asserts, all live against the stand:

- **Thanked passport.** Every line has a mark, and none is failed or a finding. Each not-checkable line shows its words. `core` holds, so the stand's deployment facts derive its Core. "GIVEHASH MATCHES CORE" is shown.
  - "Check it all again" ticks again and gives the same ids and verdicts.
  - The verify line names the rpc, Core, Hand number and a 40-hex commit, and no `npx`/`bunx`/`npm i`.
- **Bundle.** The downloaded bundle, run through `verifyBundle` in a child process, gives exactly the page's ids and verdicts.
- **Refunded passport.** Its parts are `core, raised, reward-time, description, back`; the fifth line is `refunded`; there is no route line. "Print the receipt" leads to `/print`.
- **`/check` with the seeded `twoPasses` live address.**
  - The box is empty after Check. The ruler has one secret segment. All 6 steps pass, Core's answer is `accepted`, and both columns agree.
  - The page's HTML and every input value contain neither the seed (hex, base64url, digits from `craft secrets`) nor the link text.
- **`/check` with a give address whose helper confirmation was altered** (`craft tamper --how giver-sig`). Every step passes until `InvalidGiverSig`, which fails here; Core answers `InvalidGiverSig`; the columns agree.
- **`/core`.**
  - The derived address equals stand.json's Core. The cap is `15552000`. The domain names the Core. The commit is 40 hex. There are 12 limits. The unaudited sentence is word for word.
  - On the dev stand it says "There is no build to hash". With `/build.json` mocked by the test, it shows the hash with "Served by this site".

Screenshots, all looked at: `knowledge/plan/research/2026-11-20-experiment/shots/build/proof-pages/`. They cover the passport (thanked, refunded), check-live, check-give, check-tampered and core, in EN and RU at 390 and 1280 px. None has horizontal overflow (the script checks `scrollWidth`). One fix came from looking at them: a long `now.0x…` id in the evidence toggle pushed the 390 px page sideways, so it is now shortened. Two wording fixes: "Nothing waits now for …" instead of "$0 waits", and the passport's mono header no longer prints the configuration's English chain name on the RU page.

## Not verified

- A **failed passport line** (a finding) was never drawn on a live Hand: the chain gives no false facts. Its logic is covered by `model.test.ts` and the SDK's own tamper tests; its look was not screenshotted.
- A **disagreement finding on `/check`** was never produced live, for the same reason. The comparison is unit-tested.
- The **long read between** (`proof-long-read`): no seeded Hand on this stand was topped up or extended, so the button was not pressed in a browser.
- **`/core` on a built site** through face or static: there it would fetch the real `build.json`. Only the dev stand and a mocked answer were run.
- **A screen reader and axe** were not run on these screens (e2e-guards' wave).
- The **Russian translation of the twelve limits** is mine; the owner has not read it.

## Needs (files I do not own)

- `apps/hand/src/testids.ts`: add `proof: { tally: "proof-tally", givehashMatches: "proof-givehash-matches", verifyLine: "proof-verify-line" }`, `check: { agree: "check-agree" }`, `core: { buildLabel: "core-build-label", buildValue: "core-build-value", unaudited: "core-unaudited" }`. The screens use these literal ids now; after the change they should use the constants.

## Review round 1 (2026-11-20): five findings, fixed in this package's files

Written by the AI agent that fixed them. Nothing was committed. Each finding was first reproduced on a build made before the fix (the new e2e tests failed there), then fixed, then run on a dev server and on a built site.

### 1. /check called a thanked Hand's answer thankable (major)

- **Cause.** Step 3 asked only `checkGive`/`checkRoute`. Core's `checkGive` does not look at `closedAt`, the expiry or the caller.
- **Fix.** `check/index.tsx` reads the latest block once (`chainNow`), then `hands(id)`, `thanks(id)` and Core's answer, all pinned to that block (`pinnedTo` hands the SDK's reads a client that adds the block number). `check/model.ts` `handNow` turns that into one of six states: `open`, `expired`, `thanked-this`, `thanked-other`, `thanked` (a route was pasted) and `refunded`.
- **On screen.** "The contract accepts this answer." now stands alone, with a line saying that this check does not look at whether the Hand is open. Under it, a box "The hand itself, at the same block" carries the state sentence, a link to the passport for a closed Hand, and its source (`hands(id) · thanks(id) · block · network time`). "The asker can thank this answer" appears only for an open Hand in time.
- **"This is the answer that was thanked"** is decided by `giveHash(hand, give)` of the pasted Give being equal to `thanks(id).giveHash`. It is computed with the SDK, not taken from Core's return, so it also holds when a contract giver now answers differently.

### 2. /check with the network off (major)

- **Cause.** The early return after a failed `openAddress` left the Core column in `waiting`; the sentence and `kept` both said "Nothing was sent."; the header promised more than can be done offline.
- **Fix.** One band above the columns says "Can't reach the network right now. Nothing was sent." once, with "Try again" (the pasted text is kept in memory only). The Core column says "Not asked". A link the SDK refuses now also ends the Core column ("Not asked: this link did not open here").
- **Column 2 offline** is `check/offline.ts`: each pass's share and payee, what the route leaves, the answer's helper and payee, whether the helper's confirmation is a key's or an account's, and the words in the link and in `?d=`, labelled "not compared with the chain". Every row has a dashed "?" and no mark.
- **Not done, and why: "that the keys follow one another".** The link does not carry a pass's next key; it is recovered from the next confirmation, and a confirmation is made over the Hand's terms, which only the contract has. So nothing about keys can be shown from the bytes alone. The page says exactly that.
- **The header** now reads "With no network, this page measures its bytes and shows what they say. With the hand's terms read once from the contract, it walks the contract's own checks…".
- **The lazy chunk.** viem 2.52.0 does `await import("../../utils/ccip.js")` in the handler of every failed `eth_call`. Two guards: /check asks nothing when `navigator.onLine` is false, and `check/ccip.ts` names the helper so the screen's chunk imports it statically (seen in the build: `check-*.js` starts with `import … from "./ccip-*.js"`).
- **Which errors count as the network** is the chain layer's `isNetworkError` (added by another fixer in this round). Anything else is "The check itself failed here".

### 3. The passport had no transaction line, no Transfers and no block-time checks (minor)

- `proof/sent.ts` reads, beside the SDK's record: the closing transaction's receipt (`from`, `gasUsed`, `effectiveGasPrice`, an L1 fee if the receipt has one), the token's `Transfer` logs from Core in it, and the two blocks of `Raised` and of `Thanked`/`Refunded`.
- **The transaction line** opens the Payouts part (or "The reward went back"): who sent it, the block, what it cost in ETH and in dollars at the dated price snapshot. It is tagged "For information" and has no verdict. Its evidence lists the receipt's fields and where this Hand's logs and the token's logs stand.
- **Each `Paid` line** shows the token's own Transfer under it (token, to, amount, log index), matched by payee, amount and place: between the Hand's event before the `Paid` and the `Paid` itself. A `Pending` line shows none.
- **Two more checks:** `time.opened` (`block(Raised).timestamp = hands(id).openedAt`) and `time.closed` (`block(Thanked or Refunded).timestamp = hands(id).closedAt`). A time that could not be read is "not checkable", never failed.
- **The downloaded file** holds these facts under `extra` (`format: "aHand.proof-page/1"`). The SDK's `readBundle` ignores unknown keys, so `verifyBundle` and the CLI still pass; they do not check the two time lines. The note under the button says so.

### 4. /core's "about 70" (minor)

The record's sentence stays word for word. Under it, in mono: "With this site's default of 250 thousand gas per payout: 55 paid passes at worst." The number is `passesLeft` from an empty route at `config.defaults.payoutGasK`, computed at run time (`core/facts.ts` `paidPassesAtWorst`).

### 5. Passport check 1 without its caveat (polish)

The first line now says "The factory, the salt and the code's hash come with this site…". Its evidence carries the from-a-clone command (the same `reproduceLine` /core prints) and, as information, the runtime code hash and the factory's code hash read at the record's block, with a sentence that they are recorded and are not the proof (D-10).

### What I ran (2026-11-20, this machine)

The stand's slots use ports outside my range, so I ran the SDK's helper chain on 24800 (`anvil.ts --serve --write-stand --write-config`), Vite on 24801 and a built copy served by `infra/stand/static.ts` on 24802. `proof.spec.ts` now takes `STAND_FILE` for `craft.ts` as well as for the seed.

| Command | Result |
|---|---|
| new /check and offline tests against the build made **before** the fix | failed as the findings describe: no state line; Core column stuck in `waiting` |
| `STAND_FILE=… STAND_BASE_URL=http://127.0.0.1:24802 bunx playwright test tests/e2e/smoke/proof.spec.ts --project phone --project desk` (built site) | 20 passed |
| the same against the dev server on 24801, `phone` | 10 passed |
| `cd apps/hand && bun test tests/guards src/screens/{proof,check,core}` | 180 pass, 0 fail |
| `bunx tsc --noEmit -p apps/hand` | exit 0 |
| `bun tools/ahand.ts verify --bundle <the file the page downloaded>` | 18 checks: 17 ok, 1 not checkable, 0 failed (the page shows those 18 and its own 2) |
| `sha256sum contracts/src/AHandCore.sol` | `118f4d37…d738` |

Screenshots, looked at: `knowledge/plan/research/2026-11-20-experiment/shots/round-1/fix-proof-pages/` (three `before-*`, then /check on a thanked, expired, refunded and open Hand, /check offline in light and dark, the passport plain and with the lens, /core; EN and RU at 390 and 1280 px; none overflows sideways).

### Not verified

- A `time.*` line that **fails**, and a Paid line with **no** Transfer: the chain gives neither. Both are unit-tested (`proof/sent.test.ts`).
- The L1 fee on a receipt: the local chain has none. The field is read if present; unit-tested only.
- /check's "The check itself failed here" state was not produced in a browser.
- The Russian of the new sentences is mine; the owner has not read it.

### Needs (files I do not own)

- `packages/sdk/src/proof.ts`: take `proof/sent.ts` in. `collect` should read the receipt fields, the token's Transfers and the two block times into `HandRecord`; `passportOf` should produce `time.opened` and `time.closed`; `bundleSchema` should carry them. Then the page drops `readPageFacts`/`timeChecks` and the bundle's and the CLI's checks equal the page's again.
- `apps/hand/src/screens/limits/{en,ru}.ts` and its screen: under `limits.length.say`, this build's own figure, in that page's words (no "gas" there): "With this site's setting, that is 55 paid shares." / «При настройке этого сайта это 55 оплаченных долей.», computed with `passesLeft` at `config.defaults.payoutGasK`.
- `apps/hand/src/chain/clients.ts`: reference viem's `offchainLookup` there, so every screen's failed `eth_call` finds the helper loaded, not only /check's.
- `apps/hand/src/testids.ts`: `check: { handNow: "check-hand-now", passport: "check-passport", offline: "check-offline", offlineBand: "check-offline-band", offlinePass: "check-offline-pass", retry: "check-retry" }`, `proof: { sent: "proof-sent", move: "proof-move", coreCaveat: "proof-core-caveat", coreCommand: "proof-core-command", codeHashes: "proof-code-hashes" }`, `core: { limitHere: "core-limit-here" }`. The screens use these literals now.

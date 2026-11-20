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

# Build note: docs (wave 6)

Documentation written from the code as it stood on 2026-11-20, by an AI assistant of the overnight experiment. The choices below are the assistant's, not the owner's. Nothing was committed. Stand: slot 3 (chain 18575, relay 18577, site 18330); the one extra server was `python3 -m http.server` on 19150.

## What exists

- The old tree moved by name with plain `mv` (not staged): `docs/{00-project,10-model,20-protocol,30-architecture,40-applications,50-implementation,70-decisions,templates,README.md}` → `docs/archive/core-v2/`. `ls docs` showed no other old entry. The archive README starts with the banner "These pages describe an earlier Core. They are kept for history."
- New: `README.md` (root), `docs/how-it-works.md`, `docs/ru/how-it-works.md`, `docs/core.md`, `docs/links.md`, `docs/sdk.md`, `docs/app.md`, `docs/app-duties.md`, `docs/without-the-site.md`, `docs/deploy.md`, `docs/runbook.md`, `docs/limits.md`, `docs/defaults.md`. `docs/glossary.md` (words package) untouched.

## Choices the design did not make

- **how-it-works uses a real run, not invented numbers.** Hand 14 on slot 3 was raised with `craft.ts make` (40 test dollars, minimum 70%, 30 days), passed twice with `tools/ahand.ts pass` (10%, 5%), answered with `craft.ts give --giver 4`, and thanked with `thank-calldata` + `ahand.sh thank`. The page's numbers (4 + 2 + 34, worst gas 973 882, 383 bytes, 23 checks) are that run's. The Deal card shows "at least $34", what `ui/DealCard.tsx` computes for the helper after two passes (reward × claim left), not UX-SPEC's illustrative "$28".
- **limits.md is generated from the screen's catalogue** (`screens/limits/{en,ru}.ts`, order and sources from `index.tsx`), English and Russian, with a line saying the screen wins if the catalogue changes after tonight (the words package may edit it in this wave).
- **defaults.md has all 70 rows of DECISIONS.md** (Fork, Chosen, Rejected), each with "Owner's? no", plus the "Left for the owner" list verbatim.
- **app-duties.md** was written from my own reading of code and test names because `docs/build-notes/harden-libs.md` did not exist while I worked; the page says harden-libs' table is the authority where they differ.
- **The `exit.html` serve command** is quoted as `python3 -m http.server "${PORT:-8000}" --bind 127.0.0.1` so it could be run in my port range (19150); the page itself prints port 8000.
- Docs are Markdown; to look at them at 390 px I rendered three with Python-Markdown into the scratchpad (not part of the repo).

## Commands quoted in README.md and without-the-site.md, run on slot 3

| Command | Result |
|---|---|
| `flock /tmp/ahand-exp-bun.lock bun install --frozen-lockfile` | "Checked 264 installs across 387 packages (no changes)"; `bun.lock`, `package.json` unchanged |
| `bun infra/stand/stand.ts up --slot 3` | up in 4.2 s, built, served by face; Core `0x65ac…2309`; chain 40.00 days ahead |
| `bun infra/stand/seed.ts --slot 3 --json` | exit 0, 13 fixtures |
| `bun infra/stand/loop.ts --slot 3` | exit 0, six parts `ok` (usd delivered 1 of 1 relay, pending, refund, zero-reward, second-token, undeployed-account) |
| `bun infra/stand/stand.ts status --slot 3` | chain, relay, site up; dev down |
| `SELFTEST_PORT=19160 bun run check` | **exit 1.** Passed: Core hash, ABI, typecheck of 9 projects, forge 217 passed, vectors 3 passed with no fixture diff, `selftest.sh` passed, SDK vitest 21 files / 413 passed, abi 11, deliver 34. Failed: `apps/hand` 326 pass / **1 fail**, `tests/guards/secrets.test.ts` "no navigation carries a fragment the app wrote", on `screens/hand/index.tsx:43` (a `replaceState` added by another package of this wave, mid-edit). face, stand, relay, tools tests and the build did not run after it |
| `STAND_SLOT=3 bunx playwright test tests/e2e/smoke/about.spec.ts` | 13 passed (22.5 s) |
| `bun tools/ahand.ts core-check --rpc http://127.0.0.1:18575` (with and without `--deployment contracts/deployments/31337-slot3.json`) | exit 0, every line `ok`, initcode `0x9f40…de65` |
| `bun infra/stand/stand.ts down --slot 3` | see the end |
| `bash contracts/exit/ahand.sh status 2` / `status 14` | TIME'S UP / CLOSED, thanked; fields equal `hands()` |
| `ahand.sh refund 2 -- --private-key <account 5>` | status 1; Hand 2 refunded, 15 mUSD to the raiser |
| `ahand.sh pending <blacklist token> <payee 0x14dC…9955>` | 5 mUSD; `withdraw` while blocked: exit 1 (`BLACKLISTED` at estimate); after the fixture's unblock `cast send`, `withdraw -- --private-key <account 5>`: status 1, pending 0 |
| `ahand.sh extend 4 +60d`, `ahand.sh fund 4 5` (account 1) | status 1 each; reward 50 → 55, expiry moved; `extend 4 +200d`: exit 1, "more than 180 days after the latest block" |
| `bun tools/ahand.ts pass … --share-bps 1000 / 500 --payee …` | exit 0 each; route 100 → 90 → 85% |
| `bun tools/ahand.ts thank-calldata "<give>" --rpc $RPC --out thank.hex` | Core's checkGive accepts, give hash `0xf876…892a`, worst gas 973 882 |
| `ahand.sh thank thank.hex -- --gas-limit 973882 --private-key <account 1>` | status 1; balances +4, +2, +34 mUSD exactly |
| `bun tools/ahand.ts verify --rpc $RPC --core $CORE 14` (and `--save`, then `--bundle`) | 23 checks: 22 ok, 1 not checkable (description), 0 failed; exit 0 both |
| `cast decode-calldata "thank(…)" $(cat thank.hex)` | handId 14, two Shakes (10000→9000, 9000→8500), the Give at 8500, dataHash 0 |
| `python3 -m http.server "${PORT:-8000}" --bind 127.0.0.1` with `PORT=19150` in `.run/3/dist` | `GET /exit.html` 200, 572 301 bytes; Chromium 390 px: no console error, no overflow, network time line shown |
| `exit.html` from `file://` (Chromium, ru-RU, 390 px) | shows the file-page sentence and the serve command; screenshot looked at |
| `bash contracts/exit/selftest.sh` | ran inside `bun run check`: "selftest passed" |
| `bun infra/stand/drill.ts --slot 3 --reuse` | exit 0, 13 `ok` lines over three stages; relay and face restored |

Also run for deploy.md / core.md: `cast keccak "aHand.core/1"`, `cast compute-address … --init-code-hash 0x9f40…` → `0x65ac…2309`; `bash contracts/script/check-deployment.sh contracts/deployments/31337-slot3.json http://127.0.0.1:18575` → holds; the reproduce line (`forge build && cast keccak …`) inside the stand's forge lock → `0x9f4031e9…de65`; `cast call $CORE "hands(uint256)(…)" 14` as printed in core.md. `sha256sum contracts/src/AHandCore.sol` → `118f4d37…d738`.

## Done checks

- `ls docs`: the new pages, `ru/`, `glossary.md`, `build-notes/`, `archive/`. `docs/archive/core-v2/` holds the nine old entries.
- `grep -rniE "gasless|community-verified|cannot be cheated|trustless guarantee|audited by" docs --exclude-dir=archive`: **nothing in my pages**; two hits in files of the words package: `docs/glossary.md:27` ("gasless" listed as a word to avoid) and `docs/build-notes/words.md:3` ("audited by one hand"). See needs.
- `grep -rnE "pause|rescue" docs/runbook.md`: one line, the sentence saying Core has neither.
- app-duties.md has 23 rows; limits.md has 16 entries, the two token entries as 12 and 13.
- charity, reclaim, Signals, policyAdmin, MAX_SHAKES: only `docs/core.md` "…are gone", D-13's "no Signals" in defaults.md, and the glossary's avoid-list (words package).

## Screenshots (looked at)

`knowledge/plan/research/2026-11-20-experiment/shots/build/docs/`: `exit-served-390-en.png`, `exit-file-390-ru.png`, `how-en-390.png`, `how-ru-390.png`, `readme-390.png` (the last three are the Markdown rendered plainly; wide code lines scroll inside their block).

## Not verified

- Commands on any real network, an explorer form, `ahand.sh` with `--ledger`/`--account`, `deploy.sh`, `tools/ahand.ts manifest`, `recover` (described from their notes and help text only).
- The app's screens named in app.md were not walked by me; app.md is from routes, code and other packages' notes and smokes.
- The Russian of `docs/ru/how-it-works.md` is mine; the owner has not read it.

## Stopped

`bun infra/stand/stand.ts down --slot 3`: site, relay and chain stopped by pid; 18575, 18577, 18330, 18331 free. The http.server on 19150 was stopped by its pid (the first one I started had kept the port, so my first `${PORT:-8000}` run had not bound; it was re-run alone afterwards: 200, 572 301 bytes, then stopped). Nothing of mine listens on 19150–19199.

## Review round 1 (fixer: docs)

Ports used: 25400–25403 (a stand on slot 7 with `STAND_PORT_BASE=25330`) and 25420 (`SELFTEST_PORT` in a fresh clone). Nothing committed.

**New test: `docs/tests/docs.test.ts`** (`bun test docs/tests`, 16 tests). Written first; 15 failed against the pages as they stood, all 16 pass after the fixes. It reads the tree rather than a copy: the two `git clone` lines are taken from `.github/workflows/check.yml`, the port variables from every `.ts`/`.sh` under the packages, the Deal card's lead-in from `apps/hand/src/ui/words.ts`, the browser suites from `tests/e2e/*.spec.ts`. It also checks every relative link on these pages and the banner on all 45 archived pages. It is not in `bun run check` (root `package.json` is not this package's; see needs).

| Finding | What was done | Run |
|---|---|---|
| no way to get `contracts/lib` | README: `mkdir` + the two `git clone` lines of check.yml before `bun install`; one paragraph: `contracts/lib` is git-ignored, `.gitmodules` is a leftover (`git submodule update --init` fetches nothing), never stage `contracts/lib` | fresh `git clone` of `exp/e2e` (de1d968) into the scratchpad: `forge build` failed with the reviewer's `Math.sol not found`; `git submodule update --init` did nothing. After the two lines: `forge build` ok, initcode hash `0x9f4031e9…de65`; `bun install --frozen-lockfile`, `check:core`, `check:abi`, `typecheck` (9 projects), `test:contracts` 217 passed, `test:vectors` 3 passed, `test:exit` (`SELFTEST_PORT=25420`) "selftest passed", `build` ok. `test:sdk` and `test:unit` were not run there (their ports are not in this fixer's range); `git status` in the clone stayed empty |
| jq and port variables | "You need git, Bun 1.4.4, Foundry 1.8.6 and jq"; a table of the nine variables with users and defaults (`SELFTEST_PORT`, `RELAY_TEST_PORTS`, `DELIVER_TEST_PORTS`, `TOOLS_TEST_PORT_BASE`, `FIXTURES_TEST_PORT`, `STAND_STATIC_TEST_PORT`, `STAND_TEST_SLOTS`, `RAISE_TEST_PORT`, `STAND_PORT_BASE`), defaults read from the code | the stand below ran with `STAND_PORT_BASE=25330` as written |
| `manifest` / `core-check` on a stand; face behind a cache | README and deploy.md show `--deployment contracts/deployments/31337-slot<N>.json` and the cli-verify fallback order (STAND_SLOT, `31337.json`, the single slot file). deploy.md "In front of face": a cache table per path, the language, compression, the card cap, what face does not do | slot 7 up/seed/loop (6 ok); `core-check … --deployment …31337-slot7.json` every line ok; `manifest 31337 --deployment … --app infra/stand/.run/7/dist` rc 0 (the file it wrote was removed), and without `--deployment` rc 0 by the fallback. Live headers by curl match the table (assets immutable; `/`, `exit.html`, `build.json` no-cache with br; Hand card 300 s; `/healthz` no-store; POST 405). Burst of 76 cold cards: 18 real cards (`max-age=300`) = 2 renderers + 16 queued, 58 generic `no-store`; `/healthz` during the burst 200 in 6 ms |
| bun audit untriaged | deploy.md "Advisories in dependencies": 20 advisories, ten packages, each with what pulls it, why it is not reachable in what ships, what lifts it; rule "never run the vitest UI" | `bun audit` (20: 3 critical, 7 high, 9 moderate, 1 low); versions traced in `node_modules/.bun` (vite 5.4.21 only via vite-node; every app path links vite 8.3.8); viem imports `isows` only inside its WebSocket transport; the built app has no `ws` code (grep of `dist/assets`); `readBundle` (zod) is called only by `tools/lib/verify.ts`; opentype.js calls `inflateSync`, not `unzipSync` |
| earlier-Core folders unmarked | README "Code from the earlier Core": `apps/web`, `packages/subgraph`, `infra/anvil`, `infra/seed`, D-2 and D-6, not installed/built/tested/maintained; the folders untouched | test |
| quoted sentences changed this round | "Someone raised a hand:" / «Кто-то поднял руку:» in README, how-it-works (en, ru), app.md; "sees what will be sent to whom" (how-it-works en/ru, without-the-site.md); the bundle: "checks its signatures and arithmetic with no network; amounts need the chain" (en, ru) | test (reads words.ts) |
| archive pages without a banner | a scripted edit put one banner line (plus a blank line) at the top of all 45 pages, with a link to the root README that resolves from each depth; the archive README's two-line banner became the same one line. Nothing else in those files changed (`git diff --stat`: 45 files, +89 −2) | test |
| stale counts; suites | sdk.md points to evidence.md for counts; README names `first-loop.spec.ts` and `shots.spec.ts` (29 tests, about 9 minutes, 215 pictures over git-ignored `tests/e2e/shots/`; a bare `bunx playwright test` runs it too) | test |

**Decided here.** `defaults.md` is unchanged: its only "looking for" is D-37's rejected option "Ana is looking for", a transcription of DECISIONS.md, and D-37's "Always Someone" still holds. The Russian title in the how-it-works card became a noun phrase («квартира в Ереване на июнь.») because the new lead-in ends with a colon. The audit table went into deploy.md (what ships and how), not the runbook (what to do when a part is down). `bun audit fix` was not run: it rewrites the shared lockfile.

**Screenshots** (Markdown rendered with Python-Markdown into the scratchpad, Chromium; no page overflow at 390 or 1280): `knowledge/plan/research/2026-11-20-experiment/shots/round-1/fix-docs/` `readme-390.png`, `readme-1280.png`, `deploy-390.png`, `deploy-1280.png`, `how-en-390.png`, `how-ru-390.png`, `archive-page-390.png`, `sdk-1280.png`. Looked at: readme-1280, how-ru-390.

**Stopped.** `stand.ts down --slot 7` stopped chain, relay and face by pid; 25400–25449 free.

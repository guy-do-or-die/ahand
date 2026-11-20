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

# aHand

**Shake it on.**

```
Someone raised a hand: a sublet in Yerevan, June.     $40 reward · open until 29 Jan
You pass the link on and keep 10%. The next person passes it on and keeps 5%.
The person who finds the flat answers. The asker thanks: $4 + $2 + $34, paid by the contract.
```

aHand turns a request into a link that carries a reward. Each person who passes the link on can keep a share of the reward, and whoever helps signs an answer at the end of the route. When the asker thanks that answer, a contract with no owner and no fee pays every share along the route at once; if nobody is thanked by the end date, the whole reward goes back to the asker.

## State

**Unaudited; runs on a local chain only; an overnight experiment whose choices are not the owner's decisions.**

- The contract `contracts/src/AHandCore.sol` (sha256 `118f4d37…d738`) is the owner's and is not changed here. Seven AI reviews and one AI scan found no defect; no professional audit has been done.
- Everything around it (SDK additions, app, delivery, tools, these pages) was written on the night of 2026-11-20 by AI agents on branch `exp/e2e`. Every choice they made is listed in [`docs/defaults.md`](docs/defaults.md), each marked "not the owner's".
- Nothing has run against a public network, a public relay, a real wallet or a real phone. See [`docs/limits.md`](docs/limits.md) for what the system cannot promise, and [`docs/evidence.md`](docs/evidence.md) (written by the last wave) for what ran.

## Start the stand

You need git, Bun 1.4.4, Foundry 1.8.6 and jq (the exit kit's self-test and `check-deployment.sh` call it). Foundry is called by path: put `~/.foundry/bin` first in `PATH` or set `FOUNDRY_BIN` (on some machines a bare `forge` is another program).

```sh
mkdir -p contracts/lib                     # the two libraries Core builds against, at the versions CI fetches
git -c advice.detachedHead=false clone --depth 1 --branch v1.16.2 https://github.com/foundry-rs/forge-std contracts/lib/forge-std
git -c advice.detachedHead=false clone --depth 1 --branch v5.6.1 https://github.com/OpenZeppelin/openzeppelin-contracts contracts/lib/openzeppelin-contracts
bun install --frozen-lockfile
bun infra/stand/stand.ts up --slot 3       # anvil 40 days ahead, Core by CREATE2, two test tokens, relay, built app behind face
bun infra/stand/seed.ts --slot 3 --json    # thirteen named fixtures: thanked, refunded, dark, public, a 6492 helper, …
bun infra/stand/loop.ts --slot 3           # the core loop through the SDK alone, six parts
bun infra/stand/stand.ts status --slot 3
bun infra/stand/stand.ts down --slot 3
```

`contracts/lib` is git-ignored and is not in the repository; the two `git clone` lines above are the only way in, the same two that `.github/workflows/check.yml` runs. The `.gitmodules` file is a leftover of the earlier tree with no submodule behind it: `git submodule update --init` fetches nothing. Never stage anything under `contracts/lib`. With these two versions the initcode hash comes out as `0x9f40…de65` in any folder ([deploy](docs/deploy.md#reproducing-the-initcode-hash)).

Slot `N` uses ports `18545+10N` (chain), `18547+10N` (relay), `18300+10N` (site) and `18301+10N` (Vite with `--dev`). Slot 3 opens at `http://127.0.0.1:18330`. When those are taken, `STAND_PORT_BASE=B` moves every slot to `B+10N` (chain), `+1` (relay), `+2` (site), `+3` (dev), with `B` from 1024 to 65000; every command on that slot (`up`, `status`, `down`, `drill.ts`, the browser suites) must see the same value. A local build shows the ribbon `LOCAL TEST NETWORK · TEST DOLLARS` and offers a dev wallet with anvil's public test accounts at `/dev/wallet`.

## Run the checks

```sh
SELFTEST_PORT=19160 bun run check                                    # Core hash, ABI, typecheck, forge, vectors, exit kit, SDK, unit tests, docs tests, build
STAND_SLOT=3 bunx playwright test tests/e2e/smoke/about.spec.ts       # one browser smoke on a running stand
bun tools/ahand.ts core-check --rpc http://127.0.0.1:18575 --deployment contracts/deployments/31337-slot3.json   # this clone's initcode → CREATE2 address → code on chain
bun test docs/tests                                                   # these pages against the tree: recipes, ports, quoted words, links
```

`bun run check` is defined in `package.json`; its parts can be run alone (`test:contracts`, `test:vectors`, `test:exit`, `test:sdk`, `test:unit`, `test:docs`, `typecheck`, `build`). It starts chains and servers on fixed test ports; on a machine where they are taken, move them with these variables (the defaults in brackets):

| Variable | Used by | Default |
|---|---|---|
| `SELFTEST_PORT` | `contracts/exit/selftest.sh` (its own anvil) | first free of 18945–18954 |
| `RELAY_TEST_PORTS` | `infra/relay/tests`, a range `from-to` | `15100-15119` |
| `DELIVER_TEST_PORTS` | `packages/deliver/tests`, a range `from-to` | `15120-15149` |
| `TOOLS_TEST_PORT_BASE` | `tools/tests`: one port per file at base + 2 … base + 9 | `18350` |
| `FIXTURES_TEST_PORT` | `infra/stand/tests/fixtures.test.ts`: chain, relay on the next port | `16060` |
| `STAND_STATIC_TEST_PORT` | `infra/stand/tests/stand.test.ts`, the static server | `16001` |
| `STAND_TEST_SLOTS` | `infra/stand/tests/stand.test.ts`, two stand slots `a,b` (their ports follow `STAND_PORT_BASE`) | `8,9` |
| `RAISE_TEST_PORT` | `apps/hand/src/screens/raise/flow.test.ts`, its anvil | a free port |
| `HAND_TEST_PORT_BASE` | `apps/hand` tests with a fixed port: watcher `B`, send `B+1`, dev wallet `B+2` and its fake Base RPC `B+3`, outbox relay `B+4` | `16110`, `16111`, `16112`, `25051`, `19060` |
| `SDK_TEST_PORT_BASE` | `packages/sdk/tests`: money `B`, wallet `B+1`, proof `B+2`, steps `B+3` (the others pick free ports) | `15051`, `15052`, `16201`, `16202` |
| `FACE_TEST_PORT_BASE` | `apps/face/tests/face.test.ts`: faces and its chain at `B` … `B+5` | `25100` |
| `STAND_PORT_BASE` | every stand slot (see above) | the fixed layout |

The SDK's own tests (`test:sdk`) start their anvils on free ports the system picks, except the four named under `SDK_TEST_PORT_BASE`.

The browser suites run against a stand that is up, always from the root with `STAND_SLOT` set:

- `tests/e2e/smoke/` (one spec per screen) and `tests/e2e/guards/` (fail closed, the clock, secrets, accessibility, Russian);
- `tests/e2e/first-loop.spec.ts` (four people, one loop through the screens), `tests/e2e/life.spec.ts` (the whole life of a Hand), `tests/e2e/clock.spec.ts` and `tests/e2e/drill.spec.ts` (every server off, money still moves);
- `tests/e2e/shots.spec.ts` is not a check but the screenshot run: 29 tests, about 9 minutes, 215 pictures (every screen in both themes, both languages, 390 and 1280 px) written over `tests/e2e/shots/`, which is git-ignored. A bare `bunx playwright test` runs it too; name the suites you want.

What ran, with counts and times, is in [`docs/evidence.md`](docs/evidence.md).

## Code from the earlier Core

Four folders were built for the earlier Core and still speak of charity, reclaim and `policyAdmin`: `apps/web`, `packages/subgraph`, `infra/anvil` and `infra/seed`. They are kept on disk on purpose (D-2: the new app is `apps/hand`, not `apps/web` migrated; D-6: the root `workspaces` list leaves them out), so they are not installed, not built, not tested and not maintained on this branch; several import names the SDK no longer has. Read them as history, like [`docs/archive/core-v2/`](docs/archive/core-v2/README.md).

## Where to read next

| Page | For |
|---|---|
| [how-it-works](docs/how-it-works.md) · [по-русски](docs/ru/how-it-works.md) | one Hand from raise to thanks, with real numbers |
| [core](docs/core.md) | the contract: functions, events, errors, check order |
| [links](docs/links.md) | the link, its three shapes and three modes, measured sizes |
| [sdk](docs/sdk.md) | the calls per role, the clock rule, account setup |
| [app](docs/app.md) | screens, what the device stores, what is logged |
| [app-duties](docs/app-duties.md) | the 23 duties Core leaves to apps, with code and tests |
| [without-the-site](docs/without-the-site.md) | moving money with `exit.html`, `ahand.sh` or a block explorer |
| [deploy](docs/deploy.md) | CREATE2, the deployment file, reproducing the initcode hash |
| [runbook](docs/runbook.md) | what to do when a part is down |
| [limits](docs/limits.md) · [defaults](docs/defaults.md) · [glossary](docs/glossary.md) | what it can't promise; every choice made tonight; the words |

Older pages describe an earlier Core and are kept in [`docs/archive/core-v2/`](docs/archive/core-v2/README.md).

## Licence

MIT by the plan's default D8, not yet the owner's decision. No `LICENSE` file is added (DECISIONS D-60). `AHandCore.sol` carries `SPDX-License-Identifier: MIT`.

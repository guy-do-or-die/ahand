# aHand

**Shake it on.**

```
Someone is looking for a sublet in Yerevan, June.     $40 reward · open until 29 Jan
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

You need Bun 1.4.4 and Foundry 1.8.6. Foundry is called by path: put `~/.foundry/bin` first in `PATH` or set `FOUNDRY_BIN` (on some machines a bare `forge` is another program).

```sh
bun install --frozen-lockfile
bun infra/stand/stand.ts up --slot 3       # anvil 40 days ahead, Core by CREATE2, two test tokens, relay, built app behind face
bun infra/stand/seed.ts --slot 3 --json    # thirteen named fixtures: thanked, refunded, dark, public, a 6492 helper, …
bun infra/stand/loop.ts --slot 3           # the core loop through the SDK alone, six parts
bun infra/stand/stand.ts status --slot 3
bun infra/stand/stand.ts down --slot 3
```

Slot `N` uses ports `18545+10N` (chain), `18547+10N` (relay), `18300+10N` (site) and `18301+10N` (Vite with `--dev`). Slot 3 opens at `http://127.0.0.1:18330`. A local build shows the ribbon `LOCAL TEST NETWORK · TEST DOLLARS` and offers a dev wallet with anvil's public test accounts at `/dev/wallet`.

## Run the checks

```sh
SELFTEST_PORT=19160 bun run check                                    # Core hash, ABI, typecheck, forge, vectors, exit kit, SDK, unit tests, build
STAND_SLOT=3 bunx playwright test tests/e2e/smoke/about.spec.ts       # one browser smoke on a running stand
bun tools/ahand.ts core-check --rpc http://127.0.0.1:18575            # this clone's initcode → CREATE2 address → code on chain
```

`bun run check` is defined in `package.json`; its parts can be run alone (`test:contracts`, `test:vectors`, `test:sdk`, `test:unit`, `typecheck`, `build`). The browser suites are `tests/e2e/smoke`, `tests/e2e/guards`, `tests/e2e/life.spec.ts`, `tests/e2e/clock.spec.ts` and `tests/e2e/drill.spec.ts`; always run them from the root with `STAND_SLOT` set.

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

# aHand

> This README is interim. It will be rewritten together with the documentation; until then it says
> only how to build, test and run what is in this tree.

aHand lets someone ask for help and put a reward behind the request. The request travels as a link
from person to person; each person who passes it on can keep a share of the reward, and whoever
helps sends an answer back along the route. When the asker says thanks, one call to the contract pays
the helper and everyone on the route at once; without thanks, the whole reward goes back to the asker
after the end date. The contract (`contracts/src/AHandCore.sol`, "Core") holds the rewards and does
the arithmetic; the web app, the SDK and the command-line tool are ways to talk to it, and none of
them is needed to get money out.

## What you need

- [Bun](https://bun.sh) 1.4.4.
- [Foundry](https://getfoundry.sh) 1.8.6 (`forge`, `cast`, `anvil`). Every script calls it by path:
  `$FOUNDRY_BIN`, default `~/.foundry/bin`.
- `jq`, for the exit kit's self-test; `node`, for one test of the Vercel Function (`NODE_BIN`).

## The contract libraries

`contracts/lib` is not in the repository. Fetch the two libraries Core and its tests build against,
pinned as the CI gate (`.github/actions/setup/action.yml`) pins them:

```sh
mkdir -p contracts/lib
git clone --depth 1 --branch v1.16.2 https://github.com/foundry-rs/forge-std contracts/lib/forge-std
git clone --depth 1 --branch v5.6.1 https://github.com/OpenZeppelin/openzeppelin-contracts contracts/lib/openzeppelin-contracts
```

`.gitmodules` is a dead leftover: the tree records no submodule, so `git submodule update` fetches
nothing. `contracts/lib/` is ignored by git, and nothing under it is ever staged or committed.

## Install and check

```sh
bun install --frozen-lockfile
bun run check
```

`bun run check` is the whole gate, the same steps as CI: Core's source unchanged byte for byte, the
typecheck, `forge build`, the ABI package equal to the build, every forge test, the SDK vectors and
gas fixtures unchanged after Core rewrote them, the exit kit's self-test, the tests of every package
and app, and the web app's build. Each step is also a script of its own in `package.json`
(`test:sdk`, `test:web`, `test:view` and the rest). `infra/gate/gate.ts` runs them: the steps that
rewrite generated files first, then the rest in lanes side by side, each step's output printed
whole when it ends, and a table of the times at the end. The stand's tests take slots 6 and 7
(`STAND_TEST_SLOTS="a,b"` picks others).

## The local stand

A stand is a whole aHand on this computer: anvil with its clock 40 days ahead, Core and the test
contracts deployed, a test relay, and the built app served by the view server.

```sh
bun run stand up --slot 3            # --dev runs the Vite dev server instead of a build
bun infra/stand/seed.ts --slot 3     # fixture Hands for every screen state (each run a new set)
bun run stand status --slot 3        # --json for the machine-readable form
bun run stand down --slot 3          # or --all
```

Ten stands can run side by side, one per slot (0 to 9, default `STAND_SLOT`, else 0); each slot owns
four ports and the folder `infra/stand/.run/<slot>/` (`stand.json` names its site, RPC and relay). The
ports (`infra/stand/ports.ts`):

| | chain (anvil) | relay | site | dev server |
|---|---|---|---|---|
| fixed layout | 18545 + 10s | 18547 + 10s | 18300 + 10s | 18301 + 10s |
| `STAND_PORT_BASE=B` | B + 10s | B + 10s + 1 | B + 10s + 2 | B + 10s + 3 |

`STAND_PORT_BASE` (1024 to 65000) moves every slot when the fixed ports are taken; every command that
touches a slot must see the same value. `bun run stand stop|start --slot N <service>` stops or starts
one service of a slot, and `bun run stand build --slot N` rebuilds its app.

## Test ports

The tests that start their own chains, relays or servers read these variables for their ports:

| Variable | Tests | Default |
|---|---|---|
| `SDK_TEST_PORT_BASE` | `packages/sdk` (B to B + 3) | 15051, 15052, 16201, 16202 |
| `DELIVER_TEST_PORTS` | `packages/deliver` | 15120-15149 |
| `RELAY_TEST_PORTS` | `infra/relay` | 15100-15119 |
| `HAND_TEST_PORT_BASE` | `apps/web` chain, wallet and outbox tests (B to B + 4) | 16110, 16111, 16112, 25051, 19060 |
| `RAISE_TEST_PORT` | `apps/web` raise flow | a free port |
| `VERCEL_TEST_PORT` | `apps/web/tests/vercel.test.ts` | a free port |
| `TOOLS_TEST_PORT_BASE` | `tools` (from B up) | 18350 |
| `STAND_TEST_SLOTS` | `infra/stand` (two slots it brings up and down) | 6,7 |
| `FIXTURES_TEST_PORT`, `STAND_STATIC_TEST_PORT` | `infra/stand` | 16060, 16001 |
| `SELFTEST_PORT` | `contracts/exit/selftest.sh` | first free of 18945-18954 |

The view server's own tests (`apps/view`) take free ports. The server itself reads `VIEW_PORT`
(default 8080) with the rest of its `VIEW_*` settings ([view server](docs/view.md)).

## Browser suites

The Playwright suites in `tests/e2e` run against a running stand, by hand (CI does not run them).
Chromium only; the first time, `bunx playwright install chromium`.

```sh
STAND_SLOT=3 bunx playwright test tests/e2e/smoke                # one file per screen and flow
STAND_SLOT=3 bunx playwright test tests/e2e/guards               # a11y, fail-closed, hygiene, Russian, the wall clock
STAND_BASE_URL=http://127.0.0.1:18330 bunx playwright test ...   # any served build instead of a slot
```

The site comes from the slot's `stand.json`, so a stand on `STAND_PORT_BASE` needs nothing more.
The default project is `phone` (390×844); `--project desk` adds 1280×800. Each spec file that needs a chain seeds its
own fixtures and names the slot or the URL it was written for in its header. Also there:
`clock.spec.ts`, `drill.spec.ts`, `shots.spec.ts` and `lens-shots.spec.ts` (screenshots), and
`bun tests/e2e/fork/run.ts`, which proves the public test build on a local fork of Base Sepolia.

User scenarios, a Hand's whole life and the first loop among them, are played by the demo engine
in `tests/demo` (its README): several people at once in the browser, the same scenario as a test, a
live show (`bun run show <scenario>`, `--ru` in Russian) and an entry of `tests/demo/CATALOGUE.md`;
`bun tests/demo/atlas.ts` pictures every screen in every seeded state.

## Where to read on

- [docs/app.md](docs/app.md): the web app, `apps/web`.
- [docs/sdk.md](docs/sdk.md): the SDK, `packages/sdk`.
- [docs/links.md](docs/links.md): the link format, and the command-line tool `tools/ahand.ts`.
- [docs/delivery.md](docs/delivery.md): how an answer reaches the asker over Nostr relays.
- [docs/view.md](docs/view.md): the view server for link previews, `apps/view`.
- [docs/public-test-deployment.md](docs/public-test-deployment.md): the build served on Base Sepolia.
- [contracts/exit/README.md](contracts/exit/README.md): getting money out with nothing but `cast`.

## Licences

The contracts (`contracts`), the SDK (`packages/sdk`), the ABI package (`packages/abi`), the delivery
package (`packages/deliver`) and the command-line tools (`tools`) are under the MIT licence. The web
app (`apps/web`), the view server (`apps/view`), the preview card (`packages/card`), the local stand
(`infra/stand`), the test relay (`infra/relay`) and the demo engine (`tests/demo`) are under the GNU
Affero General Public License, version 3 only (AGPL-3.0-only); each of them carries its `LICENSE` file.

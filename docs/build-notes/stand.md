# Build note: `stand` (wave 3)

## What exists

- `infra/stand/stand.ts`: `up [--slot N] [--dev] [--no-face] [--ahead SECONDS]`, `down [--slot N | --all]`, `status [--slot N] [--json]`, `build --slot N`, `stop --slot N <chain|relay|site|dev>`, `start --slot N <relay|face|static|dev>`. The slot defaults to `STAND_SLOT`, else 0.
  - `up`: anvil from `$FOUNDRY_BIN` with `--chain-id 31337 --timestamp <machine + ahead> --block-time 1 --slots-in-an-epoch 1`; `forge script script/Deploy.s.sol --broadcast` under `withForgeLock` with `DEPLOY_OUT=deployments/31337-slot<N>.json` (plus `DEPLOY_COMMIT` and `DEPLOY_DIRTY` from git, as `script/deploy.sh` does); reads that file with `parseDeployment`, checks that Core sits at `create2(factory, salt, initcodeHash)` and that every contract the file names has code; writes `.run/<N>/config.json` and `.run/<N>/stand.json`; starts the relay; then builds and serves (face, else `static.ts`), or with `--dev` starts Vite on the dev port.
  - Every service runs detached in its own process group, with one entry in `pids.json` (`pid`, `port`, `program`, `log`, `startedAt`) and one log in `logs/<service>.log` (plus `logs/deploy.log` and `logs/build.log`). Stopping kills the group, waits for the process to end and for the port to be free.
- `infra/stand/static.ts`: the plain file server. Existing files as they are; any other path gets `index.html`; the CSP of ARCHITECTURE §11 (with the configuration's RPC and relay in `connect-src`), `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff` on every answer. It logs method, path without query, and status.
- `infra/stand/time.ts --slot N <seconds>` (or `--stand FILE`): `evm_increaseTime` and `evm_mine`; prints the latest block before and after. It refuses 0, negative numbers and any chain but 31337.
- `infra/stand/tests/stand.test.ts`: 14 unit tests (arguments, anvil's flags, chain-id refusal, the configuration accepted by the app's own `parseConfig`, the stand.json fields, the CSP, the path rule including traversal, and the static server running on port 16001), and one test that starts slots 8 and 9 at the same moment and takes them down again.

## Choices the design left open

- **The key.** The stand passes no key. `Deploy.s.sol` itself derives anvil's public account 0 from anvil's public mnemonic when it runs on 31337 with no sender. So no key ever appears on a command line, where `ps` would show it. Before deploying, the stand asks the RPC for its chain id and refuses anything but 31337. It refuses again if the deployment file names any other chain.
- **A stale deployment file is deleted before deploying**, and again on `down`, so a stand can never read a file that an earlier chain left. `stand.json` records which file it read (`deploymentFile`) and that file's sha256 (`deploymentSha256`). The two-slot test checks both.
- **A missing path with a file extension gets a 404, not the index** (`/assets/gone.js`). App paths (`/31337/1`, `/31337/<core>/1`, `/my`) have no extension, so they still get `index.html`. A browser therefore never receives HTML in place of a script; `nosniff` is there for the same reason.
- **stand.json has more than §14's fields**: `ports`, `server` (`face`, `static`, or null in dev mode), `serverNote` (why that server was chosen, e.g. "face is off: --no-face" or why face failed its health check), `deploymentFile`, `deploymentSha256` and `deployment` (the facts). §14's eleven fields come first, unchanged.
- **build.json**: `{hash, algorithm, command, commit, dirty, files}`. `hash` is `hashDir(dist).hash`. `command` is the coreutils line that recomputes it from inside the folder. `dirty` is true when `apps/hand` or `packages` differ from the commit, untracked files included.
- **The configuration's `site`.** `up` writes the site port's address, or with `--dev` the dev server's. `start dev` switches it to the dev address before Vite starts. `build` switches it back to the site address, except on a dev stand: Vite watches the file and would reload with the wrong address. `start face` and `start static` set `stand.json` to `mode: built` with the site port's address. `start dev` sets `mode: dev`.
- **Face.** It gets `FACE_PORT`, `FACE_DIST`, `FACE_RPC`, `FACE_CHAIN` (the chain id), `FACE_CORES`, `FACE_CANONICAL` and `FACE_SITE`. It also gets `FACE_RELAYS`, which §14 does not name: face's own `config.ts` reads it to put the relay into its CSP. Without it, the CSP would block delivery on a face-served stand. If face fails `/healthz` within 5 s, it is stopped and `static.ts` serves instead; `status` gives the reason. `start face` does not fall back: it fails with that reason.
- **`down` without `--slot`** acts on `STAND_SLOT`, else 0, the same default as `up`. `down --all` covers every slot that has a `pids.json` or `stand.json`. `down` removes `pids.json`, `stand.json` and the deployment file. It keeps `config.json`, `dist/`, `vite-cache/` and `logs/` (a warm cache makes the next `up --dev` faster). `status` without `--slot` lists every slot that has files.
- **`up` refuses a slot that is in use** (a live process in `pids.json`, or any of its four ports open) and names the cause. If any step fails, it stops what it started and removes the slot's files. It never kills a process it did not start: when a port is held by someone else, `stop` says so and leaves it.
- **Vite** runs as `apps/hand/node_modules/.bin/vite --port <dev> --strictPort --host 127.0.0.1`, which under its shebang means node, the same program `bun run build` uses.
- **The two-slot test is skipped**, with a line saying so, when any port of slots 8 or 9 is in use. That way `bun run test:unit` cannot collide with a gate's stand. `STAND_TEST_SLOTS=a,b` chooses other slots. When the slots are free, the test brings up two full built stands, which takes about 6 seconds.

## What I ran, with results (all live, on this machine)

| Check | Result |
|---|---|
| `bun infra/stand/stand.ts up --slot 9 --no-face` | chain, deploy, relay, build, site in 3.8 s; status printed site, rpc, relay and core, the tokens, the forwarder and the account factory, plus four service lines and the chain's time |
| `cast block latest/safe/finalized` on 18635; `date +%s` | blocks 12/11/10; timestamp 1798598620 against machine 1795142620: 3 456 000 s = 40.00 days ahead |
| `curl -sI /31337/1` on 18390 | 200, `Content-Security-Policy` as in §11 with `http://127.0.0.1:18635 ws://127.0.0.1:18637`, `Referrer-Policy: no-referrer`; body byte-identical to `dist/index.html` |
| `/exit.html`, `/build.json`, `/gallery.html`, `/`; `/assets/nope.js` | 200 each; 404 |
| build.json hash vs `hashDir(dist)` vs the coreutils command | all three `249db5a9…9f26` |
| `stop --slot 9 relay` / `start --slot 9 relay` | 18637 free, then open |
| `stop --slot 9 site` / `start --slot 9 static` | 18390 free, then open; `/` and `/build.json` byte-identical before and after |
| `bun infra/stand/time.ts --slot 9 86400` | block 20 at 1798598628 → block 21 at 1798685028 (+86 400 s); status then said 41.00 days ahead |
| `time.ts … 0`, `--stand /dev/null` | refused, exit 1 |
| `down --slot 9` | each service stopped by pid, ports 18635/18637/18390/18391 free, `ps` finds none of the pids, deployment file gone |
| `up --slot 8 --dev` | Vite on 18381: `/`, `/gallery.html`, `/exit.html`, `/31337/1` → 200; `stand.json` `mode: dev`, `site: http://127.0.0.1:18381`; cache in `.run/8/vite-cache` |
| `up --slot 9` (face present, written by the face package this wave) | face answered `/healthz`; after `FACE_RELAYS` was added, face's CSP also lists the relay |
| Playwright Chromium, 390×844 touch, `en-GB` and `ru-RU`: `/`, `/31337/1`, `/exit.html`, `/core` on slot 9 (face) and slot 8 (Vite) | all 200, no console errors or warnings, no horizontal page scroll; screenshots in `knowledge/…/2026-11-20-experiment/shots/build/stand/` |
| `bun test infra/stand/tests/stand.test.ts` (twice) | 15 pass, 0 fail, 128 expect calls, ~6–7 s; slots 8 and 9 were brought up in parallel and both came up |
| `bunx tsc --noEmit -p infra/stand` (5.9.3) | 0 errors |
| a stranger on 18637, then `up --slot 9` | refused: "slot 9 is in use: port 18637 (relay)"; `down` left the stranger alone |
| `FOUNDRY_BIN=/nonexistent … up --slot 9` | failed with "anvil not found at /nonexistent/anvil", cleaned up, no stand left |
| `sha256sum contracts/src/AHandCore.sol` | `118f4d37…d738` |

Nothing of mine is left running: slots 8 and 9 are down, their ports are free, and the test server on 16001 stopped with its test.

## Not verified

- A failure in the middle of `up` after the chain has started (a failed deploy or build). The cleanup path is the same `down` that the runs above used, but I did not force those two failures.
- `down --all`. It was not run, because it would also stop slots other agents are using.
- Face's behaviour beyond `/healthz` and its headers. Face belongs to another package.
- The screens are still stubs from earlier waves; the screenshots prove only that the stand serves them. In dev at 390 px, `exit.html` lets the Core address run past its text column. That page is not this package's (wave 4, `exit-page`).

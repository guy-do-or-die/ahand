# Build note: `ground` (wave 1)

Written 2026-11-20 by the `ground` package agent. Everything below was run on this machine unless it says otherwise.

## What exists now

- **Root `package.json`**: explicit workspaces (`packages/sdk`, `packages/abi`, `packages/deliver`, `apps/hand`, `apps/face`, `infra/stand`, `infra/relay`, `tools`); the root's own devDependencies from ARCHITECTURE §2; `overrides` for `typescript` 5.9.3 and `viem` 2.52.0 only (TanStack overrides and `patchedDependencies` removed); scripts `check:core`, `test:contracts`, `test:vectors`, `test:sdk`, `test:unit`, `typecheck`, `build`, `stand`, `e2e`, `check`. Foundry is called only as `${FOUNDRY_BIN:-$HOME/.foundry/bin}/forge`.
- **Every manifest** exactly as §2's table, exact versions. One `bun install` from emptied `node_modules`; `bun.lock` rewritten (the only lockfile).
- **Export conditions** `types`, `bun`, `source` → `src/index.ts` (and `import` → `dist`) for `@ahand/sdk`, `@ahand/abi`, `@ahand/deliver`; `@ahand/sdk/testing` → `packages/sdk/tests/helpers/index.ts`.
- **SDK**: `payee.ts` real (`payeeProblem` plus `payeeRefused`); ten stubs (`chain tx errors describe keys wallet resign money proof steps`) with §4's signatures and the types they need (`HandView`, `HandLog`, `Receipt`, `CoreErrorName`, `CoreRefusal`, `Call`, `AccountSetup`, `RaiseTerms`, `SeenGive`, `DroppedHolder`, `PriceSnapshot`, `HandRecord`, `Check`, `StepResult`, …); every body throws `"<name>: not built"`. `UntrustedCore` (a class) and `EXPIRY_MARGIN = 600` are real. `prices.json` from the 2026-11-10 fee study. Export lines added to `index.ts`.
- **Chain helper** `packages/sdk/tests/helpers/anvil.ts` (`startChain()`, `standOf`, `configOf`, `deploymentOf`, `freePort`, `foundryBin`): anvil on a free port (or `--port`/`ANVIL_PORT`), clock 40 days ahead, Core through `0x4e59…956C` with `keccak256("aHand.core/1")`, MockUSD and BlacklistToken minted (1 000 000 test dollars each) to accounts 1–5, KeyAccountFactory and Forwarder when their artifacts exist. Modes `--selftest`, `--serve` (block time 1, one slot per epoch), `--write-stand FILE`, `--write-config FILE`. Runs under Bun and under Node/vitest (no Bun-only API).
- **`apps/hand` skeleton**: `index.html`, `gallery.html`, `exit.html` (+ placeholder `exit/main.ts`); `vite.config.ts`, `vite.exit.config.ts`, shared `vite.shared.ts` (AHAND_CONFIG → `virtual:ahand-config`, `resolve.conditions` with `source`, AHAND_OUT_DIR, AHAND_VITE_CACHE); scripts `build` (main then exit) and `build:exit`; `src/config/{schema,load,index}.ts` + `config.example.json`; design layer copied from `apps/web`; i18n mechanism; 17 screen stubs; empty `src/wallet` and `src/chain`; a wave-1 `main.tsx`/`app.tsx` frame (lockup, EN·RU switch, ribbon, landing stub, footer line).
- **`infra/stand/ports.ts`** (slot ports and paths) and **`foundry.ts`** (binaries by path, `withForgeLock`, `forge`, `cast`, `runFoundry`).
- **`playwright.config.ts`** at the root, **`tests/e2e/lib/{stand,rpc,accounts}.ts`**, **`tests/e2e/smoke/ground.spec.ts`**, `tests/e2e/tsconfig.json`.
- **`.gitignore`**: `contracts/deployments/31337*.json`, `tests/e2e/test-results/`, `tests/e2e/playwright-report/`, `!.github/`.

## The five facts, proven

| Fact | How it was run | Result |
|---|---|---|
| `qrcode` 1.5.4 takes a byte segment plus a numeric segment | `QRCode.create([{data: bytes, mode:"byte"}, {data: 1 030 digits, mode:"numeric"}], {errorCorrectionLevel:"L"})` in `apps/hand` under Bun | segments `Byte:23 + Numeric:1030`, version 14; `toString(..., {type:"svg"})` also works |
| `@resvg/resvg-js` 2.6.2 loads under Bun | `new Resvg(svg).render().asPng()` in `apps/face` under Bun 1.4.4 | a 220-byte PNG (magic `PNG`); native binding `@resvg/resvg-js-linux-x64-gnu` 2.6.2 |
| `compileMessage` from `@lingui/message-utils` works in a Vite 8 build | production `vite build` (8.3.8) of `apps/hand`, served by `vite preview`, opened in Chromium | the footer renders `t("common.footer", {core})` with the value interpolated (`CORE 0X5137…CBB0`), not `{core}`; EN and RU both |
| wagmi 3.7.11 exports `injected` without another package | `import { injected, createConfig } from "wagmi"` and `createConfig({connectors:[injected()]})` | works; `@wagmi/connectors` 8.2.4 comes in as wagmi's own dependency, so nothing was added |
| Chromium 1255 launches under Playwright 1.65.1 | `STAND_BASE_URL=about:blank bunx playwright test tests/e2e/smoke/ground.spec.ts` | 1 passed; `playwright-core`'s `browsers.json` names chromium revision 1255 (Chrome for Testing 159.0.8154.6) |

## Done checks, as run

- `bun install` exit 0; `bun.lock` is the only lockfile; `ls node_modules/.bun | grep -c '^viem@'` → 1.
- From the root: `bunx playwright --version` → 1.65.1; `bunx tsc --version` → 5.9.3.
- `cd packages/sdk && bunx vitest run` → 9 files, **268 passed**, 0 failed (run twice, before and after the helper).
- `bunx tsc --noEmit -p apps/hand` → 0 errors. `bun run --cwd apps/hand build` writes `dist/index.html`, `dist/gallery.html`, `dist/exit.html`; `build:exit` alone leaves `dist/index.html` in place. `exit.html` has no `src="http`/`href="http`.
- `bun -e "import('@ahand/sdk')…"` → `function function function`.
- `ANVIL_PORT=14003 bun packages/sdk/tests/helpers/anvil.ts --selftest` → Core with 10 733 bytes of code at `0x5137D66BDD57872362b1ed470817B54c2324CbB0`, CREATE2 derivation matches, forwarder and accountFactory not null, chain ahead by 3 456 000 s (40.00 days), exit 0. (`ANVIL_PORT` only because this agent was limited to ports 14000–14049; without it the system picks a free port.)
- `STAND_BASE_URL=about:blank bunx playwright test tests/e2e/smoke/ground.spec.ts` → passes, writes `tests/e2e/test-results/slot-x/`.
- `git check-ignore`: `tests/e2e/test-results/x` and `contracts/deployments/31337-slot0.json` ignored; `.github/workflows/check.yml` not ignored.
- `grep -n "forge \|anvil \|cast " package.json` → two lines, both `${FOUNDRY_BIN:-$HOME/.foundry/bin}/forge`.
- `sha256sum contracts/src/AHandCore.sol` → `118f4d37…5713d738`; `bun run check:core` → OK.
- Live, on a `--serve` helper chain (port 14002): `--write-stand` and `--write-config` files written; the config passes the app's `parseConfig`; `tests/e2e/lib/rpc.ts` read code, `handsCount`, balances (1 000 000 000 000 units on accounts 1 and 5), `pending`; blocks advance once a second; `safe` and `finalized` trail `latest` by 1 and 2; `jump(86400)` moved the clock a day; `pauseBlocks` made 0 blocks in 2.2 s and `resumeBlocks` restarted them.
- `withForgeLock`: three concurrent holders ran strictly one after another; a lock folder 200 s old was taken over; a fresh one made a waiter give up with a plain message.
- Screenshots (EN, RU; 390 px and 1280 px; light and dark; gallery; exit) in `knowledge/plan/research/2026-11-20-experiment/shots/build/ground/`. Looked at: no horizontal scroll, no console errors. One defect found and fixed: the amber ribbon's text was paper-coloured in dark mode (`.ah-meta` overrode the utility); it now uses `--on-amber`.
- Every chain and server started was stopped by its own pid; no port in 14000–14049 is left open.

## Choices the design did not make

- **`clsx`** is not in §2's table, but the ported components import it. Instead of adding a dependency, `src/lib/clsx.ts` (20 lines, the forms used) is imported; the only change to each copied component is that one import line.
- **Not copied**: `QrCode.tsx` (needs `uqr`, not in the stack; `Qr` is built new on `qrcode` by app-design), `scripts/generate-mark.ts` (needs satori/resvg, which `apps/hand` does not depend on; the frozen SVGs it produced are copied to `public/`). `Identity.tsx` was copied with its hook `src/hooks/useEnsIdentity.ts` (wagmi ENS reads against mainnet; app-design decides whether it stays, since tests may contact only 127.0.0.1).
- **Copied verbatim** into `apps/hand/src`: `design/{tokens.css,components.css,tokens.ts}`, `design/index.css` (two import paths changed), `ui/{SwipeButton,QuietButton,PotBar,ChipRow,ChainRail,ReceiptTable,MetaLine,Emoji,Logo,Sheet,ThemeToggle,Identity}.tsx`, `lib/{markSpec,format,ens}.ts`, `public/*.svg`. Onest is installed but not yet in the font stack (app-design's job), so Cyrillic headlines currently fall back to the system font.
- **Catalogue shape**: each `en.ts` default-exports a flat `{ "screen.key": "…" }`; `ru.ts` is typed `Record<keyof typeof en, string>`, so a missing Russian key fails the typecheck. The i18n loader collects `screens/*/{en,ru}.ts` by `import.meta.glob`, compiles with `compileMessage`, and follows `navigator.language`; app-shell owns it from wave 2.
- **Helper deployment** sends all transactions at once with explicit nonces and waits for all receipts, so `--serve` (one block a second) is up in about two blocks instead of fifteen. `--write-*` without `--serve` implies `--serve` (a file naming a dead chain is useless). The helper's stand file has `mode: "helper"`, `slot`, `site` and `relay` null, plus `pid` and the full `deployment`.
- **Token kinds**: `"usd"` (MockUSD) and `"blacklist"` (BlacklistToken). Both report symbol `mUSD` (BlacklistToken inherits it); labels "Test dollars" and "Test dollars that can block".
- **Config defaults** (D-26): `minClaimBps` 7000, `payoutGasK` 250, `expiryDays` 30. Config `site` must be http(s), relays ws(s); `cores.canonical` must be one of `cores.trusted`.
- **`prices.json`**: date 2026-11-10, ETH $2 400, Base 0.006 gwei (live 2026-11-09 23:52 UTC, base fee plus tip), Ethereum 0.3 gwei (the study's 2026 average, not its "now" of 0.05). sdk-words owns it from wave 2.
- **Playwright**: `phone` is the default project; `desk` exists only when the command line names it (`--project desk`); the decision is passed to workers through `AHAND_PW_DESK`. `outputDir` is `slot-<STAND_SLOT>`, else `slot-x` when only `STAND_BASE_URL` is set, else `slot-0`.
- **`tests/e2e/lib/stand.ts`** also honours `STAND_FILE` (a helper chain's `--write-stand` file) in `readStand` and `seed`, for waves that run before the stand exists. `rpc.ts` reads ABIs from `packages/abi/abis/<name>.json`, falling back to `contracts/out`.
- **Dev-wallet test ids** assumed by `accounts.ts`: `dev-account-<n>`, `dev-account-not-set-up`, and `connect-wallet` (see "needs").
- **`withForgeLock`** keeps the lock fresh with a heartbeat every 30 s, so a long compile is not taken for a dead holder; stale = no heartbeat for 120 s.
- **`test:unit`** runs each package's `bun test --pass-with-no-tests`, so it passes before later waves add tests. `packages/sdk` keeps its own `test` (vitest).

## Not done or not verified

- `bun run typecheck` stops at `apps/face` with TS18003 ("no inputs") until face has `src/` (wave 3); `tools` will do the same until wave 2. Each project with sources passes alone (`packages/sdk`, `packages/abi`, `packages/deliver`, `apps/hand`, `infra/stand`, `tests/e2e`).
- `infra/relay` has no `tsconfig.json` in my ownership, so it is not in `typecheck`.
- `bun run check`, `test:contracts` and `test:vectors` were not run by me (forge is contracts-kit's in this wave).
- No CSP meta tag in `index.html` yet (harden-app / app-shell).
- `seed()` in `tests/e2e/lib/stand.ts` calls `infra/stand/seed.ts`, which arrives in wave 3; not run.

## Versions installed (exact)

Root: typescript 5.9.3, viem 2.52.0, @playwright/test 1.65.1 (playwright-core 1.65.1), @axe-core/playwright 4.14.0, @types/bun 1.4.4.
SDK: zod 3.25.76, vitest 1.6.1 (brings vite 5.4.21 for itself).
Deliver, relay: nostr-tools 2.26.1.
App: react 19.3.1, react-dom 19.3.1, wagmi 3.7.11 (@wagmi/core 3.6.9, @wagmi/connectors 8.2.4), @tanstack/react-query 5.108.1, @lingui/core 6.12.0, @lingui/message-utils 6.12.0, qrcode 1.5.4, @fontsource-variable/schibsted-grotesk 5.3.0, @fontsource-variable/onest 5.3.1, @fontsource/ibm-plex-mono 5.3.0; dev: vite 8.3.8, @vitejs/plugin-react 6.3.0, tailwindcss 4.3.5, @tailwindcss/vite 4.3.5, vite-plugin-singlefile 2.3.4, rollup 4.68.7, @types/react 19.3.0, @types/react-dom 19.3.0, @types/qrcode 1.5.6, happy-dom 21.0.4, @happy-dom/global-registrator 21.0.4, fake-indexeddb 6.2.8.
Face: satori 0.63.2, @resvg/resvg-js 2.6.2.
Total: 253 packages in `node_modules/.bun`, one viem.

## Review round 1: moving the stand's ports (`STAND_PORT_BASE`)

Finding: every slot's four ports were fixed (`18545/18547/18300/18301 + 10 × slot`) and read no environment, so a reviewer whose ports were taken had to patch `ports.ts`.

- **Fix** (`infra/stand/ports.ts`): optional `STAND_PORT_BASE`, a whole number from 1024 to 65000 in plain digits (no sign, exponent, hex, spaces or leading zero; anything else is refused with a message naming the variable). Unset or empty: the fixed layout, unchanged. Set to `B`: slot `s` takes `B + 10s` (chain), `+1` (relay), `+2` (site), `+3` (dev), so all ten slots fit in `B … B + 93`. `portsOf(slot, env = process.env)` is still the only place that computes ports; `stand.ts` and `drill.ts` call it unchanged, and `playwright.config.ts` reads the site from `stand.json`, so it follows.
- **Why a compact layout instead of the fixed offsets moved by a base**: the fixed layout spreads one slot's ports over 246 numbers (18300 … 18545); someone given a narrow free range (here 50 ports) could not fit it. With the variable, five slots fit in 50 ports.
- **Rule**: every command on a slot (`up`, `status`, `stop`, `down`, drill) must see the same `STAND_PORT_BASE`. The slot's folder (`infra/stand/.run/<s>`) does not move with the ports; pick a slot no one else is using.
- **Test**: `infra/stand/tests/ports.test.ts` (7 tests): the fixed layout unchanged; the compact layout at 25300, 65000 and 1024; no two ports of any two slots meet; `process.env` is read when no environment is passed; twelve bad values refused; a slot outside 0–9 still refused. Failed before the fix (`portBaseFromEnv` not exported), 7 pass after; `tsc --noEmit -p infra/stand` clean.
- **Live**: the fixed ports of slot 4 (18585, 18587, 18340) were held by another run at the time, exactly the reviewer's situation. `STAND_PORT_BASE=25300 bun infra/stand/stand.ts up --slot 4` brought up anvil on 25340, the relay on 25341 and face on 25342 (`/healthz` ok, chain id 31337, Core code present at `0x65ac…2309`); `STAND_SLOT=4 bunx playwright test tests/e2e/smoke/ground.spec.ts tests/e2e/smoke/about.spec.ts` → 14 passed; screenshot `knowledge/plan/research/2026-11-20-experiment/shots/round-1/fix-ground/stand-port-base-25300-slot4-landing.png`; `down` stopped all three pids and freed 25340–25342.
- **Whole `infra/stand` suite with the variable set** (`STAND_PORT_BASE=25300 STAND_TEST_SLOTS=2,3 STAND_STATIC_TEST_PORT=25345 FIXTURES_TEST_PORT=25347 bun test`): 35 pass, 2 fail. The two failures are in `tests/stand.test.ts` ("configuration and stand.json"), which takes `portsOf(9)` from the environment but compares with the fixed numbers 18635/18637; with `portsOf(9, {})` on that line (tried on a temporary copy) they pass. That file is not this package's; the change is requested. The two-stand test ran on the moved ports (slots 2 and 3, 25320–25333) and passed. Without the variable, the "configuration and stand.json" tests pass (4 pass); the whole suite was not rerun without it, since its live tests would then need ports outside this fixer's range (25300–25349).

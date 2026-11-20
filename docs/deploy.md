# Deploy

```sh
$ cast keccak "aHand.core/1"
0x4f0ff848a233427c84043ed87224bdfcb9f141e864d27833ac5d1344e3a3347d
$ cast compute-address 0x4e59b44847b379578588920cA78FbF26c0B4956C \
    --salt 0x4f0ff848a233427c84043ed87224bdfcb9f141e864d27833ac5d1344e3a3347d \
    --init-code-hash 0x9f4031e9df87b432822254b2e546d1fc8b88a6bb8798522e7b47d1ab5a08de65
0x65ac707E2AE7392583de5d6192C619F1D8862309
```

Code found at that address can only have come from that initcode. So "this is the Core built from commit X" is proven by one derivation, not by trusting a list the same site serves (D-10).

**Nothing has been deployed to any public network.** Only local anvil chains (31337) were used. Deploying to Base, and declaring a canonical Core for real networks, is the owner's act.

## CREATE2

`contracts/script/Deploy.s.sol` deploys `new AHandCore{salt: SALT}()` through the deterministic deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`, with `SALT = keccak256("aHand.core/1")` (D-9). Core's constructor takes no arguments, so the initcode, and with it the address, is the same on every chain where that deployer exists. The script is idempotent: a second run on the same chain keeps Core.

On chain 31337 only, the same script also deploys the test helpers: `MockUSD` and `BlacklistToken` (1 000 000 each minted to anvil accounts 1–5), `KeyAccountFactory` (counterfactual accounts for the "not set up yet" path) and `Forwarder` (Multicall3's `aggregate3` signature). On any other chain it deploys Core only (tested in `contracts/test/Deploy.t.sol`). The stand refuses any chain id but 31337 before deploying.

```sh
bash contracts/script/deploy.sh <rpc> [forge args]      # fills commit and dirty from git, deploys, then checks
bash contracts/script/check-deployment.sh <file> <rpc>  # every field against the chain and this clone
```

`check-deployment.sh contracts/deployments/31337-slot3.json http://127.0.0.1:18575` printed `deployment … holds on chain 31337` on 2026-11-20. `deploy.sh` was not run by this package (the stand runs `forge script` itself, under its lock).

## The deployment JSON

Written with `vm.writeJson` to `DEPLOY_OUT`, default `contracts/deployments/<chainId>.json`; Foundry may write only under `./deployments` (`fs_permissions` in `contracts/foundry.toml`). Stand slot N writes `31337-slot<N>.json`; files `31337*.json` are not committed. Parsed and validated by `parseDeployment` in `packages/abi/src/deployment.ts`. The fields, one line each, are in `contracts/deployments/README.md`:

`chainId`, `core`, `factory`, `salt`, `initcodeHash`, `runtimeHash` (information only: OpenZeppelin's EIP-712 fills seven immutables, so it differs per chain), `deployBlock`, `tokens` (`[{address, symbol, decimals, kind}]`, kind `usd` or `blacklist`, on 31337 only), `forwarder` and `accountFactory` (null except on 31337), `commit`, `dirty`, `solc` (0.8.35), `optimizerRuns` (200), `evmVersion` (prague), `oz` (5.6.1).

## Reproducing the initcode hash

```sh
cd contracts && "${FOUNDRY_BIN:-$HOME/.foundry/bin}/forge" build && "${FOUNDRY_BIN:-$HOME/.foundry/bin}/cast" keccak "$(jq -r .bytecode.object out/AHandCore.sol/AHandCore.json)"
0x9f4031e9df87b432822254b2e546d1fc8b88a6bb8798522e7b47d1ab5a08de65
```

This is the line `bun tools/ahand.ts core-check` and the `/core` screen print. It needs `jq`. The hash does not depend on the folder the clone sits in: `contracts/foundry.toml` sets `auto_detect_remappings = false` with two relative remappings, because Foundry otherwise wrote the clone's absolute path into Core's metadata and so into the initcode (found by the tools package, fixed in wave 2; `docs/build-notes/tools-cli.md`). The compiler settings that the hash depends on are those in `foundry.toml`: solc 0.8.35, optimizer 200 runs, `evm_version` prague, OpenZeppelin 5.6.1 under `contracts/lib`.

To check a running chain against this clone in one command:

```sh
bun tools/ahand.ts core-check --rpc <rpc> [--deployment <file>]
bun tools/ahand.ts core-check --rpc http://127.0.0.1:18575 --deployment contracts/deployments/31337-slot3.json   # stand slot 3
```

On a stand the deployment file is `contracts/deployments/31337-slot<N>.json`, not `31337.json`. Without `--deployment` the tool looks, in this order, for the slot named by `STAND_SLOT`, then `31337.json`, then the one stand slot file present, and refuses to guess when there are several; with none at all `core-check` checks the address this tree derives and says so. It recomputes the initcode hash from `contracts/out` (and checks that `out` was compiled from today's `AHandCore.sol`), derives the CREATE2 address, compares with the deployment file, reads the code, `eip712Domain()` and `MAX_EXPIRY_PERIOD`. On slot 3 every line was `ok`.

## The app's own build

The stand writes `build.json` beside the built app: the sha256 of every file, and the coreutils command that recomputes it from inside the folder (`tools/manifest.ts`, `hashDir`). `/core` fetches it at that moment and labels it "served by this site". A manifest ties a deployment, the commit, the compiler settings and an app hash together:

```sh
bun tools/ahand.ts manifest 31337 --deployment contracts/deployments/31337-slot3.json --app infra/stand/.run/3/dist
```

It is written next to the deployment file and named after it (`31337-slot3.manifest.json`; `--out` puts it elsewhere). The same rule as `core-check` finds the deployment file when `--deployment` is left out; when none is found it stops with exit 1 and names the files it looked for.

## In front of face

Face (`apps/face`) listens on `127.0.0.1` unless `FACE_HOST` says otherwise, and is meant to stand behind a reverse proxy or CDN that ends TLS. It holds no key; what the proxy should know about it:

| Path | `Cache-Control` face sends | What a cache may do |
|---|---|---|
| `/assets/*` (names carry a content hash) | `public, max-age=31536000, immutable` | keep for a year |
| `/og/…png`, a Hand's card | `public, max-age=300`, `Vary: Accept-Language` | keep five minutes: the card follows the chain (state, a reward that grew) |
| `/og/…png` answered by the generic card because the renderers were full | `no-store` | keep nothing: it is true of every Hand, but not this one's card |
| `/`, a Hand's address, `/index.html`, `exit.html`, `build.json`, other built files | `no-cache` | revalidate every time. Face sends no `ETag` or `Last-Modified`, so a revalidation is a full fetch |
| `/healthz`, errors, `503` | `no-store` | keep nothing |

- **The language.** Face answers in English or Russian, from `?l=` or `Accept-Language`, and a card or page carries `Vary: Accept-Language`. A cache that keys on the whole header keeps one copy per browser's header; it may instead reduce the header to `en` or `ru` before the cache, the only two face tells apart.
- **Compression.** Face compresses text itself (`apps/face/src/compress.ts`): brotli, else gzip, by `Accept-Encoding`, for HTML, JS, CSS, JSON, SVG and other text of 1 KiB or more; PNG and fonts go as they are. The built files are compressed once, at the strongest setting, and held in memory; a page face writes per request (a Hand's tags) is compressed at a fast setting. Every answer that could be compressed says `Vary: Accept-Encoding`. A proxy should pass `Accept-Encoding` through and not compress again; the folder on disk stays exactly as built, so `build.json` and its hashes still match what is served.
- **The cap on cards.** A card costs a few hundred milliseconds of CPU, so cards are drawn by two worker threads with a queue of 16 (`apps/face/src/render-pool.ts`). Beyond that a card request is answered at once with the generic card (`no-store`), or, if even that is not drawn yet, with `503` and `Retry-After: 5`. Nothing else waits on the renderers: pages, files and `/healthz` stay fast during a burst. Drawn cards are kept in memory (2 048 cards or 32 MiB, least recently used out first), and one reading of a Hand from the chain answers for the same address for five seconds (1 024 addresses).
- **What face does not do.** It has no rate limit per client and no connection limit of its own; it accepts only `GET` and `HEAD` (`405` otherwise) and reads no request body. Every uncached Hand address costs chain reads at `FACE_RPC`, so the proxy in front should limit requests per client, and the RPC's own quota is the one to watch.

## Advisories in dependencies

`bun audit` on 2026-11-20 reports 20 advisories (3 critical, 7 high, 9 moderate, 1 low) in ten packages. None of them is reachable in what ships: the built app (a folder of static files), `exit.html`, face, the relay, the stand and the CLI. Reachability below was judged by reading imports and the built bundle, not by an exploit.

| Package (version) | Advisories | Pulled in by | Why it is not reachable in what ships | What lifts it |
|---|---|---|---|---|
| `vitest` (1.6.1) | critical: the Vitest UI server reads and runs any file | `packages/sdk` tests | test runner only; the UI server listens only with `vitest --ui`, which nothing here runs (`@vitest/ui` is not installed) | the vitest bump D-7 deferred |
| `tinypool` (0.8.4) | 2 critical: prototype pollution to code execution through worker options | vitest | test runner only; its options are vitest's own, never input | the vitest bump |
| `vite` (5.4.21) | 7 (launch-editor on Windows, `server.fs` bypasses, `.map` traversal, custom middleware) | vitest's `vite-node` | the 5.x copy runs only inside the SDK's tests and serves nothing. The app builds with vite 8.3.8, which these ranges (≤ 6.4.3) do not include; its dev server (`stand.ts up --dev`) listens on `127.0.0.1` | the vitest bump |
| `esbuild` (0.21.5) | moderate: any site can read esbuild's dev server | vite 5 | esbuild's own `serve` is never started; vite 5 uses it to transform test files | the vitest bump |
| `postcss` (8.5.16) | high + moderate: a `sourceMappingURL` reads other `.map` files | vite 5 | runs at build or test time on this repository's own CSS only; the app's build uses postcss 8.5.33 | a lockfile refresh within vite 5's range (`^8.4.43`), or the vitest bump |
| `nanoid` (3.3.15) | 2 high: a loop on a negative or zero size | postcss 8.5.16 | called by postcss with a fixed size; never with input | a lockfile refresh within postcss's range (`^3.3.12`), or the vitest bump |
| `source-map-js` (1.2.1) | high: denial of service through section offsets | postcss 8.5.16, tailwind's build | build time, on this repository's own files | a lockfile refresh within the ranges (`^1.2.1`) |
| `ws` (8.20.1) | high: memory exhaustion from tiny fragments | viem 2.52.0 (exact pin) through `isows` | viem loads `isows` only inside its WebSocket transport, and every client here uses `http` (`apps/face/src/preview.ts`, `apps/hand/src/chain/clients.ts`, the stand, the CLI). The built app holds no copy of `ws`; it talks to relays with the browser's own `WebSocket`. happy-dom's copy is 8.21.0, outside the range | the viem bump D-7 deferred (a viem that pins ws ≥ 8.21.0) |
| `zod` (3.25.76) | high: memory exhaustion on oversized constrained collections | `packages/sdk` (`proof.ts`), and abitype inside viem | the SDK validates one thing with zod: a proof bundle read by `bun tools/ahand.ts verify --bundle FILE`, a file the person running it chose, already parsed in full by `JSON.parse`; the schema has no size-constrained collection. The app never reads a bundle; abitype's zod helpers are not imported | the zod 4 bump D-7 deferred |
| `fflate` (0.7.3, 0.7.4) | moderate: `unzipSync` loops on a malformed ZIP64 | satori's `opentype.js` in face | opentype.js calls only `inflateSync` (for WOFF), never `unzipSync`, and only on face's own bundled fonts (`apps/face/src/fonts/`), never on a request | a satori release that leaves its exact pin `0.7.3` for ≥ 0.7.5 |

A lockfile refresh (`bun audit fix`) was not run: the lockfile is shared tonight and its changes belong in the same gated commit. Rules until those bumps land: **never run the vitest UI** (`vitest --ui`) or any of these dev servers on an address other than `127.0.0.1`; ship only the built folder, face and the relay, never `node_modules` behind a public server. The bumps themselves are one commit with the whole suite as the gate (D-7); none was tried tonight.

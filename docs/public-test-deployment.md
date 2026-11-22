# Public test deployment on Base Sepolia

The branch `next` is served as a static site, with one Vercel Function for link previews, at `https://next.ahand.in`: the repository's Vercel project builds every pushed branch, and the `branch-domains` workflow registers `<branch>.ahand.in` for it. The site is the built `apps/web` against Base Sepolia (chain 84532), with the configuration [`apps/web/src/config/base-sepolia.json`](../apps/web/src/config/base-sepolia.json): RPC `https://sepolia.base.org`, Core `0x65ac707E2AE7392583de5d6192C619F1D8862309` (the CREATE2 address, the same on every chain that has the deterministic deployer), Circle's test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6 decimals), Multicall3 as the forwarder, and the five relays `@ahand/deliver` recommends (`RECOMMENDED_RELAYS` in `packages/deliver/src/relays.ts`: `wss://relay.primal.net`, `wss://nos.lol`, `wss://relay.nos.social`, `wss://relay.ditto.pub`, `wss://relay.coinos.io`; a test holds the configuration to that list, and the CSP's `connect-src` is written from it). `chain.local` is false: the build has no dev wallet and no gallery; a visitor logs in through Privy's one window, with email, Google, Apple, X, Farcaster, a passkey or a crypto wallet (`privy.appId` `clt69jwp204btq1o3q72cupji`, see [app.md](app.md#logging-in-through-privy)).

Four optional fields describe a public test site (a stand's configuration has none of them and reads as before):

| Field | Value here | What it changes |
|---|---|---|
| `chain.testnet` | `true` | the header's ribbon says "Base Sepolia (test network) · Test dollars" («Base Sepolia (тестовая сеть) · Тестовые доллары»), the wallet is told the chain is a testnet, USDC is called "Test USDC" («Тестовые USDC») and /raise starts at the $5 chip |
| `chain.explorer` | `https://sepolia.basescan.org` | handed to the wallet as `blockExplorerUrls`; every transaction a screen shows (raise, send back, a closed Hand, thanks, /waiting, the passport) and Core's address on `/core` and `/without-us` link to it |
| `faucets` | Circle's USDC faucet, Base's list of ETH faucets | /raise says where test money comes from, beside the reward and under "You need $5 and a little ETH" |
| `previews` | `true` | the view server's Vercel Function writes a Hand's address's link-preview tags and its card (below): /raise's "In a chat it looks like this" shows the title, details and reward as a chat will, and `/core` says a Hand's address and its card carry what this server adds. `false` is for a static-only host: no rewrite reaches the function, the preview is the site's name only and /raise says so |

`chain.name` is `Base Sepolia`, the name a wallet stores when it adds the network; screens show the catalogue's name for chain 84532, «Base Sepolia (тестовая сеть)» in Russian.

Three chain fields set how the site meets the network (2026-11-21; a stand sets only the first, 1 000):

| Field | Value here | What it changes |
|---|---|---|
| `chain.blockTimeMs` | `200` | the chain's real pace: Base makes a block every 200 ms (blocks 61 429 229 and 61 441 608 are 2 476 s apart). The SDK's `findBlockAt` guesses a block from a time with it: five reads find a Hand's block, where the 2 000 written before took 35 |
| `chain.pollMs` | `2000` | how often the app asks for news: the block watcher, viem's and wagmi's polling, `exit.html`'s refresh (four times this). Absent, it is the block time but at least a second; here it keeps the public RPC from being asked five times a second |
| `chain.logWindow` | `200` | the widest `eth_getLogs` range the public RPC takes (wider: HTTP 413, `{"code":-32614,"message":"eth_getLogs is limited to a 200 range"}`). Every log read starts at it. Absent, reads start at 2 000 blocks and a refused window shrinks by itself |

Until Core is put on Base Sepolia, every screen that reads Core says "This contract is not on Base Sepolia (test network) yet." («Этого контракта ещё нет в сети Base Sepolia (тестовая сеть).») with a Check again button; `/core` shows the derivation and the empty `eth_getCode`. A network that does not answer still says "Can't reach the network right now."

## What Vercel runs

The project's Root Directory is `apps/web`, the app's own folder, so its settings live in [`apps/web/vercel.json`](../apps/web/vercel.json). `bun apps/web/deploy.ts write` writes it; nobody edits it by hand.

| Field | Value | Why |
|---|---|---|
| `framework` | `null` ("Other") | the output is plain files; no preset should add its own routes |
| `installCommand` | `cd ../.. && npx -y bun@1.4.4 install --frozen-lockfile` | the workspace is the repository root, of which `apps/web` is one member; installing there installs the whole tree from `bun.lock` |
| `buildCommand` | `cd ../.. && npx -y bun@1.4.4 apps/web/deploy.ts build` | prints Bun's version and stops on a Bun older than 1.3.2, builds `apps/web` with the Base Sepolia configuration into `apps/web/dist`, stops if `exit.html` names a file it does not carry, writes `build.json` beside it, and fails if `vercel.json` is stale |
| `outputDirectory` | `dist` | relative to the Root Directory: `apps/web/dist` |
| `functions` | `api/view.mjs`: `includeFiles` `view/**`, `maxDuration` 10 | the view server's link previews as one Vercel Function (Node.js 24); the folder the build makes for it goes in whole |
| `rewrites` | `/([0-9]+/(?:0x[0-9a-fA-F]{40}/)?[0-9]+)` and `/og/(generic\|[0-9]+/(?:0x[0-9a-fA-F]{40}/)?[0-9]+)\.png` → `/api/view`, then `/((?:[^/]*/)*[^/.]*)` → `/index.html` | a Hand's address (`/<chain>/<hand>`, `/<chain>/<core>/<hand>`, with `?d=…`) and its card go to the function; every other app path (no dot in its last part) is the app; Vercel serves an existing file first, and a missing file with an extension stays a 404, as `infra/stand/static.ts` does. The groups are unnamed, so Vercel adds nothing to the query and `d` arrives as written |
| `headers` | the stand's headers, plus Privy | the CSP with the configuration's RPC and relays in `connect-src` and Privy's sources (`auth.privy.io`, `*.rpc.privy.systems`, WalletConnect's relay and wallet list and Coinbase's relay in `connect-src`; `auth.privy.io` and WalletConnect's verify frame in `frame-src`/`child-src`; the wallet list's icons in `img-src`; see [app.md](app.md#headers)), `no-referrer`, `nosniff`, COOP `same-origin`, the Permissions-Policy; `exit.html` gets its own CSP with its inline script's sha256, any https RPC and `data:` fonts; `/assets/*` immutable; `build.json` no-cache |

Vercel reads `vercel.json` before it builds, so its headers are literal. `write` also writes `apps/web/api/view.mjs` and `apps/web/api/package.json`; the build stops when any of the three is stale. `apps/web/tests/vercel.test.ts` (part of `bun run check`) builds the public app, requires the file to be exactly what that build needs, compares its headers with `infra/stand/static.ts` for the same configuration, and plays its routes through Vercel's own route compiler (`@vercel/routing-utils`). Any change to the app moves `exit.html`'s hash: run `bun apps/web/deploy.ts write` and commit the file with the change. A stale file fails both that test and the Vercel build, instead of shipping an `exit.html` whose script its own header blocks.

Vercel documents only "Bun 1" in its build image. `bun.lock` carries `configVersion`, which Bun 1.3.2 and later read as the isolated linker; Bun 1.2.x ignores it, installs hoisted, and the build still passes while `exit.html` keeps `url(../node_modules/@fontsource…)` fonts that 404 on the site (seen with Bun 1.2.23 on a clean clone; 1.3.14 and 1.4.4 inline them). So the build stops on a Bun older than 1.3.2, and on any `exit.html` with a `url(../…)` or `node_modules` in it. Since 2026-11-21 both commands run `npx -y bun@1.4.4` (`BUN` in apps/web/deploy.ts, the same version CI pins and a test checks): the image's own Bun was 1.3.14, which rewrites a lockfile written by 1.4 (it drops `libc` and adds `hasInstallScript`), so `--frozen-lockfile` refused it once Privy's packages entered the lock.

## Link previews: the view server as a Vercel Function

A chat's robot fetches what stands before `#`. For a Hand's address it now gets `index.html` as built with the view server's Open Graph and Twitter tags added before `</head>` (and the Hand's title as the page title once `d` matched Core's dataHash), and `og:image` names `/og/<chain>/<hand>.png?d=…`, a 1200×630 PNG. Everything else is still a static file.

How it is wired:

- **`apps/web/api/view.mjs`** is the function Vercel finds (zero configuration, Node.js runtime). It is one line, `export { default } from "../view/handler.mjs"`, written by `bun apps/web/deploy.ts write`. Its `package.json` beside it says `"type": "module"` and `engines.node` `24.x` (Vercel runs it on `nodejs24.x`), and has no dependencies, so the Node.js builder, which installs the nearest `package.json`, installs nothing (`apps/web/package.json` is the app's own, whose dependencies the function does not need).
- **`apps/web/view/`** (ignored by git) is made by the build command after the app: `buildFunction` bundles `apps/view/src/function-entry.ts` with Bun for Node (ESM, split: `og.tsx` with satori and resvg is its own chunk, loaded with the first card), and puts beside it the built `index.html` (the same bytes as `dist/index.html`), `view.json` (the view server's `VIEW_*` settings from the public configuration: the one RPC, chain 84532, the trusted and canonical Core, the relays, the site, the listed tokens as `VIEW_TOKENS`), the view server's fonts and lockup, and `@resvg/resvg-js` with the prebuilt binaries installed beside it (on Vercel's build image `linux-x64-gnu`), copied as files. Vercel's builder for the function runs after the build command (its frontend builder runs first), traces `api/view.mjs` with `@vercel/nft` and adds `includeFiles` `view/**` whole.
- **`apps/view/src/function.ts`** (`viewFunction`) is the view server as one web-standard handler, `(Request) => Promise<Response>`: the same reader (`preview.ts`: the chain's terms, the title only after `d` matched), the same tags (`meta.ts`), the same card (`og.tsx`) and headers (`headers.ts`) as `server.ts`. Cards are drawn on the request's thread (no worker pool in a function) and remembered while the instance lives. The site in `og:url` and `og:image` is the configuration's `site` (`VIEW_SITE`), never a header the request brings. It sends no Strict-Transport-Security and compresses nothing (Vercel does both for every answer). Anything that goes wrong on a page gives `index.html` as built.
- **Headers.** A page with tags carries the very CSP and headers `vercel.json` sends for that path (it adds no inline script); `Cache-Control: no-cache` and `Vary: Accept-Language` as the view server. A card: `image/png`, `Cache-Control: public, max-age=300` (a Hand changes state; robots keep a card five minutes), `Vary: Accept-Language`. Neither has `s-maxage`, so Vercel's CDN does not keep them: every robot's fetch reaches the function, and the view server's own five-second memory of a reading and its memory of drawn cards spare the RPC.

How it is checked (`bun run check`):

- `apps/web/tests/vercel.test.ts` plays the routes through `@vercel/routing-utils`: both shapes of a Hand's address (any chain number, a Core in either case) and three card paths reach the function with the app's headers; `/84532/12/proof`, `/84532/12/`, a short Core and `/og` without `.png` stay the app; other `/og/…` names are 404s; a configuration with `previews` false has no function and no rewrite to it. It calls `viewFunction` with Requests against anvil (Hands raised through the SDK): an unlisted Hand's tags in English and Russian, the page equal to `index.html` once the tags are taken out, the headers equal to the static ones, HEAD and POST; its card 1200×630 with its Cache-Control, dark another; a numbered address (terms only), a public Hand (details); an unknown Hand, a changed `d`, `d` given twice, a dark Hand's number with a wrong `d`, chains 84532 and 1, an untrusted Core and a 20 000-character `d`: the generic card; hostile words (`</title><script>…`, a fake meta tag, an RLO) escaped and isolated; a refunded Hand read again. Then it builds the function's folder, gathers its files as Vercel does (`@vercel/nft` from the repository root with the Root Directory as the process folder, plus `includeFiles`), copies only those out and has `node` (`NODE_BIN`) import the entry and answer a card and a page.
- `bun tests/e2e/fork/run.ts` (step 7) does the same against the Base Sepolia fork under Node 24 (`FORK_NODE`): Hands raised from anvil's account 5 through the SDK, then a page for each shape (unlisted with `d`, numbered, public, a dark Hand's number, unknown, a changed `d`, chain 8453, a huge `d`) and three cards.

`build.json` is written by the build as the stand writes it (`tools/manifest.ts` `buildRecord`): the hash of every file, the command that recomputes it, the commit and the dirty flag. Where the build has no `.git` folder, the commit is `VERCEL_GIT_COMMIT_SHA`. `/core` shows it as "served by this site".

## Putting Core on the network

Core is on Base Sepolia since block 61 393 192 (transaction `0x421bd59585f3f709c0baf7a09b66f2a768225a91e72ddfecb0a33ed6e7dc33fe`, 2 392 020 gas, built from be485ca, clean), and `script/check-deployment.sh` holds for its deployment file against `https://sepolia.base.org`. That file, `contracts/deployments/84532.json`, is in this branch, and the check workflow's step "Deployed Core is the Core this tree builds" reads it. Steps 1 to 5 are how it was put there, for a redeploy or another network.

1. Put Base Sepolia ETH on the deployer's address. Core's deployment took 2 392 020 gas on a fork of Base Sepolia (11 659 bytes of calldata); at Base Sepolia's 0.006 gwei that is about 0.000015 ETH, and the L1 data part is under 0.00000001 ETH. 0.001 ETH leaves a wide margin. (The same gas on Base mainnet at 0.006 gwei is about 0.000014 ETH, $0.03 at $2 400; on Ethereum at 0.3 gwei about 0.00072 ETH, $1.72.)
2. Deploy Core from a clone of this branch with `contracts/lib` in place (the two `git clone` lines of `.github/workflows/check.yml`), with the key in a Foundry keystore or a Ledger:

   ```sh
   cd contracts && "${FOUNDRY_BIN:-$HOME/.foundry/bin}/forge" build
   bash script/deploy.sh https://sepolia.base.org --account <keystore name> --sender <deployer address>
   ```

   It writes `contracts/deployments/84532.json` with `commit` and `dirty` from git and ends with `deployment deployments/84532.json holds on chain 84532` from `script/check-deployment.sh`. The address must be `0x65ac707E2AE7392583de5d6192C619F1D8862309`.
3. Back at the root, rewrite the Vercel file (the build now takes the deployment's block, commit and dirty flag into the configuration, so `exit.html` changes) and check:

   ```sh
   bun apps/web/deploy.ts write
   bun test apps/web/tests/vercel.test.ts
   ```

4. Publish Core's source, so that the explorer shows its code and its Contract → Write Contract tab, which `/without-us` step 3 relies on. Sourcify needs no key (Blockscout reads it); BaseScan needs an Etherscan API key (one key works for every Etherscan chain):

   ```sh
   cd contracts
   "${FOUNDRY_BIN:-$HOME/.foundry/bin}/forge" verify-contract 0x65ac707E2AE7392583de5d6192C619F1D8862309 src/AHandCore.sol:AHandCore --chain 84532 --verifier sourcify
   "${FOUNDRY_BIN:-$HOME/.foundry/bin}/forge" verify-contract 0x65ac707E2AE7392583de5d6192C619F1D8862309 src/AHandCore.sol:AHandCore --chain 84532 --verifier etherscan --etherscan-api-key "$ETHERSCAN_API_KEY"
   ```

5. For a redeploy or another network, commit the new deployment file and `apps/web/vercel.json`, and push the branch. In the first Vercel build log read the `vercel: bun <version>` line.

Visitors need a little Base Sepolia ETH and test USDC; /raise links Circle's faucet (network Base Sepolia) and Base's list of ETH faucets. Someone with no crypto app logs in with email, Google, Apple, X, Farcaster or a passkey: Privy makes them a wallet, which then needs the same test ETH and USDC (nothing sponsors its gas). Someone with a crypto app picks "Continue with a wallet" in the same window: on a computer the browser's extension wallets (EIP-6963), on a phone WalletConnect's list (the wallet app opens and asks), or the site opened inside the wallet app's own browser.

### Privy's dashboard

Privy's docs say each way in the app asks for must also be on in Privy's dashboard (dashboard.privy.io, the app `clt69jwp204btq1o3q72cupji`; [login methods](https://docs.privy.io/authentication/user-authentication/login-methods/oauth)). On 2026-11-21 the window showed email, Google, X, Apple, Farcaster, wallets and "I have a passkey" on `http://localhost:3300`; whether each one finishes a login was not tried (no login was done here), so check each in the dashboard's login methods:

1. **Email**: on.
2. **Socials**: Google, Apple, Twitter (X), Farcaster on. Privy's shared OAuth credentials work for testing; for a launch put the app's own Google and Apple OAuth clients there (their consent screen then names aHand, not Privy), and, if the dashboard keeps a list of allowed OAuth redirect URLs, allow every page of `https://next.ahand.in` and `https://ahand.in`: Privy sends the person back to the very page they logged in from (its `redirect_to` is the page's own address, `/raise`, `/give`, a Hand's page…).
3. **External wallets**: on (Privy asks a wallet for a sign-in message as the login). **Passkeys**: on; "allow sign up with passkey" decides whether a passkey can start a new account or only log in to one that added it.
4. **Embedded wallets → Ethereum**: "create on login" for users without wallets (the app also asks for it); leave Privy's own confirmation screens to the app's setting (`showWalletUIs`, which the app sets from the lens: on with it, off without).
5. **Bot protection (Cloudflare Turnstile)**: off. On, it needs `https://challenges.cloudflare.com` as a script source, which the app's CSP does not allow (no script from another origin).
6. **WalletConnect**: nothing is needed; Privy uses its own project id. To use aHand's own (its name and usage in WalletConnect's dashboard), create a project at cloud.reown.com, add `https://*.ahand.in` and `https://ahand.in` to its allowed domains, and put its id in Privy's dashboard under the external wallets' WalletConnect setting.
7. **Domains**: the dashboard's allowed domains should be exactly `privy.origins` in `base-sepolia.json` (`https://ahand.in`, `https://*.ahand.in` and the six localhost ports). A page on any allowed domain sets Privy's confirmation windows for itself (this app shows them only with the lens on), so a page on any of them can have a person log in and then sign with their Privy wallet without a window: keep no other domain there. The app only compares its own address with `privy.origins`; a new domain goes into both.

## Proving it on a fork first

```sh
bun tests/e2e/fork/run.ts      # FORK_PORT (32200) and FORK_SITE_PORT (32202) move it; FORK_KEEP=1 keeps it up; FORK_NODE names the Node for the function
```

It forks Base Sepolia with anvil a few blocks behind the head as chain 84532 (now that Core is on Base Sepolia, at the last block before it came, found by `eth_getCode` bisection; `FORK_BLOCK` pins one), builds the public app against the fork, serves it with `infra/stand/static.ts`, checks the "not on Base Sepolia yet" sentence in both languages on every screen that reads Core, deploys Core with `contracts/script/deploy.sh` from anvil's public test account 0 (unlocked, `--unlocked --sender`), runs `check-deployment.sh`, writes 1 000 test USDC into Circle's balance slot for anvil accounts 1 to 5, and drives the life in Chromium: raise from an injected test wallet (`tests/e2e/lib/fork/key-wallet.ts`, anvil key 1), pass at 0%, help with a pasted payee, `/check` of the give link, thank by pasting that link into `/thank` (the public relays are blocked in the test), then `/core` and the passport. It also checks the ribbon in both languages, `/core`'s sentence on the preview tags this server adds and its explorer link, the faucets and the test-USDC line on /raise, the link preview with chain 84532 and the Hand's own words, the explorer link of the thanks, and a phone-style browser that sets only `window.ethereum` being offered and connecting. Then the SDK's own loop (`infra/stand/loop.ts --only usd`) runs on the same fork, and the view server's Vercel Function is built against the fork, gathered as Vercel gathers it, and called under `FORK_NODE` (Node 24, as Vercel runs it) for every shape of a Hand's address and its cards. Nothing is sent to Base Sepolia itself; the fork's deployment file goes to `tests/e2e/test-results/fork/`, never to `contracts/deployments`.

## What this site does not do

- Previews only for a Hand's address and its card. `/`, `/raise` and every other page are `index.html` as built, without the view server's generic tags; a dark Hand's address carries nothing before `#`, so it unfurls as that plain page.
- A card or a page with tags is not kept by Vercel's CDN (no `s-maxage`): each fetch runs the function, and its reads go to `https://sepolia.base.org`. When that RPC refuses, the page gets the generic card, never an error.
- `https://sepolia.base.org` is a public, rate-limited RPC: under load it refuses requests, and a screen then says "Can't reach the network right now" until the next read succeeds.
- Google, Apple and X leave the page and come back by a fresh load. The raise form is kept across that trip (at most 30 minutes, in this device's `prefs`), and so is an opened link (in this tab's `sessionStorage`, used only on a way back within ten minutes and erased by the next load of the app in that tab, used or not: the one exception to the rule that a reload forgets an opened link); where that storage refuses, someone who logs in with Google from a link opens the link once more, and the screen says so ([app.md](app.md#logging-in-through-privy)).
- Privy's dashboard decides which sites may use the app id (step 7 above: exactly `privy.origins`). `privy.origins` in `base-sepolia.json` is the part the app expects: `https://*.ahand.in` (so `next.ahand.in`), `https://ahand.in` and `http://localhost:` 3000, 3001, 3300, 3400, 3411 and 5173; on any other address (a `vercel.app` preview) the app says logging in can't be reached and offers the browser's wallets. A new domain needs adding in both places, or Privy's key frame refuses to load. Which phone apps list themselves (EIP-6963) or only set `window.ethereum` is checked on a real phone, not here.
- The explorer's Write Contract tab exists only once Core's source is verified there (step 4).
- Delivery of answers goes through five public Nostr relays of different operators (`docs/delivery.md`). When none takes the message, the helper's link is the way: the helper sends it, the asker pastes it into `/thank`.
- No dev wallet and no gallery: they ship only in builds whose chain is the local one.

# Public test deployment on Base Sepolia

The branch `exp/e2e` can be served as a static site at `https://exp-e2e.ahand.in`: the repository's Vercel project builds every pushed branch, and the `branch-domains` workflow registers `<branch>.ahand.in` for it. The site is the built `apps/hand` against Base Sepolia (chain 84532), with the configuration [`apps/hand/src/config/base-sepolia.json`](../apps/hand/src/config/base-sepolia.json): RPC `https://sepolia.base.org`, Core `0x65ac707E2AE7392583de5d6192C619F1D8862309` (the CREATE2 address, the same on every chain that has the deterministic deployer), Circle's test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6 decimals), Multicall3 as the forwarder, the relays `wss://relay.damus.io` and `wss://nos.lol`. `chain.local` is false: the build has no dev wallet and no gallery; a visitor uses their own browser wallet.

Four optional fields describe a public test site (a stand's configuration has none of them and reads as before):

| Field | Value here | What it changes |
|---|---|---|
| `chain.testnet` | `true` | the header's ribbon says "Base Sepolia (test network) · Test dollars" («Base Sepolia (тестовая сеть) · Тестовые доллары»), the wallet is told the chain is a testnet, USDC is called "Test USDC" («Тестовые USDC») and /raise starts at the $5 chip |
| `chain.explorer` | `https://sepolia.basescan.org` | handed to the wallet as `blockExplorerUrls`; every transaction a screen shows (raise, send back, a closed Hand, thanks, /waiting, the passport) and Core's address on `/core` and `/without-us` link to it |
| `faucets` | Circle's USDC faucet, Base's list of ETH faucets | /raise says where test money comes from, beside the reward and under "You need $5 and a little ETH" |
| `previews` | `false` | no server writes link previews here: /raise's "In a chat it looks like this" shows the site's name only and says so, and `/core` says every page address is `/index.html` as built |

`chain.name` is `Base Sepolia`, the name a wallet stores when it adds the network; screens show the catalogue's name for chain 84532, «Base Sepolia (тестовая сеть)» in Russian.

Until Core is put on Base Sepolia, every screen that reads Core says "This contract is not on Base Sepolia (test network) yet." («Этого контракта ещё нет в сети Base Sepolia (тестовая сеть).») with a Check again button; `/core` shows the derivation and the empty `eth_getCode`. A network that does not answer still says "Can't reach the network right now."

## What Vercel runs

The project's Root Directory is `apps/web`, the old app kept as history, so this branch's settings live in [`apps/web/vercel.json`](../apps/web/vercel.json). `bun apps/hand/vercel.ts write` writes it; nobody edits it by hand.

| Field | Value | Why |
|---|---|---|
| `framework` | `null` ("Other") | the output is plain files; no preset should add its own routes |
| `installCommand` | `cd ../.. && bun install --frozen-lockfile` | the workspace is the repository root; `apps/web` is not a member on this branch |
| `buildCommand` | `cd ../.. && bun apps/hand/vercel.ts build` | prints Bun's version and stops on a Bun older than 1.3.2, builds `apps/hand` with the Base Sepolia configuration into `apps/web/dist`, stops if `exit.html` names a file it does not carry, writes `build.json` beside it, and fails if `vercel.json` is stale |
| `outputDirectory` | `dist` | relative to the Root Directory: `apps/web/dist` |
| `rewrites` | `/((?:[^/]*/)*[^/.]*)` → `/index.html` | every app path (no dot in its last part) is the app; Vercel serves an existing file first, and a missing file with an extension stays a 404, as `infra/stand/static.ts` does |
| `headers` | the stand's headers | the CSP with the configuration's RPC and relays in `connect-src`, `no-referrer`, `nosniff`, COOP `same-origin`, the Permissions-Policy; `exit.html` gets its own CSP with its inline script's sha256, any https RPC and `data:` fonts; `/assets/*` immutable; `build.json` no-cache |

Vercel reads `vercel.json` before it builds, so its headers are literal. `apps/hand/tests/vercel.test.ts` (part of `bun run check`) builds the public app, requires the file to be exactly what that build needs, compares its headers with `infra/stand/static.ts` for the same configuration, and plays its routes through Vercel's own route compiler (`@vercel/routing-utils`). Any change to the app moves `exit.html`'s hash: run `bun apps/hand/vercel.ts write` and commit the file with the change. A stale file fails both that test and the Vercel build, instead of shipping an `exit.html` whose script its own header blocks.

Vercel documents only "Bun 1" in its build image. `bun.lock` carries `configVersion`, which Bun 1.3.2 and later read as the isolated linker; Bun 1.2.x ignores it, installs hoisted, and the build still passes while `exit.html` keeps `url(../node_modules/@fontsource…)` fonts that 404 on the site (seen with Bun 1.2.23 on a clean clone; 1.3.14 and 1.4.4 inline them). So the build stops on a Bun older than 1.3.2, and on any `exit.html` with a `url(../…)` or `node_modules` in it. If the first Vercel build stops on the version, set both commands in `vercelJson` (apps/hand/vercel.ts) to `npx -y bun@1.4.4 …`, run `bun apps/hand/vercel.ts write` and push again.

`build.json` is written by the build as the stand writes it (`tools/manifest.ts` `buildRecord`): the hash of every file, the command that recomputes it, the commit and the dirty flag. Where the build has no `.git` folder, the commit is `VERCEL_GIT_COMMIT_SHA`. `/core` shows it as "served by this site".

## The owner's steps

Core is on Base Sepolia since block 61 393 192 (transaction `0x421bd59585f3f709c0baf7a09b66f2a768225a91e72ddfecb0a33ed6e7dc33fe`, 2 392 020 gas, built from be485ca, clean), and `script/check-deployment.sh` holds for its deployment file against `https://sepolia.base.org`. That file is not in this branch yet: a push without it gives a working site whose `/core` names no commit; steps 3 to 5 take it in. Steps 1 and 2 are how it was put there, for another network or a redeploy check.

1. Put Base Sepolia ETH on the deployer's address. Core's deployment took 2 392 020 gas on a fork of Base Sepolia (11 659 bytes of calldata); at Base Sepolia's 0.006 gwei that is about 0.000015 ETH, and the L1 data part is under 0.00000001 ETH. 0.001 ETH leaves a wide margin. (The same gas on Base mainnet at 0.006 gwei is about 0.000014 ETH, $0.03 at $2 400; on Ethereum at 0.3 gwei about 0.00072 ETH, $1.72.)
2. Deploy Core from a clone of this branch with `contracts/lib` in place (README, "Start the stand"), with the key in a Foundry keystore or a Ledger:

   ```sh
   cd contracts && "${FOUNDRY_BIN:-$HOME/.foundry/bin}/forge" build
   bash script/deploy.sh https://sepolia.base.org --account <keystore name> --sender <deployer address>
   ```

   It writes `contracts/deployments/84532.json` with `commit` and `dirty` from git and ends with `deployment deployments/84532.json holds on chain 84532` from `script/check-deployment.sh`. The address must be `0x65ac707E2AE7392583de5d6192C619F1D8862309`.
3. Back at the root, rewrite the Vercel file (the build now takes the deployment's block, commit and dirty flag into the configuration, so `exit.html` changes) and check:

   ```sh
   bun apps/hand/vercel.ts write
   bun test apps/hand/tests/vercel.test.ts
   ```

4. Publish Core's source, so that the explorer shows its code and its Contract → Write Contract tab, which `/without-us` step 3 relies on. Sourcify needs no key (Blockscout reads it); BaseScan needs an Etherscan API key (one key works for every Etherscan chain):

   ```sh
   cd contracts
   "${FOUNDRY_BIN:-$HOME/.foundry/bin}/forge" verify-contract 0x65ac707E2AE7392583de5d6192C619F1D8862309 src/AHandCore.sol:AHandCore --chain 84532 --verifier sourcify
   "${FOUNDRY_BIN:-$HOME/.foundry/bin}/forge" verify-contract 0x65ac707E2AE7392583de5d6192C619F1D8862309 src/AHandCore.sol:AHandCore --chain 84532 --verifier etherscan --etherscan-api-key "$ETHERSCAN_API_KEY"
   ```

5. Commit `contracts/deployments/84532.json` and `apps/web/vercel.json`, and push the branch. In the first Vercel build log read the `vercel: bun <version>` line.

Visitors need a little Base Sepolia ETH and test USDC; /raise links Circle's faucet (network Base Sepolia) and Base's list of ETH faucets. On a computer they use a browser extension wallet; on a phone they open the site inside their wallet app's own browser (MetaMask, Coinbase Wallet, Rabby, Trust…): the site takes a wallet that announces itself (EIP-6963) and, when none does, the page's own `window.ethereum`.

## Proving it on a fork first

```sh
bun tests/e2e/fork/run.ts      # FORK_PORT (32200) and FORK_SITE_PORT (32202) move it; FORK_KEEP=1 keeps it up
```

It forks Base Sepolia with anvil a few blocks behind the head as chain 84532 (now that Core is on Base Sepolia, at the last block before it came, found by `eth_getCode` bisection; `FORK_BLOCK` pins one), builds the public app against the fork, serves it with `infra/stand/static.ts`, checks the "not on Base Sepolia yet" sentence in both languages on every screen that reads Core, deploys Core with `contracts/script/deploy.sh` from anvil's public test account 0 (unlocked, `--unlocked --sender`), runs `check-deployment.sh`, writes 1 000 test USDC into Circle's balance slot for anvil accounts 1 to 5, and drives the life in Chromium: raise from an injected test wallet (`tests/e2e/lib/fork/key-wallet.ts`, anvil key 1), pass at 0%, help with a pasted payee, `/check` of the give link, thank by pasting that link into `/thank` (the public relays are blocked in the test), then `/core` and the passport. It also checks the ribbon in both languages, `/core`'s static-site sentence and its explorer link, the faucets and the test-USDC line on /raise, the link preview with chain 84532 and the site's name only, the explorer link of the thanks, and a phone-style browser that sets only `window.ethereum` being offered and connecting. Then the SDK's own loop (`infra/stand/loop.ts --only usd`) runs on the same fork. Nothing is sent to Base Sepolia itself; the fork's deployment file goes to `tests/e2e/test-results/fork/`, never to `contracts/deployments`.

## What this site does not do

- No preview cards: face (`apps/face`), which draws the OG card of a Hand's address, does not run on a static host; a shared address unfurls as the plain page titled "aHand". /raise shows that card and says so.
- `https://sepolia.base.org` is a public, rate-limited RPC: under load it refuses requests, and a screen then says "Can't reach the network right now" until the next read succeeds.
- No WalletConnect: a phone's own browser (Safari, Chrome) has no wallet; the visitor opens the site inside the wallet app's browser. Which phone apps list themselves (EIP-6963) or only set `window.ethereum` is checked on a real phone, not here.
- The explorer's Write Contract tab exists only once Core's source is verified there (step 4).
- Delivery of answers goes through two public Nostr relays. When neither takes the message, the helper's link is the way: the helper sends it, the asker pastes it into `/thank`.
- No dev wallet and no gallery: they ship only in builds whose chain is the local one.

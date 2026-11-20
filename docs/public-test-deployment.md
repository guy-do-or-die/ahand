# Public test deployment on Base Sepolia

The branch `exp/e2e` can be served as a static site at `https://exp-e2e.ahand.in`: the repository's Vercel project builds every pushed branch, and the `branch-domains` workflow registers `<branch>.ahand.in` for it. The site is the built `apps/hand` against Base Sepolia (chain 84532), with the configuration [`apps/hand/src/config/base-sepolia.json`](../apps/hand/src/config/base-sepolia.json): RPC `https://sepolia.base.org`, Core `0x65ac707E2AE7392583de5d6192C619F1D8862309` (the CREATE2 address, the same on every chain that has the deterministic deployer), Circle's test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6 decimals), Multicall3 as the forwarder, the relays `wss://relay.damus.io` and `wss://nos.lol`. `chain.local` is false: the build has no dev wallet and no gallery; a visitor uses their own browser wallet.

Until Core is put on Base Sepolia, every screen that reads Core says "This contract is not on Base Sepolia (test network) yet." («Этого контракта ещё нет в сети Base Sepolia (тестовая сеть).») with a Check again button; `/core` shows the derivation and the empty `eth_getCode`. A network that does not answer still says "Can't reach the network right now."

## What Vercel runs

The project's Root Directory is `apps/web`, the old app kept as history, so this branch's settings live in [`apps/web/vercel.json`](../apps/web/vercel.json). `bun apps/hand/vercel.ts write` writes it; nobody edits it by hand.

| Field | Value | Why |
|---|---|---|
| `framework` | `null` ("Other") | the output is plain files; no preset should add its own routes |
| `installCommand` | `cd ../.. && bun install --frozen-lockfile` | the workspace is the repository root; `apps/web` is not a member on this branch |
| `buildCommand` | `cd ../.. && bun apps/hand/vercel.ts build` | builds `apps/hand` with the Base Sepolia configuration into `apps/web/dist`, writes `build.json` beside it, and fails if `vercel.json` is stale |
| `outputDirectory` | `dist` | relative to the Root Directory: `apps/web/dist` |
| `rewrites` | `/((?:[^/]*/)*[^/.]*)` → `/index.html` | every app path (no dot in its last part) is the app; Vercel serves an existing file first, and a missing file with an extension stays a 404, as `infra/stand/static.ts` does |
| `headers` | the stand's headers | the CSP with the configuration's RPC and relays in `connect-src`, `no-referrer`, `nosniff`, COOP `same-origin`, the Permissions-Policy; `exit.html` gets its own CSP with its inline script's sha256, any https RPC and `data:` fonts; `/assets/*` immutable; `build.json` no-cache |

Vercel reads `vercel.json` before it builds, so its headers are literal. `apps/hand/tests/vercel.test.ts` (part of `bun run check`) builds the public app, requires the file to be exactly what that build needs, compares its headers with `infra/stand/static.ts` for the same configuration, and plays its routes through Vercel's own route compiler (`@vercel/routing-utils`). Any change to the app moves `exit.html`'s hash: run `bun apps/hand/vercel.ts write` and commit the file with the change. A stale file fails both that test and the Vercel build, instead of shipping an `exit.html` whose script its own header blocks.

`build.json` is written by the build as the stand writes it (`tools/manifest.ts` `buildRecord`): the hash of every file, the command that recomputes it, the commit and the dirty flag. Where the build has no `.git` folder, the commit is `VERCEL_GIT_COMMIT_SHA`. `/core` shows it as "served by this site".

## The owner's steps

Pushing the branch as it is gives a site that says Core is not there yet. To make it work:

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

4. Commit `contracts/deployments/84532.json` and `apps/web/vercel.json`, and push the branch.

Visitors need a browser wallet on Base Sepolia, a little Base Sepolia ETH, and test USDC from Circle's faucet to raise.

## Proving it on a fork first

```sh
bun tests/e2e/fork/run.ts      # FORK_PORT (32200) and FORK_SITE_PORT (32202) move it; FORK_KEEP=1 keeps it up
```

It forks Base Sepolia with anvil a few blocks behind the head as chain 84532, builds the public app against the fork, serves it with `infra/stand/static.ts`, checks the "not on Base Sepolia yet" sentence in both languages on every screen that reads Core, deploys Core with `contracts/script/deploy.sh` from anvil's public test account 0 (unlocked, `--unlocked --sender`), runs `check-deployment.sh`, writes 1 000 test USDC into Circle's balance slot for anvil accounts 1 to 5, and drives the life in Chromium: raise from an injected test wallet (`tests/e2e/lib/fork/key-wallet.ts`, anvil key 1), pass at 0%, help with a pasted payee, `/check` of the give link, thank by pasting that link into `/thank` (the public relays are blocked in the test), then `/core` and the passport. Then the SDK's own loop (`infra/stand/loop.ts --only usd`) runs on the same fork. Nothing is sent to Base Sepolia itself; the fork's deployment file goes to `tests/e2e/test-results/fork/`, never to `contracts/deployments`.

## What this site does not do

- No preview cards: face (`apps/face`), which draws the OG card of a Hand's address, does not run on a static host; a shared address unfurls as the plain page.
- Delivery of answers goes through two public Nostr relays. When neither takes the message, the helper's link is the way: the helper sends it, the asker pastes it into `/thank`.
- No dev wallet and no gallery: they ship only in builds whose chain is the local one.

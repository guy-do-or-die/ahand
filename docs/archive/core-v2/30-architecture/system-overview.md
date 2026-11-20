# System overview

## Components

### Contracts (Base Sepolia)

- **AHandCore** — escrow, per-Hand snapshotted terms, EIP-712 route verification, settlement and reclaim allocations, push-with-deferral payouts, and a bounded prospective token/charity policy.
- **AHandSignals** — soulbound ERC-1155-shaped ledger for role receipts (`RAISED`, `SHAKEN`, `GIVEN`, `THANKED`) and earned/received Up, immutably bound to one `sourceCore`. Permissionless, idempotent materialization; no settlement authority. `DOWN` is reserved with no entrypoint.
- **AHandWitness** — optional timestamping of hashes and signed artifacts. Zero Core connectivity.

Details in [Contract boundaries](contract-boundaries.md).

### Web application

The one deployed application is the web app at `https://ahand.in` (see [web app](../40-applications/web-app.md)) — a TanStack Start client with routes for the landing page, `/raise`, the `/hands` public board, `/h/$id` Hand pages, `/h/$id/thank` settlement, and the `/pocket` dashboard. It uses:

- **Privy** for auth (email, Google, passkey, Farcaster, Twitter → embedded wallet) alongside ordinary wagmi/viem external wallets;
- **account abstraction** via permissionless.js: EntryPoint v0.8, EIP-7702 `Simple7702Account`, Pimlico bundler and paymaster, toggled by `VITE_AA_ENABLED`;
- **XMTP** (v7 client, `dev` network) to deliver a Give directly to the raiser as a chat message; link export is the fallback;
- server routes `/api/pin` (server-held IPFS pinning key), `/api/og/$id` (OG images), `/api/aa` (bundler/paymaster proxy), `/api/rpc` (local-dev RPC proxy).

The app reads chain state directly over RPC (`getHand`, `handsCount`, Signals `balanceOf`, Witness `witnessedAt`); it does not query the subgraph.

### Packages

- **packages/sdk** — pure TypeScript protocol SDK: types, EIP-712 hashing/signing, the payload codec, and route verification. See [SDK and link protocol](sdk-and-link-protocol.md).
- **packages/abi** — ABIs and per-chain deployment addresses generated from forge artifacts; `addresses.{chain}.json` is the deployment registry, selected by `AHAND_CHAIN`.
- **packages/subgraph** — The Graph subgraph indexing `AHandCore` on Base Sepolia. See [Subgraph](subgraph.md).

### Infra

- `infra/anvil/stand.ts` — local stand: spawns anvil (chainId 31337), deploys the contracts with MockUSD, starts a Pimlico Alto bundler plus mock paymaster, and writes addresses into `packages/abi`.
- `infra/seed/seed.ts` — raise-only seeder that puts real pinned Hands on Base Sepolia for the board and landing carousel, reusing the web app's exact metadata and link code.

## Data flows

### Raise

```text
client builds the three-layer metadata (envelope / discovery / route body)
  → discovery doc is pinned to IPFS through /api/pin (CID computed locally;
    `pinned: false` reported honestly when no provider key is set)
  → wallet funds AHandCore.raise() with the exact USDC deposit
  → Core emits Raised (and HandTagged) with visibility, commitments,
    and the ipfs:// discoveryRef
  → the raiser gets a share link carrying the root capability secret
    in the URL fragment, plus a QR code
```

### Pass

```text
holder opens /h/$id, the app verifies metadata against on-chain commitments
  → SDK creates a fresh child capability and signs a Shake with the parent one
  → holder picks attribution: anonymous, self, or explicit (+ ShakerAcceptance)
  → codec renders a new link containing exactly one secret — the fresh child;
    the parent secret structurally cannot travel
  → link moves through any channel (chat, QR, anything byte-preserving)
```

No Core write is required to pass a Hand.

### Give and Thank

```text
terminal capability signs Give; the Giver wallet signs GiverAcceptance
  → SDK builds a TerminalProof payload — it has no secret slot at all
  → the proof travels to the raiser as an XMTP message or as a
    /h/$id/thank#<proof> link
  → the raiser's client verifies route, Give, and acceptances locally,
    then submits thank() directly (raiser-only, before expiry)
  → Core splits the pool: charity cut, per-hop shaker margins, giver residual;
    pushes each payout with a gas-bounded transfer and defers any failed
    push into a claim withdrawable permissionlessly to the same beneficiary
  → anyone may later call AHandSignals.materializeThank() to mint receipts
    and earned Up for the raiser and giver
```

### Reclaim

```text
after expiry, anyone calls reclaim(handId)
  → full refund is pushed to the raiser; no charity cut on failure
```

## Failure independence

| Failure | What breaks | What remains possible |
|---|---|---|
| Web app (ahand.in) down | Its UI and its pinning/OG/AA endpoints | The payload is self-identifying; another client can decode it and settle against Core directly |
| ENS resolution unavailable | Names and avatars in the UI | Everything — addresses are shown raw; ENS is display-only |
| IPFS gateway or pinning provider down | Fetching discovery docs for board/carousel cards | The board shows what it can verify; Hands opened through a link carry their metadata in the link itself; escrow and commitments are on-chain |
| Subgraph down | Nothing user-facing today | The web app already reads the chain directly |
| XMTP down | In-app Give delivery and replies | The Give travels as a plain link |
| Pimlico bundler/paymaster down | Sponsored AA transactions | Ordinary wallet transactions |
| Signals unavailable or unmaterialized | Receipt/Up updates and views | Money settlement — Core never calls Signals |

Token/charity policy administration is prospective only and cannot touch a live Hand; see the [administration inventory](contract-boundaries.md#administration-inventory).

## Repository shape

```text
contracts/           Foundry: AHandCore, AHandSignals, AHandWitness, AHandTypes
apps/web/            TanStack Start client (ahand.in)
packages/sdk/        protocol types, hashing, signing, payload codec, verification
packages/abi/        generated ABIs + per-chain addresses
packages/subgraph/   Graph subgraph for AHandCore
infra/anvil/         local stand (anvil + deploy + AA stack)
infra/seed/          Base Sepolia seeder
docs/                this documentation
```

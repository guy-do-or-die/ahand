# Deployment and trust boundaries

## Live deployment — Base Sepolia (chainId 84532)

| Component | Value |
|---|---|
| `AHandCore` | `0x840C2D884ad2d17c3756c4cc86C84E801A57E811` |
| `AHandSignals` | `0x9d4AC0e5aA9A11F161c2D5e39A931Dde24375b17` (immutable `sourceCore` = the Core above) |
| `AHandWitness` | `0x964Ec4995d43cc6Da4BD9666617b0877012Db63a` |
| Reward token | Circle Base Sepolia USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6 decimals, `usdScale = 10^12`) |
| `policyAdmin` | `0xa42E5d4447c133440406aAA685DE725Ad381A162` |
| Allowlisted charity | `0x2D9A5736E99eB8c180fDbD8B9F19a46F733B1351` |
| Deploy block | 44613002 |
| Subgraph | Graph Studio target `ahand-base-sepolia` |
| Web app | `https://ahand.in`, deployed on Vercel |

**Base mainnet deployment has not happened.** Base Sepolia is the only public deployment; mainnet USDC is not the deployed asset anywhere.

`packages/abi/src/addresses.{chain}.json` is the deployment registry: generated alongside the ABIs from forge artifacts, selected by `AHAND_CHAIN`, and consumed by the web app, the seeder, and the subgraph manifest generator. No production value depends on an address hidden only in frontend source.

## Web app services

- **Pinning** — `/api/pin` holds the provider key (`PINATA_JWT`, or `WEB3_STORAGE_TOKEN`) server-side; browsers never see it. Deliberately narrow: it accepts at most 2048 bytes of valid JSON (a discovery-doc pipe, not a file host). The CID is computed locally and the response reports `pinned: false` honestly when no provider confirmed it.
- **Account abstraction** — Pimlico bundler and paymaster (`VITE_AA_BUNDLER_URL`, `VITE_AA_PAYMASTER_URL`, optional `VITE_AA_SPONSORSHIP_POLICY_ID`), EntryPoint v0.8 with EIP-7702 `Simple7702Account`; toggled by `VITE_AA_ENABLED`.
- **Auth** — Privy (`VITE_PRIVY_APP_ID`) for social login and embedded wallets, next to ordinary external wallets.
- **Give delivery** — XMTP, `dev` network.
- **ENS display reads** — Ethereum mainnet RPC, overridable via `VITE_ENS_RPC` (see [ENS](ens.md)).

## Local development

`infra/anvil/stand.ts` runs the full stack locally: anvil (chainId 31337), contract deployment via `Deploy.s.sol` with MockUSD, a Pimlico Alto bundler plus mock paymaster on `:4339` (reached through `/api/aa`, `AA_LOCAL_URL`), and addresses written into `packages/abi`. `infra/seed/seed.ts` seeds Base Sepolia itself with real pinned Hands for the public board, writing the share links (which contain root capability secrets) to a gitignored local file.

## Trust inventory

| Party | Trusted for | Not trusted for |
|---|---|---|
| `AHandCore` | Escrow and validated settlement, exactly as coded and immutable | Real-world quality of help |
| `policyAdmin` | Token switch and charity eligibility for future Raises; can suspend new admission | Anything touching an existing Hand, `thank`, `reclaim`, `withdraw`; upgrades, rescue, winner selection (none exist) |
| `AHandSignals` | Hook-free materialization of Core-authenticated receipts from its one immutable `sourceCore` | Escrow or settlement authority |
| Raiser | Acceptance judgment — `thank` is raiser-only | Objective universal truth |
| IPFS pinning provider (Pinata) | Availability of discovery docs after the raiser's tab is gone | Integrity — content is verified byte-for-byte against on-chain commitments |
| IPFS gateways | Serving bytes | Integrity — same verification |
| Pimlico | Bundling and (optionally) sponsoring AA transactions | Transaction content — users sign; ordinary wallet transactions bypass it entirely |
| Privy | Auth and embedded-wallet key custody for social-login users | External wallets or any protocol authority |
| XMTP | Delivering Give messages | Settlement — the proof link works from any channel |
| Vercel | Hosting the web app and its API routes (including the pinning key) | Capability secrets — they travel in URL fragments and are never sent to the server |
| Graph Studio | Subgraph availability and mapping output | Creating protocol facts; nothing user-facing consumes it yet |

## Operational fallbacks

- ENS unresolved → raw addresses render everywhere; no action fails.
- Pinning or gateway outage → the board shows what it can verify; link-carried metadata still verifies against on-chain commitments.
- Bundler/paymaster outage → ordinary wallet transactions.
- Web app outage → the payload is self-identifying; a compatible client can decode and settle against Core directly.
- Push payout failure at settlement → the amount defers into a claim withdrawable permissionlessly to the fixed beneficiary.
- Token or charity later disabled by policy → live Hands still settle, reclaim, and withdraw from their snapshot.

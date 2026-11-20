# System architecture

Escrow and authorization live in three small contracts on Base Sepolia. Everything around them — the web client, the SDK, the subgraph, naming, storage, messaging — is replaceable and cannot authorize or block Core money.

- [System overview](system-overview.md) — components, data flows, failure independence
- [Contract boundaries](contract-boundaries.md) — what AHandCore, AHandSignals, and AHandWitness each own
- [SDK and link protocol](sdk-and-link-protocol.md) — `packages/sdk` and the web link codec
- [ENS](ens.md) — optional client-side display identity
- [Subgraph](subgraph.md) — the Base Sepolia Graph deployment
- [Deployment and trust boundaries](deployment-and-trust.md) — addresses, operators, trust inventory

```text
        Privy · Pimlico · XMTP · IPFS pinning        ENS (mainnet, read-only)
                       │                                      │
                       ▼                                      ▼
              apps/web (ahand.in) ──────── packages/sdk · packages/abi
                       │ raise / thank / reclaim │ capability links
                       ▼                         ▼
   Base Sepolia:  AHandCore ◄─ immutable sourceCore ─ AHandSignals   AHandWitness
                       │ events
                       ▼
              packages/subgraph (Graph Studio)
```

Each Hand snapshots its terms at `raise`: the single immutable reward token (Base Sepolia USDC) and a mandatory charity share between 1% and 30%. `AHandSignals` is a hook-free soulbound ledger immutably bound to one `AHandCore`; it materializes receipts and earned Up after the fact and has no settlement authority. Naming, indexing, storage, and messaging sit outside the money path entirely.

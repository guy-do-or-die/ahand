# Protocol model

aHand separates a small settlement primitive from the applications that discover, explain, transport, and evaluate Hands.

```text
Raiser
  │ raises reward + root capability
  ▼
Hand ──link──► Shaker ──link──► Shaker ──link──► Giver
  │               │                │                │
  │               └─ attribution   └─ attribution   └─ residual
  │                  + optional       + optional
  │                    margin           margin
  │
  └─ Thank verifies the winning route, pays out, and commits the earned-Up source
```

Core sees signed route artifacts at settlement. It does not require every pass to become a transaction.

Each Shake distinguishes route authority from optional durable attribution. The capability signer delegates the branch; if it is also the non-zero stable `shaker`, that one signature supplies attribution and payout consent. Only a distinct non-zero `shaker` signs `ShakerAcceptance`. Positive margin requires an attributed account; zero margin may use either attributed form or `shaker = 0` without a `SHAKEN` receipt.

Charity is mandatory. The Raiser chooses `charityBps` within the immutable inclusive `[100, 3_000]` range at Raise, after which the rate and recipient are frozen for that Hand.

## Documents

- [Primitive and lifecycle](primitive-and-lifecycle.md)
- [Actors and roles](actors-and-roles.md)
- [Economics](economics.md)
- [Privacy and metadata](privacy-and-metadata.md)
- [Identity and ENS](identity-and-ens.md)
- [Tags, context, and Signals](tags-context-and-signals.md)

## Separation of concerns

| Layer | Establishes | Does not establish |
|---|---|---|
| Core | Escrow, status, valid winning route, allocation and payout facts | Human identity, solution quality, global trust |
| Capability link | Authority to continue one route branch | Exclusive transfer, public ownership, or durable identity |
| Metadata commitment | Integrity of disclosed content | Availability or confidentiality by itself |
| ENS | Optional display names and avatars, resolved client-side by the web app against Ethereum mainnet | Any Core authorization; there is no on-chain ENS integration |
| The Graph | Queryable derived history (a Base Sepolia subgraph exists; the web app reads chain state directly and does not query it yet) | New protocol truth |
| Signals | Soulbound receipts plus a scarce, spendable Up | Core authority or an objective universal score |
| Application | UX, policy, discovery, scoring | Privileged economic status |

One global Signals ledger exists per Core deployment. A successful Thank commits each Raiser/Giver half-share of the charity USD value; a separate permissionless, idempotent materialization adds that credit to the actor's lifetime accumulator and mints the floor-square-root delta as earned Up. Each distinct attributed Shaker on the winning route receives one `SHAKEN` whether paid or zero-margin; anonymous hops receive none. No Shaker earns automatic Up — a participant may instead spend its own earned Up through contextual `up()` to recognize a helpful Shaker without increasing supply or enabling recursive spending. `materializeRaised` mints the `RAISED` receipt for any raised Hand regardless of how it later resolved.

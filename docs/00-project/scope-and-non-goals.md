# Scope and non-goals

## In scope (built and deployed)

- Three contracts on Base Sepolia — `AHandCore` (escrow and settlement), `AHandSignals` (soulbound receipt ledger), `AHandWitness` (peripheral timestamping) — plus a local anvil stand with MockUSD.
- Offchain EIP-712 capability delegation carried in links (domain "aHand", version "2"), with ERC-1271 fallback verification for contract signers.
- Success-only telescopic Shaker margins, up to `MAX_SHAKES = 6` hops; an optional stable Shaker account that may equal the capability signer or separately accept the exact Shake, required for every positive margin; anonymous zero-margin hops.
- Direct Raiser-only `thank` and permissionless `reclaim` after expiry; no post-Raise top-up.
- One immutable reward token per deployment: Circle Base Sepolia USDC live, MockUSD locally, with a per-Hand snapshot of the token and its USD scale.
- Mandatory charity selected by the Raiser within the immutable 1%–30% range, allocated only on successful Thank.
- Hybrid payouts with exact conservation: every allocation is pushed with a gas-bounded transfer, and a failed push defers into a pull claim withdrawable permissionlessly to the fixed beneficiary.
- Public, Preview, and Dark visibility; mandatory metadata commitment in every mode; discovery documents on IPFS verified against the on-chain commitment; up to 8 public tags in Public and Preview.
- Signals: `RAISED`, `SHAKEN`, `GIVEN`, `THANKED`, and `UP` live, with permissionless idempotent materialization, cumulative-square-root earned Up for Raiser and Giver, spendable `up()`, and fully on-chain SVG metadata. `DOWN` is reserved without an entrypoint.
- Bounded two-step policy admin: prospective token enable/disable and charity allowlist only; no pause, upgrade, rescue, winner-selection, or retrospective powers over existing Hands, Thank, Reclaim, or withdrawals.
- The web app at https://ahand.in as the reference client: Privy auth with embedded or external wallets, optional account abstraction (EIP-7702 via Pimlico), raise/board/detail/thank/pocket flows, XMTP delivery of Gives, QR share links, server-held IPFS pinning.
- The TypeScript SDK (`packages/sdk`) for typed-data hashing/signing and link payload encoding; generated ABIs and per-chain addresses (`packages/abi`).
- A Graph subgraph for AHandCore on Base Sepolia (`packages/subgraph`); the web app currently reads chain state directly over RPC and does not query it.
- Client-side ENS name/avatar resolution against Ethereum mainnet as optional display identity.
- A Foundry test suite covering validation, settlement, attack vectors, conservation, ERC-1271, fork safety, invariant fuzzing, and cross-language signature vectors.

## Explicitly out of scope for Core

- Application IDs or an application registry.
- Separate protocol roles for apps, agents, indexers, or humans.
- A maintenance fee or protocol tax; software has no revenue path beyond an ordinary successful Shaker margin.
- Discovery algorithms, messaging, feeds, and trust scores.
- ENS resolution inside a Base transaction.
- Cross-chain settlement.
- Storage of full route history before settlement.
- Enforcement of real-world solution quality.
- A universal ontology or canonical global reputation number.

## Not implemented

- Base mainnet deployment; the live network is Base Sepolia.
- On-chain ENS integration of any kind: no subnames issuance, no CCIP-Read, no naming stack in the contracts.
- Relayed Thank: the `ThankPermit` typehash is reserved, but no entrypoint exists.
- `down()`: the signal id and `DOWN_COST` constant are reserved, but there is no entrypoint.
- Multi-asset support and price oracles; the static one-dollar scale is a disclosed simplification.
- Governance, timelock, and dispute arbitration beyond the bounded prospective policy admin.
- Subgraph consumption by the web app; the subgraph is deployed but unqueried by the client.
- Programmatic Shaker agents and vertical applications; the protocol admits them today without changes, but none are built.

## Scope guard

Any proposed Core feature must answer:

1. Which actor gains a concrete ability?
2. Why can that ability not live in an application or indexer?

If the second answer is "it can live outside Core," it lives outside Core.

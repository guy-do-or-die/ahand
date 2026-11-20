# ADR-0008: Base as the settlement chain; peripheral isolation

Status: accepted

## Context

Adding chains, storage systems, identity checks, or callbacks to deterministic escrow multiplies failure modes and blurs which components are load-bearing. The protocol needs one settlement domain and a rule for what may sit outside it.

## Decision

Core settles on one Base chain per deployment. The live deployment is on Base Sepolia (chainId 84532); a Base mainnet deployment is planned. Local development runs the same contracts on anvil.

Everything else is peripheral: client-side ENS name/avatar resolution against Ethereum mainnet, the Graph subgraph, IPFS pinning and gateways for discovery documents, XMTP message delivery, and account-abstraction bundler/paymaster infrastructure. Core remains usable through raw addresses and valid signed route artifacts when any peripheral is down.

Each peripheral must pass a removal test: removing it degrades a real discovery, display, or delivery capability, and its failure neither corrupts nor freezes Core escrow. An integration that fails either half of that test is not added.

## Consequences

### Positive

- Core has one settlement and security domain.
- Peripheral failure has bounded impact: worse discovery or display, never stuck funds.
- Every integration can be explained with a concrete removal test.

### Negative

- Cross-chain reads (ENS on mainnet) need explicit client-side trust and latency handling.
- With peripherals down, users fall back to a raw-address, link-passing experience.

## Alternatives rejected

- **Cross-chain Core:** adds settlement risk without a user requirement.
- **Mandatory indexer or resolver callback:** turns availability infrastructure into settlement authority.
- **Decorative integrations:** fail the removal test and add dependency surface for nothing.

## References

- [Deployment and trust boundaries](../30-architecture/deployment-and-trust.md)

## Revisit when

If a real application requires settlement or objective verification unavailable on Base, and the cross-chain trust model is accepted on its own merits.

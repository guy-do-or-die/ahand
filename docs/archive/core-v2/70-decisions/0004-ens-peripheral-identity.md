# ADR-0004: ENS is peripheral identity and discovery

Status: accepted

## Context

Raw addresses make actors hard to recognize across independent clients, but putting name resolution inside settlement would introduce a mutable cross-chain dependency into escrow.

## Decision

ENS never grants Core authority. Core makes no ENS calls, resolves nothing, and treats no ENS record as authorization, consent, or a capability. All resolution happens in clients.

Today the integration is display-only: the web app resolves ENS names and avatars client-side against Ethereum mainnet (standard wagmi lookups via the `useEnsIdentity` hook) as optional identity decoration for addresses that have them. A record may advertise a default Shaker account or endpoint, but the capability signer must still authorize every Shake, and a distinct attributed Shaker must still sign `ShakerAcceptance`. Updating a record affects future display only; it cannot rewrite historical route attribution or Signals.

A structured `ahand.eth` namespace — branches such as `*.user.ahand.eth`, `*.app.ahand.eth`, `*.charity.ahand.eth`, `*.token.ahand.eth`, and `*.tag.ahand.eth`, possibly served from Base via an ENSIP-10 wildcard resolver with CCIP-Read — is future work. Nothing in the deployed contracts or clients depends on it, and this ADR intentionally does not specify it.

## Consequences

### Positive

- Core settlement is indifferent to resolver, gateway, or L1 availability.
- Names and avatars can rotate behind stable addresses without touching protocol facts.
- Independent clients can add or skip ENS display without compatibility impact.

### Negative

- Users without ENS names appear as raw addresses.
- Client-side mainnet resolution adds a read dependency and latency to the display path only.
- Any future namespace needs its own issuance and recovery policies before it can be relied on.

## Alternatives rejected

- **Custom application registry:** only aHand-specific clients would understand it.
- **ENS in Core:** mutable resolution and L1/gateway availability would affect escrow.
- **ENS name as authorization:** resolution is mutable metadata, not consent.

## References

- [Identity and ENS](../10-model/identity-and-ens.md)
- [ENS architecture](../30-architecture/ens.md)

## Revisit when

If a namespace under `ahand.eth` is actually issued and clients start depending on its records, its resolution and trust model needs its own ADR.

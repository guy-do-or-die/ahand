# ADR-0007: Use three explicit visibility modes

Status: accepted

## Context

One public/private flag cannot distinguish broadly discoverable requests from link-accessible requests that intentionally reveal a coarse teaser. Privacy claims are also easily overstated when hashes or URL fragments are mistaken for encryption.

## Decision

Every Hand selects exactly one visibility mode at Raise — `Public`, `Preview`, or `Dark` — immutable Core state carried in the `Raised` event.

`metadataCommitment` is mandatory in every mode. The modes differ only in discovery data:

- **Public** and **Preview** require a non-empty `discoveryRef` (≤ `MAX_DISCOVERY_REF = 128` bytes) plus a non-zero `discoveryCommitment`, and may carry public tags (≤ `MAX_PUBLIC_TAGS = 8`, strictly ascending, non-zero). Core enforces the same structural rules for both; the mode declares intent: a Public discovery document is a matching-safe description meant for open boards and indexers, while Preview publishes only a deliberate coarse teaser and the route body requires capability delegation.
- **Dark** forbids all discovery data: `discoveryRef`, `discoveryCommitment`, and tags must be empty or zero. Entry begins with capability possession.

Visibility changes discovery and metadata disclosure, never settlement arithmetic. Commitments provide integrity, not confidentiality: clients verify the fetched discovery document byte-for-byte against `discoveryCommitment`, but capability-gated bytes are not described as encrypted unless actual encryption and a key policy exist.

No mode hides the winning route after Thank. Settlement provenance retains every occurrence — position, claim delta, margin, and the consented non-zero `shaker` account or zero. An attributed zero-margin Shaker opts into public participation and one deduplicated `SHAKEN`; `shaker = 0` avoids protocol attribution but does not guarantee anonymity from capability peers, calldata, or transaction metadata.

## Consequences

### Positive

- Users can reason about what indexers and link recipients learn.
- Public boards and carousels have an explicit opt-in source.
- A Preview Hand can reveal enough to route without publishing verification secrets.
- Privacy tests can assert concrete forbidden outputs (Dark raise with any discovery data reverts).

### Negative

- Preview design requires field-level disclosure discipline in the discovery document.
- Onchain tags and discovery refs are permanent.
- A legitimate capability recipient can copy disclosed data or a bearer link.
- Dark mode reduces discovery and therefore route reach.
- Preview and Dark cannot conceal economic identities or route provenance that a successful settlement publishes.

## Alternatives rejected

- **UI-only hiding:** another client or indexer can still read published bytes.
- **Hash-only privacy:** predictable inputs may be enumerated, and obtained plaintext remains visible.
- **Resolver-enforced visibility as the sole control:** links and metadata availability need an application-level capability policy even when any resolver is unavailable.

## References

- [Privacy and metadata](../10-model/privacy-and-metadata.md)
- [SDK and link protocol](../30-architecture/sdk-and-link-protocol.md)

## Revisit when

If a deployed encryption, access-control, or confidential-compute system introduces a fourth mode with a materially different and testable security boundary.

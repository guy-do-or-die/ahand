# ADR-0003: Route authority travels in capability artifacts

Status: accepted

## Context

A Hand must travel between strangers through arbitrary Web2 channels, QR codes, and physical intermediaries. Requiring an onchain transaction or registered account for every pass would destroy that property and store losing branches permanently.

## Decision

Raise commits a fresh root capability. Each pass signs a Shake that delegates a branch to a fresh child capability, commits the claim transition, and may name a stable Shaker account. If the named Shaker equals the authorizing capability signer, the Shake signature itself supplies Shaker consent; only a distinct non-zero named account signs `ShakerAcceptance`. A positive margin requires one of those attributed forms; a zero-margin occurrence may instead remain unattributed with `shaker = 0`. Before Give, the complete live candidate route travels offchain with only the current bearer secret. After the terminal capability signs Give and the Giver accepts it, the client exports a distinct terminal proof containing those signed artifacts and no capability secret. Core validates the winning route and Give at Thank.

Identity and route authority remain conceptually separate even when one account performs both functions. A display name or a consented Shaker account may identify an actor; only the signed capability chain authorizes the next route action. In self mode the Shake signature supplies both proofs. For a distinct account, `ShakerAcceptance` consents to attribution and any positive-margin payout, not delegation.

Bearer forwarding strips the parent secret from the newly encoded live payload. Terminal proof construction strips the terminal secret and is typed separately so it cannot be imported as route authority. These protections do not revoke a sender's retained copy; capabilities remain branchable until terminality or expiry. Core caps route length at `MAX_SHAKES = 6` hops; clients bound the encoded link size.

## Consequences

### Positive

- A route can pass through any byte-preserving channel.
- Losing branches require no Core storage or gas.
- Applications can import the same neutral payload.
- The Raiser can import a complete settlement proof without receiving the terminal signing key.
- Settlement proves which route received payout allocations.

### Negative

- Copied bearer links can be exercised by the copier.
- A leaked earlier secret can create a competing truncated branch.
- A terminal holder that retains its own key can still sign competing Gives before settlement; secret stripping prevents unnecessarily sharing that power with the Raiser but is not revocation.
- Payload size grows linearly with route length.
- Availability before settlement depends on recipients retaining the route payload.

## Alternatives rejected

- **Onchain pass per hop:** adds gas, latency, surveillance, and losing-branch state.
- **Central route database:** becomes authoritative and breaks portable settlement.
- **ENS names as capability:** mutable resolution cannot prove delegation.

## References

- [Capabilities and routing](../20-protocol/capabilities-and-routing.md)
- [SDK and link protocol](../30-architecture/sdk-and-link-protocol.md)

## Revisit when

If production use demonstrates that bearer-copy risk or route-size growth cannot be bounded with personal capabilities, expiry, safe forwarding, and the maximum route limit.

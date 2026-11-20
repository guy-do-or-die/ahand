# Actors and roles

## Roles are interaction-scoped

An address is not permanently a Raiser, Shaker, or Giver. It occupies a role in one Hand or route. The same actor may occupy different roles in different Hands.

## Raiser

The Raiser:

- chooses the request and visibility;
- funds the escrow in the deployment's reward token (Base Sepolia USDC on the live deployment) and selects an allowlisted charity plus a rate within the immutable inclusive 1%–30% range;
- commits public economic terms;
- controls the root capability at creation;
- accepts one Give via `thank` or lets the Hand expire.

The Raiser cannot be cryptographically forced to judge subjective work honestly. The protocol can make refusals observable, but cannot prove offchain usefulness without an external adjudicator. A successful Thank commits the Raiser's half-charity role credit; separate permissionless Signals materialization later mints the current cumulative-square-root Up delta.

## Capability holder

The capability holder can extend or terminate one route. Capability control is intentionally distinct from:

- identity;
- payout recipient;
- application that rendered the link;
- device or messaging channel.

A link may move from person to app to bot to QR scanner and back. Core does not need to know those categories.

## Shaker

The Shaker adds routing value. It may be:

- a friend forwarding a message;
- venue staff scanning or sharing a QR;
- the web app constructing an initial route;
- a bot or another application forwarding a public Hand.

Every Shaker uses the same signed Shake and margin rule. One Shake distinguishes the **authorizing capability signer** from the optional stable **attributed Shaker account**:

- If they are the same non-zero address, the Shake signature proves both route authority and attribution/payout consent.
- A distinct non-zero attributed Shaker must separately sign `ShakerAcceptance` over that exact Shake, so an uninvolved address cannot be framed as a participant.
- A zero-margin hop may instead use `shaker = 0` and forward anonymously; a positive margin always requires a non-zero attributed account.

Core contains no `appId`, `agentId`, `appFee`, or privileged registrar checks; software participates under exactly the same rules as people.

An actor may forward at zero margin as a pure pay-it-forward action. If it accepts attribution, a winning Hand gives it `SHAKEN` but no automatic Up. Another actor may later recognize that contribution through the contextual `up()` action, which spends the issuer's earned Up and credits only non-respendable received Up.

## Giver

The Giver is the consenting final helper identity and the fixed destination of the residual reward. There is deliberately no separate Giver payout address. The Giver's acceptance binds its own address together with the exact Give, route, solution commitment, and economics, preventing a route holder from attributing an arbitrary solution, payout, or reputation consequence to an uninvolved identity.

Giver consent does not guarantee Raiser acceptance; Thank is a direct, raiser-only action. That irreducible risk is addressed through terms, contextual evidence, and application trust policy.

A successful Thank commits the Giver's other half-charity role credit; materialization mints the corresponding Up delta on the same global ledger the Raiser uses. `earnedUp` and `receivedUp` are accounting portions, not role-specific token types.

## Applications and agents

Applications are participants and interpreters, not protocol tenants. Like people, software may be a Raiser, Shaker, or Giver in a particular interaction. It is a Shaker only when it actually forwards route authority, and it monetizes only through ordinary consented Shaker margins on winning routes.

## Charity and token policy

Core carries two small policy maps, not registries: `setTokenEnabled` can suspend new Raises in the single immutable reward token, and `setCharityAllowed` maintains the charity allowlist. Policy changes are prospective only — a Hand snapshots its token, scale, charity address, and rate at Raise, and no later change affects it.

## Signals participation

- A successful Raiser becomes eligible for materialized `THANKED` and earned Up.
- A successful Giver becomes eligible for materialized `GIVEN` and earned Up.
- Every distinct attributed Shaker on a successful Hand receives one `SHAKEN`, whether its margin was positive or zero. Anonymous (`shaker = 0`) hops receive none.
- Route events retain every occurrence, but repeated attribution of the same address within one Hand does not multiply its `SHAKEN` balance.
- No Shaker receives automatic Up. Any actor with at least one whole Up of remaining `earnedUp` may explicitly pass whole Up to another actor via `up()`; the ledger debits `wholeUpCount * 10^9` raw units and the target receives the same amount as non-respendable `receivedUp`.
- Down is reserved: signal id 6 and the `DOWN_COST` constant (`3 * 10^9`) exist, but no `down()` entrypoint does. Nothing mints or burns Down today.

Signals live in a hook-free soulbound multi-token ledger with no transfers, approvals, or recipient callbacks; it does not claim ERC-1155 conformance. Signals cannot authorize or block money movement.

## Identity is optional

A route remains valid with raw addresses and capabilities. The web app resolves ENS names and avatars client-side as optional display identity; ENS is never a settlement dependency. See [Identity and ENS](identity-and-ens.md).

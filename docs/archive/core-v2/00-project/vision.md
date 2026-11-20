# Vision and design principles

## Problem

Marketplaces require the right helper to visit the right marketplace, search the right category, and trust a platform-specific reputation system. Many real problems instead travel through existing relationships: a friend knows a specialist, a venue knows its staff, a local group knows a finder, or an agent can discover a relevant public request.

aHand makes that route economically legible without requiring the route to occur inside one social network or application.

## Primitive

A Raiser escrows a reward and creates a Hand. The Hand travels as a capability-bearing link through arbitrary channels: direct messages, email, social networks, community forums, QR codes, NFC tags, or physical handoff. Each Shaker can forward the live capability and reserve a success-only margin. The capability signer may attribute itself with the same Shake signature, or route authority may attribute a distinct stable account that separately accepts the exact Shake; a zero-margin pass may instead remain anonymous at protocol level. A Giver returns a solution. The Raiser Thanks the accepted Give, and Core validates and settles only the winning route.

## Principles

### Protocol over marketplace

Core owns no discovery, feeds, messaging, ranking, matching, or vertical-specific schemas. Applications and agents add those functions at the edges.

### One route role for every intermediary

A human, frontend, indexer, bot, or autonomous agent is a Shaker when it advances a capability. Core creates no separate economic classes for applications or agents.

### Pay only successful contribution

Shaker margins are paid only from a successfully settled route. There is no protocol maintenance fee and no special application fee. The mandatory charity share — the Raiser chooses its rate within the immutable 1%–30% range at Raise — is not an intermediary fee: it is the external economic cost that grounds earned Up, and it is allocated only when a Give is Thanked. Reclaim returns the full pool with no charity cut.

### Links are transport, not accounts

The current capability can move through any byte-preserving communication channel. No recipient is required to create a platform account merely to inspect or forward a Hand.

### Minimal trusted Core

Core protects escrow and validates settlement. Identity, discovery, semantic interpretation, indexing, reputation, and presentation remain peripheral and cannot freeze or redirect Core funds.

### Privacy is selected by the Raiser

Every Hand carries a mandatory `metadataCommitment`; beyond that, the Raiser picks one of three visibility modes. Public and Preview both publish a bounded discovery reference and its commitment, and may attach up to eight public tags; Public discloses the full discovery document, while Preview discloses a deliberately limited one and keeps the route body capability-gated. Dark publishes no discovery reference, no discovery commitment, and no tags. A hash is not automatically private, and deterministic public identifiers remain discoverable.

### Signals are scarce and non-recursive

A successful Thank fixes the Raiser's and Giver's charity-value credits; separate permissionless materialization later mints each actor's cumulative-square-root marginal Up output. Earned Up can be spent to Up another actor; received Up cannot be spent again. Every distinct consented Shaker account on the winning Hand receives one `SHAKEN`, including an attributed zero-margin contributor; an anonymous zero-margin occurrence receives none. Shakers receive no automatic Up — another actor may explicitly spend earned Up to recognize a contribution. This supplies factual participation receipts plus costly, inspectable judgment without making route length an issuance strategy. (Down is reserved in the ledger — id and cost constant exist — but has no entrypoint yet.)

### Facts and interpretations stay distinct

Core events report protocol facts. Tags are attributed classifications. Signals contain protocol receipts and attributable Up actions. ENS names are client-resolved display metadata. Indexers and applications may derive contextual scores, but they must expose their inputs and must not present a projection as Core truth.

### Composability through stable interfaces

Other applications should be able to route a Hand, resolve an actor, index public events, and evaluate Signals without becoming privileged protocol members.

## Closing

The measure of the design is that any client, application, or agent can raise, route, and settle a Hand with no `appId`, no privileged registration, and no application-specific settlement path. The web app at https://ahand.in is one such client — the reference one, not a privileged one.

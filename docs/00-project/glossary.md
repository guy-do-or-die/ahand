# Glossary

Terms in this file are canonical. Contracts, SDK types, UI labels, and subgraph entities use them consistently.

## Core nouns

### Hand

One escrowed, incentivized request and its lifecycle. Status moves `Active → Settled` (on Thank) or `Active → Reclaimed` (after expiry); both end states are terminal.

### HandRef

The globally unique reference to a Hand:

```text
(chainId, sourceCore, handId)
```

`sourceCore` is the AHandCore contract that owns the Hand. `handId` alone is only locally unique within one Core deployment. An AHandSignals deployment is immutably bound to one `sourceCore` and authenticates Signal source facts against this complete identity.

### Raiser

The actor who creates and funds a Hand and ultimately accepts a Give. `thank` is callable only by the Raiser.

### Shaker

Any intermediate human or programmatic actor that forwards the live route capability. A Shaker may reserve a disclosed margin. On a winning Hand, each distinct non-zero consented Shaker account receives one factual `SHAKEN`; only positive-margin occurrences create payout allocations, and route participation never mints automatic Up.

### Giver

The final helper who supplies the solution or performs the requested action and receives the residual payout. Implementation terminology uses `giver`; `solver` is avoided unless a technical integration requires it.

### Give

The terminal, signed proposal binding a Hand, a solution commitment, a Giver, the terminal route claim, and expiry/replay controls.

### Thank

The Raiser's acceptance of a Give and the resulting atomic terminal accounting. `thank` verifies the EIP-712 route chain (with an ERC-1271 fallback for contract signers), splits the pool into charity, per-hop Shaker margins, and Giver residual, pushes each payout, and stores a commitment (`thankSignalSourceHash`) from which the isolated Signals ledger is materialized permissionlessly and idempotently under `THANK_SOURCE`.

### Capability

Unforgeable authority to extend or terminate a route branch. It is distinct from actor identity and from a stable Shaker or Giver account. A bearer capability may be represented by a fresh key carried in the link (the web app puts the secret in the URL fragment, which is never sent to the server); a personal capability may be bound to a wallet or smart account. Offchain delegation does not revoke the parent's retained copy.

### Shake

A signed delegation from a parent capability to a child capability. It binds the Hand, an optional stable Shaker account, the claim before and after the hop, an optional hop-data commitment, and validity controls. If the attributed Shaker is the authorizing capability signer, this signature also supplies Shaker consent; only a distinct non-zero Shaker separately accepts the exact Shake.

### Pass

The client/UI action that creates and transports a Shake plus a fresh child capability. `Pass` is not a separate Core artifact.

### Shaker account

The optional stable address attributed as the Shaker for one route occurrence. It may equal the authorizing capability signer or be a distinct account. If the margin is positive, this address is also the fixed margin destination and must be non-zero. An anonymous hop (`shaker = 0`) is valid only at zero margin and receives no receipt; an attributed zero-margin account still becomes eligible for `SHAKEN`.

### ShakerAcceptance

The signature by a distinct non-zero Shaker account over one canonical `shakeHash`. It proves control and consent to attribution and, where applicable, payout terms. It is unnecessary when `shaker` equals the authorizing capability signer, because the Shake signature already supplies both proofs.

### Claim

The fraction (in basis points) of the distributable reward that remains available downstream at a route position.

### Margin

The difference between the parent and child claims reserved by one Shaker: `floor(distributable * (parentClaimBps - childClaimBps) / 10_000)`. It is paid only when that route wins.

### Payout allocation

An immutable non-zero accounting entry created by Thank or Reclaim, with kinds `Charity`, `ShakerMargin`, `GiverResidual`, and `RaiserRefund` (event `PayoutAllocated`). Core immediately pushes each allocation to its beneficiary with a gas-bounded transfer (120,000-gas stipend, event `PayoutPushed`); if the push fails, the amount is deferred into an aggregate `(token, beneficiary)` claim (event `PayoutDeferred`). Deferred claims are drained by `withdraw(token, beneficiary)` — permissionless to trigger, but the destination is fixed to the beneficiary (event `PayoutWithdrawn`). Conservation is exact: the Giver residual absorbs rounding dust.

### Reward token

The single immutable ERC-20 configured per Core deployment (`rewardToken`). On the live Base Sepolia deployment it is Circle's Base Sepolia USDC, `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6 decimals); on the local anvil stand it is MockUSD. Core snapshots `usdScale = 10^(18 - decimals)` into each Hand at Raise, rejects fee-on-transfer behavior by requiring the exact deposit, and policy changes (`setTokenEnabled`) are prospective only — they never affect an Active Hand.

### Charity

The eligible recipient of the mandatory success-only charitable share. The Raiser selects a recipient from the policy allowlist and a `charityBps` within the immutable inclusive `[100, 3_000]` range (1%–30%); both are frozen at Raise. The charity share is `floor(credited * charityBps / 10_000)`, allocated only on Thank. Reclaim returns the full pool to the Raiser and creates neither a charity allocation nor earned Up.

### ThankPermit

Reserved. `THANK_PERMIT_TYPEHASH` is defined in AHandTypes for a future relayed Thank, but no entrypoint exists; `thank` is direct and Raiser-only.

### Witness

Optional peripheral timestamping through AHandWitness, which has zero Core connectivity: `witness(hash)`, `witnessShake`, `witnessGive`, and `witnessRoot` record first-write-wins timestamps. A Witness proves that signed bytes existed at a time; it does not prove that a Shake belonged to the winning route or that a solution was useful.

## Semantic and trust nouns

### Tag

A reusable public label attached to a Hand at Raise. On-chain a tag is an opaque `bytes32`; a Hand may carry up to 8, strictly ascending, unique, and non-zero. Tags are allowed in Public and Preview modes and forbidden in Dark. A tag classifies; it does not prove.

### Context

The derived information surrounding an interaction: HandRef, protocol facts, metadata, tags, actors, provenance, and Signals. Context is not a minted object and has no mandatory singular reference. The `up` operation takes a non-zero `UpContext` binding the recognition to a concrete interaction.

### Signal

One entry in aHand's hook-free soulbound multi-token ledger (AHandSignals). Six canonical ids: `RAISED=1`, `SHAKEN=2`, `GIVEN=3`, `THANKED=4`, `UP=5`, `DOWN=6` (reserved — no entrypoint). The ledger exposes ERC-1155-shaped balances and `TransferSingle` events for indexer compatibility but does not claim ERC-1155 conformance (it advertises ERC-165 only): there are no approvals, transfers, or receiver callbacks, so a contract actor cannot veto its own receipts. `uri(id)` returns a fully on-chain SVG data URI. Signals never control escrow or make a route valid.

`SHAKEN` is a factual participation receipt, not a payment receipt or trust weight. Exactly one is materialized per distinct non-zero consented Shaker account on the winning Hand; anonymous zero-margin occurrences receive none, and repeated occurrences by the same account are deduplicated.

Protocol receipts are materialized permissionlessly (`materializeRaised` for any raised Hand, `materializeThank` after settlement) from facts authenticated against the ledger's immutable `sourceCore`. Idempotence is tracked by a typed, domain-separated source key; `RAISED_SOURCE` and `THANK_SOURCE` are distinct, so one Hand's Raise and Thank receipt sets are processed independently and exactly once.

### Up

One soulbound positive Signal balance with two accounting portions:

```text
Up balance = earnedUp + receivedUp
```

`earnedUp` is the remaining Up an actor may spend to signal other actors. `receivedUp` was given by others and cannot be spent again. These are portions of one token id, not separate token types. `ONE_UP = 1e9` raw units (9 decimals); `up(target, wholeUpCount, context)` spends `wholeUpCount * ONE_UP`, requires a non-zero context, and forbids self-targeting.

### Earned Up

The spendable portion of Up, created only for the Raiser and Giver by successful Thank and minted during separate permissionless materialization. Each of the two actors gets half of the Hand's charity USD value added to one global lifetime accumulator (`cumulativeUsd`) and is minted only the increase in `floor(sqrt(cumulativeUsd))` — a cumulative-square-root, sub-additive curve. Spending Up reduces remaining `earnedUp` but never rewrites the historical accumulator.

### Received Up

Up assigned by another actor through the explicit `up` operation. It contributes to the recipient's balance but does not increase `earnedUp` and therefore cannot be forwarded recursively.

### Down

Reserved. The signal id (`DOWN=6`) and cost constant (`DOWN_COST = 3 * ONE_UP`) are defined in the ledger, but no `down` entrypoint exists; semantics, reason/evidence encoding, and any derived display weight are open.

### Protocol fact

An event or state transition directly established by Core, such as a deposit, settlement, route payout, or reclaim.

## Application and identity nouns

### App

Any programmatic participant: a frontend, agent, bot, indexer, or hybrid. An app holds no Core privilege and has no registry or `appId`; when it advances a capability it is an ordinary Shaker, with the same margin path and the same `SHAKEN` receipt as an attributed human.

### Web app

The reference client at https://ahand.in — the one application built today. It composes and funds Hands, transports capabilities as links and QR codes, runs the shake/pass/give/thank flows, and reads chain state directly over RPC. It has no Core privilege; if it ever reserved a margin it would do so as an ordinary disclosed Shaker.

### ENS profile

Optional client-side display identity. The web app resolves ENS names and avatars read-only against Ethereum mainnet (standard lookups, no custom gateway) and shows them next to addresses. Resolution grants no Core authority, and the contracts contain no ENS integration.

## Privacy nouns

All three modes require a mandatory `metadataCommitment`.

### Public Hand

A Hand that publishes a non-empty discovery reference (≤ 128 bytes, an IPFS locator in practice) and its non-zero `discoveryCommitment`, plus optional public tags. Its discovery document may be indexed and discovered without possessing the capability link; clients verify the fetched document byte-for-byte against the commitment.

### Preview Hand

A Hand with the same on-chain requirements as Public — discovery reference, discovery commitment, optional tags — whose discovery document deliberately exposes only a limited preview while the route body and route authority stay capability-gated.

### Dark Hand

A Hand that publishes no semantic discovery data: discovery reference, discovery commitment, and tags must all be empty. Its route body travels only with capability possession. Dark does not mean recipients cannot copy what they receive or that ordinary blockchain facts (deposit amount, timing, settlement) are hidden.

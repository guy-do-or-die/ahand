# Open questions

Genuinely unresolved items. Settling one should update this file and, where load-bearing, add an ADR.

## Base mainnet deployment

The system runs on Base Sepolia. Whether and when to deploy to Base mainnet is open, along with the operational details: re-verifying Circle's mainnet USDC address at deployment time, choosing the policy admin and initial charity allowlist, and funding/liquidity for real rewards.

## Discovery-document pinning

Discovery documents are pinned through a single server-held key (`/api/pin`, Pinata or Web3.storage). The on-chain commitment is an integrity anchor, not an availability guarantee: pinning redundancy, retention monitoring, and failure alerting are unresolved. When no key is configured the endpoint honestly returns `pinned: false`, which is fine for development but not a durability story.

## Subgraph consumption

The Base Sepolia subgraph indexes AHandCore events, but the web app reads chain state directly over RPC. Open: when to move the board, activity, and history reads onto the subgraph, and whether to add a Signals datasource to it.

## Down semantics

`DOWN = 6` and `DOWN_COST = 3 * ONE_UP` are reserved in the ledger with no entrypoint. The entrypoint shape, reason/evidence encoding, idempotence keying, and whether clients derive a display weight all remain to be decided.

## Relayed Thank

`THANK_PERMIT_TYPEHASH` is reserved; `thank` is direct and Raiser-only. A relayed path needs nonce/deadline encoding, a relayer submission model, and careful interaction with ERC-1271 validation before it can ship.

## Payload encryption for Preview and Dark

Capability secrets ride in the URL fragment, which avoids ordinary HTTP transmission but does not encrypt the route body from recipients. Preview route bodies are capability-gated plaintext today. Encryption, recipient keying, and recovery are open privacy work.

## Tag namespace governance

On-chain a tag is an opaque `bytes32`, and the web app does not yet attach tags at raise. Whether to bind tags to a naming convention or registry, and how to handle spam and squatting without making a semantic label into property, is unresolved.

## ENS namespace under ahand.eth

ENS is display-only today: the web app resolves existing names client-side. Whether to issue subnames under `ahand.eth` for users, charities, or apps — and with what controller, renewal, and recovery policies — is open.

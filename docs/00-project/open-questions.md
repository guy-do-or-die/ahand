# Open questions

Genuinely unresolved items. Settling one should update this file and, where load-bearing, add an ADR.

## Base mainnet deployment

The system runs on Base Sepolia. Whether and when to deploy to Base mainnet is open, along with the operational details: re-verifying Circle's mainnet USDC address at deployment time, choosing the policy admin and initial charity allowlist, funding/liquidity for real rewards, and moving Give delivery to XMTP `production` (`VITE_XMTP_ENV`), which leaves every `dev`-network identity and conversation behind.

## Gas sponsorship

`/api/aa` sponsors only the app's own calls from EIP-7702 `Simple7702Account` senders, but it does not know who is asking: any holder of such an account can get those calls sponsored, and an owner who submits the signed op themselves can swap the account's code in the same transaction. Open: whether to require a server-verified Privy session and bind the op's sender to that user's embedded wallet, which calls deserve sponsorship (for example `withdraw`, or receipt mints sent on someone else's behalf), whether the `RAISED` receipt should stay a second sponsored op after every sponsored raise (it cannot ride in the raise batch, because the hand id is unknown until `raise` executes), and the Pimlico policy's global, per-user and per-op spend caps.

## Solution notes

The salted solution commitment ([ADR-0013](../70-decisions/0013-salted-solution-commitment.md)) canonicalizes only edge whitespace (`trim`). Whether to also normalize Unicode (NFC), inner whitespace, or line endings is open; a changed canonical form needs a new commitment tag so older seals keep verifying. The note's length is also unsettled: the Give form puts no cap on it, while the raiser's inbox (`parseGiveMessage`) ignores any message over 8192 characters, so a very long note plus its proof link never shows up.

## Witness

`AHandWitness` keys a typed anchor on `keccak256(structHash, sig)`, so one Shake or Give signed twice (a fresh ECDSA nonce, another signer implementation) can be anchored, and emitted, twice; keying on the struct hash alone is the alternative. `witnessGive` checks only that the recovered key signed the Give bytes — not the Hand, the route, the deadline, giver consent, or an ERC-1271 giver. Both are open, as is when to redeploy Witness on Base Sepolia: the deployed contract predates the blind/typed namespace split (see [deployment and trust](../30-architecture/deployment-and-trust.md)).

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

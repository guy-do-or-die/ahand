# Identity and ENS

## Identity is optional

Routes work with raw addresses. Core authorization comes from `msg.sender` checks, EIP-712 signatures, and capability-chain linkage; no name system participates in raise, thank, reclaim, or withdraw.

## What the app does with ENS

The web app resolves ENS names and avatars client-side against Ethereum mainnet, using standard wagmi/viem resolution (the `useEnsIdentity` hook; the endpoint is configured with `VITE_ENS_RPC`). This is read-only display sugar: a resolved name labels an address in the UI and never substitutes for it in a signature, route, or payout. Where no name resolves, the UI shows the raw address.

## What does not exist

The contracts contain no ENS integration: no resolvers, no CCIP-Read, no subname issuance, no coin-type records. ENS availability cannot affect settlement, and an ENS record never authorizes anything.

Updating an ENS name rotates future display only. Soulbound Signals and historical protocol facts stay with the underlying address.

## Future work

The team holds `ahand.eth`. A namespace under it — subnames for users, applications, charities, or tag vocabularies — is a possible future direction; nothing is specified or built.

# Web app

The web app is the reference client for aHand: a TanStack Start (Vinxi) application deployed on Vercel at https://ahand.in. It reads chain state directly over RPC via viem (`getHand`, `handsCount`, Signals `balanceOf`, Witness `witnessedAt`) and does not query the [subgraph](../30-architecture/subgraph.md). Production targets Base Sepolia; local development runs against anvil (chain id 31337), selected via `VITE_CHAIN`. Styling is Tailwind v4; all copy goes through Lingui i18n with an English-only catalog.

## Routes

- `/` — landing: hero, how-it-works, and a live carousel of open Hands read from chain.
- `/raise` — compose and fund a Hand: title, description, reward amount, expiry (1–180 days, default 30), charity share (picker with 1% / 5% / 10% / 30% presets, clamped to the protocol's 1–30% range), and visibility (Public / Preview / Dark); ends on a share screen with the link and its QR code.
- `/hands` — public board: the 24 newest Public Hands, read straight from chain.
- `/h/$id` — Hand detail: current state, the route so far, and shake / pass / give / reclaim actions. The discovery document is fetched from an IPFS gateway and verified byte-for-byte against the on-chain `discoveryCommitment` before it is shown.
- `/h/$id/thank` — the raiser's settlement flow.
- `/pocket` — personal dashboard: incoming Gives (XMTP inbox), payout claims, and activity; includes a dev faucet when running on anvil.
- `/dev/gallery` — component gallery, development only.

## Server routes

- `/api/pin` — pins discovery documents (under 2 KB) to IPFS using a server-held key (Pinata JWT or Web3.storage token); the key never reaches the client. The route computes the CID locally and returns `pinned: false` honestly when no key is configured.
- `/api/og/$id` — Satori-rendered Open Graph images for Hand links.
- `/api/rpc` — RPC proxy for local development.
- `/api/aa` — proxy to the Pimlico bundler/paymaster, or a local mock.

## Auth and wallets

Privy handles social login (email, Google, passkey, Farcaster, Twitter) and provisions an embedded wallet; external wallets connect through wagmi/viem. Account abstraction sits behind the `VITE_AA_ENABLED` flag: permissionless.js with EntryPoint v0.8, the EIP-7702 `Simple7702Account` implementation, and Pimlico bundler and paymaster (optionally under a Pimlico gas-sponsorship policy).

## Give delivery

A Give can be sent directly to the raiser over XMTP (v7, "dev" environment); exporting the Give as a link is the fallback. Hand pages poll XMTP for direct replies, so a conversation can continue where the Hand lives.

## Links and secrets

Share links are ordinary HTTPS URLs on `/h/$id`. An `e=` query parameter carries the base64url-encoded discovery doc so the server can render a preview; the capability secret travels only in the URL fragment and is never sent to the server. Share screens render the same link as a QR code.

## Identity

ENS names and avatars are resolved client-side against Ethereum mainnet (standard wagmi lookups in the `useEnsIdentity` hook) as optional display identity — see [identity and ENS](../10-model/identity-and-ens.md). Resolution is display only and plays no part in authorization.

# ENS

ENS is an optional, client-side display layer. Nothing in the contracts reads, writes, or depends on ENS, and no protocol action requires a name.

## What is built

The web app resolves an address to its primary name and avatar with the `useEnsIdentity` hook (`apps/web/app/hooks/useEnsIdentity.ts`): standard wagmi `useEnsName`/`useEnsAvatar` lookups pinned to Ethereum mainnet (`chainId: mainnet.id`), regardless of the chain the app transacts on — that is where names live. `VITE_ENS_RPC` overrides the mainnet RPC endpoint used for these reads. Results are cached for five minutes and retried once.

When resolution fails, times out, or an address simply has no name, `displayIdentity` (`apps/web/app/lib/ens.ts`) falls back to a truncated raw address, so every identity in the UI renders unconditionally. A resolved name is presentation only: settlement, routes, and payouts use addresses everywhere.

`ahand.eth` is held by the team on Ethereum mainnet. It currently anchors nothing at runtime.

## What is not built

There is no on-chain ENS integration: no CCIP-Read, no Durin, no wildcard resolver, no subname issuance, no ENS-based service discovery. Tag ids are opaque `bytes32` values to the protocol; the web app applies no namehash convention to them.

## Future work

Possible later directions, none in progress: subnames under `ahand.eth` for users or applications, and ENS text records as application profiles. Any such addition stays outside Core — naming can never authorize or block money (see [Contract boundaries](contract-boundaries.md)).

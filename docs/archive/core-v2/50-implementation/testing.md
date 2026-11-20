# Testing

Two suites cover the protocol: a Foundry suite for the contracts and a vitest suite for the SDK, tied together by generated cross-language signature vectors.

## Contract suite (`contracts/test`)

All suites build on a shared harness (`AHandTestBase.sol`) with mock tokens and actors under `contracts/test/mocks`.

- `AHand.raise.t.sol` — raise validation: exact-deposit escrow and fee-on-transfer rejection, policy checks, visibility coherence per mode (mandatory `metadataCommitment`; Dark requires empty discovery data and no tags; Public/Preview require discovery ref and commitment), tag rules (at most 8, strictly ascending, non-zero), expiry bounds, and the precedence order of revert reasons.
- `AHand.policy.t.sol` — policy admin: prospective-only token enable/disable and charity allowlisting (live Hands unaffected), two-step admin transfer, `policyRevision` bump rules, and the absence of stray selectors, `receive`, and `fallback`.
- `AHand.acceptance.t.sol` — the acceptance matrix across hop attribution modes: anonymous hops valid only at zero margin, self-attributed hops without a second signature, explicit shakers requiring `ShakerAcceptance`; missing, garbage, wrong-signer, wrong-hash, and cross-Hand/cross-hop replayed acceptances; giver acceptance; margin that rounds to zero.
- `AHand.withdraw.t.sol` — permissionless `withdraw` to the fixed beneficiary: aggregation across Hands and settlements, zero-claim cases, and claim persistence with retry after a blacklisted-beneficiary push failure.
- `AHand.attacks.t.sol` — attack vectors: route truncation and tail substitution, claim growth and per-hop floor violations, signature malleability, settle-once, escrow isolation, force-send bookkeeping, and a fuzzed self-insertion coalition bound.
- `AHand.conservation.t.sol` — exact conservation: a golden twenty-dollar fixture, a fuzzed exact-conservation property, and duplicate-shaker claim aggregation.
- `AHand.erc1271.t.sol` — ERC-1271 wallets in every role (up to a route where all fourteen signers are contracts), gas-bomb validators contained by the 350k verification gas cap, a reentrant validator blocked without state change, and ECDSA-first fallthrough to the contract path.
- `AHand.forksafety.t.sol` — fork safety: the domain separator matches its canonical derivation and changes on a chain-id fork; pre-fork shake, give, and acceptance signatures fail post-fork while fresh ones succeed.
- `AHand.invariant.t.sol` — stateful invariant fuzzing across raise/thank/reclaim/withdraw/materialize/up: strict conservation, Hand lifecycle, Signals accounting, and monotone processed sources.
- `AHand.routehash.t.sol` — route hash binding: tail-swap rejection, independence from signature bytes, and a locked derivation.
- `AHand.windows.t.sol` — expiry windows: thank succeeds up to expiry and fails at it, reclaim is permissionless from expiry onward, and shake/give deadlines are bounded by expiry.
- `Signals.materialize.t.sol` — signals materialization: idempotence via typed source keys, settlement-commitment mismatch rejection, the cumulative-square-root earned-Up curve and its order independence, per-Hand shaker dedup with anonymous hops skipped, hook-free mints to contracts, `up()` guard ordering, and the soulbound ERC-165-only surface.
- `GenVectors.t.sol` — generates `packages/sdk/tests/test-vectors.json`, the byte-identity oracle the SDK replays; pinned to chain id 31337, a fixed core address, and well-known keys so the output is environment-independent.

## SDK suite (`packages/sdk/tests`)

- `vectors.test.ts` replays the Foundry-generated vectors: domain separator, typehashes, struct hashes, digests, and signatures must reproduce byte-identically on both the raw and typed-data signing paths.
- `provisional.test.ts` covers typed-data coherence, `handRef` and `routeHash` layout, EIP-2098 compact signatures, the LiveRoute and TerminalProof codecs (round-trips, secret stripping on forward, kind discrimination, size caps), and `verifyLiveRoute` / `verifyTerminalProof` — including signature-tampering cases: flipped signature bytes, raised claims, swapped shakers and givers, dropped hops, and replay against another Hand.

## Running

From the repo root:

```sh
bun run test          # contracts: runs `cd contracts && forge test`
```

Or directly per suite:

```sh
cd contracts && forge test
cd packages/sdk && bun run test    # vitest run
```

Regenerate the cross-language vectors after changing the signing library:

```sh
cd contracts && FOUNDRY_OUT=out-vec forge test --match-path 'test/GenVectors.t.sol' -vv
```

The web app has no automated test script; it is exercised manually against the local stand (`bun run stand`).

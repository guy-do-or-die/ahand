# Testing

Two suites cover the protocol: a Foundry suite for the contracts and a vitest suite for the SDK, tied together by generated cross-language signature vectors.

## Contract suite (`contracts/test`)

The suites of the earlier Core, listed below as history, built on a shared harness (`AHandTestBase.sol`, no longer in the tree) with mock tokens and actors; the current suites share `contracts/test/Helpers.sol` and the mocks under `contracts/test/mocks`.

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

> The list above describes the suites of the earlier Core and is kept as history. The current
> contract suites are `contracts/test/Core*.t.sol`, `Deploy.t.sol`, `Gas.t.sol`, `SdkGas.t.sol` and
> `SdkVectors.t.sol`; the last writes `contracts/test/fixtures/sdk-vectors.json`, Core's own answers
> about signed routes and Gives, which the SDK replays.

## SDK suite (`packages/sdk/tests`)

Vitest files for the modules of `packages/sdk/src` (`link.test.ts`, `address.test.ts`,
`proof.test.ts`, `verify.test.ts`, …). `core-vectors.test.ts` and `verify.test.ts` replay Core's
fixtures; `link-vectors.test.ts` reads `link-vectors.json`, the links that independent readers
open with the same answer. Several suites start their own anvil from the contracts' build, so
`forge build` comes first. See [the SDK](../sdk.md).

## Running

From the repo root:

```sh
bun run test:contracts   # cd contracts && forge test
bun run test:sdk         # the SDK's vitest suites
bun run test:vectors     # rewrites Core's fixtures and fails if they changed
bun run check            # everything CI runs
```

The web app (`apps/web`) is tested by `bun run test:web` and the browser suites in `tests/e2e`,
against a local stand from `infra/stand` (`bun run stand`). An earlier note here described the
manual runs of the earlier client against `infra/anvil/stand.ts`; that stand is history.

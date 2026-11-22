# Documentation index

This directory documents the aHand protocol and the reference implementation in this
repository: the contracts in `contracts/`, the web client in `apps/web`, the view server in
`apps/view`, the SDK in `packages/sdk`, the subgraph in `packages/subgraph`, and the local
infrastructure in `infra/`. The code is the source of truth; these pages describe what is built and why.

> **The current SDK and link format.** Core was rewritten (`contracts/src/AHandCore.sol` is the
> only contract), and the SDK with it. Two pages describe them as they are now:
> [the SDK](sdk.md) and [links](links.md). [Delivery](delivery.md) describes how a helper's answer
> reaches the asker over Nostr relays (`packages/deliver`, and `infra/relay` for local tests).
> [The view server](view.md) describes the preview server for messengers' link previews (`apps/view`).
> The numbered folders below were written for the earlier Core (with `AHandSignals`,
> `AHandWitness`, a subgraph and the earlier link codec) and have not been brought up to date yet:
> read them as the history of the design, and where they disagree with the code or with these
> pages, the code and these pages hold.
>
> **Deployments.** The deployment registry is `contracts/deployments/<chainId>.json`, which
> `@ahand/abi` (`packages/abi`) exposes as `DEPLOYMENTS`, together with each network's USDC
> (`NETWORKS`). The earlier `packages/abi/src/addresses.{chain}.json` files and the `AHAND_CHAIN`
> setting that chose one of them are gone, as are the earlier exports `DeployedAddresses`,
> `AHandSignalsAbi` and `AHandWitnessAbi`.
> Its Core ABI export is now `aHandCoreAbi` (was `AHandCoreAbi`) and the test token's is `mockUsdAbi`
> (was `MockUSDAbi`): @wagmi/cli writes them, in its camelCase naming.
>
> **Code not ported yet.** `apps/web`, `packages/subgraph`, `infra/anvil` and `infra/seed` were
> written for the earlier Core, the earlier SDK and the earlier `@ahand/abi`. They are not in the
> workspaces, `bun run check` does not cover them, and they do not build on this branch until they
> are ported to the current Core.

## Map

| Area | Purpose |
|---|---|
| [`00-project`](00-project/README.md) | Vision, glossary, scope, and open questions. |
| [`10-model`](10-model/README.md) | Product and protocol semantics without contract-level detail. |
| [`20-protocol`](20-protocol/README.md) | State machine, signed artifacts, settlement, events, and invariants. |
| [`30-architecture`](30-architecture/README.md) | Contracts, SDK, web client, ENS, subgraph, and deployment. |
| [`40-applications`](40-applications/README.md) | The web application and the application model. |
| [`50-implementation`](50-implementation/README.md) | Current status and the test suite. |
| [`70-decisions`](70-decisions/README.md) | Architecture Decision Records for load-bearing choices. |
| [`templates`](templates/README.md) | The ADR template. |

## Recommended reading by task

**Working on Core** — [glossary](00-project/glossary.md),
[protocol model](10-model/README.md), [economics](10-model/economics.md),
[core state machine](20-protocol/core-state-machine.md),
[routing](20-protocol/capabilities-and-routing.md),
[settlement](20-protocol/settlement-and-giver-protection.md),
[events](20-protocol/events-and-indexing.md),
[invariants](20-protocol/invariants-and-threat-model.md),
[contract boundaries](30-architecture/contract-boundaries.md).

**Working on the web app or an integration** —
[actors and roles](10-model/actors-and-roles.md),
[privacy and metadata](10-model/privacy-and-metadata.md),
[tags, context, and Signals](10-model/tags-context-and-signals.md),
[the SDK](sdk.md), [links](links.md),
[web app](40-applications/web-app.md).

**Working on link previews** — [links](links.md), [the view server](view.md).

**Working on indexing** — [events](20-protocol/events-and-indexing.md),
[subgraph](30-architecture/subgraph.md).

## Editing discipline

1. Update the narrowest relevant document instead of duplicating a rule.
2. Link to the source rule from explanatory documents.
3. Add or amend an ADR when a change alters identity, economics, trust, privacy, or Core authority.
4. Record unresolved choices in [open questions](00-project/open-questions.md); do not silently pick a value in code.
5. Docs describe the implementation. When code and docs disagree, fix one of them in the same change.

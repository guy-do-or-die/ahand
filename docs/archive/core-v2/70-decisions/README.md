# Architecture decisions

This directory records decisions that would otherwise be easy to reverse accidentally while evolving aHand. An ADR fixes a boundary or principle; detailed ABIs and parameters live in the protocol documents it links.

## Index

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-application-neutral-core.md) | Core has no application identity or registry | Accepted |
| [0002](0002-uniform-shaker-economics.md) | Every contributing intermediary uses uniform, success-only Shaker economics | Accepted |
| [0003](0003-capability-routes.md) | Route authority travels in capability artifacts, normally offchain | Accepted |
| [0004](0004-ens-peripheral-identity.md) | ENS is peripheral display identity; it is never Core authority | Accepted |
| [0005](0005-tags-and-derived-context.md) | Tags are one opaque namespace and context is derived, not minted | Accepted |
| [0006](0006-contextual-signals.md) | One global spendable Up lives in a hook-free, immutable-Core-bound contextual ledger | Accepted |
| [0007](0007-three-visibility-modes.md) | Public, Preview, and Dark are distinct disclosure contracts | Accepted |
| [0008](0008-base-core-and-sponsor-isolation.md) | Base is the settlement chain; everything else is peripheral | Accepted |
| [0010](0010-stablecoin-policy-and-pull-accounting.md) | Single stablecoin policy and hybrid push/pull payouts | Accepted |
| [0011](0011-shaker-attribution-and-acceptance.md) | Self attribution reuses the Shake signature; only a distinct Shaker adds acceptance | Accepted |
| [0012](0012-bounded-prospective-policy-authority.md) | Policy authority is bounded to future Raises | Accepted |

## Maintenance rule

When implementation pressure appears to require violating an accepted ADR, do not silently encode the exception. Add a superseding ADR, state the new threat and product requirement, and update every affected document.

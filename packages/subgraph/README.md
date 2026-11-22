# `packages/subgraph`: not ported to the current Core

This code was written for the earlier Core (with `AHandSignals` and `AHandWitness`), the earlier
`@ahand/sdk` and the earlier `@ahand/abi` (`DeployedAddresses`, `addresses.{chain}.json`). Those
are gone from this branch, so this code does not build here until it is ported. It is not in the
root workspaces, and `bun run check` does not cover it. See [the documentation index](../../docs/README.md).

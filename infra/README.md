# `infra`

- **`stand`**: the local stand (`bun run stand`): a whole aHand on this machine, one per slot. A
  workspace; `bun run check` typechecks and tests it.
- **`relay`**: the local test relay for stands and tests, never for real users. A workspace;
  `bun run check` typechecks and tests it.
- **`anvil`** and **`seed`**: not ported to the current Core. They were written for the earlier Core
  (with `AHandSignals` and `AHandWitness`), the earlier `@ahand/sdk` and the earlier `@ahand/abi`
  (`DeployedAddresses`, `addresses.{chain}.json`), and `seed` also imports files of the earlier web
  app. They are not in the root workspaces, `bun run check` does not cover them, and they do not
  build on this branch. See [the documentation index](../docs/README.md).

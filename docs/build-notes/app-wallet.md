# app-wallet: the wallet layer, the chain's clock, the chain hooks (wave 3)

## What exists

- `apps/hand/src/chain/`
  - `clients.ts`: one viem chain and public client per configured chain (fallback transport when several RPC URLs).
  - `watcher.ts`: `BlockWatcher`, the one clock. It polls the latest block at the chain's block time and only while something listens. No tip before the first block. `stale` after N polls with no new block (N = max(5, 10 s of block time), counted in polls and not with the device's clock). `offline` when a poll fails. `nextTip()`.
  - `finality.ts`: `follow(client, hash)` goes Sent → In a block → safe → final through the chain's own tags (`finalityOf`). It re-reads the block hash at the receipt's height until safe; a replaced block puts the state back to Sent and the same hash is watched again. Nothing is ever resent. `standingOf` is the single look.
  - `simulate.ts`: `simulateAll(calls, from)`. One call goes through the SDK's `simulate`. Several calls go as one `eth_simulateV1` sequence, so an approve→raise or setup→thank is checked as it will run. Refusals are decoded with the SDK's `refusalOfData`. Where an RPC lacks `eth_simulateV1`, only the first call is checked ahead and each later one just before it is sent.
  - `hooks.ts` (exported via `index.ts`): `CLIENTS`, `clientOf`, `watcherOf`, `useChainStatus`, `useNow` (`{number, timestamp, stale}` or undefined), `useBlockRead`, `useHand` (with `state` = `stateAt(useNow)`), `usePending`, `useFinality`, `useCost` (simulate, then `costOf`, plus the OP Stack L1 fee when `hasL1`).
- `apps/hand/src/wallet/`
  - `config.ts`: wagmi 3.7 config with EIP-6963 discovery, `storage: null`, `ssr: false`. The dev connectors come from `import("./dev")` behind `__AHAND_LOCAL__`.
  - `dev.ts`: the dev wallet. It has an EIP-1193 provider per account and a wagmi connector per account (`type: "dev"`, ids `dev-1`…`dev-5`, `dev-not-set-up`). Accounts 1–5 are anvil's own. Account 5 signs with entropy. "Not set up yet" is `KeyAccountFactory.getAddress(account 6, DEV_UNSET_SALT)`: it answers with an ERC-6492 wrapper while it has no code and answers 4200 to sending. Unknown methods get 4200 and are never passed on to anvil (anvil's own accounts are unlocked). The page also has a "say no to the next request" switch (4001).
  - `send.ts`: the engine, `sendCalls`, `resume`, `canBatch`. `useSend.ts` is the React hook around it. `typed.ts` holds `signTypedWith`, which uses `eth_signTypedData_v4` only and returns `{signature, kind, wrapped}`; `useTypedSigner.ts` is its hook.
  - `state.ts`: `useWallet`, `useWalletOptions`, `connectWallet`, `disconnectWallet`, `switchToAppChain`, `connectedWallet`. It is built on `wagmi/actions` and one external store, so no provider wraps the app and `app.tsx` is untouched.
  - `ConnectSheet.tsx` (`ConnectSheet`, `ConnectButton`), `icons.ts` (`safeIcon`: `data:image/…` only, at most 200 kB, shown only through `<img>`; rdns is never read), `words.ts` (EN/RU typed like the kit's).
- `apps/hand/src/screens/dev-wallet/`: `/dev/wallet` has four parts: the account, the two clocks, the same message asked twice, and a test approve through `useSend` with `TxRail`.
- `tests/e2e/smoke/wallet.spec.ts`: 4 tests. The spec takes the RPC from the page's `data-rpc`, so it runs with `STAND_BASE_URL` alone or with `STAND_SLOT`.

## Choices the design left open

- **Sequence simulation with `eth_simulateV1`.** Simulating each call alone would refuse the raise of approve+raise and the thank of setup+thank. anvil 1.8.6 answers `eth_simulateV1` (checked). A step path re-simulates each later step after `between()`.
- **Dev account 5's entropy.** viem's `setSignEntropy` is global and cannot be reset to `false`. It is set right before each signature and set back to `"0x"` right after. An empty extra entropy is the same as plain RFC 6979; checked: the signature before and after is identical. `sign` reads the setting synchronously, so no other signature in the page picks it up. A test checks that account 2 stays deterministic after account 5 has signed.
- **The dev wallet derives keys from anvil's public mnemonic** and has no literal keys. The dev module is dead code in a non-local build.
- **`DEV_UNSET_SALT = keccak256("aHand.dev-wallet.not-set-up/1")`.** The "not set up yet" account gets its own salt, so the fixtures' account-6 KeyAccount (which `loop.ts` may deploy) never makes it "set up". Once something does deploy it, it answers unwrapped, as a real smart wallet would.
- **The dev wallet reports `atomic: unsupported`.** A key account in a page cannot run two calls as one, and claiming it could would be a fake. So in the browser the batch path is never taken; it is covered by unit tests with a test-double wallet (below).
- **Batch intents come in two parts.** `onIntent` gets `{kind:"batch", id}` before any waiting, and again with the `hash` once `wallet_getCallsStatus` shows a receipt. Without the hash, `resume` needs the wallet (`needs-wallet`).
- **`send()` resolves at In a block**, with the receipt and the events. `result.settled` resolves at Final, and the hook's state keeps moving to Final. Leaving the screen stops the following, never the action.
- **A wallet on another chain** is asked to switch once. If it refuses, the result is `error`.
- **Reverted steps:** the call is replayed on the block before it to name Core's error, as `ahand.sh` does. For a reverted atomic batch no reason is decoded.
- **wagmi `storage: null`.** Nothing about wallets is written to the device. After a reload the person connects again; a sent action is resumed from its stored hash without a wallet.
- **Discovery only (EIP-6963).** No generic `injected()` for legacy `window.ethereum`: it would list the same wallet twice next to its 6963 entry.
- **Wallet words live in `wallet/words.ts`**, in the kit's pattern, because the i18n loader collects only `screens/*` and `common`. `words.test.ts` checks the banned words, «ты», and that "wallet" appears only in "Connect a wallet".

## Ran, with results (2026-11-20, all on this machine)

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p apps/hand`; `-p tests/e2e` | 0 errors (whole project, not only my paths) |
| `cd apps/hand && bun test src/wallet src/chain` | 31 pass, 0 fail (own anvils on 16110, 16111, 16112). Covers: batch path, step path with `between()`, between saying no, re-check refusal after between, refusal before any send (single and at step 1), sequence simulation, revert with Core's reason (`NotOpen`), the four states in order, resume from a stored hash with no wallet, batch-without-hash needs the wallet, dropped tx and `anvil_reorg` without resending, `[setupCall, thankCall]` as one `wallet_sendCalls` and as two steps with `checkGiveOnChain` between (the Hand reads `thanked`, account code deployed), the dev provider (equal / different / 6492 verified by viem's verifier before deployment, 4200 on send and on unknown methods, 4001 once), the watcher (scripted and live, `evm_increaseTime` followed within two blocks, stale when mining stops) |
| `cd apps/hand && bun test` (with the guards: clock, secrets, words, colour, store, intake) | 179 pass, 0 fail |
| `STAND_BASE_URL=http://127.0.0.1:18331 bunx playwright test tests/e2e/smoke/wallet.spec.ts` against `anvil.ts --serve --port 16100 --write-config`, Vite on 18331 | 4 passed (phone), and 4 passed with `--project desk`. Account 1: equal signatures, valid by `verifyTypedData`. Account 5: different, both valid. Not set up yet: no code, the answer ends in the 6492 magic and viem's 6492 verifier accepts it. Approve: the rail showed in-block → safe → final, the `LOCAL STAND-IN` tag was visible, receipt `success` from account 1, `allowance(account1, Core)` = 1 000 000 on chain. Network time ≥ 39 days ahead of the browser's `Date.now()`, and after `evm_increaseTime` the page showed the jumped time by block n+2 |
| `gallery.spec.ts` on the same dev server | 13 passed |
| Production build (`chain.local: false`, chain 8453) into scratch | built. `grep` for the first and second anvil keys and for the mnemonic finds nothing, and no dev-wallet chunk is emitted. The local build's `dev-wallet-*.js` does contain the mnemonic (control). Neither build contains the literal key (keys are derived) |
| `grep -rn "personal_sign\|eth_sign\b" apps/hand/src` | nothing |
| Screenshots, EN/RU, 390 px and 1280 px, light and dark | `knowledge/plan/research/2026-11-20-experiment/shots/build/app-wallet/`. No console error or warning, no horizontal overflow. Fixed after looking: a 6492 tag that wrapped inside its own word, letter initials in place of account numbers, the RU decimal point, and a factory address shown in capitals |

Everything I started was stopped by pid (the helper chain and its anvil, Vite). Nothing listens on 18331 or 16100–16149.

## Not verified

- Any real browser wallet (EIP-6963 discovery was not exercised with an extension), and any wallet with real EIP-5792 atomic support. The batch path ran only against a test-double wallet over anvil.
- `useCost`'s L1 fee on an OP Stack chain (no Base RPC tonight); `useCost`, `useHand`, `usePending` and `useFinality` as React hooks have no test of their own (their pure parts do).
- On a slot-0 stand (the gate's): not run by me, since no stand existed when I finished. The spec reads the RPC from the page, so it should work there too.

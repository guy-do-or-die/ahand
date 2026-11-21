# Build note: fixtures (wave 3)

Package `fixtures`: `infra/stand/seed.ts`, `infra/stand/loop.ts`, `infra/stand/tests/fixtures.test.ts`, `tests/e2e/lib/craft.ts`. Written 2026-11-20 by an AI agent of the overnight experiment. Nothing was committed.

## What exists

- **`infra/stand/seed.ts`** is a program and also the library the other two build on (`World`).
  - Usage: `bun infra/stand/seed.ts (--slot N | --stand FILE) [--json] [--only a,b] [--site URL]`.
  - Each run makes a complete new set of 13 fixtures: `refunded`, `thanked`, `unlisted`, `dark`, `public`, `twoPasses`, `lost`, `give`, `resigned`, `undeployed`, `noReward`, `expired`, `blocked`.
  - It mines its own blocks (`evm_mine` after each transaction). It reads time only from the chain.
  - Before printing, it opens every address it wrote with `openAddress` and checks two things: the description status and the Hand's state by the chain's clock.
  - `--json` prints the chain, the test book, the accounts, every fixture (`handId`, `n`, mode, token, reward, expiry, root key, `inbox.n1`, texts, every address, receipts where there is one, `state`) and the block range of the run.
- **`infra/stand/loop.ts`** runs the core loop through the SDK only.
  - Usage: `bun infra/stand/loop.ts (--slot N | --stand FILE) [--only part,…]`.
  - It runs six parts: `usd`, `pending`, `refund`, `zero-reward`, `second-token` and `undeployed-account`. It prints one line per part, saying what it asserted on Core: state by the chain's clock, `closedAt`, `thanks.giveHash`, the events and the balances.
  - It exits 1 if any part fails. All parts run even after one fails.
  - Delivery goes over the stand's relay when `stand.json` names one. The give link is sent to the Hand's `inbox.n1` and read back with the inbox secret derived from the keys, and the raiser then thanks the link that arrived.
- **`tests/e2e/lib/craft.ts`** is the child-process tool of ARCHITECTURE §14. It prints one JSON object per call.
  - Commands: `make`, `open`, `pass`, `give`, `wrap-6492`, `tamper`, `deliver-send`, `deliver-listen` and `secrets`. The file's header gives the options of each.
  - `open` exits 1 with `{ok:false, code, messageId}` when a link does not open.
  - For a give link, `open` also reports Core's own answer: bare, and with the account's setup when the signature is wrapped.
  - Usage errors exit 2.
- **`infra/stand/tests/fixtures.test.ts`** runs all three programs as child processes, the way spec files and gates do, against a chain of its own on port 16060 and the stand relay on 16061. It has 15 tests.

## Choices the design left open

- **`n` of the test book** starts at Core's `handsCount()` when a run first raises and then counts up. A run raises one Hand per `n`, so `n` never repeats on one chain. The book is `0x6669787475726573` ("fixtures"). `loop.ts` and `craft make` use the same scheme, so their Hands are rebuildable too.
- **A lock per chain**: a folder `ahand-chain-<sha256(rpc)>.lock` in the system's temporary directory, holding the owner's pid. It stops parallel seed, loop and `craft make` runs from racing for account 1's nonces. A lock whose owner is dead is taken over, and no clock is read for that. Checked by running two seeds and a loop at once: all three exited 0.
- **One jump of the clock per run.** The `refunded` and `expired` Hands are raised first, with a 60-second expiry. One jump moves the chain to the later of the two expiries, then `refunded` is refunded. The refund lands before every later fixture is raised, so they carry larger Hand numbers, and `findLaterHands`, which reads the Hand numbers after the refunded one (D-64, revised 2026-11-21), finds them. **On a shared stand, a seed run moves the chain's clock forward by about a minute.** Nothing else in the seed is that short-lived.
- **Accounts.** 1 raises. 2 and 3 are holders. 4 gives. 0 sends what anyone may send. 6 owns the KeyAccount. **7 is the payee that only the `blocked` fixture blocks**, and **8 is the payee `loop.ts` blocks and then unblocks**. The `second-token` cycle (holders 2 and 3, giver 4) therefore never meets a block. If an older run left one of them blocked, the loop lifts the block first and says so on its line.
- **The undeployed KeyAccount's salt** is the Hand's number in the seed and `2^64 + number` in the loop, so every run gets a fresh account. A thank deploys the account, and a fixed salt would be deployed by the next run.
- **Give links** are written bare, with every attachment inside. The raiser who opens one therefore reads the description (`readDescription` returns "attached").
- **"Lost"** is a dark Hand whose first link was written with no attachments. That is what a root key rebuilt on another device opens.
- **"Re-signed"** uses this route: A keeps 5% and passes to B, B keeps 5% and passes to the giver, and the giver gives. Then A, who still holds the first link, signs one Shake straight to the giver's key, and the giver signs again. Core accepts both Gives. `judgeGive` returns `resigned` and drops position 1 (B). The seed asserts that verdict.
- **The unblock and withdraw commands** are `cast send … --from <account 0> --rpc-url … --unlocked`. anvil keeps its accounts unlocked, so no key is printed. Both commands were run: status 1, and `pending()` went from 5 000 000 to 0.
- **`tamper flip`** changes the byte that counts the Shakes (XOR 0x7f), so the link names more Shakes than it holds. The result is always `malformed`. `--at N` flips any other byte instead.
- **`tamper other-core`** inserts another Core address into the link's bytes and writes the address bare, because a numbered path would name the canonical Core. The result is `untrusted` (`link.untrusted`).
- **Three extra tampers**, because the wave 5 guards need them: `version` (gives `link.unsupported`), `other-number` (gives `another-hand`) and `giver-sig`. A link with an altered giver signature opens, and Core then refuses it with `InvalidGiverSig`, for plain and for 6492-wrapped signatures alike.
- **`tamper cut-d`.** On an unlisted Hand it gives `unmatched-data`. On a public Hand the link still opens, because a numbered address with no `d` opens (ARCHITECTURE §9), and the description reads "lost".
- **Site** comes from `stand.json`. A helper stand has none, so addresses use `http://127.0.0.1`. `--site` overrides it.
- **`deliver-listen --n N`** derives the inbox secret from account 1's keys signature and the test book. A test therefore needs only the `n` the seed printed.

## What was run (all on this machine, on the wave 1 helper chain `anvil.ts --serve --port 16050 --write-stand`, plus the stand relay on 16051)

| Command | Result |
|---|---|
| `bun infra/stand/seed.ts --stand FILE` | 13 fixtures, every state as expected, self-check passed; about 0.5 s |
| `bun infra/stand/seed.ts --stand FILE --json [--only …]` | JSON with every fixture; `undeployed.coreBare` = `InvalidGiverSig`, `coreWithSetup` = `accepted`; `resigned.verdict` = `resigned` |
| `bun infra/stand/loop.ts --stand FILE` (no relay) | exit 0, six `ok` lines; `usd` says the link went by hand |
| `bun infra/stand/loop.ts --stand FILE` (relay on 16051) | exit 0, six `ok` lines; `usd` delivered to 1 of 1 relay and read from the Hand's inbox |
| the `blocked` fixture's `unblock.cast` and `withdraw.cast`, run with `cast` | both status 1; `pending()` 5 000 000 → 0 |
| two `seed.ts` and one `loop.ts` at once on one chain | all three exit 0 (the lock serialises them) |
| every craft command by hand (make, open, pass, give, wrap-6492, each tamper, deliver-send → deliver-listen, secrets) | as described above; `secrets` on a give link exits 2 ("carries no seed") |
| `bun test infra/stand/tests/fixtures.test.ts` | 15 pass, 0 fail, 130 expects, 7.9 s (both seed runs well under 20 s) |
| `tsc --noEmit -p infra/stand`, `tsc --noEmit -p tests/e2e` | 0 errors |
| `grep -c Date.now` in the three files | 0, 0, 0 (the test also asserts this) |

The chain, the relay and the test's own chain and relay were stopped by their pids afterwards.

## SDK defects met

None. This was the SDK's first full use, and every call behaved as its comment says. That includes:
- `checkGiveOnChain` with and without setup;
- the 6492 path of `askSigner`, which uses viem's `verifyHash` against an account that is not deployed yet;
- `receiptOf` on thanks, refunds, zero amounts and Pending;
- `findLaterHands`;
- `carryFor` and `passOn` across all three shapes.

Frictions worth a line, none of them a wrong result:

1. **The SDK cannot read the Hand number from a `raise` receipt.** `seed.ts` decodes `Raised` itself (`raisedIn`). The raise screen of wave 4 will need the same. A `raisedIn(receipt, core)` in `chain.ts` would serve both.
2. **The SDK does not export the link's byte layout** (`pack` and the head offsets). `craft tamper` therefore re-implements the LEB128 head walk. If the link format changes, `craft.ts` must follow.
3. **`walletKind` reports `key` for an account that is not deployed yet**, as documented. Only the 6492 wrapper tells the two apart.
4. **Not the SDK:** on the helper chain, `BlacklistToken` reports the same symbol as `MockUSD` (`mUSD`), because it inherits it. Loop lines and any screen that shows symbols cannot tell the two tokens apart; only the configuration's `label` can.

## Not verified

- No run against a stand of `infra/stand/stand.ts`. It was being written beside this package, and seeding another agent's slot would have moved its clock. The stand file fields read (`rpc`, `relay`, `site`, `chainId`, `core`, `tokens`, `forwarder`, `accountFactory`) match what `stand.ts` writes, but `--slot N` was not run.
- No browser. Nothing in this package draws a screen, so no screenshot was taken.
- Concurrency was tested with three processes. Playwright workers seeding at the same moment on one stand were not tried.
- The machine-time `at` of a Nostr message (the delivery package's choice) is reported by `deliver-listen` as is.

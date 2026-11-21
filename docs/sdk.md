# The SDK

```ts
import { chainNow, readHand, openAddress, getHandFor, passesLeft } from "@ahand/sdk";

const now = await chainNow(client);                                   // the latest block: the only clock
const opened = await openAddress(address, getHandFor({ 31337: client }, [{ chainId: 31337, core }]));
const { view, stateAt } = await readHand(client, core, opened.head.handId);
stateAt(now.timestamp);                                               // "open" | "expired" | "thanked" | "refunded" | "missing"
```

`packages/sdk` (`@ahand/sdk`, TypeScript, viem 2.52.0). Everything protocol lives here; the app, `exit.html`, face, the stand and the CLI call it. Tests: `cd packages/sdk && bunx vitest run` (part of `bun run check`; the counts of the last run are in [evidence](evidence.md)); several start their own anvil through `tests/helpers/anvil.ts`. Exports are listed in `packages/sdk/src/index.ts`.

## Calls per role

**Asker (raiser)**

| Step | Calls |
|---|---|
| words | `normalizeText`, `describeHand({mode, title, content, inbox})` → `dataHash`, shape, what goes inside and outside (`describe.ts`) |
| keys | `keysTypedData(chainId, core, raiser)` (sign once), `masterOf`, `rootSeed`, `inboxSecret`, `newBook`, `matchRoot` (`keys.ts`) |
| time | `chainNow`, `expiryAfter(now, seconds, MAX_EXPIRY_PERIOD)`, `readLimits` (`chain.ts`) |
| send | `approveCall`, `raiseCall`, `fundCall`, `extendCall`, `simulate` first (`tx.ts`) |
| link | `encodeLive`, `toAddress` (`link.ts`, `address.ts`) |
| thank | open the give link, `checkGiveOnChain`, `judgeGive` against Gives already seen (`resign.ts`), `payeeProblem` (`payee.ts`), `worstThankGas` (`gas.ts`), `thankCall`, then `receiptOf(handLogsAt(…))` |
| newer Hand | `await findLaterHands(client, core, handId, raiser, { forwarder })`: reads `handsCount` once and announces how many Hands it will read and in how many requests; `run()` reads `hands(id).raiser` for the numbers after this one, newest first, 200 per `eth_call` through the forwarder, at most 20 000; no logs |

**Holder**: `openAddress`/`openLink` (proves the route against the Hand), `readHand`, `readDescription` (and `readDescriptionOf(hand, matched)` where only a faced address's `d` was matched), `passesLeft`, `carryFor`, `passOn` (signs a Shake with the link key: no wallet), `canReshape`, `toAddress`.

**Helper (giver)**: `signGive` (a key's answer brought to Core's 65-byte form by `toCoreSignature`; a contract's or a wrapped one returned as it came), offline `checkGive` with `askSigner` (`wallet.ts`; ERC-1271 for a deployed account, ERC-6492 for one not deployed yet), then `checkGiveOnChain`, then `encodeGive`. Delivery is `@ahand/deliver` (NIP-17 gift wrap to the Hand's `inbox.n1`).

**Payee**: `readPending`, `withdrawCall`; anyone may deliver to the payee.

**Anyone**: `refundCall` from the expiry; `costOf` and `l1FeeOf` (`money.ts`, a dated price snapshot `prices.json`); `decodeCoreError`, `messageIdOf` (`errors.ts`).

**Verifier**: `collect`, `passportOf`, `exportBundle`, `verifyBundle` (no network: signatures, hashes and sums keep their verdict; rows built on the file's events and views read `"recorded"`, never ok), `verifyBundleOnChain` and `rereadRecord` (the file re-read from the chain by block hash), `thankInputOf` (`proof.ts`); `handLogsInBlock` (`chain.ts`); `checkOrder`, `runSteps` (`steps.ts`); `linkLayout` (`link.ts`: where a link's parts lie, offsets and lengths only, for `/check`'s ruler). `bun tools/ahand.ts verify` is the same from a clone.

## Trust: fail closed

`getHandFor(clients, trusted)` reads only the Cores in its list. Any other chain or Core throws `UntrustedCore`, which `messageIdOf` maps to `link.untrusted`. There is no "open with a warning". Test: "answers for a trusted Core, refuses an untrusted Core, an unknown chain and a Hand never raised" (`packages/sdk/tests/chain.test.ts`).

## The clock rule

Every "now" is the latest block's timestamp (`chainNow`), never `Date.now()`:

- `stateAt(now)` is "expired" when `closedAt = 0` and `now ≥ expiry`, as Core judges (`refund` passes from the same second; `extend`, `fund`, `thank` refuse from it). Test: "is open one second before the expiry and expired at it; refunded after the refund".
- `expiryAfter` keeps 600 seconds (`EXPIRY_MARGIN`) below Core's 180-day cap, because `eth_call` judges by the latest block and the transaction lands later. Test: "raises at expiryAfter(chainNow, 180 days, cap) without a revert; cap + 1 and a past time are refused".
- `grep -rn "Date.now" packages/sdk/src` finds nothing. The app's guard `apps/hand/tests/guards/clock.test.ts` fails on any device-clock read in `screens/`, `ui/`, `chain/` and `shell/`; every stand's chain runs 40 days ahead of the machine, so a slip shows at once.
- `checkGiveOnChain` succeeding means "this Give is well formed for this Hand", not "it can still be thanked": `checkGive` ignores the expiry and the caller. Ask `simulate(thankCall, raiser)` for that.

## Logs, bounded

No indexer. `findBlockAt(openedAt)` bounds every read; a Hand's events sit at `openedAt` and `closedAt` (`handLogsAt`), and only `Funded`/`Extended` lie between. `findBlockAt` guesses from the chain's real pace (viem's `blockTime`: 200 ms on Base, so five reads find a block on Base Sepolia where a 2 s guess took 35).

Logs are read window by window (`readLogWindows`): never more than 2 000 blocks per call (`LOG_WINDOW`; test "never asks for more than 2 000 blocks in one call"), and less where a node takes less. `logRangeRefusal` tells two refusals apart. A limit of the range (code -32614, Base's own, which Base Sepolia's public RPC sends in an HTTP 413 over 200 blocks and viem hands on as an `RpcRequestError`; an HTTP 413 with no JSON-RPC body; or an error whose message says "block range", "limited to", "max range"…) makes the read ask the same blocks again at the size the node named, else at half the size, down to one block, and no window of that read is larger again. Once a window of that size is taken, the size is kept per client, so its later reads start there; a size is never kept from a refusal alone, nor from a read that never got a window through. Too many results ("more than 10000 results", "too many logs", "response size") is a fact about those blocks only: the window halves there and doubles back after two windows taken, and nothing is kept. A node that lacks the blocks asked ("block range extends beyond current head block", "header not found") and a rate limit are not refusals of the size. `setLogWindow(client, n)` starts a client at a known size (the app does it from the chain's `logWindow`). Any other error is thrown unchanged (tests in `log-windows.test.ts`, against an HTTP node that answers as sepolia.base.org does, and as a lagging node, a node with one dense block and a node that refuses everything do). viem retries a -32005 answer and a 413 with no JSON-RPC body three times (150, 300 and 600 ms apart) before the SDK sees it, so on such a node each halving costs four requests and about a second; Base's -32614 is not retried. `handLogs`, `handLogsAt` and the passport's `readBetween` read this way, and so do the app's send-fate probes, which also remember how far they have read for a send (less the last 64 blocks) and go on from there when asked again.

`findLaterHands` reads no log: Core numbers its Hands, so the Hands raised after one have larger numbers, and `hands(id).raiser` says whose each is. It makes exactly the requests it announced, one per 200 Hands (test "finds the raiser's later Hands by number, newest first, in exactly the requests it announced").

## An account that is not set up yet

Core has no ERC-6492. A helper whose smart account has no code yet signs with a 6492 wrapper; the SDK keeps it as it is until the thank:

```ts
const inner = unwrap6492(giverSig)!;                    // { factory, factoryData, signature } via viem's parser; undefined if not wrapped
const setup = { forwarder, factory: inner.factory, factoryData: inner.factoryData };
await checkGiveOnChain(client, core, handId, shakes, give, setup); // one eth_call: forwarder.aggregate3([setup, checkGive with the inner signature])
const calls = [setupCall(setup), thankCall(core, handId, shakes, give)]; // thankCall always writes the inner signature
```

- `setupCall` is `forwarder.aggregate3([{ factory, factoryData }])`, **never a call in the sender's own name**: a wrapper can name any contract and any calldata (for example "the token: transfer to me"), and sent from the raiser's account it would act for the raiser. The forwarder holds nothing and has no allowances (Multicall3 on real networks; `contracts/test/mocks/Forwarder.sol` on the stand). This is the assistant's addition (D-62), not the owner's decision. Tests: "wraps the setup call in the forwarder's aggregate3, never in the sender's own name" and "is refused bare, accepted with the setup, and closes the Hand as thanked by [setupCall, thankCall]" (`packages/sdk/tests/tx.test.ts`); a hostile setup moving nothing of the sender's in `contracts/test/Deploy.t.sol`.
- The app sends both as one EIP-5792 batch where the wallet reports atomic support, else in two steps with Core asked again between them. Only the two-step path ran tonight.
- From a clone: `bun tools/ahand.ts thank-calldata <give-address> --rpc $RPC --forwarder 0x…` prints the setup `cast send` line first and the thank calldata second.

## Errors

`decodeCoreError` reads Core's 23 errors and OpenZeppelin's three from any viem error or raw bytes; `simulate` returns only Core's refusals and rethrows anything else. `messageIdOf` gives the catalogue id (`core.InvalidClaim`, `link.malformed`, …) that the app shows in both languages.

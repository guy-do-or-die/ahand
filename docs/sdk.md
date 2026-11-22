# The SDK

```ts
import { chainNow, readHand, openAddress, getHandFor, passesLeft } from "@ahand/sdk";

const now = await chainNow(client);                                   // the latest block: the only clock
const opened = await openAddress(address, getHandFor({ 31337: client }, [{ chainId: 31337, core }]));
const { coreHand, stateAt } = await readHand(client, core, opened.head.handId);
stateAt(now.timestamp);                                               // "open" | "expired" | "thanked" | "refunded" | "missing"
```

`packages/sdk` (`@ahand/sdk`, TypeScript, viem 2.52.0). Everything protocol lives here, and applications call it. `@ahand/sdk/app` holds the choices of one application, which another may make otherwise: the dated price snapshot `PRICES`, the limit on a public address's `d`, in base64url characters (`PUBLIC_PART_MAX_CHARS`) and the message ids a screen shows (`messageIdOf`). Tests: `bun run test:sdk` (part of `bun run check`); several start their own anvil through `tests/helpers/anvil.ts`, from the contracts' build, so `forge build` in `contracts/` comes first. Exports are listed in `packages/sdk/src/index.ts` and `packages/sdk/src/app.ts`.

## Calls per role

**Asker (raiser)**

| Step | Calls |
|---|---|
| words | `normalizeText`, `describeHand({mode, title, content, inbox}, { publicPartMaxChars })` → `dataHash`, shape, the link part (`linkPart`, after `#`) and the public part (`publicPart`, in `d`); past the limit it throws `DescriptionTooLarge` with `chars` and `max` (`describe.ts`) |
| keys | `keysTypedData(chainId, core, raiser)` (sign once), `masterOf(signature, { chainId, core, raiser })`, `rootSeedOf`, `inboxSecretOf`, `newBook`, `matchRoot` (`keys.ts`); only the raiser's own key's signature is taken, since a smart account's may be stored or predictable |
| time | `chainNow`, `expiryAfter(now, seconds, MAX_EXPIRY_PERIOD)`, `readLimits` (`chain.ts`) |
| send | `approveCall`, `raiseCall`, `fundCall`, `extendCall`, `simulate` first (`tx.ts`) |
| link | `encodeLive`, `toAddress` (`link.ts`, `address.ts`) |
| thank | open the give link, `checkGiveOnChain`, `judgeGive` against Gives already seen (`resign.ts`: `"first"`, `"same"`, `"branch"` or `"re-signed"`), `payeeProblem` (`payee.ts`), `worstThankGas` (`gas.ts`), `thankCall`, then `receiptOf(handLogsAt(…))` |
| newer Hand | `await findLaterHands(client, core, handId, raiser, { forwarder })`: reads `handsCount` once and announces how many Hands it will read and in how many requests; `run()` reads `hands(id).raiser` for the numbers after this one, newest first, 200 per `eth_call` through the forwarder, at most 20 000; no logs |

**Holder**: `openAddress`/`openLink` (proves the route against the Hand), `readHand`, `readDescription` (and `readDescriptionOf(hand, matched)` where only a described address's `d` was matched), `passesLeft`, `carryFor` (the `linkPart` and `publicPart` to pass on in a given shape), `passOn` (signs a Shake with the link key: no wallet), `canReshape`, `toAddress`.

**Helper (giver)**: `signGive` (a key's answer brought to Core's 65-byte form by `toCoreSignature`; a contract's or a wrapped one returned as it came), offline `checkGive` with `askSigner` (`wallet.ts`; ERC-1271 for a deployed account, ERC-6492 for one not deployed yet), then `checkGiveOnChain`, then `encodeGive`. Delivering the give link to the raiser is not the SDK's: the Hand's description names the key answers are wrapped to (`inbox.n1`).

**Payee**: `readPending`, `withdrawCall`; anyone may deliver to the payee.

**Anyone**: `refundCall` from the expiry; `costOf` and `l1FeeOf` (`money.ts`, with a dated price snapshot such as `PRICES` from `@ahand/sdk/app`); `decodeCoreError` (`errors.ts`), `messageIdOf` (`@ahand/sdk/app`).

**Verifier**: `collectRecord`, `passportOf`, `exportBundle`, `verifyBundle` (no network: signatures, hashes and sums keep their verdict; rows built on the file's events and views read `"recorded"`, never `true`), `verifyBundleOnChain` and `rereadRecord` (the file re-read from the chain by block hash; it stops after `MAX_DIFFERENCES`), `thankInputOf` (`proof.ts`; it decodes only places that name the Hand, at most `THANK_TRIES`, in an input no longer than a transaction). Each row is a `Check`: its `verdict` is `true`, `false`, `"not-checkable"` or `"recorded"` (`CheckVerdict`), and its `messageId` is the i18n key of its sentence (`proof.route`, …). A record is public: `collectRecord` and `exportBundle` refuse a live link, whose seed is the route's key. `readBundle` takes exactly Core's arguments for each event and bounds a file by `BUNDLE_MAX_LOGS` and `BUNDLE_MAX_PENDING`; it also reads a file of the same format from an earlier writer that named `hands(id)`'s record `view` or the public part `outside`, and refuses a file that carries both an earlier key and the key it became; `exportBundle` writes only `coreHand` and `publicPart`. The giver row of an account with code rests on the chain's code and reads `"recorded"` offline; `handLogsInBlock` (`chain.ts`); `checkOrder`, `runSteps` (`steps.ts`; each step's `check` is a `RefusalName`, Core's error it guards against); `linkLayout` (`link.ts`: where a link's parts lie, offsets and lengths only, for a page that shows them).

## Trust: the canonical Core

Core is one contract at one address on every chain, `0x65ac707E2AE7392583de5d6192C619F1D8862309` (`CANONICAL_CORE`): CREATE2 from the deterministic deployer `0x4e59…956C`, the salt `keccak256("aHand.core/1")` and the hash of Core's initcode (`CANONICAL_CORE_BUILD`, the same facts as `contracts/deployments/84532.json`; `coreAddressOf` derives the address). Core cannot be changed at its address; a new version would be another address.

- A link or an address that leaves Core's address out names the canonical Core, and a reader knows it with no options. `LinkOptions.canonicalCore` names another (tests do), and `null` says the reader knows none: such a link is then `no-canonical-core`. The key given as `undefined` (an unset configuration value) is refused with a TypeError rather than read as either. Writers leave the canonical Core's address out; a link that writes it is `non-canonical` (`tests/canonical.test.ts`).
- The passport trusts the canonical Core: its `core` row derives the address from `CANONICAL_CORE_BUILD` and fails for a record of any other address, however well that record agrees with itself. A contract that copies Core's code at another address emits the same events, so nothing else would tell it apart. `passportOf`, `verifyBundle` and `verifyBundleOnChain` take `{ coreBuild }` for another Core (a test chain's, or a later version's): a `CoreBuild`, the factory, salt and initcode hash its address derives from, such as `{ ...CANONICAL_CORE_BUILD, initcodeHash }`, never the address itself, which is refused with a TypeError; a saved bundle's own facts about Core are never read. Test: "a Hand on a twin of Core" (`packages/sdk/tests/proof.test.ts`).

## Trust: fail closed

`getHandFor(clients, trusted)` reads only the Cores in its list. Any other chain or Core throws `UntrustedCore`, which `messageIdOf` maps to `link.untrusted`. There is no "open with a warning". Test: "answers for a trusted Core, refuses an untrusted Core, an unknown chain and a Hand never raised" (`packages/sdk/tests/chain.test.ts`).

## The clock rule

Every "now" is the latest block's timestamp (`chainNow`), never `Date.now()`:

- `stateAt(now)` is "expired" when `closedAt = 0` and `now ≥ expiry`, as Core judges (`refund` passes from the same second; `extend`, `fund`, `thank` refuse from it). Test: "is open one second before the expiry and expired at it; refunded after the refund".
- `expiryAfter` keeps 600 seconds (`EXPIRY_MARGIN`) below Core's 180-day cap, because `eth_call` judges by the latest block and the transaction lands later. Test: "raises at expiryAfter(chainNow, 180 days, cap) without a revert; cap + 1 and a past time are refused".
- `grep -rn "Date.now" packages/sdk/src` finds nothing. The tests' chains run 40 days ahead of the machine (`tests/helpers/anvil.ts`), so a slip shows at once.
- `checkGiveOnChain` succeeding means "this Give is well formed for this Hand", not "it can still be thanked": `checkGive` ignores the expiry and the caller. Ask `simulate(thankCall, raiser)` for that.

## Logs, bounded

No indexer. `findBlockAt(openedAt)` bounds every read; a Hand's events sit at `openedAt` and `closedAt` (`handLogsAt`), and only `Funded`/`Extended` lie between. `findBlockAt` guesses from the chain's real pace (viem's `blockTime`: 200 ms on Base, so five reads find a block on Base Sepolia where a 2 s guess took 35).

Logs are read window by window (`readLogWindows`): never more than 2 000 blocks per call (`LOG_WINDOW`; test "never asks for more than 2 000 blocks in one call"), and less where a node takes less. `logRangeRefusal` tells two refusals apart. A limit of the range (code -32614, Base's own, which Base Sepolia's public RPC sends in an HTTP 413 over 200 blocks and viem hands on as an `RpcRequestError`; an HTTP 413 with no JSON-RPC body; or an error whose message says "block range", "limited to", "max range"…) makes the read ask the same blocks again at the size the node named, else at half the size, down to one block, and no window of that read is larger again. Once a window of that size is taken, the size is kept per client, so its later reads start there; a size is never kept from a refusal alone, nor from a read that never got a window through. Too many results ("more than 10000 results", "too many logs", "response size") is a fact about those blocks only: the window halves there and doubles back after two windows taken, and nothing is kept. A node that lacks the blocks asked ("block range extends beyond current head block", "header not found") and a rate limit are not refusals of the size. `setLogWindow(client, n)` starts a client at a known size (an application can set it from its chain configuration). Any other error is thrown unchanged (tests in `log-windows.test.ts`, against an HTTP node that answers as sepolia.base.org does, and as a lagging node, a node with one dense block and a node that refuses everything do). viem retries a -32005 answer and a 413 with no JSON-RPC body three times (150, 300 and 600 ms apart) before the SDK sees it, so on such a node each halving costs four requests and about a second; Base's -32614 is not retried. `handLogs`, `handLogsAt` and the passport's `readBetween` read this way.

`findLaterHands` reads no log: Core numbers its Hands, so the Hands raised after one have larger numbers, and `hands(id).raiser` says whose each is. It makes exactly the requests it announced, one per 200 Hands (test "finds the raiser's later Hands by number, newest first, in exactly the requests it announced").

## An account that is not set up yet

Core has no ERC-6492. A helper whose smart account has no code yet signs with a 6492 wrapper; the SDK keeps it as it is until the thank:

```ts
const inner = unwrapErc6492(giverSig)!;                 // { factory, factoryData, signature } via viem's parser; undefined if not wrapped
const setup = { forwarder, factory: inner.factory, factoryData: inner.factoryData };
await checkGiveOnChain(client, core, handId, shakes, give, setup); // one eth_call: forwarder.aggregate3([setup, checkGive with the inner signature])
const calls = [setupCall(setup), thankCall(core, handId, shakes, give)]; // thankCall always writes the inner signature
```

- `setupCall` is `forwarder.aggregate3([{ factory, factoryData }])`, **never a call in the sender's own name**: a wrapper can name any contract and any calldata (for example "the token: transfer to me"), and sent from the raiser's account it would act for the raiser. The forwarder holds nothing and has no allowances (Multicall3 on real networks; `contracts/test/mocks/Forwarder.sol` on a local chain). Tests: "wraps the setup call in the forwarder's aggregate3, never in the sender's own name", "is refused bare, accepted with the setup, and closes the Hand as thanked by [setupCall, thankCall]" and "a wrapper whose "factory" is the token" (`packages/sdk/tests/tx.test.ts`).
- An application can send both as one EIP-5792 batch where the wallet reports atomic support, or in two steps with Core asked again between them.

## Errors

`decodeCoreError` reads Core's 23 errors and OpenZeppelin's three from any viem error or raw bytes; `simulate` returns only Core's refusals and rethrows anything else. A `LinkError` whose content Core itself would refuse keeps Core's error in `refusal` (`{ name, position }`). `messageIdOf` (`@ahand/sdk/app`) gives the id a screen shows (`core.InvalidClaim`, `link.malformed`, …).

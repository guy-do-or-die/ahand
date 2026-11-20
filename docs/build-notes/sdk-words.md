# Build note: sdk-words (wave 2)

SDK modules for descriptions, keys, wallets, payees, re-signed Gives and money. Written 2026-11-20 by an AI assistant during the overnight experiment. The choices below are the assistant's, not the owner's.

## What exists

| Module | What it does | Test |
|---|---|---|
| `packages/sdk/src/describe.ts` | Statement names `title`, `content`, `salt`, `private`, `inbox.n1` (`STATEMENT`). `normalizeText` (NFC, then CRLF/CR → LF). `describeHand` for public, unlisted and dark (ARCHITECTURE §9). `readDescription` gives `none`, `attached` or `lost`, from `opened.ofHand` only. `canReshape` (same shape, or bare). `carryFor` returns what a holder passes on. | `tests/describe.test.ts` (25) |
| `packages/sdk/src/keys.ts` | The EIP-712 keys message (`keysTypedData`, `KEYS_PURPOSE`). `masterOf` is HKDF-Extract, `rootSeed` and `inboxSecret` are HKDF-Expand; all three use WebCrypto HMAC-SHA256. Also `newBook`, `rootKeyOf` and `matchRoot`. | `tests/keys.test.ts` (9) |
| `packages/sdk/src/wallet.ts` | `walletKind` (key, delegated by `0xef0100`+address, or code), `isErc6492` and `unwrap6492` (viem's parser), `askSigner` (viem `verifyHash`), `signGive`. | `tests/wallet.test.ts` (7, on a helper chain) |
| `packages/sdk/src/payee.ts` | Unchanged from wave 1. The tests found nothing to fix. | `tests/payee.test.ts` (4) |
| `packages/sdk/src/resign.ts` | `routeKeys`, `seenGiveOf` (an addition: builds a `SeenGive` from an opened give link), `judgeGive`. | `tests/resign.test.ts` (10) |
| `packages/sdk/src/money.ts` | `costOf` on Base and on Ethereum, `usdText`, `l1FeeOf` through the `GasPriceOracle` predeploy `0x4200…000F`. | `tests/money.test.ts` (8, two on a helper chain) |
| `packages/sdk/src/prices.json` | Unchanged. Its figures match the 2026-11-10 fee study: 0.006 gwei on Base, 0.3 gwei on Ethereum (the 2026 average), $2,400 per ETH. `money.test.ts` checks this against six rows of the study's table. | |
| `packages/sdk/tests/sizes.test.ts` | Prints the size table below. | (1) |

## How to write each mode (for app builders)

```ts
const d = describeHand({ mode, title, content, inbox });           // salt: random unless given; public takes none
const outside = d.outside && packAttachments(d.outside);
const link = await encodeLive({ domain, hand, signedShakes: [], seed, attachments: d.inside }, { ...options, outside });
const address = toAddress({ site, link, shape: d.shape, outside: d.outside }, options);

// a holder passing on, in the received shape or bare (a QR is always bare, everything inside)
const carry = carryFor(opened, shape);
const { link: next } = await passOn(opened, terms, { ...options, outside: carry.outside && packAttachments(carry.outside) }, carry.attachments);
const nextAddress = toAddress({ site, link: next, shape, outside: carry.outside }, options);
```

`describeHand` also returns the `salt` it used, so the device's list can keep it with the texts.

## Decisions (the assistant's)

- **A public Hand is faced.** All of its list (`title`, `content`, `inbox.n1`) and both texts go in `d`, following ARCHITECTURE §9. This replaces the "numbered + board" form used in `tests/link-fixtures.ts`, because there is no board. A public Hand takes no salt: passing one throws, so that nobody thinks a salt hides a public description.
- **Content that is empty or missing means no `content` statement.** An empty title (after normalisation, with only spaces left) is refused. An inbox key that is not 32 bytes is refused.
- **When `readDescription` says "attached".** It means: the root list matched the Hand's dataHash; the hidden list behind `private` arrived if the root names one; and every `title`/`content` value has its text. Otherwise it says `lost` and still returns what arrived. Example: a holder who dropped the inside of an unlisted link leaves the title only. The function reads the root list and the one list behind `private`, and nothing else. A holder's list hung on its own Shake is never read, even if it has a `title` (tested).
- **canReshape allows only the same shape or bare,** as the task says. Faced → numbered would also be darker, but it is not offered: no mode of this build uses numbered.
- **The keys' byte layout.** Extract salt is `"aHand.keys/1"`. The infos are `"aHand.root/1" ‖ book(8) ‖ n(uint32, big-endian)` and `"aHand.inbox/1" ‖ book ‖ n`. Expand uses one HMAC block, T(1). A test proves that the two-step result equals WebCrypto's own one-call HKDF for n = 0, 1 and 300.
- **The master does not depend on how a wallet writes a key's signature.** A key's signature is first brought to Core's form with `toCoreSignature`, so v as 0/1, ERC-2098 or high s from one key give the same master (tested). A signature that is not a key's is used as it came.
- **matchRoot looks at n = 0 to 1 000 by default** (`MATCH_ROOT_MAX_N`).
- **askSigner refuses a plain signature for an address without code.** It does not pass it to viem: viem's verifier would `ecrecover` it and could say yes to a form that Core refuses (high s, v 0/1). Core asks code only where there is code. A wrapped signature always goes to `verifyHash`, which runs ERC-6492. A network failure throws. It is never turned into "bad signature".
- **signGive.** For `key` or `delegated`, a 64- or 65-byte answer is brought to Core's form. A wrapper, a `code` answer, any other length, or 65 bytes that are not a valid key signature are returned as they came.
- **judgeGive** (D-24):
  - A key that appears on two routes is the same link in the same hands.
  - *Resigned (a)*: walk the new route. Each time it reaches a key of an earlier route further along than the last key matched, every holder in between was skipped. This catches a middle cut even when a stranger is inserted in place of the skipped holders.
  - *Resigned (b)*: the new Give's signer or payee equals the earlier Give's signer or payee (crosswise too; zero is ignored), **and** the earlier route, after the point where the routes part, has holders who kept a share and are not on the new route.
  - Everything else is `branch`, with an empty `dropped`. `dropped` lists the holders the verdict is about, by their position on the earlier route, with a payee where they kept a share. Each holder is named once, across all earlier Gives.
  - `seenGiveOf` marks a Shake as "kept nothing" when `nextClaimBps == claimBps`.
- **costOf.** The L1 fee is added to Base only. Dollars from $1 up show cents. Below $1 they show two significant figures, so $0.000976 reads `0.00098` and never `0`. The fee study's table rounds that row to $0.0010.
- **l1FeeOf** calls `getL1Fee(bytes)` (present on every OP Stack oracle version) with the serialized unsigned transaction. It returns undefined where the predeploy has no code. An oracle that is there and fails throws.

## Sizes (from `sizes.test.ts`, as printed)

Setup: canonical Core, Hand number 1, title of 68 bytes, details of 157 bytes, `inbox.n1` included, paid Shakes (a payee and a 1 % margin each), site `https://ahand.app`. "QR" means the bare address with everything inside, written as decimal digits. "QR text" is the site plus `/#` plus the digits.

| mode | Shakes | link, bytes | address, chars | of it `d`, chars | QR digits | QR text, chars |
|---|---|---|---|---|---|---|
| public | 0 | 37 | 549 | 471 | 939 | 958 |
| public | 1 | 107 | 642 | 471 | 1107 | 1126 |
| public | 3 | 279 | 871 | 471 | 1521 | 1540 |
| public | 6 | 537 | 1215 | 471 | 2143 | 2162 |
| public | 10 | 881 | 1674 | 471 | 2971 | 2990 |
| unlisted | 0 | 319 | 657 | 203 | 1131 | 1150 |
| unlisted | 1 | 389 | 750 | 203 | 1300 | 1319 |
| unlisted | 3 | 561 | 979 | 203 | 1714 | 1733 |
| unlisted | 6 | 819 | 1323 | 203 | 2335 | 2354 |
| unlisted | 10 | 1163 | 1782 | 203 | 3164 | 3183 |
| dark | 0 | 428 | 590 | 0 | 1030 | 1049 |
| dark | 1 | 498 | 683 | 0 | 1199 | 1218 |
| dark | 3 | 670 | 913 | 0 | 1613 | 1632 |
| dark | 6 | 928 | 1257 | 0 | 2234 | 2253 |
| dark | 10 | 1272 | 1715 | 0 | 3063 | 3082 |

How these compare with ARCHITECTURE §0:

- **Link bytes and the dark QR digits match §0 exactly** at 0 Shakes: 37, 319 and 428 bytes, and 1 030 digits. The test asserts these numbers.
- **Address lengths are 1 character off** (§0 had 550, 658 and 589). They also depend on the site's address and on how many digits the Hand number has, so the test does not assert them.
- **Hand number.** With Hand 123 456 instead of 1, every link is 2 bytes longer.
- **Cost of a Shake.** Each paid Shake adds 86 bytes in every mode, as brief 03 says. The first adds only 70, because the 16-byte pin of a link with no Shakes is dropped. The test asserts that the growth is the same in all three modes.

## What was run, and the results

- `cd packages/sdk && bunx vitest run tests/{describe,keys,wallet,payee,resign,money,sizes}.test.ts`: 7 files, 64 tests, 0 failed.
- `cd packages/sdk && bunx vitest run` (the whole SDK suite, including the new chain/tx/errors tests written alongside by sdk-chain): 18 files, 373 tests, 0 failed.
- `cd packages/sdk && bunx tsc --noEmit -p .`: 0 errors.
- Live on the wave 1 helper chain (anvil 1.8.6, Core and the test contracts deployed by `startChain`; ports 15051 and 15052; each test stops its own chain, and nothing was listening on 15050–15099 afterwards):
  - Before the account exists, `askSigner` accepts a KeyAccount owner's ERC-6492-wrapped signature of a real Give digest. It refuses another key's wrapped signature. It refuses the owner's plain signature (there is no code yet). The SDK's offline `checkGive` with `askSigner` returns the Give's hash, or `Refusal("InvalidGiverSig")` for the stranger. Asking deployed nothing.
  - After `createAccount` is mined, the owner's plain signature is accepted, a wrapped one is still accepted, and another key's is refused.
  - `walletKind` gives `key` for a plain key and for the not-yet-deployed account, `code` for Core and the deployed account, and `delegated` for an account after a real EIP-7702 authorization transaction (its code read back as `0xef0100` + the delegate).
  - `l1FeeOf` is undefined on anvil. Then an 11-byte stand-in that returns 12 345 to any call was put at `0x4200…000F` with `anvil_setCode`: `l1FeeOf` read 12 345. This checks the read path and the decoding, **not** Base's fee formula.
- `sha256sum contracts/src/AHandCore.sol` gave `118f4d37…d738`, unchanged.

## Not verified

- Base's real `GasPriceOracle`: nothing was called on a public network.
- Real wallets: a passkey or MPC signer that does not repeat its signatures, Coinbase Smart Wallet's 6492 wrapper, and a hardware wallet's `v` form. Only viem local accounts and the test `KeyAccount` were used.
- That a 32-byte `inboxSecret` is always a valid secp256k1 secret key. It fails with probability about 2⁻¹²⁸. The deliver package turns it into a Nostr key and should refuse the impossible case.
- Nothing visible was built here, so there are no screenshots.

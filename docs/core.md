# Core: the contract

```sh
$ cast call $CORE "hands(uint256)(address,uint40,uint40,uint40,address,uint16,uint16,uint256,address,bytes32)" 14 --rpc-url $RPC
0x70997970C51812dc3A010C7d01b50e0d17dc79C8   # raiser
1801200739                                   # expiry
1798608740                                   # openedAt
1798608764                                   # closedAt: not 0, so closed
0x6B867aFa284Ce84eE76424373420E1170da2eE7b   # token
250                                          # payoutGasK
7000                                         # minClaimBps
40000000                                     # reward
0x3b1227eb9D6F5541Fab08E7f3205506ecA088EB7   # rootKey
0xd6471a75…f06e                              # dataHash
```

`contracts/src/AHandCore.sol`, 655 lines, Solidity 0.8.35, OpenZeppelin 5.6.1. It is the owner's code and is never edited here: `bun run check:core` compares its sha256 with `118f4d37f8a9d54d33245760b0f5871cbb79bf9bf4a7f152d89e84ef5713d738`. It has **no owner, no fee, no pause and no upgrade**; nothing but the functions below moves money. Unaudited.

A Hand locks a reward in one ERC-20 until its expiry. Before the expiry its raiser can pay the reward along a signed route to a giver; from the expiry on anyone can send it back to the raiser.

## Functions

| Function | Who, when | What it does |
|---|---|---|
| `raise(token, reward, expiry, rootKey, payoutGasK, minClaimBps, dataHash) → handId` | anyone | Locks `reward` from the caller. Hands are numbered from 1. A reward of 0 touches no token |
| `extend(handId, newExpiry)` | raiser, before expiry | Moves the expiry later, at most 180 days from now. Every route collected so far stays valid |
| `fund(handId, amount)` | raiser, before expiry | Adds to the reward. Signatures name shares, not amounts, so they stay valid |
| `thank(handId, signedShakes, signedGive, dataHash)` | raiser, before expiry | Checks the route and the Give, closes the Hand, pays each Shake's margin and the giver the rest |
| `refund(handId)` | anyone, from the expiry second | Closes the Hand and pays the whole reward to the raiser |
| `withdraw(token, payee, to)` | anyone to the payee; only the payee elsewhere | Sends what waits for `payee` in `token` |
| `checkRoute(handId, signedShakes) → (lastKey, claimBps, routeHash)` | anyone, view | The route check of `thank` |
| `checkGive(handId, signedShakes, signedGive) → giveHash` | anyone, view | The route and Give check of `thank`. Does **not** look at the expiry, the caller or whether the Hand is closed |
| `hands(id)`, `thanks(id)`, `pending(token, payee)` | views | The Hand's ten fields; `(giveHash, dataHash)` of a thank; waiting money |
| `handsCount`, `thanksCount`, `refundsCount`, `MAX_EXPIRY_PERIOD` (180 days), `eip712Domain()` (`aHand`, `core`) | views | Counters (not a reputation: anyone can inflate them) and constants |
| `transferOut` | Core itself only | Each payout runs in its own frame, so a failing one undoes only itself |

Each payout gets `payoutGasK × 1000` gas. A payout that fails for any reason (a blocked payee, a broken token, too little gas) is not lost: it waits in `pending[token][payee]`.

## Events

| Event | Says |
|---|---|
| `Raised(handId*, raiser*, token*, reward, expiry, rootKey, payoutGasK, minClaimBps, dataHash)` | every term of the Hand |
| `Extended(handId*, expiry)`, `Funded(handId*, amount, reward)` | the new expiry; the new reward |
| `Thanked(handId*, token*, reward, dataHash)` | closed by a thank |
| `Shaken(handId*, payee*, position, margin, nextKey, claimBps, nextClaimBps, dataHash)` | each Shake of the thanked route, zero margins included |
| `Given(handId*, signer*, payee*, amount, claimBps, routeHash, dataHash)` | the accepted Give and the giver's amount |
| `Refunded(handId*, token*, reward)` | closed by a refund |
| `Paid(handId*, token*, payee*, amount)` | that amount **left Core**. Not necessarily what the payee received |
| `Pending(handId*, token*, payee*, amount)` | that amount now waits for the payee |
| `Withdrawn(token*, payee*, amount, to)` | waiting money delivered |

Order in a thank: `Thanked`, then for each Shake `Shaken` and its `Paid` or `Pending`, then `Given` and the giver's payout. No payout event for an amount of zero. A refund: `Refunded`, then one payout. The Yerevan run in [how-it-works](how-it-works.md) produced `Thanked, Shaken, Paid, Shaken, Paid, Given, Paid`. That every state rebuilds from events is proven by `invariant_stateRebuildsFromEvents` in `contracts/test/Core.invariant.t.sol`.

## Errors in plain words

| Error | Where | Meaning |
|---|---|---|
| `ExpiryTooEarly` | raise, extend | the end date is not in the future, or not later than the current one |
| `ExpiryTooLate` | raise, extend | more than 180 days from now |
| `ZeroRootKey` | raise | no link key: nobody could ever pass this Hand on |
| `MinClaimTooHigh` | raise | the giver's minimum is above 100% |
| `NotOpen` | extend, fund, thank, refund | no such Hand, or already closed |
| `NotRaised` | checkRoute, checkGive | no Hand has this number |
| `NotRaiser` | extend, fund, thank | only the raiser may do this |
| `Expired` | extend, fund, thank | time is up; only a refund now |
| `GiverIsRaiser` | thank, checkGive | the giver signed with the raiser's address |
| `ZeroPayee` | thank, checkGive | the Give names nowhere to send the money |
| `InvalidClaim(i)` | route, Give | shares don't add up at pass `i`; at `i` = number of Shakes, the Give's share is not what the route left |
| `AnonymousMargin(i)` | route | pass `i` keeps a share and names no one to pay |
| `InvalidKeySig(i)` | route, Give | the link key's signature at `i` is unreadable or another key's; at `i` = number of Shakes, the Give was not signed by the last holder |
| `InvalidRouteHash` | Give | the Give was signed for another route |
| `BelowMinClaim` | Give | the route leaves the giver less than the raiser's minimum |
| `InvalidGiverSig` | Give | the giver's signature does not check out (wrong key; a smart account refused or is not deployed) |
| `NotExpired` | refund | too early |
| `NotPayee` | withdraw | only the payee may send its waiting money elsewhere |
| `ZeroDestination` | withdraw | not to the zero address |
| `NothingPending` | withdraw | nothing waits for this payee in this token |
| `InexactTransfer` | raise, fund, payouts | the token moved another amount than asked; inside a payout this becomes `Pending` |
| `NotCore` | transferOut | internal |
| `Reentered` | any state change | a token or account called back in mid-operation |

`withdraw` is not wrapped in `try`, so OpenZeppelin's `SafeERC20FailedOperation(token)` can reach its caller; the SDK's `CORE_ERRORS_ABI` decodes all 26 (`packages/sdk/src/errors.ts`). Each error was met live by `packages/sdk/tests/tx.test.ts` and `chain.test.ts` (see `docs/build-notes/sdk-chain.md`). The words the app shows are in `apps/hand/src/i18n/common/{en,ru}.ts` under `core.<Name>`.

## The check order

`thank` checks in this order and stops at the first wrong thing:

```
NotOpen → NotRaiser → Expired → GiverIsRaiser → ZeroPayee
→ per Shake i: InvalidClaim(i) → AnonymousMargin(i) → InvalidKeySig(i)
→ Give: InvalidClaim(n) → InvalidRouteHash → BelowMinClaim → InvalidKeySig(n) → InvalidGiverSig
```

`checkGive` is the same from `GiverIsRaiser` on, after `NotRaised`. Tested in Core by `test_thank_firstWrongThingIsNamed`, `test_checkGive_firstWrongThingIsNamed` and `test_route_firstWrongThingInTheGiveIsNamed` (`contracts/test/Core.t.sol`); through the SDK by the 16-case test "thank's check order" in `packages/sdk/tests/tx.test.ts`; the order as data is `packages/sdk/src/steps.ts` (`checkOrder`, `runSteps`), shown on `/check` and on every flip card.

## The giver's signature

A giver with no code, or with an EIP-7702 delegation, is checked by its key. Otherwise, or if the key did not sign, the address's code decides (ERC-1271). Core has no ERC-6492: an account that is not deployed yet must be set up before the thank ([sdk](sdk.md#an-account-that-is-not-set-up-yet)).

## Accepted limits

The twelve limits of the record are on [limits](limits.md), entries 1–11 and 16: thanking is voluntary; holders rely on the raiser and the giver; a second address is invisible; very long routes can't be thanked; tokens that change balances; blocked payees wait; no deadline or revocation on signatures; the 180-day cap; a lost link; unaudited; no owner and no rescue; a refund can be pushed into waiting.

## Gone from this Core

The earlier Core's charity share, reclaim, Signals, `policyAdmin` and `MAX_SHAKES` are gone; none of them exists in `AHandCore.sol`. Pages about them are in `docs/archive/core-v2/`.

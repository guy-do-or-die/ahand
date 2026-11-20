# How it works: one Hand, from raise to thanks

What the helper sees after two passes (the Deal card, `apps/hand/src/ui/DealCard.tsx`):

```
✋  Someone raised a hand:
    a sublet in Yerevan, June.

    $40 reward · open until 29 Jan

    If you help and they thank you     at least $34
    If you pass it on                  keep a share you choose
    If nobody is thanked by 29 Jan     the whole reward goes back
```

Every number on this page comes from one run on the local stand (slot 3, chain 31337, 2026-11-20; the chain's clock runs 40 days ahead, so its dates read December and January). It is Hand 14. The steps were run with the commands shown; the results are in [`build-notes/docs.md`](build-notes/docs.md). The test token is `MockUSD` ("test dollars", 6 decimals); on Base it would be USDC.

## 1. Raise

The asker (anvil account 1, `0x7099…79C8`) writes a title and details, chooses a reward of 40 and keeps the defaults: the helper keeps at least 70%, the Hand is open for 30 days, each payout may use 250 thousand gas ([defaults](defaults.md), D-26).

- The words are normalised (NFC, LF) and become a list of statements whose hash goes on chain: `dataHash 0xd647…f06e`. The words themselves never go on chain (`packages/sdk/src/describe.ts`).
- The link's first key comes from one signature of the asker's account over a fixed message, by HKDF, with the asker's own Hand number on this device (`packages/sdk/src/keys.ts`; [links](links.md)).
- `raise(token, 40000000, expiry, rootKey, 250, 7000, dataHash)` locks 40 test dollars in Core. The expiry is the chain's latest block time plus 30 days (`expiryAfter`), never the device's clock.

Result: Hand 14, open until 2027-01-29 05:32:19 UTC by the chain's clock, root key `0x3b12…8EB7`.

The app does this on `/raise`; this run used `bun tests/e2e/lib/craft.ts make --slot 3 --reward 40 --min-claim 7000 …`, which calls the same SDK functions.

## 2. Share

The asker sends the address. It is unlisted, the default: the title stands before `#` so a messenger can show it; the details, a salt and the asker's inbox key travel inside the link after `#`, which no server receives.

```
http://127.0.0.1:18330/31337/14?d=AgFP…#<link>
```

## 3. Two passes

A holder opens the link and sees the Deal card: at that point "at least $40", the reward times the claim still left (100%). The holder passes it on, keeping 10% for `0x3C44…93BC`. The next holder keeps 5% for `0x90F7…b906`. Each pass is a Shake signed by the link's key in the page, with no wallet and no transaction; nothing reaches the chain.

```sh
bun tools/ahand.ts pass "$ADDRESS" --rpc $RPC --share-bps 1000 --payee 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
bun tools/ahand.ts pass "$NEXT"    --rpc $RPC --share-bps 500  --payee 0x90F79bf6EB2c4f870365E785982E1f101E93b906
```

After the second pass, `bun tools/ahand.ts inspect` reads: link 383 bytes, 922 digits as a QR code, address 693 characters; route 100% → 90% → 85%; "passes left: 53 more, by the worst gas of one thank".

## 4. The answer

The person who knows a flat (account 4, `0x15d3…6A65`) presses "I can help". The page builds a Give for the claim the route left (85%), the link's last key signs it, and the helper's own key signs it. Before anyone calls it an answer, Core's `checkGive` is asked by `eth_call`; here it answered the give hash `0xf876…892a`. The give link holds no secret. The app delivers it to the asker's inbox key over a relay (NIP-17), or the helper sends it back along the chain.

## 5. Thanks

The asker opens the answer, sees what will be sent to whom, and thanks. Without the site:

```sh
bun tools/ahand.ts thank-calldata "$GIVE" --rpc $RPC --out thank.hex    # Core's checkGive, the payouts, worst gas 973 882
bash contracts/exit/ahand.sh thank thank.hex -- --gas-limit 973882 --private-key <account 1>
```

| Who | Share | Paid |
|---|---|---|
| first holder `0x3C44…93BC` | 10% | 4 test dollars |
| second holder `0x90F7…b906` | 5% | 2 test dollars |
| helper `0x15d3…6A65` | 85% | 34 test dollars |
| total | | 40 |

The balances moved by exactly these amounts (read with `cast call balanceOf` before and after). `hands(14).closedAt` is set and `thanks(14).giveHash` is `0xf876…892a`. The receipt's events, in Core's order: `Thanked`, `Shaken`, `Paid`, `Shaken`, `Paid`, `Given`, `Paid`.

## 6. Proof

```sh
bun tools/ahand.ts verify --rpc $RPC --core $CORE 14
```

23 checks: 22 ok, 1 not checkable here (the description: the words travel only in links), 0 failed. The same check ids appear on the passport page `/31337/14/proof`. The proof saved with `--save` is a bundle: `verify --bundle` checks its signatures and arithmetic with no network; amounts need the chain, because only the chain can say that the events the bundle carries really happened (`verify --bundle FILE --rpc $RPC` re-reads every event of the file by its block hash, and `hands`, `thanks` and `pending` at its block, and fails on any difference).

## If nobody is thanked

From the expiry second on, by the chain's clock, anyone may call `refund(14)` and the whole reward goes back to the asker. Nothing else can take money out of a Hand ([core](core.md)).

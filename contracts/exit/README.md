# The exits: moving a Hand's money without this site

aHand's Core has no owner, no fee and no switch. Everything it holds can be moved by calling it
directly. This folder shows three ways that need nothing from us:

1. **`ahand.sh`**: bash and Foundry's `cast`, from any computer.
2. **A block explorer's "Write Contract" form**, field by field (below).
3. **`exit.html`** from the built app: one self-contained file that works opened from disk.

The three exits are the same three calls: **refund** (time's up: the reward goes back to the raiser),
**withdraw** (a payout that could not be delivered waits in Core for its payee), **thank** (the raiser
pays a route a giver signed). `ahand.sh` also reads a Hand (`status`), and lets the raiser `extend` and
`fund` it.

## 1. `ahand.sh`

```sh
export RPC=https://...            # any RPC of the chain
export CORE=0x...                 # the Core's address (the same on every chain: see contracts/deployments)
bash ahand.sh status 12
bash ahand.sh refund 12 -- --ledger
bash ahand.sh pending <token> <payee>
bash ahand.sh withdraw <token> <payee> [to] -- --account my-key
bash ahand.sh extend 12 +30d -- --private-key "$KEY"
bash ahand.sh fund 12 25.5 -- --ledger
bash ahand.sh thank thank.hex -- --ledger
```

Everything after `--` goes to `cast send` unchanged, so any signer cast knows works. Before sending,
the script checks that `CORE` answers as an aHand Core (EIP-712 domain `aHand`, `core`) and that the
Hand is in a state where the call can pass, judged by the latest block's time, never your computer's.
If Core still refuses, the script names Core's error in plain words. When a withdraw fails because the
token itself will not send to the destination (a blocked address, say), it asks the token, says so in one
line, and names the way out: the payee sends it to another address of theirs (`withdraw <token> <payee>
<to> -- <the payee's signer>`). `ahand.sh` needs only bash and cast.

The thank calldata comes from `bun tools/ahand.ts thank-calldata <give-link>` or from `exit.html`.
`bash selftest.sh` proves refund, withdraw, extend, fund and thank on a fresh local chain (it needs jq too). Before
that, with a stand-in `cast` (`selftest-cast.sh`) and no chain, it checks that amounts past 64 bits
are compared as uint256: a pending 10 tokens of 18 decimals is withdrawn, an unlimited allowance
sends no approve, and 10 tokens with no allowance approve first.

## 2. On a block explorer

Open the Core's address on the chain's explorer (Basescan, Etherscan, Blockscout), tab **Contract**.
"Read Contract" needs nothing. "Write Contract" needs a connected wallet ("Connect to Web3") and a
verified contract; if the explorer shows no form, use `ahand.sh` or `exit.html`.

### First, read the Hand: `hands(handId)`

| Field returned | Meaning |
|---|---|
| `raiser` | who raised it; the refund goes here |
| `expiry` | unix seconds; from this second on, anyone can refund |
| `openedAt` | 0 means no Hand has this number on this chain |
| `closedAt` | not 0: closed, by a thank or a refund |
| `token` | the reward's token |
| `payoutGasK` | gas each payout may use, in thousands |
| `minClaimBps` | the giver's guaranteed least share, in hundredths of a percent |
| `reward` | the reward, in the token's smallest units (6 decimals for USDC: 1000000 = 1) |
| `rootKey`, `dataHash` | the link's first key; the hash of the Hand's description |

Compare `expiry` with the time of the chain's latest block (shown on the explorer's front page or
in the block list), not with your clock. `thanks(handId)` tells a thanked Hand (a `giveHash` that is
not zero) from a refunded one (zero).

### Exit 1: `refund`

| Field | Write |
|---|---|
| `handId (uint256)` | the Hand's number |

Anyone may send it, from the second `expiry` is reached, while `closedAt` is 0. The whole reward
(everything raised and funded) goes to `raiser`. If the token refuses that transfer, it waits as
pending for the raiser (exit 2).

### Exit 2: `withdraw`

First read `pending(token, payee)`: the amount waiting, in smallest units. Then:

| Field | Write |
|---|---|
| `token (address)` | the token it waits in |
| `payee (address)` | the address it waits for |
| `to (address)` | where to send it: the payee itself (anyone may send this), or another address (only the payee's own account may) |

Never the zero address. The whole pending amount moves at once.
If the token refuses to send to the payee itself, nothing moves and it keeps waiting; the payee then
sends it to another address of theirs.

### Exit 3: `thank`

Only the raiser's account, only before `expiry`. The values come from the thank calldata built from
the giver's give link (`bun tools/ahand.ts thank-calldata <give-link>`, or `exit.html`); this prints
them in the order of the form:

```sh
cast decode-calldata "thank(uint256,((address,address,uint16,uint16,bytes32),bytes)[],((address,address,uint16,bytes32,bytes32),bytes,bytes),bytes32)" <calldata>
```

| Field | Write |
|---|---|
| `handId (uint256)` | the Hand's number |
| `signedShakes (tuple[])` | the route, one entry per pass, in order: `[[[nextKey, payee, claimBps, nextClaimBps, dataHash], keySig], ...]`; `[]` when the giver opened the link first-hand |
| `signedGive (tuple)` | `[[signer, payee, claimBps, routeHash, dataHash], keySig, giverSig]` |
| `dataHash (bytes32)` | what the raiser states with the thank; `0x0000000000000000000000000000000000000000000000000000000000000000` for nothing |

Addresses and hashes go in quotes inside the brackets on most explorers, numbers without:
`[["0xAb…", "0xCd…", 10000, "0x5e…", "0x00…"], "0x…", "0x…"]`. Before sending, "Read Contract" →
`checkGive(handId, signedShakes, signedGive)` with the same values must answer a hash and no error.

**A giver whose smart account is not deployed yet** signed with an ERC-6492 wrapper. Unwrap it
(`tools/ahand.ts` does) into a factory, its calldata and the inner signature. First set the account up
through Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`, "Write Contract" → `aggregate3`,
`calls = [[factory, true, factoryCalldata]]`), never by calling the factory from your own account:
a wrapper can name any contract and any call, and sent from your account it would act in your
name. Then thank with the inner signature as `giverSig`.

### What Core's refusals mean

| Error | Meaning |
|---|---|
| `NotOpen` | no Hand with this number, or it is already closed |
| `NotExpired` | too early to refund: the Hand still runs |
| `Expired` | time is up: it can only be refunded now |
| `NotRaiser` | only the raiser may do this |
| `NotPayee` | only the payee may send its pending money elsewhere |
| `NothingPending` | nothing waits for this payee in this token |
| `ZeroDestination` | not to the zero address |
| `InvalidGiverSig` | the giver's signature does not check out (wrong key, or the smart account refused or is not deployed) |
| `InvalidKeySig(i)`, `InvalidClaim(i)`, `InvalidRouteHash`, `BelowMinClaim` | the route or the Give was changed after signing, or does not meet the Hand's terms |

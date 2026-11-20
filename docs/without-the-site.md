# Without the site

```sh
$ export RPC=http://127.0.0.1:18575 CORE=0x65ac707E2AE7392583de5d6192C619F1D8862309
$ bash contracts/exit/ahand.sh status 2
Hand 2: TIME'S UP since 2026-12-30 05:32:05 UTC. Anyone can refund it: ahand.sh refund 2
$ bash contracts/exit/ahand.sh refund 2 -- --private-key <any account>
refunding Hand 2: 15 mUSD (15000000 units) back to 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
status               1 (success)
```

Core has no owner and no switch, so every Hand's money can be moved by calling Core directly. Three ways need nothing from this site: `exit.html`, the shell script `ahand.sh`, and a block explorer's contract form. They cover the three money actions: **thank** (the raiser pays a route), **refund** (from the expiry, anyone; the reward goes back to the raiser) and **withdraw** (waiting money to its payee). `ahand.sh` also reads a Hand and lets the raiser extend and fund it. Every command on this page was run on the local stand on 2026-11-20; results in [`build-notes/docs.md`](build-notes/docs.md). The survival drill (`bun infra/stand/drill.ts --slot 3 --reuse` on a running stand, or without `--reuse` on a free slot; `tests/e2e/drill.spec.ts`) turns face, the relay and then the whole site off and moves money these ways.

## 1. `exit.html`

One self-contained file in every build (`apps/hand/exit/`, built into `dist/exit.html`, about 570 kB with its fonts). Type any RPC address; it checks that Core answers as an aHand Core (`eip712Domain` = `aHand`, `core`) on that chain, reads a Hand by number, judges its state by the latest block's time, and offers refund, withdraw and thank from a give address, each with the wallet's button, the `cast send` line, and the explorer's fields and raw calldata. For a helper's account that is not set up yet it offers two steps: the setup through the forwarder, then the thank. English and Russian. Download it from `/without-us` (saved as `ahand-exit.html`).

**The file-page caveat.** Opened from disk (`file://`), a browser wallet extension does not inject into the page, so the buttons cannot send. The page says so: "Opened from a file, a browser wallet can't see this page." Use the `cast` lines it prints, or serve the folder:

```sh
cd <folder with exit.html> && python3 -m http.server "${PORT:-8000}" --bind 127.0.0.1
# then open http://127.0.0.1:${PORT:-8000}/exit.html
```

The page itself prints the same command with port 8000.

## 2. `ahand.sh`

Bash and Foundry's `cast` (`contracts/exit/ahand.sh`; field-by-field explorer notes in `contracts/exit/README.md`). Environment: `RPC`, `CORE`, and `FOUNDRY_BIN` (default `~/.foundry/bin`). Everything after `--` goes to `cast send` unchanged (`--ledger`, `--account`, `--private-key`). Before sending it checks that `CORE` answers as an aHand Core and that the Hand's state allows the call, by the latest block's time; if Core still refuses, it names Core's error in plain words and exits 1, also for a transaction that was mined and reverted.

```sh
bash contracts/exit/ahand.sh status 14
bash contracts/exit/ahand.sh refund 2 -- --private-key <any account>
bash contracts/exit/ahand.sh pending <token> <payee>
bash contracts/exit/ahand.sh withdraw <token> <payee> [to] -- --private-key <any account; only the payee for another "to">
bash contracts/exit/ahand.sh extend 4 +60d -- --private-key <the raiser>
bash contracts/exit/ahand.sh fund 4 5 -- --private-key <the raiser>
bash contracts/exit/ahand.sh thank thank.hex -- --gas-limit 973882 --private-key <the raiser>
```

The thank's calldata comes from the give link:

```sh
bun tools/ahand.ts thank-calldata "<give address>" --rpc $RPC --out thank.hex
```

It asks Core's `checkGive`, prints what will be sent to whom, the worst gas (pass it as `--gas-limit`, so every payee gets its whole payout gas) and the ready `ahand.sh` line. For a 6492-wrapped answer from an account with no code it prints, first, a `cast send` to the forwarder that sets the account up, then the thank calldata with the inner signature. `bun tools/ahand.ts pass "<live address>" --rpc $RPC` passes a link on with no site; `bun tools/ahand.ts verify --rpc $RPC --core $CORE <handId>` checks a Hand's whole proof.

`bash contracts/exit/selftest.sh` proves refund, pending, withdraw both ways, extend, fund and thank on a fresh local chain (set `SELFTEST_PORT`).

## 3. A block explorer

Open Core's address on the chain's explorer, tab **Contract**. "Read Contract" needs nothing: `hands(handId)`, `thanks(handId)`, `pending(token, payee)`. "Write Contract" needs a connected wallet and a verified contract.

| Action | Fields |
|---|---|
| `refund` | `handId` |
| `withdraw` | `token`, `payee`, `to` (the payee itself: anyone may send; elsewhere: only the payee) |
| `thank` | `handId`, `signedShakes`, `signedGive`, `dataHash` (zero for nothing). Decode the calldata into these fields with the line below |

```sh
cast decode-calldata "thank(uint256,((address,address,uint16,uint16,bytes32),bytes)[],((address,address,uint16,bytes32,bytes32),bytes,bytes),bytes32)" $(cat thank.hex)
```

Compare `expiry` with the time of the chain's latest block, not your clock. Before a thank, "Read Contract" → `checkGive` with the same values must answer a hash. For an account that is not set up yet, set it up through Multicall3's `aggregate3` (`calls = [[factory, true, factoryCalldata]]`), **never** by calling the factory from your own account. The full field-by-field guide, with the meaning of every refusal, is `contracts/exit/README.md`.

Not run tonight: any explorer form (none is reachable from a local chain), Multicall3 on a real network, `ahand.sh` with `--ledger` or `--account`.

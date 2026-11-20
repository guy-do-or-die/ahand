# cli-verify (wave 5)

`tools/ahand.ts` now proves from a clone what the site proves: `verify`, `find`, `recover` and `help` are added. The wave 2 commands (`inspect`, `thank-calldata`, `pass`, `manifest`, `core-check`) behave as before. `tools/manifest.ts` is untouched, so `hashDir` gives the same result.

## What was built

- `tools/lib/cli.ts` holds what every command shares: `Fail`, argument parsing (value options and switches), `clean`, `connect`, `trustedCore`, `amountOf` and the formatters. They were moved out of `ahand.ts` unchanged. `ahand.ts` still exports `Fail`, and now `USAGE` too.
- `verify --rpc URL [--core 0x…] <handId> [--give ADDRESS] [--between] [--details] [--save FILE]` runs the SDK's `collect` and `passportOf`. It prints one line per check: id, `ok` / `FAIL` / `not checkable`, and an English sentence. Under a FAIL it always prints the formula, inputs, expected, actual and source; under a "not checkable" it prints the reason. `--details` adds that evidence under every check. Exit 0 only when no check failed.
- `verify --bundle FILE [--details]` does the same from a saved proof through `verifyBundle`, with no network. `--save` writes the bundle with `exportBundle`.
- `find --rpc URL [--core] --raiser 0x… [--days N] [--chunk B]` builds its window from the latest block's timestamp minus N days (`findBlockAt`). It then runs the SDK's `findLaterHands` over that window with no cap on windows. Before the first `eth_getLogs` it prints the request count. It shows progress on stderr (one rewriting line on a TTY, otherwise about 20 lines). On Ctrl-C it finishes the request in flight, prints what it found and exits 130; a second Ctrl-C quits at once. For each Hand it prints `#id state reward`, with the state read at the latest block. The help text says an indexer would replace it.
- `recover --book HEX [--max N] --rpc URL [--core] <handId> [--print-link [--site URL]]` reads the keys signature from standard input. Steps: `masterOf`, then `matchRoot` against `hands(id).rootKey`. The default output is `n`, the book, the first 10 characters of the root key, and the Hand's state. With `--print-link` it rebuilds the seed with `rootSeed` and encodes a live link with `encodeLive` (no route, no words). It prints a warning on stderr and the link as the last line of stdout: the link alone, or `<site>/#<link>` with `--site`.
- `help` lists all eight commands, each with one example.
- `tools/lib/passport.ts` holds one English sentence per sentence key of `proof.ts` (19 keys) and the line layout.

## Choices the design did not make

- **The contract check from a clone uses this clone's build.** `verify --rpc` gives `collect` the factory, salt and initcode hash from `contracts/out`, but only when that build matches `AHandCore.sol` as it is now. Otherwise it uses the chain's deployment file, and with neither the check reads "not checkable". `verify --bundle` replaces the bundle's own `build` facts with this clone's before `verifyBundle` runs, because a bundle should not vouch for its own contract. A test shows that a bundle naming another Core then fails `core`. Without a build in the clone, the bundle's facts are used, and the header says so.
- **The stretch between raise and closing** (Funded/Extended) is read at once when it takes at most 216 requests (one day of Base, the SDK's `LATER_HANDS_WINDOWS`). A longer stretch is read only with `--between`; until then `reward-time` reads "not checkable", with the count. This mirrors the page, which asks first.
- **`--give` takes only a give link.** A live link is refused before anything is read, and nothing is saved, so `--save` can never write a seed into a bundle.
- **What "before the first request" means for `find`.** Finding the start block takes one read of the latest block plus a binary search. Those reads cannot be counted before the latest block is known, so the first stderr line announces them in words. The printed count is the count of `eth_getLogs` requests, and the test asserts it equals the number actually made.
- **`find` reports more than the brief listed.** Each row also gives the raise block and its UTC time. `--chunk` (1 to 2 000 blocks) is there for RPCs that cap log ranges. `--days` must be from 1 to 366.
- **recover's signer note.** If the signature recovers as a key's (65 bytes) to an address other than the raiser, the failure says so. `--max` defaults to the SDK's 1 000 and may go up to 1 000 000. `--book` accepts 16 hex characters, with or without `0x`, in any case.
- **Ports.** The wave 2 tests used 15251 to 15253. They now use my range, as do my new tests: 18352 to 18358, with a dead port at 18398. I left out 18350 and 18351 on purpose: stand slots 5 to 9 serve their site and Vite on ports ending in 0 and 1, and slot 5's Vite was listening on 18351 while I worked.

## What I ran

| Command | Result |
|---|---|
| `cd tools && bun test` | 42 pass, 0 fail (6 files; wave 2's 21 tests are among them), three green runs after the port move (the first full run failed one file on a port another agent held) |
| `cd tools && bunx tsc --noEmit -p .` | 0 errors |
| `verify --rpc … --give <give address>` on a thanked Hand (1 pass at 10%, key giver) on the helper chain | 18 checks, all `ok`, exit 0 (also looked at by hand) |
| the same Hand without `--give` | exit 0; only `description` is not checkable; signatures recovered from the thank's input |
| ids and verdicts printed vs `passportOf(collect(…))` in the test process | ids equal; verdicts equal except `core`, which the SDK alone cannot check without build facts |
| open Hand; Hand refunded after a 3-day jump | ids `core, raised, reward-time, description`; and `… refunded, payout.raiser, now.<raiser>`, exit 0 |
| `verify --save`, then `--bundle` | the same lines, "no network was used", exit 0 |
| bundle with the giver's `Paid` amount +1 | exit 1, `ahand: 2 checks failed: payout.giver, payouts` |
| bundle with another Core | `core` FAIL, exit 1 |
| `find` through a recording proxy (18355): two Hands of account 1 in the last day, one older by 2 days, one by account 3 | the count line was on stderr before the first `eth_getLogs`; requests made = printed count; found exactly the two, `open`, `5 mUSD` and `0 mUSD`; `--days 3` also finds the older one |
| `find --chunk 1` with SIGINT after 2 requests | exit 130, "stopped after k of N requests", fewer requests made than N |
| `recover` for a Hand raised with `rootSeed(master, book, 7)` | `found: n = 7`; no seed, signature or master in stdout+stderr (hex, base64url, digits) |
| `recover --print-link --site …` | the printed link opens (SDK `openLink`) with the Hand's seed; warning on stderr |
| wrong book, `--max` too low, another key's signature, empty stdin, `--signature` as an option | exit 1, 1, 1 (naming the key), 2, 2 |
| `sha256sum contracts/src/AHandCore.sol` | `118f4d37…d738` |

Every helper chain was stopped by its own `stop()`. The proxy was stopped in `finally`. Nothing of mine listens on 18352–18359 or 18398.

## Not verified

- Not run against a stand or against the proof page in a browser, so "the same ids as the page" rests on both calling `passportOf`. The test compares with `passportOf` directly. The gate's command (`verify --rpc http://127.0.0.1:18545 …` on slot 0's thanked fixture) was not run by me.
- No real RPC with log-range limits; not run on Base; the find rate on 216+ windows not measured.
- `recover` was not run with a smart-account signature (one that need not repeat) or on a TTY, where it asks for Ctrl-D.
- No screenshots: this package has nothing in a browser.

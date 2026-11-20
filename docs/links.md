# Links

```
http://127.0.0.1:18330/31337/14?d=AgFP…#AQ…
└──────── site ───────┘└ chain/hand ┘└ d ┘└ the link: never sent to any server ┘
```

`bun tools/ahand.ts inspect '<address>' --rpc $RPC` prints any address's head, shape, sizes, route, words and the Hand's state, and never prints the secret. The format is `packages/sdk/src/link.ts` (its header comment is the byte layout) and `packages/sdk/src/address.ts`.

## Kinds

| Kind | Carries | Made by |
|---|---|---|
| live | the route so far and the **one secret**: a 16-byte seed whose key signs the next Shake | `encodeLive`, `passOn` |
| give | the route and a Give signed by the last key and by the giver; **no secret** | `encodeGive` |
| addressed | a route whose next holder is a personal key, no seed | `encodeAddressed` exists in the SDK; **not built** in the app (D-45) |

A live link with no Shakes carries a 16-byte pin: the first bytes of the EIP-712 hash of the Hand's terms, so after a reorg it is refused on a Hand with other terms instead of misused (`pinOf`; test "the pin" in `packages/sdk/tests/link.test.ts`). Each Shake adds 86 bytes; the first adds 70, because the pin goes. The giver's signature travels as it is, so an ERC-6492 wrapper of an undeployed account travels unchanged.

## Three shapes of the address

| Shape | Address | A server sees |
|---|---|---|
| bare | `<site>/#<link>` | nothing |
| numbered | `<site>/<chainId>/<handId>#<link>` | which Hand |
| faced | `<site>/<chainId>/<handId>?d=<data>#<link>` | which Hand and the public part of its description |

With a Core other than the canonical one, its address stands in the path: `<site>/<chainId>/<core>/<handId>`. `d` is checked against the `dataHash` Core keeps before a word of it is shown. A holder may keep the shape or make it darker, never lighter (`canReshape` in `packages/sdk/src/describe.ts`, test "allows the same shape or bare, never lighter"). A QR code always carries the bare address with everything inside, as decimal digits.

## Three modes, and who sees what

| Mode | Address | Server and preview robots | The page's code in your browser | On chain, always public |
|---|---|---|---|---|
| public | faced; title, details and the inbox key in `d` | Hand number, title, details | everything, and the link's secret | raiser, token, reward, dates, root key, the description's hash |
| **unlisted** (default) | faced; the title in `d`; details, salt and inbox key inside the link | Hand number, title | everything, and the link's secret | the same |
| dark | bare; everything inside | nothing | everything, and the link's secret | the same |

The server never receives what stands after `#`; **the code the site serves reads it in your browser, because that is how a link opens.** A dishonest or look-alike site could copy a link or write another payee into a pass. Dark is not encryption. Russian names: открытая / по ссылке / тёмная (D-33). Built by `describeHand` (`packages/sdk/src/describe.ts`, tests "public: …", "unlisted: …", "dark: …" in `describe.test.ts`). A public Hand carries its whole description in `d` because there is no board (D-34, a deviation from the SDK fixture's public shape).

The face server (`apps/face`) reads only the part before `#`: it shows a title only after `d` matched Core's `dataHash`, and a generic card ("Someone raised a hand. Open to see.") for a bare address, a mismatch or an unknown Core.

## The description

The Hand's words are a sorted list of named statements hashed under `keccak256("aHand.data/1")` (`packages/sdk/src/data.ts`). This build uses `title`, `content`, `salt`, `private` and `inbox.n1` (the asker's 32-byte inbox key for answers). Text is normalised to NFC with LF before hashing. A reader says `attached`, `none` or `lost` (`readDescription`); a lost description still lets the link pass (D-35).

## The root key

The first key of a Hand's link is derived, not stored (`packages/sdk/src/keys.ts`):

- The asker's account confirms one EIP-712 message, domain `aHand keys`/`1`, whose text is its own warning: "Rebuilds my aHand links and opens replies to me. I sign this only on a site I trust."
- `master = HKDF-Extract("aHand.keys/1", signature)`; `rootSeed = HKDF-Expand(master, "aHand.root/1" ‖ book ‖ n)` (16 bytes); `inboxSecret = HKDF-Expand(master, "aHand.inbox/1" ‖ book ‖ n)`.
- `book` is 8 random bytes per device and asker; `n` is the asker's own Hand number in that book, reserved before anything is signed and never reused (`reserveNumber` in `apps/hand/src/store/db.ts`). Two devices can never make the same root key.
- Rebuild from a clone: `bun tools/ahand.ts recover --book <16 hex> --rpc $RPC <handId>` (reads the signature from standard input). The description is never on chain, so a rebuilt link has no words; the full recovery is the saved link.

## Errors

A link that does not open says why, and nothing else is opened: `malformed` ("This link is damaged."), `unsupported` ("made by a newer app"), `untrusted` (a Core or chain this site doesn't read: `UntrustedCore`), `no-canonical`, `another-hand`, `not-this-hand`, `invalid` (Core would refuse it), `too-long`, `unmatched-data`. Fail-closed is tested in `tests/e2e/guards/failclosed.spec.ts`.

## Measured sizes

From `packages/sdk/tests/sizes.test.ts` (copied from `docs/build-notes/sdk-words.md`): canonical Core, Hand 1, a 68-byte title, 157-byte details, `inbox.n1` included, each Shake paid (a payee and a 1% share), site `https://ahand.app`. "QR digits" is the bare address with everything inside.

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

The test asserts the link bytes at 0 Shakes (37, 319, 428) and the dark QR digits (1 030); address lengths depend on the site and the Hand number and are printed, not asserted. The Yerevan Hand after two passes (unlisted, a 26-byte title): link 383 bytes, 922 QR digits, address 693 characters (`inspect`, [how-it-works](how-it-works.md)).

How far a link can go: `passesLeft` counts the passes that still fit one thank at the worst gas: 66 at `payoutGasK` 200, 55 at 250 (`packages/sdk/tests/gas.test.ts`, `apps/hand/src/screens/raise/link.test.ts`); reading stops past 369 Shakes (`LONGEST_ROUTE` in `packages/sdk/src/gas.ts`).

# Links

```
http://127.0.0.1:18330/31337/14?d=AgFP…#AQ…
└──────── site ───────┘└ chain/hand ┘└ d ┘└ the link: never sent to any server ┘
```

The format is `packages/sdk/src/link.ts` (its header comment is the byte layout) and `packages/sdk/src/address.ts`. `packages/sdk/tests/link-vectors.json` holds 27 links that readers written apart from each other, in TypeScript, Python and Go, open with the same answer; the SDK is checked against them.

From a clone, with no site: `pbpaste | bun tools/ahand.ts inspect - --rpc $RPC` prints any address's head, each pass, where it ends, its sizes and the Hand's state, and never prints the secret (a live link's seed shows only as present). Give the address as `-`, or pipe it in with no argument, so a live link stays out of shell history; as an argument it works, with a warning.

## Kinds

| Kind | Carries | Made by |
|---|---|---|
| live | the route so far and the **one secret**: a 16-byte seed whose key signs the next Shake | `encodeLive`, `passOn` |
| give | the route and a Give signed by the last key and by the giver; **no secret** | `encodeGive` |
| addressed | a route whose next holder is a personal key, no seed | `encodeAddressed` |

A live link with no Shakes carries a 16-byte pin: the first bytes of the EIP-712 hash of the Hand's terms, so after a reorg it is refused on a Hand with other terms instead of misused (`pinOf`; test "the pin" in `packages/sdk/tests/link.test.ts`). Each Shake adds 86 bytes; the first adds 70, because the pin goes. The giver's signature travels as it is, so an ERC-6492 wrapper of an undeployed account travels unchanged.

## Three shapes of the address

| Shape | Address | A server sees |
|---|---|---|
| bare | `<site>/#<link>` | nothing |
| numbered | `<site>/<chainId>/<handId>#<link>` | which Hand |
| described | `<site>/<chainId>/<handId>?d=<data>#<link>` | which Hand and the public part of its description |

In the SDK the attachments in `d` are the public part (`publicPart`) and those after `#` the link part (`linkPart`): `describeHand` returns both, `toAddress` and `LinkOptions` take the public part, `openLink` returns both, and `viewOf` returns the public part matched.

A link or an address that leaves Core's address out names the canonical Core, `0x65ac707E2AE7392583de5d6192C619F1D8862309`, the same on every chain (`CANONICAL_CORE`; see [the SDK](sdk.md)). With another Core, its address stands in the link and in the path: `<site>/<chainId>/<core>/<handId>`, in lower case. `d` is checked against the `dataHash` Core keeps before a word of it is shown. A holder may keep the shape or make it darker, never lighter (`canReshape` in `packages/sdk/src/describe.ts`, test "allows the same shape or bare, never lighter"). A QR code always carries the bare address with everything inside, as decimal digits.

## Three modes, and who sees what

| Mode | Address | Server and preview robots | The page's code in your browser | On chain, always public |
|---|---|---|---|---|
| public | described; title, details and the inbox key in `d` | Hand number, title, details | everything, and the link's secret | raiser, token, reward, dates, root key, the description's hash |
| **unlisted** (default) | described; the title in `d`; details, salt and inbox key inside the link | Hand number, title | everything, and the link's secret | the same |
| dark | bare; everything inside | nothing | everything, and the link's secret | the same |

The server never receives what stands after `#`; **the code the site serves reads it in your browser, because that is how a link opens.** A dishonest or look-alike site could copy a link or write another payee into a pass. Dark is not encryption. On screen the modes are called Public, Unlisted and Hidden (with their own words in each language): "dark" stays the mode's name in the code, the SDK and this document, and "Hidden" is the interface's word for it, since "dark" there already names the theme. Built by `describeHand` (`packages/sdk/src/describe.ts`, tests "public: …", "unlisted: …", "dark: …" in `describe.test.ts`). A public Hand carries its whole description in `d`, because there is no public index of Hands to read it from. How long `d` may be is the site's limit, not the format's (`PUBLIC_PART_MAX_CHARS`, 8,192 base64url characters, in `@ahand/sdk/app`).

A preview server sees only the part before `#`: it should show a title only after `d` matched the `dataHash` Core keeps (`viewOf` does both), and a generic card for a bare address, a mismatch or a Core it does not trust. [The view server](view.md) is that server.

## The description

The Hand's words stand behind its `dataHash`, which Core keeps and never reads (`packages/sdk/src/data.ts`):

```
dataHash = keccak256(abi.encode(keccak256("aHand.data/1"), names, values))
```

A list of named statements, each a name of 1 to 32 bytes of text (padded with zeros to 32, no zero character in it) and a 32-byte value, sorted by name; a name stands at most once. A statement about a text has the hash of the text as its value (`textValue`), the text brought to Unicode NFC with LF line ends first (`normalizeText`). A value may be the `dataHash` of another list, so lists nest. New statements are new names, which older readers skip; another arrangement would be another format tag, so a `dataHash` of one format is never read as another's. The same formula is written in Solidity in `contracts/test/SdkVectors.t.sol`, and the SDK is checked against it.

This build uses `title`, `content`, `salt`, `private` and `inbox.n1` (the asker's 32-byte inbox key for answers). A reader says `attached`, `none` or `lost` (`readDescription`); a lost description still lets the link pass.

## The root key

The first key of a Hand's link is derived, not stored (`packages/sdk/src/keys.ts`):

- The asker's account confirms one EIP-712 message, domain `aHand keys`/`1`, whose text is its own warning: "Rebuilds my aHand links and opens replies to me. I sign this only on a site I trust."
- `master = HKDF-Extract("aHand.keys/1", signature)`; the root seed `rootSeedOf(master, book, n) = HKDF-Expand(master, "aHand.root/1" ‖ book ‖ n)` (16 bytes); the inbox secret `inboxSecretOf(master, book, n) = HKDF-Expand(master, "aHand.inbox/1" ‖ book ‖ n)` (32 bytes).
- `book` is 8 random bytes per device and asker; `n` is the asker's own Hand number in that book, which the application reserves before anything is signed and never reuses. Two devices can never make the same root key.
- After a lost device, rebuild a root link from a clone: `pbpaste | bun tools/ahand.ts recover --book <16 hex> --rpc $RPC <handId>` reads the keys signature from standard input (never from an argument), finds `n` in that book and prints the root key's first characters; `--print-link` prints the live link itself, under a warning.
- The description is never on chain, so a link rebuilt from the keys has no words; the full recovery is the saved link.

## Errors

A link that does not open says why, and nothing else is opened: `malformed` (damaged), `unsupported` (a newer format), `untrusted` (a Core or chain this site doesn't read: `UntrustedCore`), `no-canonical-core` (no Core's address, and the reader was told it knows no canonical Core), `non-canonical` (written in a way the format does not allow), `another-hand`, `not-this-hand` (the route does not start at the Hand's root key, `refusal` `InvalidKeySig` with no position; or the pin differs), `invalid` (Core would refuse it, or every Give that ends it: a route below the Hand's minimum or ending at the zero key; `refusal` names Core's error, with its position where Core's is certain, and is absent only for a seed that gives no key, about one seed in 2^128), `too-long` (more Shakes than one transaction carries, or more than 128 KiB, `MAX_LINK_BYTES`; both are the reader's limits and options), `unmatched-data`. Fail-closed is tested in `packages/sdk/tests/chain.test.ts` and `packages/sdk/tests/errors.test.ts`.

## Measured sizes

From `packages/sdk/tests/sizes.test.ts`: canonical Core, Hand 1, a 68-byte title, 157-byte details, `inbox.n1` included, each Shake paid (a payee and a 1% share), site `https://ahand.app`. "QR digits" is the bare address with everything inside.

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

The test asserts the link bytes at 0 Shakes (37, 319, 428) and the dark QR digits (1 030); address lengths depend on the site and the Hand number and are printed, not asserted.

How far a link can go: `passesLeft` counts the passes that still fit one thank at the worst gas: 66 at `payoutGasK` 200, 55 at 250 (`packages/sdk/tests/gas.test.ts`); reading stops past 369 Shakes (`LONGEST_ROUTE` in `packages/sdk/src/gas.ts`) and past 128 KiB (`MAX_LINK_BYTES` in `packages/sdk/src/link.ts`).

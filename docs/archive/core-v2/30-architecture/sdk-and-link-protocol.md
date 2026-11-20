# SDK and link protocol

`packages/sdk` is a pure TypeScript protocol SDK — no chain access, no UI. It is the shared surface the web app builds its raise, pass, give, and thank flows on, and any compatible client can use it to import bytes created by another. Five modules, all re-exported from `index.ts`:

- **`types.ts`** — `HandRef`, `Shake`, `Give`, `ShakerAcceptance`, `GiverAcceptance`, `ShakerMode`, `Visibility` (zod schemas mirroring `AHandTypes.sol`; field order frozen), protocol constants (`BPS_DENOMINATOR`, `MIN_CHARITY_BPS`, `MAX_CHARITY_BPS`, `MAX_SHAKES`, `MAX_ENCODED_LINK_LENGTH`, `MAX_INLINE_BODY_BYTES`), and the EIP-712 domain: name `"aHand"`, version `"2"`, plus the frozen type strings that must byte-match `AHandSig`.
- **`hash.ts`** — `domainSeparator`, the canonical `handRef` hash (`keccak256(abi.encode(chainId, core, handId))`), struct hashes and signing digests for Shake/Give and both acceptances, and `routeHash`/`routeHashOf` (ordered Shake struct hashes under the Hand reference).
- **`sign.ts`** — `newCapability()` (fresh private key per hop), `signShake`/`signGive` with capability keys, `signShakerAcceptance`/`signGiverAcceptance` through a `TypedSigner` (the only artifacts user wallets sign), and EIP-2098 conversion (`toCompactSig`/`fromCompactSig`) — the codec stores every signature as 64 compact bytes.
- **`payload.ts`** — the binary route container (below).
- **`verify.ts`** — `verifyLiveRoute`/`verifyTerminalProof`: pure verification that mirrors the contract's `thank` walk against caller-supplied `HandFacts` (root capability, expiry, `minGiverClaimBps`, commitments), so a client fails closed with the same judgement the chain would render. Failures accumulate with per-hop reasons (`capability-proof`, `claim-mismatch`, `claim-below-floor`, `anonymous-shaker-with-margin`, `expired`, …) instead of stopping at the first.

The SDK has vitest suites including signature-tampering cases, and the contracts repo generates cross-language vectors (`GenVectors`) so TS hashing byte-matches Solidity.

## Payload codec

One compact binary envelope rendered as unpadded base64url, kind-discriminated:

```text
header:  magic "aH" (2) | version (1, = 2) | kind (1)
         | chainId u64 (8) | core (20) | handId u256 (32) | hopCount (1)
per hop: childCapability (20) | childClaimBps u16 (2)
         | flags (1): bits 0-1 mode (0 anonymous, 1 self, 2 explicit),
                      bit 2 hasHopDataHash
         | explicit ⇒ shaker (20) + acceptanceSig (64, EIP-2098)
         | hasHopDataHash ⇒ hopDataHash (32)
         | shakeSig (64, EIP-2098)
LiveRoute (0x01) tail:
         capMode (1): 0x00 bearer ⇒ secret (32) | 0x01 personal ⇒ address (20)
         | envelopeLen u16 | envelope | bodyLen u16 | body
TerminalProof (0x02) tail:
         giver (20) | solutionHash (32) | giveSig (64) | giverAcceptanceSig (64)
         | evidenceCount (1) | [refLen u16 + ref]*
```

Everything reconstructible is not transported: `handId` appears once in the header, `parentClaimBps` telescopes from `BPS_DENOMINATOR`, parent capabilities chain from the Hand's `rootCapability`, every deadline equals the Hand expiry, and `Give.routeHash`/`finalClaimBps` re-derive from the hops. A byte not on the wire cannot be tampered with in transit — and `buildLiveRoute` validates at encode time that everything inferred at decode already holds (`planHops`), rejecting non-canonical input.

### Shaker attribution modes

`deriveShakerMode(shaker, parentCapability)` gives the canonical transport mode; EIP-712 hashing always covers the resolved `shaker` address.

| Mode | Resolved `shaker` | Extra wire bytes | Rule |
|---|---|---|---|
| `anonymous` | zero address | none | zero-margin only; no payout, acceptance, or `SHAKEN` |
| `self` | the signing parent capability | none | the Shake signature supplies attribution |
| `explicit` | a distinct account | 20-byte address + 64-byte `ShakerAcceptance` | acceptance signs the exact `shakeHash` |

The decoder rejects an `explicit` hop whose shaker collapses to zero or to the parent capability, reserved flag bits, and a transported zero `hopDataHash` — non-canonical encodings fail, they are not normalized.

### Single-secret rule

The `LiveRoute` tail holds the codec's only structural secret slot, and `buildLiveRoute` accepts exactly one `Capability` — a fresh bearer secret or a personal wallet address. There is no parameter through which a second key could travel, so parent-secret stripping is a property of the type schema, not developer discipline.

The `TerminalProof` has no secret slot at all. `buildTerminalProof` accepts only signed artifacts (`SignedGive`, `giverAcceptanceSig`, opaque evidence refs), so a viewer of a settled route — including the raiser — holds no competing-Give material. The two kinds have separate build/decode APIs plus `decodePayload`/`peekPayloadKind` dispatch on the kind byte, and importing one as the other throws `WrongPayloadKind`.

### Size limits

- `MAX_ENCODED_LINK_LENGTH = 1_900` characters — enforced on the rendered fragment by `buildLiveRoute`, and by `decodeLiveRoute` before any parsing.
- `MAX_INLINE_BODY_BYTES = 256` — cap on the inline metadata body, enforced at encode and decode.
- Unknown versions and kinds are rejected (`unsupported-version`, `wrong-kind`), never guessed.

## Web link layer (`apps/web`)

The web app wraps the codec in HTTPS links. Metadata is split into three layers (`app/lib/metadata.ts`): an **envelope** (`{v, visibility, nonce, schema, discoveryHash, routeBodyHash}`, canonical JSON, schema id `ahand/meta@2`) whose sha256 is the on-chain `metadataCommitment`; a **discovery** doc (title ≤ 80 chars, teaser ≤ 140) whose sha256 is the `discoveryCommitment` (zero for Dark); and a **route body** (description ≤ 1000 UTF-8 bytes, optional contacts) that travels only in the link fragment.

`assembleLink` renders:

```text
public/preview   https://ahand.in/h/<id>?e=<discoveryB64>#<payload>
dark             https://ahand.in/h/<id>#<payload>
```

The base64url payload — including any bearer capability secret — lives in the URL fragment, which browsers never send to the server. The `e=` query parameter carries only the public discovery doc so SSR can render a preview/OG card; Dark links forbid `?e=` and carry discovery inside the fragment instead (the marked-wrapper packing in `app/lib/link.ts`). `parseLink` rejects a link whose query discovery disagrees with the fragment, and tolerates a stripped `?e=` — the title is re-fetchable from the on-chain `discoveryRef`. Share screens render the link as a QR code.

A Give travels as a plain-text message (`app/lib/giveLink.ts`): the giver's note, a blank line, then a `/h/<id>/thank#<terminal-proof>` link — readable in any XMTP client, and the URL alone carries the whole proof, so the raiser can settle even from a foreign client. `parseGiveMessage` structurally validates candidate links with the real `decodeTerminalProof` before the inbox shows them.

Two web-side constants mirror the codec budget (`app/lib/metadata.ts`): `MAX_LINK_CHARS = 1900` and `CHARS_PER_HOP = 116` (the approximate characters one hop adds to a rendered link, used for the hops-remaining counter).

## Import checks

Before enabling any money- or authority-changing action from an imported payload, the web app (`useHandView`) verifies:

- the payload decodes against the viewed Hand's `RouteContext` (wrong `HandRef` fails in the header check);
- `verifyMetadata`: envelope sha256 equals the on-chain `metadataCommitment`, route body hash matches the envelope, discovery hash matches the on-chain `discoveryCommitment` (zero for Dark);
- `verifyLiveRoute` / `verifyTerminalProof` over the on-chain facts: signature linkage, claim continuity and the Giver floor, attribution rules, expiry.

Failure disables actions and shows the precise integrity error. A valid terminal proof enables verification and Thank only — never Pass or a replacement Give.

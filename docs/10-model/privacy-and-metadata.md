# Privacy and metadata

## Three visibility modes

| Mode | On-chain requirements | Discovery document | Tags | Route body |
|---|---|---|---|---|
| Public | `discoveryRef` (≤ 128 bytes) + non-zero `discoveryCommitment` | Matching-safe detail, publicly retrievable and indexable | Up to 8 | Capability-gated; may add detail beyond the public document |
| Preview | Same as Public | Deliberately coarse, publicly indexable | Up to 8 | Capability-gated |
| Dark | `discoveryRef`, `discoveryCommitment`, and tags all empty/zero | None | None | Capability-gated |

`metadataCommitment` is mandatory in every mode; `raise` reverts without it. Core enforces the table above (`InvalidVisibilityData`); beyond that, visibility affects information availability, not settlement semantics. Selecting Preview is itself consent to public indexing of the coarse preview. A Raiser who wants no semantic discovery selects Dark.

These modes govern application metadata; they do not conceal the winning route once it is submitted. The `thank` transaction exposes the signed route artifacts, and Core events preserve each hop's position, claim delta, margin, and attributed `shaker` (or zero) — for Preview and Dark Hands too.

## Metadata layers

The web app implements a layered package (schema `ahand/meta@2`), anchored by one on-chain commitment:

```text
Envelope        {v, visibility, nonce, schema, discoveryHash, routeBodyHash}
                metadataCommitment = sha256(canonical envelope JSON)

Discovery doc   {title, teaser?, nonce}            # absent for Dark
                discoveryCommitment = sha256(canonical discovery JSON)

Route body      {description, contacts?, image?, nonce}
                travels only in the capability link; bound by routeBodyHash

Local data      never published: verification answers, contact secrets,
                evidence disclosed only to its intended recipient
```

The envelope binds all layers, so a viewer holding the payload can verify title and body against the single on-chain `metadataCommitment`. Core stores the visibility, `metadataCommitment`, and `discoveryCommitment`, and emits the bounded `discoveryRef`; it never parses any layer.

## Discovery publication and verification

At Raise, the client posts the canonical discovery bytes (under 2 KB) to the app's `/api/pin` endpoint, which holds the pinning credential server-side (a Pinata JWT or Web3.storage token) and returns the CID. Without a configured key it computes the CID locally and honestly reports `pinned: false`. The emitted `discoveryRef` is `ipfs://<CIDv1>` where the CID is the raw sha2-256 CIDv1 of the discovery bytes — derivable from the on-chain `discoveryCommitment` digest alone, so a public Hand's document is fetchable from storage reads without an indexer.

When displaying a Hand, the app fetches the document through an IPFS gateway and verifies the bytes byte-for-byte against the commitment before using any field. Gateways and pinning providers are availability infrastructure, never trust anchors.

Links additionally carry the discovery bytes in a `?e=` query parameter so server-side rendering can build previews without an IPFS round trip; the same commitment check applies.

## Integrity, availability, and confidentiality

These are separate properties:

- A hash provides integrity after content is obtained.
- A storage network or gateway provides availability.
- Encryption and key control would provide confidentiality — **nothing in aHand is encrypted**.
- Capability links carry their secret in the URL fragment, which browsers do not transmit to the server. That prevents normal HTTP exposure to the host; it does not hide content from recipients, extensions, screenshots, or copied links.

Hash-committed or fragment-carried payloads are never described as encrypted.

## Dark Hands

Dark Hands emit no discovery reference and no tags. Random nonces in every layer prevent dictionary attacks against predictable payloads.

Dark cannot prevent a legitimate recipient from copying the link; the security boundary is capability distribution, not DRM. Dark also does not hide on-chain facts: the Hand's existence, Raiser address, reward amount, token and charity terms, expiry, timing, and a winning route submitted at Thank all remain public. It hides semantic discovery data only.

For a zero-margin hop, `shaker = 0` is the protocol-level way to decline durable attribution: no `ShakerAcceptance`, no `SHAKEN`. It does not guarantee real-world anonymity — the capability signer, adjacent recipients, or transport channel may still identify the participant. A non-zero `shaker`, even at zero margin, deliberately opts into public settlement attribution.

## Data minimization

Discovery documents should be detailed enough for matching while excluding credentials, verification answers, precise locations where a coarse region suffices, complete serial numbers, and identity documents. Anything that must stay with one party belongs in local data, not in any published layer.

# ADR-0013: Seal Give notes under a per-seal salt carried only beside the note

Status: accepted

## Context

A Give's `solutionHash` becomes public at Thank — in the `Settled` event, the `thank` calldata, and the subgraph — for every visibility mode, Dark included. Core treats it as opaque bytes. The giver's words themselves travel only in the XMTP message to the raiser. When the hash was a bare `keccak256(utf8(note))`, a short note ("yes", a phone number, a handle) could be recovered by hashing guesses, and the same reply sealed on two Hands produced the same public hash, linking them. The words also have to stay provable: the raiser should be able to tell that the note they received is the one the giver signed into the Give.

## Decision

The web app commits the giver's words as

```text
solutionHash = keccak256(utf8("aHand/solution/v1") | salt (32) | utf8(canonicalSolutionText(note)))
canonicalSolutionText(note) = note.trim()
```

with a fresh random 32-byte salt for every seal. The canonical text is also what gets delivered, so the bytes the raiser receives are the bytes that were hashed. The salt travels as a typed ref (`0x01 | salt`) in the TerminalProof's unsigned evidence tail, and only on the copy of the proof link sent beside the note; the link the giver copies or shares on its own carries no salt. `verifySolutionNote` accepts a note that opens the commitment under any carried salt, and, for proofs sealed before salting, a bare `keccak256(utf8(note))`.

This is a client convention in `packages/sdk` (`solution.ts`); Core and the signed `Give` struct are unchanged.

## Consequences

### Positive

- The public hash can no longer be enumerated from guesses, and the same words sealed twice give unrelated hashes.
- No contract, typehash, or signature change; Gives signed before the change still settle and their notes still verify.
- A missing, swapped, or forged salt only makes verification fail; opening the signed hash to other words would take a keccak preimage.

### Negative

- Whoever holds the salted link — the raiser, or anyone they forward the message to — can test guesses against the hash; the salt protects against the public, not against the note's recipients.
- If the salted message is lost, nobody can later show which words were sealed.
- Hands settled before salting keep their bare, enumerable hash on-chain permanently, and the verifier keeps the bare fallback for them.
- Only edge whitespace is canonicalized: the same words typed with a different Unicode normalization or inner spacing produce a different commitment.
- Other clients must adopt the same tag, layout, and evidence ref to seal or verify notes the web app exchanges.

## Alternatives rejected

- **Bare `keccak256(note)`:** enumerable and linkable across Hands, as above.
- **A salt derived from public values (hand id, giver, route):** anyone can recompute it, so it only namespaces the dictionary attack.
- **The salt inside the signed Give:** needs a new field and typehash in Core's EIP-712 structs for a concern Core does not otherwise have.
- **Encrypting the note on-chain:** needs recipient keys and a recovery policy the protocol does not have (see [ADR-0007](0007-three-visibility-modes.md)).

## References

- [SDK and link protocol — solution commitment](../30-architecture/sdk-and-link-protocol.md#solution-commitment)
- [Privacy and metadata — Give notes](../10-model/privacy-and-metadata.md#give-notes)
- [Open questions — solution notes](../00-project/open-questions.md#solution-notes)

## Revisit when

A second client needs to seal or verify notes, a Core revision gives the solution commitment a structured field, or the canonicalization question in the open questions is settled (a changed canonical form needs a new tag, `aHand/solution/v2`, so old seals keep verifying).

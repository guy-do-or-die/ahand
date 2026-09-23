import { concat, keccak256, stringToBytes, type Hex } from "viem";

/**
 * Solution commitment — the Give's `solutionHash`.
 *
 *   solutionHash = keccak256(utf8("aHand/solution/v1") | salt(32) | utf8(trim(note)))
 *
 * The hash goes public at Thank (`Settled`, thank calldata, subgraph), so a
 * bare keccak256 of a short note ("yes", a phone number, a handle) is
 * dictionary-enumerable and links identical replies across Hands. A fresh
 * salt per seal closes both. The salt reaches the raiser as a typed ref in
 * the TerminalProof's unsigned evidence tail — tag(1) | salt(32) — and only
 * on the copy of the link that travels beside the note.
 *
 * Core treats `solutionHash` as opaque; this is a client convention.
 */

export const SOLUTION_COMMITMENT_TAG = "aHand/solution/v1";
export const SOLUTION_SALT_BYTES = 32;
/** Evidence-ref type byte for a solution salt. */
export const EVIDENCE_SOLUTION_SALT = 0x01;

/**
 * The one canonical form, used for both sealing and delivery, so the bytes
 * the raiser receives are the bytes that were hashed (ECMAScript `trim`:
 * Unicode White_Space and line terminators at both edges).
 */
export function canonicalSolutionText(text: string): string {
  return text.trim();
}

function assertSalt(salt: Uint8Array): void {
  if (salt.length !== SOLUTION_SALT_BYTES)
    throw new Error(`solution salt must be ${SOLUTION_SALT_BYTES} bytes`);
}

export function solutionCommitment(text: string, salt: Uint8Array): Hex {
  assertSalt(salt);
  return keccak256(
    concat([
      stringToBytes(SOLUTION_COMMITMENT_TAG),
      salt,
      stringToBytes(canonicalSolutionText(text)),
    ]),
  );
}

/** The evidence ref that carries `salt` inside a TerminalProof. */
export function solutionSaltRef(salt: Uint8Array): Uint8Array {
  assertSalt(salt);
  return concat([Uint8Array.of(EVIDENCE_SOLUTION_SALT), salt]);
}

/** Every solution salt among a proof's evidence refs; other refs are ignored. */
export function solutionSalts(evidence: readonly Uint8Array[]): Uint8Array[] {
  return evidence
    .filter(
      (ref) =>
        ref.length === 1 + SOLUTION_SALT_BYTES &&
        ref[0] === EVIDENCE_SOLUTION_SALT,
    )
    .map((ref) => ref.subarray(1));
}

/**
 * Does `note` open the Give's solution commitment? Tries every salt ref in
 * the proof's evidence, then the pre-salt bare `keccak256(utf8(note))` so
 * proofs sealed before salting still verify. The evidence is unsigned, but a
 * forged or swapped salt can only fail verification — opening the signed hash
 * to different words would take a keccak preimage.
 */
export function verifySolutionNote(
  note: string,
  solutionHash: string,
  evidence: readonly Uint8Array[],
): boolean {
  const target = solutionHash.toLowerCase();
  return (
    solutionSalts(evidence).some(
      (salt) => solutionCommitment(note, salt) === target,
    ) || keccak256(stringToBytes(note)) === target
  );
}

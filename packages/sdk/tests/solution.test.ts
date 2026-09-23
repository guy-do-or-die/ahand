import { describe, expect, it } from "vitest";
import { keccak256, stringToBytes, type Hex } from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import {
  BPS_DENOMINATOR,
  EVIDENCE_SOLUTION_SALT,
  SOLUTION_SALT_BYTES,
  buildTerminalProof,
  canonicalSolutionText,
  decodeTerminalProof,
  giveHash,
  routeHashOf,
  signGive,
  signGiverAcceptance,
  solutionCommitment,
  solutionSaltRef,
  solutionSalts,
  verifySolutionNote,
  verifyTerminalProof,
  type Give,
  type HandRef,
  type TypedSigner,
} from "../src/index.js";

const pk = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}` as Hex;

const CHAIN_ID = 31337n;
const CORE = "0x00000000000000000000000000000000000c0ffe" as const;
const HAND_ID = 1n;
const EXPIRY = 2_000_000_000n;
const REF: HandRef = { chainId: CHAIN_ID, core: CORE, handId: HAND_ID };
const rootPriv = pk(0xa0);
const giverPriv = pk(0xb2);
const rootAddr = privateKeyToAddress(rootPriv);
const ctx = { handRef: REF, expiry: EXPIRY, rootCapability: rootAddr };

const salt = (byte: number) => new Uint8Array(SOLUTION_SALT_BYTES).fill(byte);
const utf8 = (s: string) => new TextEncoder().encode(s);

/** A zero-shake terminal proof sealing `solutionHash`, carrying `evidence`. */
async function proofOf(solutionHash: Hex, evidence?: Uint8Array[]) {
  const give: Give = {
    handId: HAND_ID,
    routeHash: routeHashOf(REF, []),
    giver: privateKeyToAddress(giverPriv),
    solutionHash,
    finalClaimBps: BPS_DENOMINATOR,
    deadline: EXPIRY,
  };
  const signature = await signGive(give, rootPriv, CHAIN_ID, CORE);
  const giverAcceptanceSig = await signGiverAcceptance(
    giveHash(give),
    privateKeyToAccount(giverPriv) as TypedSigner,
    CHAIN_ID,
    CORE,
  );
  const fragment = buildTerminalProof({
    ...ctx,
    shakes: [],
    give: { give, signature },
    giverAcceptanceSig,
    evidence,
  });
  return decodeTerminalProof(fragment, ctx);
}

describe("solution commitment", () => {
  it("pins the byte layout: keccak256(tag | salt | utf8(trim(note)))", () => {
    // cast keccak 0x6148616e642f736f6c7574696f6e2f7631 ‖ 11×32 ‖ 492063616e2068656c70
    expect(solutionCommitment("I can help", salt(0x11))).toBe(
      "0x6a49defcfd5c68349e22b817b36dcf604db2ffc68e8d4a85e30c338e4a1143ff",
    );
  });

  it("is deterministic per salt and differs across salts", () => {
    expect(solutionCommitment("yes", salt(1))).toBe(
      solutionCommitment("yes", salt(1)),
    );
    expect(solutionCommitment("yes", salt(1))).not.toBe(
      solutionCommitment("yes", salt(2)),
    );
  });

  it("is never the bare, enumerable keccak256 of the note", () => {
    expect(solutionCommitment("yes", salt(0))).not.toBe(
      keccak256(stringToBytes("yes")),
    );
  });

  it("seals the canonical (edge-trimmed) text", () => {
    const sealed = solutionCommitment("x", salt(7));
    for (const variant of [" x\n", "x ", "x\r\n", "\u00a0x\t", "\ufeffx"])
      expect(solutionCommitment(variant, salt(7))).toBe(sealed);
    expect(canonicalSolutionText("  a\n b \n")).toBe("a\n b");
    expect(solutionCommitment("x y", salt(7))).not.toBe(
      solutionCommitment("xy", salt(7)),
    );
  });

  it("refuses a salt of the wrong size", () => {
    expect(() => solutionCommitment("x", new Uint8Array(31))).toThrow();
    expect(() => solutionSaltRef(new Uint8Array(33))).toThrow();
  });
});

describe("solution salt evidence ref", () => {
  it("is tag(1) | salt(32) and is picked out from unrelated refs", () => {
    const ref = solutionSaltRef(salt(9));
    expect(ref.length).toBe(1 + SOLUTION_SALT_BYTES);
    expect(ref[0]).toBe(EVIDENCE_SOLUTION_SALT);
    const found = solutionSalts([utf8("xmtp:msg-1"), ref, new Uint8Array(33)]);
    expect(found).toEqual([salt(9)]);
  });

  it("survives the terminal-proof codec next to other evidence", async () => {
    const hash = solutionCommitment("I can help", salt(5));
    const proof = await proofOf(hash, [utf8("xmtp:msg-1"), solutionSaltRef(salt(5))]);
    expect(solutionSalts(proof.evidence)).toEqual([salt(5)]);
    expect(
      verifySolutionNote("I can help", proof.give.give.solutionHash, proof.evidence),
    ).toBe(true);
    // the ref is unsigned transport — the proof itself still verifies
    expect(
      await verifyTerminalProof(proof, {
        ...ctx,
        minGiverClaimBps: 2_000,
        now: EXPIRY - 1n,
      }),
    ).toEqual({ ok: true });
  });
});

describe("verifySolutionNote", () => {
  const note = "Call me at +351 912 345 678";

  it("verifies the delivered note whatever edge whitespace was typed", async () => {
    const hash = solutionCommitment(`${note} \n`, salt(3));
    const proof = await proofOf(hash, [solutionSaltRef(salt(3))]);
    expect(verifySolutionNote(note, hash, proof.evidence)).toBe(true);
  });

  it("fails, never throws, on altered words or a swapped salt", async () => {
    const hash = solutionCommitment(note, salt(3));
    const proof = await proofOf(hash, [solutionSaltRef(salt(3))]);
    expect(verifySolutionNote(`${note}!`, hash, proof.evidence)).toBe(false);
    expect(verifySolutionNote(note, hash, [solutionSaltRef(salt(4))])).toBe(false);
    expect(verifySolutionNote(note, hash, [new Uint8Array(0)])).toBe(false);
  });

  it("cannot open a salted seal without its salt", async () => {
    const hash = solutionCommitment(note, salt(3));
    const proof = await proofOf(hash);
    expect(proof.evidence).toEqual([]);
    expect(verifySolutionNote(note, hash, proof.evidence)).toBe(false);
  });

  it("still verifies a pre-salt proof (bare keccak256) on the exact note", async () => {
    const hash = keccak256(stringToBytes(note));
    const proof = await proofOf(hash);
    expect(verifySolutionNote(note, hash, proof.evidence)).toBe(true);
    expect(verifySolutionNote(`${note}\n`, hash, proof.evidence)).toBe(false);
  });

  it("compares the hash case-insensitively", () => {
    const hash = solutionCommitment(note, salt(3));
    expect(
      verifySolutionNote(note, hash.toUpperCase().replace("0X", "0x"), [
        solutionSaltRef(salt(3)),
      ]),
    ).toBe(true);
  });
});

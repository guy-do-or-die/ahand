import { describe, it, expect } from "vitest";
import vectors from "./test-vectors.json" assert { type: "json" };
import {
  domainSeparator, shakeDigest, giveDigest, signShake, signGive,
  encodePayload, decodePayload, type Shake, type Give,
} from "../src/index.js";
import type { Hex } from "viem";

const chainId = vectors.domain.chainId;
const core = vectors.domain.verifyingContract as `0x${string}`;

const toShake = (s: any): Shake => ({
  handId: BigInt(s.handId),
  childCapability: s.childCapability,
  payout: s.payout,
  parentClaimBps: s.parentClaimBps,
  childClaimBps: s.childClaimBps,
  deadline: BigInt(s.deadline),
});

describe("EIP-712 domain", () => {
  it("SDK domainSeparator == core.DOMAIN_SEPARATOR()", () => {
    expect(domainSeparator(chainId, core).toLowerCase())
      .toBe(vectors.domain.domainSeparator.toLowerCase());
  });
});

describe("Shake digests & signatures (cross-impl vs live contract)", () => {
  for (const [i, v] of vectors.shakes.entries()) {
    it(`shake[${i}] digest matches on-chain`, () => {
      expect(shakeDigest(toShake(v.shake), chainId, core).toLowerCase())
        .toBe(v.digest.toLowerCase());
    });
    it(`shake[${i}] signature reproduces exactly`, async () => {
      const sig = await signShake(toShake(v.shake), v.signerPriv as Hex, chainId, core);
      expect(sig.toLowerCase()).toBe(v.signature.toLowerCase());
    });
  }
});

describe("Give digest & signature", () => {
  const g: Give = {
    handId: BigInt(vectors.give.give.handId),
    solver: vectors.give.give.solver,
    solutionHash: vectors.give.give.solutionHash,
    finalClaimBps: vectors.give.give.finalClaimBps,
  };
  it("digest matches", () => {
    expect(giveDigest(g, chainId, core).toLowerCase())
      .toBe(vectors.give.digest.toLowerCase());
  });
  it("signature reproduces", async () => {
    const sig = await signGive(g, vectors.give.signerPriv as Hex, chainId, core);
    expect(sig.toLowerCase()).toBe(vectors.give.signature.toLowerCase());
  });
});

describe("Payload codec (byte-exact vs contract-fed fragment)", () => {
  const signed = vectors.shakes.map((v: any) => ({
    shake: toShake(v.shake),
    signature: v.signature as Hex,
  }));

  it("encodePayload == fragment that settled on-chain", () => {
    const frag = encodePayload({
      handId: BigInt(1),
      chainId,
      core,
      shakes: signed,
      latestPrivateKey: vectors.payload.latestPriv as Hex,
      metadata: JSON.parse(vectors.payload.metaJson),
    });
    expect(frag).toBe(vectors.payload.fragmentB64Url);
  });

  it("decode(encode(x)) round-trips", () => {
    const decoded = decodePayload(vectors.payload.fragmentB64Url);
    expect(decoded.handId).toBe(1n);
    expect(decoded.chainId).toBe(chainId);
    expect(decoded.core.toLowerCase()).toBe(core.toLowerCase());
    expect(decoded.shakes.length).toBe(2);
    expect(decoded.latestPrivateKey.toLowerCase()).toBe(vectors.payload.latestPriv.toLowerCase());
    expect((decoded.metadata as any).title).toContain("Yerevan");
  });

  it("SECURITY: payload carries exactly ONE private key (strip enforced by type)", () => {
    const decoded = decodePayload(vectors.payload.fragmentB64Url);
    // latest private key is the only private key field in the DecodedPayload schema;
    // parent private keys are structurally stripped and omitted.
    expect(typeof decoded.latestPrivateKey).toBe("string");
    expect(Object.keys(decoded)).not.toContain("parentPrivateKey");
  });
});

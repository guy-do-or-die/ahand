import { describe, it, expect } from "vitest";
import { keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildLiveRoute,
  buildTerminalProof,
  decodeLiveRoute,
  decodeTerminalProof,
  giveHash,
  newCapability,
  routeHashOf,
  shakeStructHash,
  signGive,
  signGiverAcceptance,
  signShake,
  signShakerAcceptance,
  verifyLiveRoute,
  verifyTerminalProof,
  ZERO_ADDRESS,
  ZERO_BYTES32,
  type Give,
  type RouteContext,
  type Shake,
  type SignedShake,
} from "@ahand/sdk";
import { buildMetadata, parseLink, verifyMetadata } from "./metadata";
import { packLinkMetadata, unpackLinkMetadata, bearerCapability } from "./link";

const CHAIN_ID = 31337n;
const CORE = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as `0x${string}`;
const HAND_ID = 7n;
const EXPIRY = 2_000_000_000n;
const NOW = EXPIRY - 86_400n;

describe("link metadata packing", () => {
  it("round-trips envelope + body without discovery", async () => {
    const m = await buildMetadata({ text: "Need a hand\nwith the details", visibility: "preview" });
    const packed = packLinkMetadata({ envelopeB64: m.envelopeB64, bodyB64: m.bodyB64 });
    const parts = unpackLinkMetadata(packed);
    expect(parts.envelopeB64).toBe(m.envelopeB64);
    expect(parts.bodyB64).toBe(m.bodyB64);
    expect(parts.discoveryB64).toBeUndefined();
  });

  it("round-trips the dark shape with the discovery doc inline", async () => {
    const m = await buildMetadata({ text: "Quiet ask\nsay nothing", visibility: "dark" });
    const packed = packLinkMetadata({
      envelopeB64: m.envelopeB64,
      discoveryB64: m.discoveryB64,
      bodyB64: m.bodyB64,
    });
    const parts = unpackLinkMetadata(packed);
    expect(parts.envelopeB64).toBe(m.envelopeB64);
    expect(parts.discoveryB64).toBe(m.discoveryB64);
    expect(parts.bodyB64).toBe(m.bodyB64);
  });

  it("keeps the envelope slot byte-exact (the sha256 anchor)", async () => {
    const m = await buildMetadata({ text: "Anchored title", visibility: "public" });
    const packed = packLinkMetadata({ envelopeB64: m.envelopeB64, bodyB64: m.bodyB64 });
    expect(packed.envelope).toEqual(m.envelopeBytes);
  });
});

describe("root link → pass-on → terminal proof (whole journey, offline)", () => {
  it("survives the full route with anonymous and attributed hops", async () => {
    const raiseText = "Sublet in Yerevan\nJune, two rooms, near the cascade";
    const metadata = await buildMetadata({ text: raiseText, visibility: "preview" });

    const root = newCapability();
    const handRef = { chainId: CHAIN_ID, core: CORE, handId: HAND_ID };
    const facts = {
      handRef,
      rootCapability: root.address,
      expiry: EXPIRY,
      minGiverClaimBps: 5_000,
      metadataCommitment: metadata.metadataCommitment,
      now: NOW,
    };
    const ctx: RouteContext = { handRef, expiry: EXPIRY, rootCapability: root.address };

    // 1. Raise mints the root link.
    const rootUrl = new URL("https://ahand.example/");
    const rootLink = ((): string => {
      const fragment = buildLiveRoute({
        handRef,
        expiry: EXPIRY,
        rootCapability: root.address,
        shakes: [],
        capability: bearerCapability(root.privateKey),
        metadata: packLinkMetadata({ envelopeB64: metadata.envelopeB64, bodyB64: metadata.bodyB64 }),
      });
      rootUrl.pathname = `/h/${HAND_ID}`;
      rootUrl.searchParams.set("e", metadata.discoveryB64);
      rootUrl.hash = fragment;
      return rootUrl.toString();
    })();

    // 2. First holder decodes, verifies, and passes on anonymously.
    const parsed1 = parseLink(rootLink, (fragment: string) => {
      const payload = decodeLiveRoute(fragment, ctx);
      return { ...payload, metadata: unpackLinkMetadata(payload.metadata) };
    });
    const meta1 = await verifyMetadata(
      { envelopeB64: parsed1.envelopeB64, discoveryB64: parsed1.discoveryB64, bodyB64: parsed1.bodyB64 },
      { metadataCommitment: metadata.metadataCommitment, discoveryCommitment: metadata.discoveryCommitment },
    );
    expect(meta1.ok).toBe(true);
    if (meta1.ok) {
      expect(meta1.discovery?.title).toBe("Sublet in Yerevan");
      expect(meta1.body.description).toContain("two rooms");
    }

    const child1 = newCapability();
    const shake1: Shake = {
      handId: HAND_ID,
      childCapability: child1.address,
      shaker: ZERO_ADDRESS,
      parentClaimBps: 10_000,
      childClaimBps: 10_000,
      hopDataHash: ZERO_BYTES32,
      deadline: EXPIRY,
    };
    const signed1: SignedShake = {
      shake: shake1,
      signature: await signShake(shake1, root.privateKey, CHAIN_ID, CORE),
    };

    // 3. Second holder keeps a margin — attributed, wallet co-signs.
    const shakerWallet = newCapability();
    const child2 = newCapability();
    const shake2: Shake = {
      handId: HAND_ID,
      childCapability: child2.address,
      shaker: shakerWallet.address,
      parentClaimBps: 10_000,
      childClaimBps: 8_500,
      hopDataHash: ZERO_BYTES32,
      deadline: EXPIRY,
    };
    const signed2: SignedShake = {
      shake: shake2,
      signature: await signShake(shake2, child1.privateKey, CHAIN_ID, CORE),
      acceptanceSig: await signShakerAcceptance(
        shakeStructHash(shake2),
        privateKeyToAccount(shakerWallet.privateKey),
        CHAIN_ID,
        CORE,
      ),
    };

    const passedFragment = buildLiveRoute({
      handRef,
      expiry: EXPIRY,
      rootCapability: root.address,
      shakes: [signed1, signed2],
      capability: bearerCapability(child2.privateKey),
      metadata: packLinkMetadata({ envelopeB64: parsed1.envelopeB64, bodyB64: parsed1.bodyB64 }),
    });

    const passed = decodeLiveRoute(passedFragment, ctx);
    const routeVerdict = await verifyLiveRoute(passed, facts);
    expect(routeVerdict).toEqual({ ok: true });
    expect(passed.modes).toEqual(["anonymous", "explicit"]);

    // 4. The terminal holder gives — dual-sign, then the terminal proof.
    const giverWallet = newCapability();
    const give: Give = {
      handId: HAND_ID,
      routeHash: routeHashOf(handRef, [shake1, shake2]),
      giver: giverWallet.address,
      solutionHash: keccak256(stringToHex("here are the keys")),
      finalClaimBps: 8_500,
      deadline: EXPIRY,
    };
    const proofFragment = buildTerminalProof({
      handRef,
      expiry: EXPIRY,
      rootCapability: root.address,
      shakes: passed.shakes,
      give: { give, signature: await signGive(give, child2.privateKey, CHAIN_ID, CORE) },
      giverAcceptanceSig: await signGiverAcceptance(
        giveHash(give),
        privateKeyToAccount(giverWallet.privateKey),
        CHAIN_ID,
        CORE,
      ),
    });

    // 5. The raiser decodes and verifies — the same walk thank() makes.
    const proof = decodeTerminalProof(proofFragment, ctx);
    const proofVerdict = await verifyTerminalProof(proof, facts);
    expect(proofVerdict).toEqual({ ok: true });

    // 6. thank() args: positional acceptances, "0x" for non-explicit hops.
    const acceptances = proof.shakes.map((s) => s.acceptanceSig ?? "0x");
    expect(acceptances[0]).toBe("0x");
    expect(acceptances[1]).not.toBe("0x");
    expect(proof.give.give.routeHash).toBe(routeHashOf(handRef, proof.shakes.map((s) => s.shake)));

    // 7. And the proof carries no capability secret — nothing to steal.
    expect(proofFragment).not.toContain(child2.privateKey.slice(2));
  });

  it("flags a tampered claim with a structured reason", async () => {
    const root = newCapability();
    const handRef = { chainId: CHAIN_ID, core: CORE, handId: HAND_ID };
    const ctx: RouteContext = { handRef, expiry: EXPIRY, rootCapability: root.address };
    const child = newCapability();
    const shake: Shake = {
      handId: HAND_ID,
      childCapability: child.address,
      shaker: ZERO_ADDRESS,
      parentClaimBps: 10_000,
      childClaimBps: 9_000,
      hopDataHash: ZERO_BYTES32,
      deadline: EXPIRY,
    };
    const signed: SignedShake = {
      shake,
      signature: await signShake(shake, root.privateKey, CHAIN_ID, CORE),
    };
    const m = await buildMetadata({ text: "tamper check", visibility: "preview" });
    const fragment = buildLiveRoute({
      handRef,
      expiry: EXPIRY,
      rootCapability: root.address,
      shakes: [signed],
      capability: bearerCapability(child.privateKey),
      metadata: packLinkMetadata({ envelopeB64: m.envelopeB64, bodyB64: m.bodyB64 }),
    });
    const decoded = decodeLiveRoute(fragment, ctx);
    // A different root on chain than the link claims → capability proof fails.
    const verdict = await verifyLiveRoute(decoded, {
      handRef,
      rootCapability: newCapability().address,
      expiry: EXPIRY,
      minGiverClaimBps: 5_000,
      now: NOW,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.failures.map((f) => f.reason)).toContain("capability-proof");
    }
  });
});

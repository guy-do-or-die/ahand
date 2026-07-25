import { describe, it, expect } from "vitest";
import {
  buildMetadata,
  verifyMetadata,
  b64urlEncode,
  b64urlDecode,
  assembleLink,
  parseLink,
  ZERO_HASH,
} from "./metadata";

describe("metadata codec", () => {
  it("rejects empty or whitespace-only text", async () => {
    await expect(buildMetadata({ text: "", visibility: "public" })).rejects.toThrow("Text cannot be empty");
    await expect(buildMetadata({ text: "   \n  ", visibility: "public" })).rejects.toThrow("Text cannot be empty");
  });

  it("splits text into discovery title and route-body description", async () => {
    let res = await buildMetadata({ text: "Looking for a sublet", visibility: "public" });
    expect(res.discovery.title).toBe("Looking for a sublet");
    expect(res.body.description).toBe("");

    res = await buildMetadata({ text: "Hello\nWorld this is long", visibility: "public" });
    expect(res.discovery.title).toBe("Hello");
    expect(res.body.description).toBe("World this is long");
  });

  it("fails if entire text exceeds 1000 bytes (even without newlines)", async () => {
    // 501 Cyrillic chars = 1002 bytes. Without newlines, it used to bypass the check.
    const hugeRussian = "а".repeat(501);
    await expect(buildMetadata({ text: hugeRussian, visibility: "public" })).rejects.toThrow("Text exceeds 1000 bytes UTF-8");
  });

  it("binds all three layers inside the envelope", async () => {
    const res = await buildMetadata({ text: "Layered\nBound", visibility: "public" });
    expect(res.envelope.v).toBe(2);
    expect(res.envelope.schema).toBe("ahand/meta@2");
    expect(res.envelope.discoveryHash).toBe(res.discoveryCommitment);
    expect(res.envelope.routeBodyHash).toBe(res.routeBodyHash);
    // Pre-split alias still points at the envelope hash.
    expect(res.metadataHash).toBe(res.metadataCommitment);
  });

  it("dark: zero on-chain discovery commitment, envelope binding intact", async () => {
    const res = await buildMetadata({ text: "Dark\nSecret details", visibility: "dark" });
    expect(res.discoveryCommitment).toBe(ZERO_HASH);
    // The title still travels (fragment-only) and is still hash-bound.
    expect(res.discovery.title).toBe("Dark");
    expect(res.envelope.discoveryHash).not.toBe(ZERO_HASH);
  });

  it("handles round-trip encoding and verification", async () => {
    const res = await buildMetadata({
      text: "Test round trip\nDescription",
      visibility: "preview",
      contacts: "@telegram",
    });

    const verify = await verifyMetadata(
      { envelopeB64: res.envelopeB64, discoveryB64: res.discoveryB64, bodyB64: res.bodyB64 },
      { metadataCommitment: res.metadataCommitment, discoveryCommitment: res.discoveryCommitment },
    );
    expect(verify.ok).toBe(true);
    if (verify.ok) {
      expect(verify.discovery?.title).toBe("Test round trip");
      expect(verify.body.description).toBe("Description");
      expect(verify.body.contacts).toBe("@telegram");
    }
  });

  it("verifies without discovery (stripped ?e=) — title lost, hand intact", async () => {
    const res = await buildMetadata({ text: "No discovery\nStill fine", visibility: "preview" });
    const verify = await verifyMetadata(
      { envelopeB64: res.envelopeB64, bodyB64: res.bodyB64 },
      { metadataCommitment: res.metadataCommitment },
    );
    expect(verify.ok).toBe(true);
    if (verify.ok) {
      expect(verify.discovery).toBeNull();
      expect(verify.body.description).toBe("Still fine");
    }
  });

  it("generates deterministic hashes with fixed nonces (Snapshot test)", async () => {
    const res = await buildMetadata({
      text: "Deterministic Hand\nWith description",
      visibility: "public",
      opts: {
        nonces: {
          envelope: "nonce1_env1111111111111",
          discovery: "nonce3_disc3333333333333",
          body: "nonce2_body22222222222",
        },
      },
    });

    // The metadataCommitment MUST be strictly equal across runs since nonces are fixed.
    expect(res.metadataCommitment).toBe("0xfcaabb8dd338e186b3166672e2d8ef479885913137450cb78535805ea66ee35e");
    expect(res.discoveryCommitment).toBe("0x526b268bd478712c36ad53d9befc691363d96c8b61931cef98520dcea716845f");
    expect(res.routeBodyHash).toBe("0x1e8d38494c2d47c36df63cf5ec7eab18a0b9916fea87b184874d9add2847454c");
  });

  it("handles full lifecycle with assembleLink and parseLink (preview mode)", async () => {
    const res = await buildMetadata({ text: "Preview mode test", visibility: "preview" });

    // Mock encode fn (the assembleLink callback)
    const mockEncode = (meta: any) => b64urlEncode(new TextEncoder().encode(JSON.stringify({ metadata: meta })));

    const url = assembleLink("http://localhost", 1n, res, mockEncode, "preview");

    // Discovery rides the query (for scrapers); envelope + body stay in the fragment.
    expect(url).toContain(`?e=${res.discoveryB64}`);

    const decodeMock = (s: string) => JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
    const parsed = parseLink(url, decodeMock);

    expect(parsed.handId).toBe(1n);
    expect(parsed.envelopeB64).toBe(res.envelopeB64);
    expect(parsed.discoveryB64).toBe(res.discoveryB64);
    expect(parsed.bodyB64).toBe(res.bodyB64);
  });

  it("handles parseLink with child routes (e.g., /thank)", async () => {
    const res = await buildMetadata({ text: "Child route test", visibility: "preview" });
    const mockEncode = (meta: any) => b64urlEncode(new TextEncoder().encode(JSON.stringify({ metadata: meta })));
    const url = assembleLink("http://localhost", 1n, res, mockEncode, "preview");

    // Add child route to path
    const thankUrl = url.replace("/h/1", "/h/1/thank");

    const decodeMock = (s: string) => JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
    const parsed = parseLink(thankUrl, decodeMock);

    expect(parsed.handId).toBe(1n);
    expect(parsed.discoveryB64).toBe(res.discoveryB64);
  });

  it("handles full lifecycle with assembleLink and parseLink (dark mode)", async () => {
    const res = await buildMetadata({ text: "Dark mode test", visibility: "dark" });

    const mockEncode = (meta: any) => b64urlEncode(new TextEncoder().encode(JSON.stringify({ metadata: meta })));
    const url = assembleLink("http://localhost", 2n, res, mockEncode, "dark");

    // Dark mode: nothing in the query — everything rides the fragment.
    expect(url).not.toContain("?e=");

    const decodeMock = (s: string) => JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
    const parsed = parseLink(url, decodeMock);

    expect(parsed.handId).toBe(2n);
    expect(parsed.envelopeB64).toBe(res.envelopeB64);
    expect(parsed.discoveryB64).toBe(res.discoveryB64);
  });

  it("parseLink tolerates a stripped ?e= — discovery becomes undefined", async () => {
    const res = await buildMetadata({ text: "Stripped query test", visibility: "preview" });
    const mockEncode = (meta: any) => b64urlEncode(new TextEncoder().encode(JSON.stringify({ metadata: meta })));
    const url = assembleLink("http://localhost", 3n, res, mockEncode, "preview");
    const stripped = url.replace(`?e=${res.discoveryB64}`, "");

    const decodeMock = (s: string) => JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
    const parsed = parseLink(stripped, decodeMock);
    expect(parsed.discoveryB64).toBeUndefined();
    expect(parsed.envelopeB64).toBe(res.envelopeB64);
  });

  it("throws on inconsistent link when e in query contradicts the fragment", async () => {
    const res = await buildMetadata({ text: "Dark mode test", visibility: "dark" });
    const mockEncode = (meta: any) => b64urlEncode(new TextEncoder().encode(JSON.stringify({ metadata: meta })));
    const url = assembleLink("http://localhost", 2n, res, mockEncode, "dark");

    // Manually append ?e= with a different discovery doc
    const fakeUrl = url.replace("/h/2#", "/h/2?e=fake#");

    const decodeMock = (s: string) => JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
    expect(() => parseLink(fakeUrl, decodeMock)).toThrow("Inconsistent link");
  });

  it("fails verification on body tampering", async () => {
    const res = await buildMetadata({ text: "Test\nDesc", visibility: "public" });
    const tamperedBody = { ...res.body, description: "Tampered" };
    const tamperedBodyB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(tamperedBody)));

    const verify = await verifyMetadata(
      { envelopeB64: res.envelopeB64, bodyB64: tamperedBodyB64 },
      { metadataCommitment: res.metadataCommitment },
    );
    expect(verify.ok).toBe(false);
  });

  it("fails verification on discovery tampering", async () => {
    const res = await buildMetadata({ text: "Test\nDesc", visibility: "public" });
    const tamperedDisc = { ...res.discovery, title: "Tampered title" };
    const tamperedDiscB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(tamperedDisc)));

    const verify = await verifyMetadata(
      { envelopeB64: res.envelopeB64, discoveryB64: tamperedDiscB64, bodyB64: res.bodyB64 },
      { metadataCommitment: res.metadataCommitment },
    );
    expect(verify.ok).toBe(false);
    if (!verify.ok) expect(verify.reason).toContain("Discovery hash mismatch");
  });

  it("fails verification when the on-chain discovery commitment disagrees", async () => {
    const res = await buildMetadata({ text: "Test\nDesc", visibility: "public" });
    const verify = await verifyMetadata(
      { envelopeB64: res.envelopeB64, bodyB64: res.bodyB64 },
      { metadataCommitment: res.metadataCommitment, discoveryCommitment: `0x${"ab".repeat(32)}` },
    );
    expect(verify.ok).toBe(false);
    if (!verify.ok) expect(verify.reason).toContain("Discovery commitment mismatch");
  });

  it("fails verification when a dark hand carries a non-zero discovery commitment", async () => {
    const res = await buildMetadata({ text: "Dark\nDesc", visibility: "dark" });
    const verify = await verifyMetadata(
      { envelopeB64: res.envelopeB64, bodyB64: res.bodyB64 },
      { metadataCommitment: res.metadataCommitment, discoveryCommitment: res.envelope.discoveryHash as `0x${string}` },
    );
    expect(verify.ok).toBe(false);

    const zeroOk = await verifyMetadata(
      { envelopeB64: res.envelopeB64, bodyB64: res.bodyB64 },
      { metadataCommitment: res.metadataCommitment, discoveryCommitment: ZERO_HASH },
    );
    expect(zeroOk.ok).toBe(true);
  });
});

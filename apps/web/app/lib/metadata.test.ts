import { describe, it, expect } from "vitest";
import { buildMetadata, verifyMetadata, b64urlEncode, b64urlDecode, assembleLink, parseLink } from "./metadata";

describe("metadata codec", () => {
  it("rejects empty or whitespace-only text", async () => {
    await expect(buildMetadata({ text: "", visibility: "public" })).rejects.toThrow("Text cannot be empty");
    await expect(buildMetadata({ text: "   \n  ", visibility: "public" })).rejects.toThrow("Text cannot be empty");
  });

  it("splits text into title and description correctly", async () => {
    let res = await buildMetadata({ text: "Looking for a sublet", visibility: "public" });
    expect(res.envelope.preview.title).toBe("Looking for a sublet");
    expect(res.body.description).toBe("");

    res = await buildMetadata({ text: "Hello\nWorld this is long", visibility: "public" });
    expect(res.envelope.preview.title).toBe("Hello");
    expect(res.body.description).toBe("World this is long");
  });

  it("fails if entire text exceeds 1000 bytes (even without newlines)", async () => {
    // 501 Cyrillic chars = 1002 bytes. Without newlines, it used to bypass the check.
    const hugeRussian = "а".repeat(501);
    await expect(buildMetadata({ text: hugeRussian, visibility: "public" })).rejects.toThrow("Text exceeds 1000 bytes UTF-8");
  });

  it("handles round-trip encoding and verification", async () => {
    const res = await buildMetadata({
      text: "Test round trip\nDescription",
      visibility: "preview",
      contacts: "@telegram",
    });

    const verify = await verifyMetadata(res.envelopeB64, res.bodyB64, res.metadataHash);
    expect(verify.ok).toBe(true);
    if (verify.ok) {
      expect(verify.envelope.preview.title).toBe("Test round trip");
      expect(verify.body.description).toBe("Description");
      expect(verify.body.contacts).toBe("@telegram");
    }
  });

  it("generates deterministic hashes with fixed nonces (Snapshot test)", async () => {
    const res = await buildMetadata({
      text: "Deterministic Hand\nWith description",
      visibility: "public",
      opts: {
        nonces: {
          envelope: "nonce1_env1111111111111",
          body: "nonce2_body22222222222"
        }
      }
    });

    // The metadataHash MUST be strictly equal across runs since nonces are fixed.
    expect(res.metadataHash).toBe("0xf3f59c076a3385afbc07c432339148886ff6398514478284f7d11fac3f7e1b43");
  });

  it("handles full lifecycle with assembleLink and parseLink (preview mode)", async () => {
    const res = await buildMetadata({ text: "Preview mode test", visibility: "preview" });
    
    // Mock encodePayloadFn
    const mockEncode = (meta: any) => b64urlEncode(new TextEncoder().encode(JSON.stringify({ metadata: meta })));
    
    const url = assembleLink("http://localhost", 1n, res, mockEncode, "preview");
    
    // Verify envelope is in query and NOT in payload
    expect(url).toContain(`?e=${res.envelopeB64}`);

    const decodeMock = (s: string) => JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
    const parsed = parseLink(url, decodeMock);
    
    expect(parsed.handId).toBe(1n);
    expect(parsed.envelopeB64).toBe(res.envelopeB64);
    expect(parsed.bodyB64).toBe(res.bodyB64);
  });

  it("handles full lifecycle with assembleLink and parseLink (dark mode)", async () => {
    const res = await buildMetadata({ text: "Dark mode test", visibility: "dark" });
    
    const mockEncode = (meta: any) => b64urlEncode(new TextEncoder().encode(JSON.stringify({ metadata: meta })));
    const url = assembleLink("http://localhost", 2n, res, mockEncode, "dark");
    
    // Dark mode: envelope is NOT in query
    expect(url).not.toContain("?e=");

    const decodeMock = (s: string) => JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
    const parsed = parseLink(url, decodeMock);
    
    expect(parsed.handId).toBe(2n);
    expect(parsed.envelopeB64).toBe(res.envelopeB64);
  });

  it("throws on inconsistent link when e in query contradicts e in fragment", async () => {
    const res = await buildMetadata({ text: "Dark mode test", visibility: "dark" });
    const mockEncode = (meta: any) => b64urlEncode(new TextEncoder().encode(JSON.stringify({ metadata: meta })));
    const url = assembleLink("http://localhost", 2n, res, mockEncode, "dark");

    // Manually append ?e= with different hash
    const fakeUrl = url.replace("/h/2#", "/h/2?e=fake#");

    const decodeMock = (s: string) => JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
    expect(() => parseLink(fakeUrl, decodeMock)).toThrow("Inconsistent link");
  });

  it("fails verification on body tampering", async () => {
    const res = await buildMetadata({ text: "Test\nDesc", visibility: "public" });
    const tamperedBody = { ...res.body, description: "Tampered" };
    const tamperedBodyB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(tamperedBody)));
    
    const verify = await verifyMetadata(res.envelopeB64, tamperedBodyB64, res.metadataHash);
    expect(verify.ok).toBe(false);
  });
});

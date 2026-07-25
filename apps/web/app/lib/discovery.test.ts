import { describe, it, expect } from "vitest";
import {
  cidForBytes,
  ipfsUri,
  gatewayUrl,
  verifyDiscoveryBytes,
  publishDiscovery,
  type PinBackend,
} from "./discovery";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("discovery CID", () => {
  it("matches the well-known raw sha2-256 CIDv1 vector", async () => {
    // Cross-checked against kubo `ipfs add --cid-version=1` / multiformats.
    expect(await cidForBytes(bytes("hello world"))).toBe(
      "bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e",
    );
  });

  it("formats locators", async () => {
    const cid = await cidForBytes(bytes("x"));
    expect(ipfsUri(cid)).toBe(`ipfs://${cid}`);
    expect(gatewayUrl(cid)).toBe(`https://ipfs.io/ipfs/${cid}`);
    expect(gatewayUrl(cid, "https://gw.example/")).toBe(`https://gw.example/ipfs/${cid}`);
  });

  it("verifies gateway bytes against a cid", async () => {
    const doc = bytes('{"title":"hi"}');
    const cid = await cidForBytes(doc);
    expect(await verifyDiscoveryBytes(doc, cid)).toBe(true);
    expect(await verifyDiscoveryBytes(bytes('{"title":"hj"}'), cid)).toBe(false);
  });
});

describe("publishDiscovery", () => {
  const doc = bytes('{"nonce":"n","title":"t"}');

  it("anvil mode: computes the cid locally and honestly reports unpinned", async () => {
    const ref = await publishDiscovery(doc, { backend: null });
    expect(ref.cid).toBe(await cidForBytes(doc));
    expect(ref.uri).toBe(`ipfs://${ref.cid}`);
    expect(ref.pinned).toBe(false);
    expect(ref.provider).toBeNull();
  });

  it("marks pinned only when the provider agrees on OUR cid", async () => {
    const agreeing: PinBackend = { provider: "pinata", pin: async (b) => cidForBytes(b) };
    const ref = await publishDiscovery(doc, { backend: agreeing });
    expect(ref.pinned).toBe(true);
    expect(ref.provider).toBe("pinata");
    expect(ref.pinError).toBeUndefined();
  });

  it("reports a cid disagreement as unpinned, keeping our locator", async () => {
    const disagreeing: PinBackend = { provider: "web3.storage", pin: async () => "bafybeidifferent" };
    const ref = await publishDiscovery(doc, { backend: disagreeing });
    expect(ref.cid).toBe(await cidForBytes(doc));
    expect(ref.pinned).toBe(false);
    expect(ref.pinError).toContain("bafybeidifferent");
  });

  it("never throws on pin failure — the locator survives, pinned=false", async () => {
    const failing: PinBackend = {
      provider: "pinata",
      pin: async () => {
        throw new Error("503 over quota");
      },
    };
    const ref = await publishDiscovery(doc, { backend: failing });
    expect(ref.cid).toBe(await cidForBytes(doc));
    expect(ref.pinned).toBe(false);
    expect(ref.pinError).toContain("over quota");
  });
});

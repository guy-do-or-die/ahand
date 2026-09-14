import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  cidForBytes,
  ipfsUri,
  gatewayUrl,
  verifyDiscoveryBytes,
  fetchDiscoveryByCommitment,
  publishDiscovery,
  type PinBackend,
} from "./discovery";

const bytes = (s: string) => new TextEncoder().encode(s);

beforeEach(() => {
  vi.stubEnv("VITE_IPFS_GATEWAY", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

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
    expect(gatewayUrl(cid)).toBe(`https://gateway.pinata.cloud/ipfs/${cid}`);
    expect(gatewayUrl(cid, "https://gw.example/")).toBe(`https://gw.example/ipfs/${cid}`);
  });

  it("uses the configured public gateway", () => {
    vi.stubEnv("VITE_IPFS_GATEWAY", " https://gw.example/ ");
    expect(gatewayUrl("test-cid")).toBe("https://gw.example/ipfs/test-cid");
  });

  it("verifies gateway bytes against a cid", async () => {
    const doc = bytes('{"title":"hi"}');
    const cid = await cidForBytes(doc);
    expect(await verifyDiscoveryBytes(doc, cid)).toBe(true);
    expect(await verifyDiscoveryBytes(bytes('{"title":"hj"}'), cid)).toBe(false);
  });
});

describe("fetchDiscoveryByCommitment", () => {
  const doc = "hello world";
  const commitment = "0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
  const cid = "bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e";

  it("fetches verified bytes from Pinata by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(doc));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchDiscoveryByCommitment(commitment)).toEqual(bytes(doc));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://gateway.pinata.cloud/ipfs/${cid}`);
  });

  it("falls back to Pinata when the configured gateway returns 429", async () => {
    vi.stubEnv("VITE_IPFS_GATEWAY", "https://gw.example/");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response(doc));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchDiscoveryByCommitment(commitment)).toEqual(bytes(doc));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `https://gw.example/ipfs/${cid}`,
      `https://gateway.pinata.cloud/ipfs/${cid}`,
    ]);
  });

  it("returns null when the default gateway is rate limited without retrying it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchDiscoveryByCommitment(commitment)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects corrupt bytes from every gateway", async () => {
    vi.stubEnv("VITE_IPFS_GATEWAY", "https://gw.example");
    const fetchMock = vi.fn().mockImplementation(async () => new Response("different content"));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchDiscoveryByCommitment(commitment)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("can recover verified bytes after a corrupt first response", async () => {
    vi.stubEnv("VITE_IPFS_GATEWAY", "https://gw.example");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("different content"))
      .mockResolvedValueOnce(new Response(doc));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchDiscoveryByCommitment(commitment)).toEqual(bytes(doc));
  });

  it("aborts gateway attempts within one overall timeout budget", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_IPFS_GATEWAY", "https://gw.example");
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => {
      const signal = init.signal!;
      signals.push(signal);
      if (signals.length === 1) {
        return new Promise((resolve) => {
          setTimeout(() => resolve(new Response("rate limited", { status: 429 })), 60);
        });
      }
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchDiscoveryByCommitment(commitment, 100);
    await vi.advanceTimersByTimeAsync(60);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(40);

    expect(await result).toBeNull();
    expect(signals[0]).toBe(signals[1]);
    expect(signals[1].aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
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

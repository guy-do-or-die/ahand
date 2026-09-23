import { beforeEach, describe, expect, it, vi } from "vitest";
import { b64urlEncode, buildMetadata, ZERO_HASH } from "../../lib/metadata";
import { planOgCard } from "./plan";

const { readContract } = vi.hoisted(() => ({ readContract: vi.fn() }));
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: () => ({ readContract }),
}));
vi.mock("../../config/web3", () => ({ activeChain: {} }));

const IMMUTABLE = "public, max-age=31536000, immutable";
const forged = b64urlEncode(
  new TextEncoder().encode(
    JSON.stringify({ title: "URGENT: claim your payout at ahand-claim.xyz", teaser: "within 24h", nonce: "A".repeat(22) }),
  ),
);
const none = new Headers();
const sameOrigin = new Headers({ "sec-fetch-site": "same-origin" });

function onchain(discoveryCommitment: `0x${string}`) {
  readContract.mockResolvedValue({ discoveryCommitment });
}

beforeEach(() => {
  readContract.mockReset();
});

describe("planOgCard: hand cards", () => {
  it("draws a verified doc and caches it for good", async () => {
    const res = await buildMetadata({ text: "Need a ladder\nfor one day", visibility: "preview" });
    onchain(res.discoveryCommitment);

    const plan = await planOgCard("7.png", res.discoveryB64, none);
    expect(plan).toEqual({
      status: 200,
      preview: { title: "Need a ladder", teaser: "for one day" },
      headers: { "Cache-Control": IMMUTABLE },
    });
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "getHand", args: [7n] }));
  });

  it("draws the generic card for a forged doc, on a short TTL", async () => {
    const res = await buildMetadata({ text: "Real title", visibility: "public" });
    onchain(res.discoveryCommitment);

    const plan = await planOgCard("7.png", forged, none);
    expect(plan.status).toBe(200);
    if (plan.status !== 200) return;
    expect(plan.preview).toBeNull();
    expect(plan.headers["Cache-Control"]).not.toContain("immutable");
  });

  it("draws the generic card for a dark or not-yet-raised hand whatever ?e= says", async () => {
    onchain(ZERO_HASH);
    const res = await buildMetadata({ text: "Dark ask", visibility: "dark" });
    for (const e of [forged, res.discoveryB64]) {
      const plan = await planOgCard("999999.png", e, none);
      expect(plan.status === 200 && plan.preview).toBeNull();
    }
  });

  it("skips the chain read without ?e= and never caches a failed read", async () => {
    const plain = await planOgCard("7.png", null, none);
    expect(plain).toEqual({ status: 200, preview: null, headers: { "Cache-Control": "public, max-age=300" } });
    expect(readContract).not.toHaveBeenCalled();

    readContract.mockRejectedValue(new Error("rpc down"));
    const failed = await planOgCard("7.png", forged, none);
    expect(failed).toEqual({ status: 200, preview: null, headers: { "Cache-Control": "no-store" } });
  });

  it("ignores an oversized ?e= without decoding it", async () => {
    const plan = await planOgCard("7.png", "A".repeat(5463), none);
    expect(plan.status === 200 && plan.preview).toBeNull();
    expect(readContract).not.toHaveBeenCalled();
  });

  it("404s anything that is not <handId>.png or draft.png", async () => {
    for (const file of ["7", "abc.png", "7.png.png", "-1.png", `${"9".repeat(19)}.png`]) {
      expect(await planOgCard(file, forged, sameOrigin)).toEqual({ status: 404 });
    }
    expect(readContract).not.toHaveBeenCalled();
  });
});

describe("planOgCard: raise-page draft", () => {
  it("refuses scrapers and foreign pages", async () => {
    expect(await planOgCard("draft.png", forged, none)).toEqual({ status: 403 });
    for (const site of ["cross-site", "same-site", "none"]) {
      const headers = new Headers({ "sec-fetch-site": site, referer: "https://ahand.in/raise", host: "ahand.in" });
      expect(await planOgCard("draft.png", forged, headers)).toEqual({ status: 403 });
    }
    const foreign = new Headers({ referer: "https://evil.example/page", host: "ahand.in" });
    expect(await planOgCard("draft.png", forged, foreign)).toEqual({ status: 403 });
  });

  it("draws the unanchored draft for the app's own page, never into a shared cache", async () => {
    const res = await buildMetadata({ text: "Draft ask\nstill typing", visibility: "preview" });
    const legacy = new Headers({ referer: "https://ahand.in/raise", host: "ahand.in" });
    for (const headers of [sameOrigin, legacy]) {
      expect(await planOgCard("draft.png", res.discoveryB64, headers)).toEqual({
        status: 200,
        preview: { title: "Draft ask", teaser: "still typing" },
        headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
      });
    }
    expect(readContract).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMetadata, ZERO_HASH } from "./metadata";
import type { HandAbiOutput } from "./hand";

const { readContract, fetchDiscovery } = vi.hoisted(() => ({
  readContract: vi.fn(),
  fetchDiscovery: vi.fn(),
}));
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: () => ({ readContract }),
}));
vi.mock("../config/web3", () => ({ activeChain: {} }));
vi.mock("./discovery", () => ({ fetchDiscoveryByCommitment: fetchDiscovery }));

const NOW = new Date("2026-09-14T12:00:00Z");
const SECRET = `0x${"11".repeat(32)}` as const;

async function fixture(overrides: Partial<HandAbiOutput> = {}, open = true) {
  const metadata = await buildMetadata({
    text: "Public request\nCan someone help?",
    visibility: "public",
    ...(open ? { open: { secret: SECRET } } : {}),
  });
  const hand: HandAbiOutput = {
    raiser: `0x${"11".repeat(20)}`,
    expiry: NOW.getTime() / 1000 + 3600,
    charityBps: 100,
    minGiverClaimBps: 7000,
    visibility: 0,
    status: 1,
    rewardToken: `0x${"22".repeat(20)}`,
    creditedReward: 33_000_000n,
    charityRecipient: `0x${"33".repeat(20)}`,
    usdScaleAtRaise: 1_000_000n,
    rootCapability: `0x${"44".repeat(20)}`,
    metadataCommitment: metadata.metadataCommitment,
    discoveryCommitment: metadata.discoveryCommitment,
    thankSignalSourceHash: ZERO_HASH,
    ...overrides,
  };
  return { hand, bytes: metadata.discoveryBytes };
}

function chain(hands: HandAbiOutput[]) {
  readContract.mockImplementation(async ({ functionName, args }) =>
    functionName === "handsCount"
      ? BigInt(hands.length)
      : hands[Number(args[0]) - 1],
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("open hands feed", () => {
  it("lists a verified active public hand", async () => {
    const { hand, bytes } = await fixture();
    chain([hand]);
    fetchDiscovery.mockResolvedValue(bytes);
    const { listOpenHands } = await import("./openHands");
    expect(await listOpenHands()).toEqual([
      expect.objectContaining({
        id: "1",
        title: "Public request",
        potUsd: 33,
        open: true,
      }),
    ]);
    expect(fetchDiscovery).toHaveBeenCalledWith(hand.discoveryCommitment);
  });

  it("distinguishes a failed gateway from an empty board and retries without caching the miss", async () => {
    const { hand, bytes } = await fixture();
    chain([hand]);
    fetchDiscovery.mockResolvedValueOnce(null).mockResolvedValueOnce(bytes);
    const { listOpenHands } = await import("./openHands");
    await expect(listOpenHands()).rejects.toThrow("Could not load open hands");
    expect(await listOpenHands()).toHaveLength(1);
    expect(fetchDiscovery).toHaveBeenCalledTimes(2);
  });

  it("reports RPC failure instead of claiming there are no hands", async () => {
    readContract.mockRejectedValue(new Error("RPC unavailable"));
    const { listOpenHands } = await import("./openHands");
    await expect(listOpenHands()).rejects.toThrow("RPC unavailable");
  });

  it("does not turn a failed per-hand RPC read into an empty result", async () => {
    readContract
      .mockResolvedValueOnce(1n)
      .mockRejectedValueOnce(new Error("RPC unavailable"));
    const { listOpenHands } = await import("./openHands");
    await expect(listOpenHands()).rejects.toThrow("Could not load open hands");
  });

  it("returns an honest empty result when the chain has no hands", async () => {
    chain([]);
    const { listOpenHands } = await import("./openHands");
    expect(await listOpenHands()).toEqual([]);
    expect(fetchDiscovery).not.toHaveBeenCalled();
  });

  it("keeps expired, settled and unlisted hands out of the open board", async () => {
    const { hand } = await fixture();
    chain([
      { ...hand, expiry: NOW.getTime() / 1000 },
      { ...hand, status: 2 },
      { ...hand, status: 3 },
      { ...hand, visibility: 1 },
      { ...hand, visibility: 2 },
    ]);
    const { listOpenHands } = await import("./openHands");
    expect(await listOpenHands()).toEqual([]);
    expect(fetchDiscovery).not.toHaveBeenCalled();
  });

  it("does not show legacy or mismatched metadata as joinable", async () => {
    const legacy = await fixture({}, false);
    const mismatched = await fixture({ metadataCommitment: ZERO_HASH });
    chain([legacy.hand, mismatched.hand]);
    fetchDiscovery.mockImplementation(async (commitment) =>
      commitment === legacy.hand.discoveryCommitment
        ? legacy.bytes
        : mismatched.bytes,
    );
    const { listOpenHands } = await import("./openHands");
    expect(await listOpenHands()).toEqual([]);
  });

  it("shows available cards after a partial failure and retries missing cards on the next load", async () => {
    const { hand, bytes } = await fixture();
    chain([hand, hand]);
    fetchDiscovery.mockResolvedValueOnce(null).mockResolvedValue(bytes);
    const { listOpenHands } = await import("./openHands");
    expect((await listOpenHands()).map((h) => h.id)).toEqual(["1"]);
    expect((await listOpenHands()).map((h) => h.id)).toEqual(["2", "1"]);
  });

  it("does not keep a hand open in cache after its expiry", async () => {
    const { hand, bytes } = await fixture({
      expiry: NOW.getTime() / 1000 + 10,
    });
    chain([hand]);
    fetchDiscovery.mockResolvedValue(bytes);
    const { listOpenHands } = await import("./openHands");
    expect(await listOpenHands()).toHaveLength(1);
    vi.setSystemTime(new Date(NOW.getTime() + 10_000));
    expect(await listOpenHands()).toEqual([]);
    expect(fetchDiscovery).toHaveBeenCalledTimes(1);
  });
});

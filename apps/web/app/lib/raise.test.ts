import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type AbiEvent,
  type Address,
  type Log,
} from "viem";
import { AHandCoreAbi, MockUSDAbi, DeployedAddresses } from "@ahand/abi";
import type { SenderCall, SendResult } from "../hooks/useSender";
import { mintRaisedReceipt, raiseCalls, raisedHandId, raisedReceiptCall, type RaiseParamsArg } from "./raise";

const ALICE = `0x${"a1".repeat(20)}` as Address;
const BOB = `0x${"b2".repeat(20)}` as Address;
const CAROL = `0x${"c3".repeat(20)}` as Address;
const STRANGER = `0x${"de".repeat(20)}` as Address;
const AMOUNT = 150_000_000n;

const PARAMS: RaiseParamsArg = {
  token: DeployedAddresses.mockUSD,
  amount: AMOUNT,
  expiry: 2_000_000_000,
  charityRecipient: DeployedAddresses.charity,
  charityBps: 100,
  minGiverClaimBps: 7000,
  rootCapability: `0x${"11".repeat(20)}`,
  visibility: 1,
  metadataCommitment: `0x${"22".repeat(32)}`,
  discoveryCommitment: `0x${"33".repeat(32)}`,
};

const RAISED_EVENT = AHandCoreAbi.find(
  (item) => item.type === "event" && item.name === "Raised",
) as AbiEvent;

/** A real Raised log, as Core encodes it. */
function raisedLog(handId: bigint, raiser: Address, address: Address = DeployedAddresses.AHandCore): Log {
  const fields: Record<string, unknown> = {
    credited: AMOUNT,
    usdScaleAtRaise: 10n ** 12n,
    policyRevision: 1n,
    expiry: PARAMS.expiry,
    rootCapability: PARAMS.rootCapability,
    visibility: PARAMS.visibility,
    metadataCommitment: PARAMS.metadataCommitment,
    discoveryCommitment: PARAMS.discoveryCommitment,
    discoveryRef: "0x",
    minGiverClaimBps: PARAMS.minGiverClaimBps,
    charityRecipient: PARAMS.charityRecipient,
    charityBps: PARAMS.charityBps,
  };
  const body = RAISED_EVENT.inputs.filter((input) => !input.indexed);
  return {
    address,
    topics: encodeEventTopics({
      abi: AHandCoreAbi,
      eventName: "Raised",
      args: { handId, raiser, token: PARAMS.token },
    }),
    data: encodeAbiParameters(body, body.map((input) => fields[input.name!])),
  } as unknown as Log;
}

function approvalLog(owner: Address): Log {
  return {
    address: DeployedAddresses.mockUSD,
    topics: encodeEventTopics({
      abi: MockUSDAbi,
      eventName: "Approval",
      args: { owner, spender: DeployedAddresses.AHandCore },
    }),
    data: encodeAbiParameters([{ type: "uint256" }], [AMOUNT]),
  } as unknown as Log;
}

/**
 * Core + Signals as far as a raise and its RAISED receipt go. Every send is
 * one all-or-nothing batch, like Simple7702Account.executeBatch; `interleave`
 * lands other people's ops between a sender's decision and its inclusion.
 */
function fakeChain() {
  type State = {
    handsCount: bigint;
    raiserOf: Map<bigint, Address>;
    processed: Set<bigint>;
    receipts: Map<Address, number>;
  };
  let state: State = { handsCount: 0n, raiserOf: new Map(), processed: new Set(), receipts: new Map() };
  let pendingInterleave: (() => Promise<void>) | null = null;

  const exec = (from: Address, calls: SenderCall[]): Log[] => {
    // Work on a copy and commit only if every call succeeds.
    const next: State = {
      handsCount: state.handsCount,
      raiserOf: new Map(state.raiserOf),
      processed: new Set(state.processed),
      receipts: new Map(state.receipts),
    };
    const logs: Log[] = [];
    for (const call of calls) {
      if (call.functionName === "approve") {
        logs.push(approvalLog(from));
      } else if (call.functionName === "raise") {
        const handId = ++next.handsCount;
        next.raiserOf.set(handId, from);
        logs.push(raisedLog(handId, from));
      } else if (call.functionName === "materializeRaised") {
        const handId = call.args![0] as bigint;
        if (next.processed.has(handId)) throw new Error("AlreadyMaterialized()");
        const raiser = next.raiserOf.get(handId);
        if (!raiser) throw new Error("WrongHand()");
        next.processed.add(handId);
        next.receipts.set(raiser, (next.receipts.get(raiser) ?? 0) + 1);
      }
    }
    state = next;
    return logs;
  };

  return {
    get handsCount() {
      return state.handsCount;
    },
    raiserOf: (handId: bigint) => state.raiserOf.get(handId),
    receiptsOf: (who: Address) => state.receipts.get(who) ?? 0,
    isProcessed: (handId: bigint) => state.processed.has(handId),
    /** The next send from anyone waits until `ops` have landed first. */
    interleave(ops: () => Promise<void>) {
      pendingInterleave = ops;
    },
    senderFor(from: Address) {
      return async (calls: SenderCall[]): Promise<SendResult> => {
        const before = pendingInterleave;
        pendingInterleave = null;
        if (before) await before();
        return { receipt: {} as SendResult["receipt"], logs: exec(from, calls) };
      };
    },
  };
}

/** The sponsored raise as useRaiseFlow runs it: raise, read the id, then the receipt. */
async function sponsoredRaise(chain: ReturnType<typeof fakeChain>, who: Address) {
  const send = chain.senderFor(who);
  const { logs } = await send(raiseCalls({ allowance: 0n, params: PARAMS, discoveryRef: "0x" }));
  const handId = raisedHandId(logs);
  if (handId === null) throw new Error("no Raised log");
  await mintRaisedReceipt(send, handId);
  return handId;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("raiseCalls", () => {
  it("approves only when the allowance is short", () => {
    const short = raiseCalls({ allowance: AMOUNT - 1n, params: PARAMS, discoveryRef: "0x" });
    expect(short.map((c) => c.functionName)).toEqual(["approve", "raise"]);
    expect(short[0].address).toBe(DeployedAddresses.mockUSD);
    expect(short[0].args).toEqual([DeployedAddresses.AHandCore, AMOUNT]);

    const unknown = raiseCalls({ allowance: undefined, params: PARAMS, discoveryRef: "0x" });
    expect(unknown.map((c) => c.functionName)).toEqual(["approve", "raise"]);

    const enough = raiseCalls({ allowance: AMOUNT, params: PARAMS, discoveryRef: "0x" });
    expect(enough.map((c) => c.functionName)).toEqual(["raise"]);
    expect(enough[0].address).toBe(DeployedAddresses.AHandCore);
    expect(enough[0].args).toEqual([PARAMS, "0x", []]);
  });

  it("never batches a Signals call — the hand id does not exist before raise runs", () => {
    for (const allowance of [undefined, 0n, AMOUNT]) {
      const calls = raiseCalls({ allowance, params: PARAMS, discoveryRef: "0x1234" });
      expect(calls.some((c) => c.address === DeployedAddresses.AHandSignals)).toBe(false);
      expect(calls.some((c) => c.functionName.startsWith("materialize"))).toBe(false);
    }
  });
});

describe("raisedHandId", () => {
  it("reads the id from Core's Raised log among the op's other logs", () => {
    expect(raisedHandId([approvalLog(ALICE), raisedLog(42n, ALICE)])).toBe(42n);
  });

  it("ignores a Raised-shaped log from any other contract", () => {
    expect(raisedHandId([raisedLog(7n, ALICE, STRANGER)])).toBeNull();
    expect(raisedHandId([raisedLog(7n, ALICE, STRANGER), raisedLog(9n, ALICE)])).toBe(9n);
  });

  it("is null when the op raised nothing", () => {
    expect(raisedHandId([])).toBeNull();
    expect(raisedHandId([approvalLog(ALICE)])).toBeNull();
  });

  it("matches Core addresses case-insensitively", () => {
    const log = raisedLog(3n, ALICE, DeployedAddresses.AHandCore.toLowerCase() as Address);
    expect(raisedHandId([log])).toBe(3n);
  });
});

describe("mintRaisedReceipt", () => {
  it("sends exactly materializeRaised(handId) to Signals", async () => {
    const send = vi.fn(async () => ({}) as SendResult);
    expect(await mintRaisedReceipt(send, 5n)).toBe(true);
    expect(send).toHaveBeenCalledWith([raisedReceiptCall(5n)]);
    expect(raisedReceiptCall(5n)).toMatchObject({
      address: DeployedAddresses.AHandSignals,
      functionName: "materializeRaised",
      args: [5n],
    });
  });

  it("swallows a failed mint (someone minted first, bundler down) — the raise already stands", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn(async () => {
      throw new Error("AlreadyMaterialized()");
    });
    await expect(mintRaisedReceipt(send, 5n)).resolves.toBe(false);
  });
});

describe("concurrent raises", () => {
  it("two sponsored raises in flight both land, each receipt on its own raiser's hand", async () => {
    const chain = fakeChain();
    // Bob's whole sponsored raise lands while Alice's op is still in flight.
    chain.interleave(async () => {
      await sponsoredRaise(chain, BOB);
    });
    const aliceHand = await sponsoredRaise(chain, ALICE);

    expect(aliceHand).toBe(2n);
    expect(chain.raiserOf(1n)).toBe(BOB);
    expect(chain.raiserOf(2n)).toBe(ALICE);
    expect(chain.receiptsOf(ALICE)).toBe(1);
    expect(chain.receiptsOf(BOB)).toBe(1);
    expect(chain.isProcessed(1n) && chain.isProcessed(2n)).toBe(true);
  });

  it("a classic raise in between does not take the sponsored raiser's receipt", async () => {
    const chain = fakeChain();
    chain.interleave(async () => {
      await chain.senderFor(CAROL)(raiseCalls({ allowance: AMOUNT, params: PARAMS, discoveryRef: "0x" }));
    });
    const aliceHand = await sponsoredRaise(chain, ALICE);

    expect(aliceHand).toBe(2n);
    expect(chain.receiptsOf(ALICE)).toBe(1);
    expect(chain.receiptsOf(CAROL)).toBe(0);
    expect(chain.isProcessed(1n)).toBe(false); // Carol's own, still hers to mint
  });

  it("the replaced pattern — materializeRaised(handsCount + 1) batched with the raise — fails the same race", async () => {
    const chain = fakeChain();
    const predicted = chain.handsCount + 1n; // read before the op is sent
    chain.interleave(async () => {
      await sponsoredRaise(chain, BOB);
    });
    const batch = [
      ...raiseCalls({ allowance: 0n, params: PARAMS, discoveryRef: "0x" }),
      raisedReceiptCall(predicted),
    ];
    await expect(chain.senderFor(ALICE)(batch)).rejects.toThrow("AlreadyMaterialized");
    expect(chain.handsCount).toBe(1n); // Alice's raise rolled back with it
  });
});

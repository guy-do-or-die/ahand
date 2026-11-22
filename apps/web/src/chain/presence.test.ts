import { describe, expect, test } from "bun:test";
import { CORE_ABI } from "@ahand/sdk";
import { createPublicClient, custom, HttpRequestError, type Address } from "viem";

import { isNoDataError, presenceOf, PresenceStore, readFailureOf } from "./presence";

const CORE: Address = "0x65ac707E2AE7392583de5d6192C619F1D8862309";

/** A client whose RPC answers every method from `answer`; viem does the rest, as in the app. */
function clientAnswering(answer: (method: string) => unknown) {
  return createPublicClient({
    transport: custom({
      async request({ method }: { method: string }) {
        const value = answer(method);
        if (value instanceof Error) throw value;
        return value;
      },
    }, { retryCount: 0 }),
  });
}

const empty = clientAnswering((method) => (method === "eth_chainId" ? "0x14a34" : method === "eth_blockNumber" ? "0x10" : "0x"));
const deployed = clientAnswering((method) => (method === "eth_getCode" ? "0x6080604052" : method === "eth_chainId" ? "0x14a34" : "0x10"));
const down = clientAnswering(() => new HttpRequestError({ url: "https://sepolia.base.org" }));

describe("Core not on this network vs the network not answering", () => {
  test("eth_getCode decides: no code is absent, code is here", async () => {
    expect(await presenceOf(empty, CORE)).toBe("absent");
    expect(await presenceOf(deployed, CORE)).toBe("here");
  });

  test("a network failure is not a verdict: it throws as a network error", async () => {
    const error = await presenceOf(down, CORE).catch((e: unknown) => e);
    expect(readFailureOf(error, undefined)).toBe("offline");
  });

  test("reading Core at an empty address fails with viem's no-data error, which is not the network", async () => {
    const error = await empty.readContract({ address: CORE, abi: CORE_ABI, functionName: "MAX_EXPIRY_PERIOD" }).catch((e: unknown) => e);
    expect(isNoDataError(error)).toBe(true);
    expect(readFailureOf(error, "absent")).toBe("absent");
    // Before eth_getCode has said so, an empty answer is only a failure: never "offline".
    expect(readFailureOf(error, undefined)).toBe("failed");
    const offline = await down.readContract({ address: CORE, abi: CORE_ABI, functionName: "MAX_EXPIRY_PERIOD" }).catch((e: unknown) => e);
    expect(isNoDataError(offline)).toBe(false);
    expect(readFailureOf(offline, "absent")).toBe("offline");
  });
});

describe("PresenceStore: one check for the tab", () => {
  test("the first listener asks once; everyone sees the answer; 'here' is kept", async () => {
    let asked = 0;
    const store = new PresenceStore(async () => {
      asked++;
      return "here";
    });
    expect(store.state()).toBe("unknown");
    const seen: string[] = [];
    const stop = store.subscribe(() => seen.push(store.state()));
    store.subscribe(() => undefined);
    await store.recheck();
    expect(store.state()).toBe("here");
    expect(seen).toEqual(["checking", "here"]);
    await store.recheck();
    expect(asked).toBe(1);
    stop();
  });

  test("absent until asked again, and asked again on Check again", async () => {
    let code = false;
    const store = new PresenceStore(async () => (code ? "here" : "absent"));
    store.subscribe(() => undefined);
    await store.recheck();
    expect(store.state()).toBe("absent");
    code = true;
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.state()));
    await store.recheck();
    expect(store.state()).toBe("here");
    expect(seen).toEqual(["here"]); // no "checking" in between: the sentence stays until the answer
  });

  test("the network failing leaves it offline, and the next screen asks again", async () => {
    let up = false;
    const store = new PresenceStore(async () => {
      if (!up) throw new HttpRequestError({ url: "https://sepolia.base.org" });
      return "absent";
    });
    store.subscribe(() => undefined);
    await store.recheck();
    expect(store.state()).toBe("offline");
    up = true;
    store.subscribe(() => undefined);
    await store.recheck();
    expect(store.state()).toBe("absent");
  });

  test("any other failure says nothing about Core", async () => {
    const store = new PresenceStore(async () => {
      throw new Error("bad answer");
    });
    await store.recheck();
    expect(store.state()).toBe("unknown");
  });
});

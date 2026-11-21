import { describe, expect, test } from "bun:test";
import {
  LinkError,
  UntrustedCore,
  CoreRefused,
  describeHand,
  domain,
  encodeLive,
  fromText,
  keyOfSeed,
  newSeed,
  openAddress,
  packAttachments,
  peekLink,
  readDescription,
  toAddress,
  toText,
  type AddressShape,
  type Hand,
} from "@ahand/sdk";
import { ContractFunctionExecutionError, ContractFunctionRevertedError, HttpRequestError, TimeoutError, createPublicClient, custom, parseAbi, zeroAddress, type Address } from "viem";
import { privateKeyToAddress } from "viem/accounts";

import en from "./en";
import { LINK_CODES, NETWORK, RETRY_MS, arrivalOf, canRetry, failureOf, holderStatements, keepMax, makePass, openHeld, pathOf, proofPathOf, readBackOf, retryWhileVisible, routeHands, shareOf } from "./held";
import ru from "./ru";

/**
 * The Hand view's and the pass's logic, offline: a Hand is made here (its terms, a first link in
 * each shape), opened, passed at 0% and at a share, read back, and broken in the ways a link
 * breaks. The chain is never asked: `getHand` answers with the terms made here.
 */

const CORE: Address = "0x65ac707E2AE7392583de5d6192C619F1D8862309";
const OTHER: Address = "0x1111111111111111111111111111111111111111";
const RAISER: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TOKEN: Address = "0x6B867aFa284Ce84eE76424373420E1170da2eE7b";
const PAYEE: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const SITE = "http://127.0.0.1:18321";
const OPTIONS = { canonicalCore: CORE };
const DOMAIN = domain(31337, CORE);

async function made(mode: "public" | "unlisted" | "dark", handId = 7n) {
  const seed = newSeed();
  const d = describeHand({ mode, title: "Who can lend me a tent?", content: "For two people, back on Monday." });
  const hand: Hand = { handId, raiser: RAISER, token: TOKEN, rootKey: privateKeyToAddress(keyOfSeed(seed)), payoutGasK: 250, minClaimBps: 7_000, dataHash: d.dataHash };
  const outside = d.outside && packAttachments(d.outside);
  const link = await encodeLive({ domain: DOMAIN, hand, signedShakes: [], seed, ...(d.inside ? { attachments: d.inside } : {}) }, { ...OPTIONS, ...(outside ? { outside } : {}) });
  const address = toAddress({ site: SITE, link, shape: d.shape, ...(d.outside ? { outside: d.outside } : {}) }, OPTIONS);
  const getHand = async () => hand;
  return { hand, address, link, getHand };
}

function split(address: string) {
  const mark = address.indexOf("#");
  return { before: address.slice(0, mark), fragment: address.slice(mark + 1) };
}

describe("arrivalOf: which link a place shows", () => {
  test("a bare link on / is the link; a numbered link on its own path is the link", async () => {
    const dark = await made("dark");
    expect(arrivalOf({ path: "/", search: "", params: {} }, split(dark.address)).kind).toBe("link");
    const faced = await made("unlisted");
    const held = split(faced.address);
    expect(pathOf(held.before)).toBe("/31337/7");
    expect(arrivalOf({ path: "/31337/7", search: "?d=x", params: { chain: "31337", hand: "7" } }, held).kind).toBe("link");
  });

  test("a link held for one Hand is never shown under another's number: that is the public view", async () => {
    const faced = await made("unlisted");
    const arrival = arrivalOf({ path: "/31337/9", search: "", params: { chain: "31337", hand: "9" } }, split(faced.address));
    expect(arrival).toEqual({ kind: "public", chainId: 31337, handId: 9n, search: "" });
  });

  test("a bare link pasted alone opens under the number it names, and only there", async () => {
    const dark = await made("dark", 12n);
    const held = { before: "", fragment: split(dark.address).fragment };
    const peek = (fragment: string) => peekLink(fromText(fragment), OPTIONS);
    expect(arrivalOf({ path: "/31337/12", search: "", params: { chain: "31337", hand: "12" } }, held, peek).kind).toBe("link");
    expect(arrivalOf({ path: "/31337/13", search: "", params: { chain: "31337", hand: "13" } }, held, peek).kind).toBe("public");
  });

  test("no link and no number: nothing", () => {
    expect(arrivalOf({ path: "/", search: "", params: {} }, undefined).kind).toBe("nothing");
  });
});

describe("openHeld and failureOf: every way a link fails has its own sentence", () => {
  test("each shape opens, with the description attached", async () => {
    for (const mode of ["public", "unlisted", "dark"] as const) {
      const hand = await made(mode);
      const opened = await openHeld(split(hand.address), hand.getHand, OPTIONS);
      expect(readDescription(opened)).toMatchObject({ status: "attached", title: "Who can lend me a tent?" });
      expect(opened.seen.shape).toBe(mode === "dark" ? "bare" : "faced");
    }
  });

  test("a bare link pasted with no address opens as bare", async () => {
    const hand = await made("dark");
    const opened = await openHeld({ before: "", fragment: toText(hand.link) }, hand.getHand, OPTIONS);
    expect(opened.seen.shape).toBe("bare");
  });

  test("one byte changed: damaged", async () => {
    const hand = await made("dark");
    const bytes = hand.link.slice();
    bytes[3] ^= 0x7f;
    const error = await openHeld({ before: `${SITE}/`, fragment: toText(bytes) }, hand.getHand, OPTIONS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LinkError);
    expect(failureOf(error).id).toMatch(/^link\.(malformed|invalid|not-this-hand|non-canonical)$/);
  });

  test("a newer version byte: made by a newer app", async () => {
    const hand = await made("dark");
    const bytes = hand.link.slice();
    bytes[0] = (2 << 4) | (bytes[0]! & 0x0f);
    const error = await openHeld({ before: `${SITE}/`, fragment: toText(bytes) }, hand.getHand, OPTIONS).catch((e: unknown) => e);
    expect(failureOf(error).id).toBe("link.unsupported");
  });

  test("another Core: doesn't read; no main contract known: its own sentence; three different ids", async () => {
    expect(failureOf(new UntrustedCore(31337, OTHER)).id).toBe("link.untrusted");
    const hand = await made("dark");
    const error = await openHeld(split(hand.address), hand.getHand, {}).catch((e: unknown) => e);
    expect(failureOf(error).id).toBe("link.no-canonical");
    expect(failureOf(new LinkError("unsupported", "link version 2")).id).toBe("link.unsupported");
  });

  test("Core's refusal, the minimum, the network and anything else", () => {
    expect(failureOf(new CoreRefused({ name: "NotRaised" })).id).toBe("core.NotRaised");
    expect(failureOf(new LinkError("invalid", "the route leaves the giver less than the Hand's minimum")).id).toBe("core.BelowMinClaim");
    expect(failureOf(new LinkError("invalid", "Core would refuse the route: InvalidClaim")).id).toBe("link.invalid");
    expect(failureOf(new HttpRequestError({ url: "http://127.0.0.1:1" })).id).toBe("hand.offline.opening");
    expect(failureOf(new HttpRequestError({ url: "http://127.0.0.1:1" }), { held: false }).id).toBe("common.time.offline");
    expect(failureOf(new Error("odd")).id).toBe("common.error.unknown");
  });

  test("a network failure while opening is labelled NETWORK, not viem's class name, which goes to the lens only; it can be tried again (FINDINGS F2)", () => {
    const abi = [{ type: "function", name: "hands", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [] }] as const;
    // What getHandFor throws when the RPC refuses the connection or never answers: viem wraps it.
    for (const cause of [new HttpRequestError({ url: "http://127.0.0.1:18545" }), new TimeoutError({ body: {}, url: "http://127.0.0.1:18545" })]) {
      const error = new ContractFunctionExecutionError(cause, { abi, functionName: "hands", args: [3n] });
      const failure = failureOf(error);
      expect(failure.code).toBe(NETWORK);
      expect(failure.code).not.toBe("ContractFunctionExecutionError");
      expect(failure.label).toEqual({ id: "hand.code.network" });
      expect(failure.detail).toBe("ContractFunctionExecutionError");
      expect(failure.id).toBe("hand.offline.opening");
      expect(canRetry(failure)).toBe(true);
    }
    expect(en["hand.offline.opening"]).toBe("Can't reach the network right now. Your link is still open in this tab; nothing was sent.");
    expect(ru["hand.offline.opening"]).toBe("Сеть сейчас недоступна. Ссылка всё ещё открыта в этой вкладке, ничего не отправлено.");
    expect([en["hand.code.network"], ru["hand.code.network"]]).toEqual(["NETWORK", "СЕТЬ"]);
    // A call that reverted is an answer from the chain, not the network.
    const revert = new ContractFunctionExecutionError(new ContractFunctionRevertedError({ abi, functionName: "hands" }), { abi, functionName: "hands", args: [3n] });
    expect(failureOf(revert).code).not.toBe(NETWORK);
    expect(canRetry(failureOf(new LinkError("malformed", "cut short")))).toBe(false);
    expect(canRetry(failureOf(new CoreRefused({ name: "NotRaised" })))).toBe(false);
  });

  test("a node's own JSON-RPC -32603 is the network's, though viem files it under a revert; a revert the node reports under -32603 stays an answer (HV-1)", async () => {
    const read = async (error: { code: number; message: string; data?: string }) => {
      const client = createPublicClient({
        transport: custom({ request: async ({ method }) => (method === "eth_chainId" ? "0x7a69" : Promise.reject(Object.assign(new Error(error.message), error))) }, { retryCount: 0 }),
      });
      try {
        await client.readContract({ address: OTHER, abi: parseAbi(["function handsCount() view returns (uint256)", "error NotRaised()"]), functionName: "handsCount" });
      } catch (thrown) {
        return failureOf(thrown);
      }
      throw new Error("the read did not fail");
    };
    const internal = await read({ code: -32603, message: "internal error" });
    expect(internal.code).toBe(NETWORK);
    expect(internal.id).toBe("hand.offline.opening");
    expect(canRetry(internal)).toBe(true);
    // Reverts: with revert data under -32603 or code 3, or said as "execution reverted" under -32603.
    expect((await read({ code: -32603, message: "execution reverted", data: "0x7b4ec5b1" })).code).not.toBe(NETWORK);
    expect((await read({ code: 3, message: "execution reverted", data: "0x7b4ec5b1" })).code).not.toBe(NETWORK);
    expect((await read({ code: -32603, message: "VM Exception while processing transaction: reverted" })).code).not.toBe(NETWORK);
  });

  test("the app's own labels are in the reader's language; Core's names stay as written (FINDINGS F10)", () => {
    for (const code of LINK_CODES) {
      const failure = failureOf(new LinkError(code, "test"));
      expect(failure.code).toBe(`LINK · ${code.toUpperCase()}`);
      const id = failure.label!.id as keyof typeof en;
      expect(en[id]).toBe(failure.code);
      expect(ru[id]).toMatch(/^ССЫЛКА · [А-ЯЁ ]+$/);
    }
    expect(ru["hand.code.link.not-this-hand"]).toBe("ССЫЛКА · НЕ ОТ ЭТОЙ РУКИ");
    expect(ru["hand.code.link.malformed"]).toBe("ССЫЛКА · ПОВРЕЖДЕНА");
    const untrusted = failureOf(new UntrustedCore(31337, OTHER));
    expect(untrusted.label).toEqual({ id: "hand.code.untrusted", values: { chain: "31337", core: OTHER } });
    expect(ru["hand.code.untrusted"]).toBe("НЕ ДОВЕРЕНО · СЕТЬ {chain} · CORE {core}");
    expect(ru["hand.code.belowMinClaim"]).toContain("BelowMinClaim");
    const core = failureOf(new CoreRefused({ name: "NotRaised" }));
    expect(core).toEqual({ id: "core.NotRaised", code: "CORE · NotRaised" });
  });

  test("the passport's path names the Core only when it is not the main contract (FINDINGS E-6)", () => {
    expect(proofPathOf(31337, CORE, 3n, CORE)).toBe("/31337/3/proof");
    expect(proofPathOf(31337, OTHER, 3n, CORE)).toBe(`/31337/${OTHER.toLowerCase()}/3/proof`);
    expect(proofPathOf(31337, CORE, 3n, null)).toBe(`/31337/${CORE.toLowerCase()}/3/proof`);
  });

  test("the network's failure is said as NETWORK, never by a library's class name, and only it may be tried again", () => {
    const refusedConnection = new HttpRequestError({ url: "http://127.0.0.1:1" });
    // What a stopped chain gives `hands(id)`: viem wraps the transport's error in the call's.
    const wrapped = new ContractFunctionExecutionError(refusedConnection, { abi: [], functionName: "hands" });
    for (const error of [refusedConnection, wrapped, new TimeoutError({ body: {}, url: "http://127.0.0.1:1" })]) {
      expect(failureOf(error, { held: false })).toMatchObject({ id: "common.time.offline", code: "NETWORK", network: true });
      expect(failureOf(error).id).toBe("hand.offline.opening");
    }
    for (const verdict of [new LinkError("malformed", "cut short"), new UntrustedCore(31337, OTHER), new CoreRefused({ name: "NotRaised" }), new Error("odd")]) {
      expect(failureOf(verdict).network).toBeUndefined();
      expect(failureOf(verdict).code).not.toBe("NETWORK");
    }
  });

  test("a network failure loses nothing: the same held link opens on the next try", async () => {
    const hand = await made("unlisted");
    let calls = 0;
    const flaky = async () => {
      if (++calls < 3) throw new ContractFunctionExecutionError(new HttpRequestError({ url: "http://127.0.0.1:1" }), { abi: [], functionName: "hands" });
      return hand.hand;
    };
    const held = split(hand.address);
    for (let attempt = 0; attempt < 2; ++attempt) {
      const error = await openHeld(held, flaky, OPTIONS).catch((e: unknown) => e);
      expect(failureOf(error).network).toBe(true);
    }
    expect(readDescription(await openHeld(held, flaky, OPTIONS)).status).toBe("attached");
  });
});

describe("openHeld: what stands before # must be the link's own Hand, said before anything else", () => {
  const trusts = (chainId: number, core: Address) => chainId === 31337 && core === CORE;
  const never = async (): Promise<Hand> => {
    throw new Error("the network must not be asked about an address that disagrees with its link");
  };

  test("a link under another Hand's address, with that Hand's own public part: another hand, not 'part doesn't match'", async () => {
    const mine = await made("unlisted", 7n);
    const other = await made("unlisted", 9n);
    const error = await openHeld({ before: split(other.address).before, fragment: split(mine.address).fragment }, never, OPTIONS, trusts).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LinkError);
    expect(failureOf(error)).toEqual({ id: "link.another-hand", code: "LINK · ANOTHER-HAND", label: { id: "hand.code.link.another-hand" } });
  });

  test("another number in a numbered path with no public part: another hand", async () => {
    const mine = await made("unlisted", 7n);
    const error = await openHeld({ before: `${SITE}/31337/1`, fragment: split(mine.address).fragment }, never, OPTIONS, trusts).catch((e: unknown) => e);
    expect(failureOf(error).id).toBe("link.another-hand");
  });

  test("a chain or a Core in the path that this build does not read: the 'doesn't read' sentence, never 'another hand'", async () => {
    const mine = await made("unlisted", 7n);
    const { before, fragment } = split(mine.address);
    const wrongChain = await openHeld({ before: before.replace("/31337/", "/8453/"), fragment }, never, OPTIONS, trusts).catch((e: unknown) => e);
    expect(wrongChain).toBeInstanceOf(UntrustedCore);
    expect(failureOf(wrongChain).id).toBe("link.untrusted");
    const wrongCore = await openHeld({ before: before.replace("/31337/", `/31337/${OTHER}/`), fragment }, never, OPTIONS, trusts).catch((e: unknown) => e);
    expect(failureOf(wrongCore).id).toBe("link.untrusted");
  });

  test("the right Hand with a public part that is not its own stays 'part of this address doesn't match'", async () => {
    const mine = await made("unlisted", 7n);
    const { before, fragment } = split(mine.address);
    const d = packAttachments(describeHand({ mode: "unlisted", title: "Another title altogether" }).outside!);
    const error = await openHeld({ before: `${before.slice(0, before.indexOf("?d=") + 3)}${toText(d)}`, fragment }, mine.getHand, OPTIONS, trusts).catch((e: unknown) => e);
    expect(failureOf(error).id).toBe("link.unmatched-data");
  });

  test("an address that agrees with its link opens as before", async () => {
    const mine = await made("unlisted", 7n);
    expect((await openHeld(split(mine.address), mine.getHand, OPTIONS, trusts)).hand.handId).toBe(7n);
  });
});

describe("retryWhileVisible: the next try comes on its own, and only while someone is looking", () => {
  function page(visibilityState: "visible" | "hidden") {
    const listeners = new Set<() => void>();
    return {
      visibilityState,
      addEventListener: (_: "visibilitychange", listener: () => void) => void listeners.add(listener),
      removeEventListener: (_: "visibilitychange", listener: () => void) => void listeners.delete(listener),
      show(state: "visible" | "hidden") {
        this.visibilityState = state;
        for (const listener of [...listeners]) listener();
      },
      listeners,
    };
  }
  function clock() {
    let next = 0;
    const timers = new Map<number, { run: () => void; ms: number }>();
    return {
      timers,
      set: (run: () => void, ms: number) => {
        timers.set(++next, { run, ms });
        return next;
      },
      clear: (id: number | undefined) => void (id !== undefined && timers.delete(id)),
      /** Runs the one timer waiting, as if its time came. */
      fire() {
        const [[id, timer]] = [...timers];
        timers.delete(id);
        timer.run();
      },
    };
  }

  test("every few seconds while the tab is visible, until stopped", () => {
    const tab = page("visible");
    const time = clock();
    let tries = 0;
    const stop = retryWhileVisible(() => void ++tries, tab, RETRY_MS, time);
    expect(tries).toBe(0);
    expect([...time.timers.values()].map((timer) => timer.ms)).toEqual([RETRY_MS]);
    time.fire();
    time.fire();
    expect(tries).toBe(2);
    stop();
    expect(time.timers.size).toBe(0);
    expect(tab.listeners.size).toBe(0);
  });

  test("a hidden tab asks nothing; coming back tries at once", () => {
    const tab = page("visible");
    const time = clock();
    let tries = 0;
    const stop = retryWhileVisible(() => void ++tries, tab, RETRY_MS, time);
    tab.show("hidden");
    expect(time.timers.size).toBe(0);
    expect(tries).toBe(0);
    tab.show("visible");
    expect(tries).toBe(1);
    expect(time.timers.size).toBe(1);
    stop();
  });

  test("RETRY_MS is a few seconds", () => {
    expect(RETRY_MS).toBeGreaterThanOrEqual(2_000);
    expect(RETRY_MS).toBeLessThanOrEqual(10_000);
  });
});

describe("the share and the pass", () => {
  test("the slider stops where the helper's minimum begins, on a whole step", () => {
    expect(keepMax(10_000, 7_000)).toBe(3_000);
    expect(keepMax(9_525, 7_000)).toBe(2_500);
    expect(keepMax(7_000, 7_000)).toBe(0);
    expect(keepMax(6_000, 7_000)).toBe(0);
    expect(shareOf(40_000_000n, 200)).toBe(800_000n);
  });

  test("a pass at 0% names nobody and keeps the shape; the new link opens with one more hand", async () => {
    const hand = await made("unlisted");
    const opened = await openHeld(split(hand.address), hand.getHand, OPTIONS);
    const pass = await makePass(opened, { keepBps: 0 }, "faced", SITE, OPTIONS);
    expect(pass.readBack).toEqual({ keptBps: 0, nextClaimBps: 10_000, shakes: 1 });
    const next = await openAddress(pass.address, hand.getHand, OPTIONS);
    expect(routeHands(next)).toHaveLength(2);
    expect(routeHands(next)[1]).toEqual({ role: "passer" });
    expect(next.seen.shape).toBe("faced");
    expect(readDescription(next).status).toBe("attached");
    // The QR is the bare address, as digits, with everything inside.
    const qr = await openAddress(pass.qr, hand.getHand, OPTIONS);
    expect(qr.seen.shape).toBe("bare");
    expect(pass.qr).toMatch(/\/#[0-9]+$/);
    expect(readDescription(qr).status).toBe("attached");
  });

  test("a pass at 10% to an address reads back that address and that share; darker is allowed", async () => {
    const hand = await made("public");
    const opened = await openHeld(split(hand.address), hand.getHand, OPTIONS);
    const pass = await makePass(opened, { keepBps: 1_000, payee: PAYEE }, "bare", SITE, OPTIONS);
    expect(pass.readBack).toEqual({ payee: PAYEE, keptBps: 1_000, nextClaimBps: 9_000, shakes: 1 });
    expect(pass.address.startsWith(`${SITE}/#`)).toBe(true);
    const next = await openHeld(split(pass.address), hand.getHand, OPTIONS);
    expect(readDescription(next).status).toBe("attached");
    expect(readBackOf(next).payee).toBe(PAYEE);
  });

  test("never lighter, never below the minimum, never a share with nowhere to land", async () => {
    const hand = await made("dark");
    const opened = await openHeld(split(hand.address), hand.getHand, OPTIONS);
    await expect(makePass(opened, { keepBps: 0 }, "faced" as AddressShape, SITE, OPTIONS)).rejects.toThrow();
    await expect(makePass(opened, { keepBps: 3_500, payee: PAYEE }, "bare", SITE, OPTIONS)).rejects.toThrow(LinkError);
    await expect(makePass(opened, { keepBps: 500 }, "bare", SITE, OPTIONS)).rejects.toThrow();
  });

  test("holders' own lists stay apart from the asker's words", async () => {
    const hand = await made("dark");
    const opened = await openHeld(split(hand.address), hand.getHand, OPTIONS);
    expect(holderStatements(opened)).toEqual([]);
    expect(routeHands(opened)).toEqual([{ role: "asker", address: RAISER }]);
    expect(zeroAddress).toBe("0x0000000000000000000000000000000000000000");
  });
});

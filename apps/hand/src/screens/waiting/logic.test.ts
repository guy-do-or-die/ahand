import { describe, expect, test } from "bun:test";
import { CORE_ABI } from "@ahand/sdk";
import { encodeAbiParameters, encodeEventTopics, getAddress, zeroAddress, type Address, type Hex } from "viem";

import { addressFromSearch, failureOf, knownHands, offerOf, pathFor, payeeOfPage, refusalFailure, withdrawnIn } from "./logic";

const CORE = getAddress("0x65ac707E2AE7392583de5d6192C619F1D8862309");
const TOKEN = getAddress("0x94e144781871a57F03745dA397dFE7a9588e943b");
const PAYEE = getAddress("0x14dC79964da2C08b23698B3D3cc7Ca32193d9955");
const OTHER = getAddress("0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc");

describe("whose money the page shows", () => {
  test("?for= takes a valid address, in any one case", () => {
    expect(addressFromSearch(`?for=${PAYEE}`)).toBe(PAYEE);
    expect(addressFromSearch(`?for=${PAYEE.toLowerCase()}`)).toBe(PAYEE);
    expect(addressFromSearch(`?x=1&for=${PAYEE.toUpperCase().replace("0X", "0x")}`)).toBe(PAYEE);
  });

  test("a broken checksum, the zero address, junk and no query open nothing", () => {
    const slipped = PAYEE.slice(0, 5) + (PAYEE[5] === "C" ? "c" : "C") + PAYEE.slice(6);
    expect(addressFromSearch(`?for=${slipped}`)).toBeUndefined();
    expect(addressFromSearch(`?for=${zeroAddress}`)).toBeUndefined();
    expect(addressFromSearch("?for=0x1234")).toBeUndefined();
    expect(addressFromSearch("")).toBeUndefined();
  });

  test("the page's own link wins over the connected account; the link carries only the address", () => {
    expect(payeeOfPage(PAYEE, OTHER)).toBe(PAYEE);
    expect(payeeOfPage(undefined, OTHER)).toBe(OTHER);
    expect(payeeOfPage(undefined, undefined)).toBeUndefined();
    expect(pathFor(PAYEE)).toBe(`/waiting?for=${PAYEE}`);
    expect(addressFromSearch(pathFor(PAYEE).slice("/waiting".length))).toBe(PAYEE);
  });
});

describe("who may do what (Core's withdraw rules)", () => {
  test("the payee takes it out; nobody else is offered that", () => {
    expect(offerOf(PAYEE, { address: PAYEE, canSend: true, balance: 10n })).toEqual({ takeOut: true, deliver: false, cannotPay: false });
    expect(offerOf(PAYEE, { address: OTHER, canSend: true, balance: 10n })).toEqual({ takeOut: false, deliver: true, cannotPay: false });
  });

  test("no account, an account that can't send, or nothing to pay with: the money stays where it is", () => {
    expect(offerOf(PAYEE, { canSend: false })).toEqual({ takeOut: false, deliver: false, cannotPay: true });
    expect(offerOf(PAYEE, { address: PAYEE, canSend: false })).toEqual({ takeOut: false, deliver: false, cannotPay: true });
    expect(offerOf(PAYEE, { address: OTHER, canSend: true, balance: 0n }).cannotPay).toBe(true);
    // An unknown balance (not read yet) is not called "nothing to pay with".
    expect(offerOf(PAYEE, { address: OTHER, canSend: true }).cannotPay).toBe(false);
  });
});

describe("Hands this device knows", () => {
  test("both stores, this chain and trusted Cores only, once each, in order, numbered ones only", () => {
    const raised = [
      { chainId: 31337, core: CORE.toLowerCase(), handId: "7" },
      { chainId: 31337, core: CORE, handId: undefined },
      { chainId: 8453, core: CORE, handId: "1" },
    ];
    const passed = [
      { chainId: 31337, core: CORE, handId: "7" },
      { chainId: 31337, core: CORE, handId: "2" },
      { chainId: 31337, core: OTHER, handId: "3" },
      { chainId: 31337, core: "not an address", handId: "4" },
    ];
    const hands = knownHands([raised, passed], 31337, [CORE]);
    expect(hands.map((h) => h.handId)).toEqual([2n, 7n]);
    expect(hands[0]!.core).toBe(CORE);
    expect(hands[1]!.key).toBe(`31337:${CORE.toLowerCase()}:7`);
  });
});

describe("what a failed withdraw means", () => {
  test("the token refusing the payee: the money stays waiting", () => {
    expect(failureOf({ reason: "failed-check", message: 'reverted with reason "BLACKLISTED"' })).toEqual({ kind: "token" });
    expect(failureOf({ reason: "reverted" })).toEqual({ kind: "token" });
    expect(failureOf({ reason: "refused", refusal: { name: "SafeERC20FailedOperation" } as never })).toEqual({ kind: "token" });
    expect(refusalFailure({ name: "InexactTransfer" } as never)).toEqual({ kind: "token" });
  });

  test("Core's own refusals keep their sentence", () => {
    const nothing = failureOf({ reason: "refused", refusal: { name: "NothingPending" } as never });
    expect(nothing).toMatchObject({ kind: "core", id: "core.NothingPending" });
    expect(failureOf({ reason: "reverted", refusal: { name: "NotPayee" } as never })).toMatchObject({ kind: "core", id: "core.NotPayee" });
  });

  test("the ways a send does not start", () => {
    expect(failureOf({ reason: "rejected" })).toEqual({ kind: "rejected" });
    expect(failureOf({ reason: "offline" })).toEqual({ kind: "offline" });
    expect(failureOf({ reason: "needs-wallet" })).toEqual({ kind: "needs-wallet" });
    expect(failureOf({ reason: "stopped" })).toEqual({ kind: "unknown" });
  });
});

describe("the Withdrawn event from a receipt", () => {
  test("decodes Core's Withdrawn and skips other logs", () => {
    const topics = encodeEventTopics({ abi: CORE_ABI, eventName: "Withdrawn", args: { token: TOKEN, payee: PAYEE } }) as Hex[];
    const data = encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [5_000_000n, OTHER]);
    const log = { address: CORE, topics, data, blockNumber: 12n, transactionHash: `0x${"ab".repeat(32)}` as Hex, logIndex: 3 };
    const foreign = { ...log, address: TOKEN as Address };
    const found = withdrawnIn({ logs: [foreign, log] }, CORE);
    expect(found).toEqual([{ token: TOKEN, payee: PAYEE, amount: 5_000_000n, to: OTHER, blockNumber: 12n, transactionHash: log.transactionHash, logIndex: 3 }]);
  });
});

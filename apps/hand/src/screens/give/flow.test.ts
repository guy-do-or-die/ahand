import { describe, expect, test } from "bun:test";
import {
  domain as domainOf,
  encodeLive,
  fromText,
  keyOfSeed,
  newKey,
  newSeed,
  openAddress,
  openLink,
  toAddress,
  type Hand,
  type OpenedAddress,
} from "@ahand/sdk";
import { getAddress, serializeErc6492Signature, zeroAddress, zeroHash, type Address, type Hex, type PublicClient } from "viem";
import { english, generateMnemonic, mnemonicToAccount, privateKeyToAddress } from "viem/accounts";

import { answerLink, confirmWithAccount, confirmWithKey, isNetworkError, type AnswerStep } from "./answer";
import { claimAmount, deliveryState, fromInbox, keyFileOf, MAX_WORDS, shareText, signatureKind, wordsOf } from "./flow";

const SITE = "https://ahand.test";
const CORE = getAddress("0x65ac707e2ae7392583de5d6192c619f1d8862309");
const RAISER = getAddress("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
const TOKEN = getAddress("0x6b867afa284ce84ee76424373420e1170da2ee7b");
const PAYEE = getAddress("0x14dc79964da2c08b23698b3d3cc7ca32193d9955");

/** A live link with no passes yet, opened as the screen opens it. No network: the Hand is given. */
async function liveLink(): Promise<OpenedAddress> {
  const seed = newSeed();
  const hand: Hand = {
    handId: 7n,
    raiser: RAISER,
    token: TOKEN,
    rootKey: privateKeyToAddress(keyOfSeed(seed)),
    payoutGasK: 250,
    minClaimBps: 7000,
    dataHash: zeroHash,
  };
  const link = await encodeLive({ domain: domainOf(31337, CORE), hand, signedShakes: [], seed });
  const address = toAddress({ site: SITE, link, shape: "bare" });
  return openAddress(address, async () => hand);
}

/** No chain is asked in these tests: Core's answer is the one place a stand-in is used, and it says so. */
const coreSaysYes = async () => undefined;
const noClient = {} as PublicClient;

describe("the words", () => {
  test("are normalised (NFC, LF) and trimmed, and never longer than the limit", () => {
    expect(wordsOf("  Café\r\nnext line  ")).toBe("Café\nnext line");
    expect(wordsOf("")).toBe("");
    expect(wordsOf("x".repeat(MAX_WORDS + 50)).length).toBe(MAX_WORDS);
  });
  test("share text keeps the address on its own line", () => {
    expect(shareText("I can help.", "https://a.test/#E1")).toBe("I can help.\n\nhttps://a.test/#E1\n");
    expect(shareText("", "https://a.test/#E1")).toBe("https://a.test/#E1\n");
  });
});

describe("money and claim", () => {
  test("the claim in money is reward × claimBps / 10 000, rounded down", () => {
    expect(claimAmount(40_000_000n, 7000)).toBe(28_000_000n);
    expect(claimAmount(1n, 7000)).toBe(0n);
    expect(claimAmount(0n, 10_000)).toBe(0n);
  });
});

describe("delivery state", () => {
  const entry = (acks: number, of: number, tries: number) => ({ acks, of, tries });
  test("no inbox or no relay is the fallback at once", () => {
    expect(deliveryState(undefined, 1, undefined)).toBe("fallback");
    expect(deliveryState("0x" + "11".repeat(32), 0, undefined)).toBe("fallback");
  });
  test("delivered from one acknowledgement; fallback after a try with none; sending before", () => {
    const inbox = "0x" + "11".repeat(32);
    expect(deliveryState(inbox, 1, undefined)).toBe("sending");
    expect(deliveryState(inbox, 1, entry(0, 0, 0))).toBe("sending");
    expect(deliveryState(inbox, 1, entry(0, 1, 1))).toBe("fallback");
    expect(deliveryState(inbox, 1, entry(1, 1, 2))).toBe("delivered");
  });
  test("a reply counts only from the Hand's own inbox key", () => {
    const inbox = ("0x" + "ab".repeat(32)) as Hex;
    expect(fromInbox(("0x" + "AB".repeat(32)) as Hex, inbox)).toBe(true);
    expect(fromInbox(("0x" + "cd".repeat(32)) as Hex, inbox)).toBe(false);
    expect(fromInbox(("0x" + "ab".repeat(32)) as Hex, undefined)).toBe(false);
  });
});

describe("network errors are told apart from refusals", () => {
  test("a fetch failure deep in the cause chain is the network", () => {
    expect(isNetworkError({ name: "ContractFunctionExecutionError", cause: { name: "HttpRequestError" } })).toBe(true);
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("execution reverted"))).toBe(false);
  });
});

describe("answering a live link (offline half; Core's eth_call is the smoke's)", () => {
  test("a one-time key confirms; the Give names the pasted payee, the route's claim and a zero dataHash; the link holds no secret", async () => {
    const opened = await liveLink();
    const key = newKey();
    const steps: AnswerStep[] = [];
    const outcome = await answerLink({
      opened,
      signer: key.address,
      payee: PAYEE,
      confirm: confirmWithKey(key.privateKey),
      client: noClient,
      forwarder: null,
      site: SITE,
      options: {},
      onStep: (step) => steps.push(step),
      checkOnChain: coreSaysYes,
      blockNumber: async () => 12n,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(steps).toEqual(["confirm", "here", "core", "write"]);
    expect(outcome.block).toBe(12n);
    const give = outcome.signedGive.give;
    expect(give.signer).toBe(key.address);
    expect(give.payee).toBe(PAYEE);
    expect(give.claimBps).toBe(opened.end.claimBps);
    expect(give.dataHash).toBe(zeroHash);
    expect(outcome.address.startsWith(`${SITE}/#`)).toBe(true);
    expect(outcome.digits.startsWith(`${SITE}/#`)).toBe(true);
    const again = await openLink(fromText(outcome.address.split("#")[1]!), async () => opened.hand);
    expect(again.head.kind).toBe("give");
    expect(again.seed).toBeUndefined();
    expect(again.signedGive?.give.dataHash).toBe(zeroHash);
    expect(outcome.address).not.toContain(opened.seed!.slice(2));
    expect(signatureKind(outcome.signedGive.giverSig).kind).toBe("key");
  });

  test("an address from twelve words confirms for itself and receives", async () => {
    const opened = await liveLink();
    const account = mnemonicToAccount(generateMnemonic(english));
    const outcome = await answerLink({
      opened,
      signer: account.address,
      payee: account.address,
      confirm: confirmWithAccount(account),
      client: noClient,
      forwarder: null,
      site: SITE,
      options: {},
      checkOnChain: coreSaysYes,
      blockNumber: async () => 1n,
    });
    expect(outcome.ok && outcome.signedGive.give.signer === account.address && outcome.signedGive.give.payee === account.address).toBe(true);
  });

  test("a refusal found here is Core's sentence and nothing is written", async () => {
    const opened = await liveLink();
    const key = newKey();
    const outcome = await answerLink({
      opened,
      signer: key.address,
      payee: zeroAddress,
      confirm: confirmWithKey(key.privateKey),
      client: noClient,
      forwarder: null,
      site: SITE,
      options: {},
      checkOnChain: coreSaysYes,
      blockNumber: async () => 1n,
    });
    expect(outcome).toMatchObject({ ok: false, reason: "refused", messageId: "core.ZeroPayee" });
  });

  test("the asker cannot answer their own hand", async () => {
    const opened = await liveLink();
    const key = newKey();
    const outcome = await answerLink({
      opened,
      signer: RAISER,
      payee: PAYEE,
      confirm: confirmWithKey(key.privateKey),
      client: noClient,
      forwarder: null,
      site: SITE,
      options: {},
      checkOnChain: coreSaysYes,
      blockNumber: async () => 1n,
    });
    expect(outcome).toMatchObject({ ok: false, reason: "refused", messageId: "core.GiverIsRaiser" });
  });

  test("a wrapped answer with no forwarder stops before any check and says so", async () => {
    const opened = await liveLink();
    const owner = newKey();
    const account = getAddress("0x1111111111111111111111111111111111111111") as Address;
    const wrapping = async (typed: Parameters<ReturnType<typeof confirmWithKey>>[0]) => {
      const inner = await confirmWithKey(owner.privateKey)(typed);
      if (!inner.ok) return inner;
      return { ok: true as const, signature: serializeErc6492Signature({ address: getAddress("0x2222222222222222222222222222222222222222"), data: "0xabcd", signature: inner.signature }) };
    };
    let asked = false;
    const outcome = await answerLink({
      opened,
      signer: account,
      payee: account,
      confirm: wrapping,
      client: noClient,
      forwarder: null,
      site: SITE,
      options: {},
      checkOnChain: async () => {
        asked = true;
      },
      blockNumber: async () => 1n,
    });
    expect(outcome).toMatchObject({ ok: false, reason: "no-forwarder" });
    expect(asked).toBe(false);
  });

  test("a no from the account is 'You said no', and nothing is checked", async () => {
    const opened = await liveLink();
    const outcome = await answerLink({
      opened,
      signer: PAYEE,
      payee: PAYEE,
      confirm: async () => ({ ok: false, reason: "rejected" }),
      client: noClient,
      forwarder: null,
      site: SITE,
      options: {},
      checkOnChain: coreSaysYes,
      blockNumber: async () => 1n,
    });
    expect(outcome).toMatchObject({ ok: false, reason: "rejected" });
  });
});

describe("the optional key file", () => {
  test("names the address, the Hand and what the file is for, and is valid JSON", () => {
    const key = newKey();
    const text = keyFileOf({ address: key.address, privateKey: key.privateKey, chainId: 31337, core: CORE, handId: 7n });
    const json = JSON.parse(text);
    expect(json.address).toBe(key.address);
    expect(json.privateKey).toBe(key.privateKey);
    expect(json.hand).toEqual({ chainId: 31337, core: CORE, handId: "7" });
    expect(typeof json.note).toBe("string");
  });
});

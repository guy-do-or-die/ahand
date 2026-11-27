import { describe, expect, test } from "bun:test";
import {
  domain as domainOf,
  giveTypedData,
  toCoreSignature,
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
import { getAddress, parseSignature, serializeCompactSignature, serializeErc6492Signature, signatureToCompactSignature, zeroAddress, zeroHash, type Address, type Hex, type PublicClient } from "viem";
import { english, generateMnemonic, generatePrivateKey, mnemonicToAccount, privateKeyToAccount, privateKeyToAddress } from "viem/accounts";

import { answerLink, confirmWithAccount, confirmWithKey, confirmWithWallet, type AnswerStep, type GiveTyped } from "./answer";
import { awaitsDelivery, claimAmount, claimText, deliveryState, onAppChain, fromInbox, keyFileOf, MAX_WORDS, shareText, signatureKind, wordsOf } from "./flow";
import { stillDelivering } from "./waiting";

const SITE = "https://ahand.test";
const CORE = getAddress("0x0f0555972388151d2c187f636a0855b6ee9b9685");
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

/**
 * What Core pays the giver (AHandCore `_payShakers`, then `_payGiver`): each Shake keeps
 * ⌊reward × (claimBps − nextClaimBps) / 10 000⌋ (`Math.mulDiv` rounds down), and the giver gets
 * what is left. `claims` is the route's claimBps from the root's 10 000 down to the Give's.
 */
function corePaysGiver(reward: bigint, claims: number[]): bigint {
  let rest = reward;
  for (let i = 0; i + 1 < claims.length; i++) rest -= (reward * BigInt(claims[i]! - claims[i + 1]!)) / 10_000n;
  return rest;
}

describe("money and claim", () => {
  test("the claim in money is the least Core pays: reward × claimBps / 10 000, rounded up", () => {
    expect(claimAmount(40_000_000n, 7000)).toBe(28_000_000n);
    expect(claimAmount(1n, 1)).toBe(1n); // "at least $0" on a funded Hand, while Core paid 1
    expect(claimAmount(1n, 9999)).toBe(1n);
    expect(claimAmount(1n, 7000)).toBe(1n);
    expect(claimAmount(0n, 10_000)).toBe(0n);
    expect(claimAmount(0n, 1)).toBe(0n);
    expect(claimAmount(3n, 3333)).toBe(1n);
    expect(claimAmount(2_000_003n, 7000)).toBe(1_400_003n);
  });

  test("a claim below a cent is written with every digit, never as $0", () => {
    const money = (amount: bigint, decimals: number, lang: "en" | "ru") => `money(${amount},${decimals},${lang})`;
    expect(claimText(28_000_000n, 6, "en", money)).toBe("money(28000000,6,en)");
    expect(claimText(800_000n, 6, "en", money)).toBe("money(800000,6,en)");
    expect(claimText(1n, 6, "en", money)).toBe("$0.000001");
    expect(claimText(1_400_003n, 6, "ru", money)).toBe("$1,400003");
    expect(claimText(1_000_000_000_001n, 6, "en", money)).toBe("$1,000,000.000001");
    expect(claimText(0n, 6, "en", money)).toBe("money(0,6,en)");
  });

  test("checked against Core's arithmetic: exact with one pass, never more than Core pays with more", () => {
    const table: [bigint, number[]][] = [
      [1n, [10_000, 1]],
      [1n, [10_000, 9999]],
      [1n, [10_000, 7000]],
      [7n, [10_000, 3333]],
      [999_999n, [10_000, 7001]],
      [2_000_003n, [10_000, 7000]],
      [10n ** 18n + 7n, [10_000, 1234]],
      [40_000_000n, [10_000]], // no pass: the giver answers the root link and gets it all
      [1n, [10_000, 9999, 9998, 1]],
      [101n, [10_000, 9000, 8000, 7000]],
      [2_000_003n, [10_000, 9500, 9000, 8500, 7000]],
      [12_345n, [10_000, 9999, 5000, 4999, 1]],
    ];
    for (const [reward, claims] of table) {
      const paid = corePaysGiver(reward, claims);
      const shown = claimAmount(reward, claims[claims.length - 1]!);
      expect({ reward, claims, below: shown <= paid }).toEqual({ reward, claims, below: true });
      if (claims.length <= 2) expect({ reward, claims, shown }).toEqual({ reward, claims, shown: paid });
    }
  });
});

describe("the wallet's network", () => {
  test("on the app's network nothing is switched; elsewhere the switch's answer decides, and a refusal stops", async () => {
    let asked = 0;
    const switchTo = (answer: boolean) => async () => {
      asked++;
      return answer;
    };
    expect(await onAppChain(31337, 31337, switchTo(false))).toBe(true);
    expect(asked).toBe(0);
    expect(await onAppChain(1, 31337, switchTo(true))).toBe(true);
    expect(await onAppChain(1, 31337, switchTo(false))).toBe(false);
    expect(await onAppChain(undefined, 31337, switchTo(false))).toBe(false);
    expect(asked).toBe(3);
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
  test("with several relays, delivered at the outbox's two acknowledgements; one is still sending while a relay is left", () => {
    const inbox = "0x" + "11".repeat(32);
    expect(deliveryState(inbox, 5, { ...entry(1, 5, 1), nextTryMs: 1 })).toBe("sending");
    expect(deliveryState(inbox, 5, entry(1, 5, 3))).toBe("delivered"); // no relay left to try: the one copy is what there is
    expect(deliveryState(inbox, 5, { ...entry(2, 5, 1), nextTryMs: 1 })).toBe("delivered");
  });
  test("a line of the giver's thread waits to be delivered by the same rule, not only while no relay took it", () => {
    const inbox = "0x" + "11".repeat(32);
    expect(awaitsDelivery(inbox, 5, entry(0, 0, 0))).toBe(true); // not tried yet
    expect(awaitsDelivery(inbox, 5, { ...entry(0, 5, 1), nextTryMs: 1 })).toBe(true);
    expect(awaitsDelivery(inbox, 5, { ...entry(1, 5, 1), nextTryMs: 1 })).toBe(true); // one relay of the two needed, a relay left
    expect(awaitsDelivery(inbox, 5, entry(1, 5, 3))).toBe(false); // one copy and nothing left to try
    expect(awaitsDelivery(inbox, 5, { ...entry(2, 5, 1), nextTryMs: 1 })).toBe(false);
    expect(awaitsDelivery(inbox, 1, entry(1, 1, 1))).toBe(false); // one relay configured: one is enough
  });
  test("app start opens the outbox for a give still short of its acknowledgements, not for a delivered one", () => {
    expect(stillDelivering(undefined)).toBe(false);
    expect(stillDelivering({})).toBe(true);
    expect(stillDelivering({ acks: 0, of: 5, nextTryMs: 1 })).toBe(true);
    expect(stillDelivering({ acks: 1, of: 5, nextTryMs: 1 })).toBe(true);
    expect(stillDelivering({ acks: 1, of: 5 })).toBe(false); // nothing left to try
    expect(stillDelivering({ acks: 2, of: 5, nextTryMs: 1 })).toBe(false);
    expect(stillDelivering({ acks: 1, of: 1 })).toBe(false);
  });
  test("a reply counts only from the Hand's own inbox key", () => {
    const inbox = ("0x" + "ab".repeat(32)) as Hex;
    expect(fromInbox(("0x" + "AB".repeat(32)) as Hex, inbox)).toBe(true);
    expect(fromInbox(("0x" + "cd".repeat(32)) as Hex, inbox)).toBe(false);
    expect(fromInbox(("0x" + "ab".repeat(32)) as Hex, undefined)).toBe(false);
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

describe("give: the connected wallet's answer goes to Core through the SDK's signGive", () => {
  const key = privateKeyToAccount(generatePrivateKey());
  const typed = (): GiveTyped =>
    giveTypedData(domainOf(31337, CORE), { handId: 7n, raiser: RAISER, token: TOKEN, rootKey: RAISER, payoutGasK: 250, minClaimBps: 7000, dataHash: zeroHash }, {
      signer: key.address,
      payee: PAYEE,
      claimBps: 7000,
      routeHash: zeroHash,
      dataHash: zeroHash,
    });
  const compact = async () => serializeCompactSignature(signatureToCompactSignature(parseSignature(await key.signTypedData(typed()))));

  test("a key's 64-byte answer is brought to Core's 65-byte form", async () => {
    const short = await compact();
    const confirmed = await confirmWithWallet(async () => ({ ok: true, signature: short }), async () => "key")(typed());
    expect(confirmed).toEqual({ ok: true, signature: toCoreSignature(short) });
    expect(confirmed.ok && (confirmed.signature.length - 2) / 2).toBe(65);
  });

  test("a contract's answer, and a wrapper, go as they came", async () => {
    const short = await compact();
    expect(await confirmWithWallet(async () => ({ ok: true, signature: short }), async () => "code")(typed())).toEqual({ ok: true, signature: short });
    const wrapped = serializeErc6492Signature({ address: PAYEE, data: "0xabcd", signature: short });
    expect(await confirmWithWallet(async () => ({ ok: true, signature: wrapped }), async () => "key")(typed())).toEqual({ ok: true, signature: wrapped });
  });

  test("a refusal and a failure are said as such", async () => {
    expect(await confirmWithWallet(async () => ({ ok: false, reason: "rejected" }), async () => "key")(typed())).toEqual({ ok: false, reason: "rejected" });
    expect(await confirmWithWallet(async () => ({ ok: false, reason: "failed", message: "wallet locked" }), async () => "key")(typed())).toEqual({ ok: false, reason: "failed", message: "wallet locked" });
  });

  test("the wallet is asked the very typed data the screen was given", async () => {
    let seen: unknown;
    await confirmWithWallet(async (asked) => {
      seen = asked;
      return { ok: true, signature: await key.signTypedData(asked) };
    }, async () => "key")(typed());
    expect(seen).toEqual(typed());
  });
});

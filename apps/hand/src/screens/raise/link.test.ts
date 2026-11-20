import { describe, expect, test } from "bun:test";
import { describeHand, fromText, keyOfSeed, newSeed, openAddress, readDescription, type Hand } from "@ahand/sdk";
import { publicKeyOf } from "@ahand/deliver";
import { encodeAbiParameters, encodeEventTopics, keccak256, stringToBytes, zeroHash, type Address, type Hex, type TransactionReceipt } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";

import { CORE_ABI } from "@ahand/sdk";
import { assertNewRoot, expiryFor, inboxKeyOf, lengthOf, MAX_BEFORE_HASH, MAX_DETAILS, MAX_TITLE, passesAt, raisedIn, weigh, writeLinks } from "./link";

const CORE = "0x65ac707E2AE7392583de5d6192C619F1D8862309" as Address;
const RAISER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const TOKEN = "0x6B867aFa284Ce84eE76424373420E1170da2eE7b" as Address;
const SITE = "http://127.0.0.1:18311";
const DAY = 86_400;
const CAP = 180 * DAY;

function handOf(seed: Hex, dataHash: Hex, handId = 7n): Hand {
  return { handId, raiser: RAISER, token: TOKEN, rootKey: privateKeyToAddress(keyOfSeed(seed)), payoutGasK: 250, minClaimBps: 7000, dataHash };
}

function raisedLog(handId: bigint, rootKey: Address, dataHash: Hex, address: Address = CORE, raiser: Address = RAISER) {
  const topics = encodeEventTopics({ abi: CORE_ABI, eventName: "Raised", args: { handId, raiser, token: TOKEN } });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint40" }, { type: "address" }, { type: "uint16" }, { type: "uint16" }, { type: "bytes32" }],
    [50_000_000n, 1_800_000_000, rootKey, 250, 7000, dataHash],
  );
  return { address, topics, data } as unknown as TransactionReceipt["logs"][number];
}

describe("raise: the Raised log of this transaction", () => {
  test("gives the hand's number and its terms", () => {
    const seed = newSeed();
    const rootKey = privateKeyToAddress(keyOfSeed(seed));
    const dataHash = keccak256(stringToBytes("words"));
    const receipt = { logs: [raisedLog(12n, rootKey, dataHash)] } as TransactionReceipt;
    const raised = raisedIn(receipt, CORE);
    expect(raised.hand.handId).toBe(12n);
    expect(raised.hand.rootKey).toBe(rootKey);
    expect(raised.hand.dataHash).toBe(dataHash);
    expect(raised.reward).toBe(50_000_000n);
    expect(raised.expiry).toBe(1_800_000_000);
  });

  test("ignores a log of another contract and throws when Core's is missing", () => {
    const receipt = { logs: [raisedLog(3n, RAISER, zeroHash, TOKEN)] } as TransactionReceipt;
    expect(() => raisedIn(receipt, CORE)).toThrow();
  });
});

describe("raise: a receipt shared with other accounts' calls (a wallet's batch, a bundle)", () => {
  const OTHER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;
  const mine = privateKeyToAddress(keyOfSeed(newSeed()));
  const mineToo = privateKeyToAddress(keyOfSeed(newSeed()));
  const theirs = privateKeyToAddress(keyOfSeed(newSeed()));
  const receipt = {
    logs: [raisedLog(40n, theirs, zeroHash, CORE, OTHER), raisedLog(41n, mine, zeroHash), raisedLog(42n, mineToo, zeroHash)],
  } as TransactionReceipt;

  test("the hand is this raiser's own, not the first in the receipt", () => {
    expect(raisedIn(receipt, CORE).hand.handId).toBe(40n);
    expect(raisedIn(receipt, CORE, { raiser: RAISER }).hand.handId).toBe(41n);
    expect(raisedIn(receipt, CORE, { raiser: RAISER.toLowerCase() as Address }).hand.raiser).toBe(RAISER);
  });

  test("among the raiser's own, the one with the root key that was sent", () => {
    expect(raisedIn(receipt, CORE, { raiser: RAISER, rootKey: mineToo }).hand.handId).toBe(42n);
    // A root key that is nowhere in the receipt still gives the raiser's hand: the caller compares the terms.
    expect(raisedIn(receipt, CORE, { raiser: RAISER, rootKey: theirs }).hand.handId).toBe(41n);
  });

  test("a receipt with only other accounts' hands holds none of this raiser's", () => {
    expect(() => raisedIn({ logs: [raisedLog(40n, theirs, zeroHash, CORE, OTHER)] } as TransactionReceipt, CORE, { raiser: RAISER })).toThrow(/by this account/);
  });
});

describe("raise: how much a hand's words may weigh", () => {
  const where = { site: SITE, chainId: 31337, core: CORE, options: { canonicalCore: CORE } };
  const inbox = publicKeyOf(generatePrivateKey());

  test("characters are counted as a reader counts them, after normalising", () => {
    expect(lengthOf("room")).toBe(4);
    expect(lengthOf("комната")).toBe(7);
    expect(lengthOf("🙌🙏")).toBe(2); // two characters, four UTF-16 units
    expect(lengthOf("e\u0301")).toBe(1); // NFC joins the letter and its accent
    expect(lengthOf("a\r\nb")).toBe(3);
  });

  test("the title's cap is 160 and the details' cap is 1000, each to the character", () => {
    expect(MAX_TITLE).toBe(160);
    expect(MAX_DETAILS).toBe(1000);
    expect(weigh({ title: "т".repeat(160), content: "д".repeat(1000), mode: "public" }, where).over).toBeUndefined();
    expect(weigh({ title: "т".repeat(161), content: "", mode: "dark" }, where)).toMatchObject({ title: 161, over: "title" });
    expect(weigh({ title: "A title", content: "д".repeat(1001), mode: "dark" }, where)).toMatchObject({ details: 1001, over: "details" });
    // Spaces around the details are not theirs.
    expect(weigh({ title: "A title", content: `  ${"д".repeat(1000)}\n`, mode: "unlisted" }, where).over).toBeUndefined();
  });

  for (const mode of ["public", "unlisted"] as const) {
    test(`${mode}: the count before # is the real address's, give or take the hand's number`, async () => {
      const title = "A quiet room in Tbilisi for a week, somewhere near the old town";
      const content = "С 3 по 10 июня, до $40 за ночь. ".repeat(20).trim();
      const weighed = weigh({ title, content, mode }, where);
      const seed = newSeed();
      const described = describeHand({ mode, title, content, inbox });
      const written = await writeLinks({ site: SITE, chainId: 31337, core: CORE, hand: handOf(seed, described.dataHash, 7n), seed, described, options: where.options });
      const real = written.address.indexOf("#");
      expect(weighed.beforeHash).toBe(real + 19); // "7" is one digit of the twenty counted
      expect(weighed.over).toBeUndefined();
    });
  }

  test("a site that names the contract in the address counts its 42 characters too", () => {
    const title = "A title";
    const short = weigh({ title, content: "", mode: "unlisted" }, where).beforeHash;
    const long = weigh({ title, content: "", mode: "unlisted" }, { ...where, options: {} }).beforeHash;
    expect(long - short).toBe(43);
  });

  test("dark shows nothing before #, whatever the words weigh", () => {
    expect(weigh({ title: "т".repeat(160), content: "д".repeat(1000), mode: "dark" }, where).beforeHash).toBe(SITE.length + 1);
  });

  test("words at their caps always fit before #: the heaviest characters stay under 8 KB", () => {
    const heaviest = weigh({ title: "🙌".repeat(MAX_TITLE), content: "🙏".repeat(MAX_DETAILS), mode: "public" }, where);
    expect(heaviest.over).toBeUndefined();
    expect(heaviest.beforeHash).toBeGreaterThan(6000);
    expect(heaviest.beforeHash).toBeLessThanOrEqual(MAX_BEFORE_HASH);
  });

  test("an address that would not fit is refused for the public shape and offered the dark one", () => {
    // Reached only if the caps are ever raised; a long site address stands in for that here.
    const far = { ...where, site: `https://${"a".repeat(2000)}.example` };
    const words = { title: "🙌".repeat(MAX_TITLE), content: "🙏".repeat(MAX_DETAILS) };
    expect(weigh({ ...words, mode: "public" }, far)).toMatchObject({ over: "address" });
    expect(weigh({ ...words, mode: "public" }, far).beforeHash).toBeGreaterThan(MAX_BEFORE_HASH);
    expect(weigh({ ...words, mode: "unlisted" }, far).over).toBeUndefined(); // only the title shows
    expect(weigh({ ...words, mode: "dark" }, far).over).toBeUndefined();
  });
});

describe("raise: the inbox key", () => {
  test("is the x-only public key packages/deliver writes", () => {
    for (let i = 0; i < 20; i++) {
      const secret = generatePrivateKey();
      expect(inboxKeyOf(secret)).toBe(publicKeyOf(secret));
    }
  });
});

describe("raise: the expiry by the network's clock", () => {
  test("30 days from the block's time", () => {
    expect(expiryFor(1_000_000, 30, CAP)).toBe(1_000_000 + 30 * DAY);
  });
  test("the 180-day chip is the cap less ten minutes", () => {
    expect(expiryFor(1_000_000, 180, CAP)).toBe(1_000_000 + CAP - 600);
  });
});

describe("raise: room for passes", () => {
  test("250 leaves 55 worst-case passes, 200 leaves 66", () => {
    expect(passesAt(250)).toBe(55);
    expect(passesAt(200)).toBe(66);
  });
});

describe("raise: a new root key is new on this device", () => {
  test("refuses one the device already used, in any letter case", () => {
    const key = privateKeyToAddress(generatePrivateKey());
    expect(() => assertNewRoot(key, [key.toLowerCase() as Address])).toThrow();
    expect(() => assertNewRoot(key, [privateKeyToAddress(generatePrivateKey())])).not.toThrow();
  });
});

describe("raise: the first link, in each shape", () => {
  const inbox = publicKeyOf(generatePrivateKey());
  const options = { canonicalCore: CORE };

  for (const mode of ["public", "unlisted", "dark"] as const) {
    test(`${mode}: opens as this hand with its words, and the QR carries everything inside as digits`, async () => {
      const seed = newSeed();
      const described = describeHand({ mode, title: "A quiet room in Tbilisi", content: "For a week in June.", inbox });
      const hand = handOf(seed, described.dataHash);
      const written = await writeLinks({ site: SITE, chainId: 31337, core: CORE, hand, seed, described, options });

      expect(written.shape).toBe(described.shape);
      if (mode === "dark") expect(written.address.startsWith(`${SITE}/#`)).toBe(true);
      else expect(written.address.startsWith(`${SITE}/31337/7?d=`)).toBe(true);
      expect(written.description).toEqual({ status: "attached", title: "A quiet room in Tbilisi", content: "For a week in June.", inbox });

      const opened = await openAddress(written.address, async () => hand, options);
      expect(opened.linkKey).toBeDefined();
      expect(readDescription(opened).title).toBe("A quiet room in Tbilisi");

      expect(written.qr.startsWith(`${SITE}/#`)).toBe(true);
      const digits = written.qr.slice(written.qr.indexOf("#") + 1);
      expect(/^[0-9]+$/.test(digits)).toBe(true);
      const bare = await openAddress(written.qr, async () => hand, options);
      expect(bare.seen.shape).toBe("bare");
      expect(readDescription(bare)).toEqual({ status: "attached", title: "A quiet room in Tbilisi", content: "For a week in June.", inbox });
      expect(fromText(digits).length).toBe(written.qrBytes);
    });
  }

  test("a seed that is not the hand's root key is refused", async () => {
    const described = describeHand({ mode: "unlisted", title: "Someone who repairs film cameras", inbox });
    const hand = handOf(newSeed(), described.dataHash);
    await expect(writeLinks({ site: SITE, chainId: 31337, core: CORE, hand, seed: newSeed(), described, options })).rejects.toThrow();
  });
});

import { describe, expect, test } from "bun:test";
import {
  describeHand,
  domain as domainOf,
  inboxSecret,
  keyOfSeed,
  masterOf,
  matchRoot,
  openAddress,
  readDescription,
  rootSeed,
  type Hand,
  type SignedShake,
} from "@ahand/sdk";
import { publicKeyOf } from "@ahand/deliver";
import { zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { keysTypedData } from "@ahand/sdk";

import { daysLeft, formatCode, parseCode, parseHandNumber, predictSplit, secondsLeft, wantsCare, DAY } from "./logic";
import { rebuildBare, rebuildWithWords, seedFitsRoot } from "./rebuild";

const CORE = "0x65ac707E2AE7392583de5d6192C619F1D8862309" as Address;
const SITE = "http://127.0.0.1:18351";
const OPTIONS = { canonicalCore: CORE };
const DOMAIN = domainOf(31337, CORE);
// anvil's public test account 1 (local chains only): the asker in the stand's fixtures.
const RAISER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const BOOK = "0x6669787475726573" as Hex;

async function master(): Promise<Hex> {
  return masterOf(await RAISER.signTypedData(keysTypedData(31337, CORE, RAISER.address)));
}

function handOf(rootKey: Address, dataHash: Hex, handId = 7n): Hand {
  return { handId, raiser: RAISER.address, token: "0x6B867aFa284Ce84eE76424373420E1170da2eE7b", rootKey, payoutGasK: 250, minClaimBps: 7_000, dataHash };
}

describe("my: the device's code", () => {
  test("is written in groups of four and read back in any spelling", () => {
    expect(formatCode(BOOK)).toBe("6669 7874 7572 6573");
    for (const typed of ["6669 7874 7572 6573", "0x6669787475726573", "6669-7874-7572-6573", " 66697874 75726573 ", "6669787475726573".toUpperCase()]) {
      expect(parseCode(typed)).toBe(BOOK);
    }
  });

  test("refuses anything that is not 8 bytes of hex", () => {
    for (const bad of ["", "6669", "66697874757265", "666978747572657300", "zz69787475726573", "0x"]) expect(parseCode(bad)).toBeUndefined();
  });

  test("a hand's number is a positive whole number", () => {
    expect(parseHandNumber("12")).toBe(12n);
    expect(parseHandNumber(" #12 ")).toBe(12n);
    for (const bad of ["", "0", "-1", "1.5", "12a", "1e3"]) expect(parseHandNumber(bad)).toBeUndefined();
  });
});

describe("my: time left is the network's", () => {
  test("nothing is claimed before a block arrives", () => {
    expect(secondsLeft(1_000, undefined)).toBeUndefined();
    expect(wantsCare("open", undefined)).toBe(false);
  });

  test("days round down; the band shows under seven days of an open hand only", () => {
    expect(secondsLeft(1_000, 400)).toBe(600);
    expect(secondsLeft(1_000, 2_000)).toBe(0);
    expect(daysLeft(7 * DAY - 1)).toBe(6);
    expect(wantsCare("open", 7 * DAY - 1)).toBe(true);
    expect(wantsCare("open", 7 * DAY)).toBe(false);
    expect(wantsCare("expired", 0)).toBe(false);
    expect(wantsCare("thanked", 10)).toBe(false);
  });
});

describe("my: who would get what, by Core's arithmetic", () => {
  const shake = (claimBps: number, nextClaimBps: number, payee: Address = zeroAddress): SignedShake => ({
    shake: { nextKey: zeroAddress, payee, claimBps, nextClaimBps, dataHash: zeroHash },
    keySig: "0x",
  });
  const A = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
  const HELPER = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as Address;

  test("each Shake gets its margin rounded down; the helper gets the rest, rounding included", () => {
    // reward 25.000001: 10% of it is 2.5000001 → 2_500_000 units (rounded down)
    const rows = predictSplit(25_000_001n, [shake(10_000, 9_000, A), shake(9_000, 9_000)], { payee: HELPER, claimBps: 9_000 });
    expect(rows).toEqual([
      { role: "passer", position: 0, payee: A, amount: 2_500_000n, bps: 1_000 },
      { role: "passer", position: 1, amount: 0n, bps: 0 },
      { role: "helper", payee: HELPER, amount: 22_500_001n, bps: 9_000 },
    ]);
    expect(rows.reduce((sum, row) => sum + row.amount, 0n)).toBe(25_000_001n);
  });

  test("with no Shakes the helper gets the whole reward; with no reward, nothing", () => {
    expect(predictSplit(40n, [], { payee: HELPER, claimBps: 10_000 })).toEqual([{ role: "helper", payee: HELPER, amount: 40n, bps: 10_000 }]);
    expect(predictSplit(0n, [shake(10_000, 8_000, A)], { payee: HELPER, claimBps: 8_000 }).map((row) => row.amount)).toEqual([0n, 0n]);
  });
});

describe("my: a link written again from the device's book", () => {
  test("the derived seed is the root key's, and matchRoot finds its number from the code alone", async () => {
    const m = await master();
    const seed = await rootSeed(m, BOOK, 3);
    const rootKey = privateKeyToAddress(keyOfSeed(seed));
    expect(seedFitsRoot(seed, rootKey)).toBe(true);
    expect(seedFitsRoot(await rootSeed(m, BOOK, 4), rootKey)).toBe(false);
    expect(await matchRoot(m, BOOK, rootKey, 10)).toBe(3);
  });

  for (const mode of ["unlisted", "dark", "public"] as const) {
    test(`${mode}: the kept words ride along only when they give Core's dataHash`, async () => {
      const m = await master();
      const seed = await rootSeed(m, BOOK, 0);
      const inbox = publicKeyOf(await inboxSecret(m, BOOK, 0));
      const words = { mode, title: "Who can lend a ladder?", content: "Two metres, for Saturday.", ...(mode === "public" ? {} : { salt: `0x${"ab".repeat(32)}` as Hex }) };
      const described = describeHand({ ...words, inbox });
      const hand = handOf(privateKeyToAddress(keyOfSeed(seed)), described.dataHash);

      const rebuilt = await rebuildWithWords({ domain: DOMAIN, hand, seed, inbox, words, site: SITE, options: OPTIONS });
      expect(rebuilt.words).toBe("attached");
      expect(rebuilt.address.startsWith(mode === "dark" ? `${SITE}/#` : `${SITE}/31337/7`)).toBe(true);
      const opened = await openAddress(rebuilt.address, async () => hand, OPTIONS);
      expect(opened.hand.handId).toBe(7n);
      expect(opened.seed).toBe(seed);
      expect(readDescription(opened)).toEqual({ status: "attached", title: words.title, content: words.content, inbox });

      // Words that differ by one character are not attached: the link is bare, and says nothing.
      const other = await rebuildWithWords({ domain: DOMAIN, hand, seed, inbox, words: { ...words, title: "Who can lend a ladder!" }, site: SITE, options: OPTIONS });
      expect(other.words).toBe("mismatch");
      expect(readDescription(await openAddress(other.address, async () => hand, OPTIONS)).status).toBe("lost");
    });
  }

  test("a bare link from another device's code opens, its words not arrived", async () => {
    const m = await master();
    const seed = await rootSeed(m, BOOK, 2);
    const hand = handOf(privateKeyToAddress(keyOfSeed(seed)), describeHand({ mode: "dark", title: "x" }).dataHash, 9n);
    const address = await rebuildBare({ domain: DOMAIN, hand, seed, site: SITE, options: OPTIONS });
    expect(address.startsWith(`${SITE}/#`)).toBe(true);
    const opened = await openAddress(address, async () => hand, OPTIONS);
    expect(opened.hand.handId).toBe(9n);
    expect(readDescription(opened).status).toBe("lost");
  });
});

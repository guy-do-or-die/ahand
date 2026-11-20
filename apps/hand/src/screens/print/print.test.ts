import { describe, expect, test } from "bun:test";
import { describeHand, domain, encodeLive, fromText, keyOfSeed, newSeed, openLink, packAttachments, toAddress, type Hand } from "@ahand/sdk";
import { getAddress, zeroAddress } from "viem";
import { privateKeyToAddress } from "viem/accounts";

import { QR_QUIET_MODULES, qrOf } from "../../ui/qr-code";
import { CODE_MM, MIN_MODULE_MM, QUIET_MODULES, TAG_MAX_VERSION, fits, maxVersionOf, moduleMm, offered, sideOf } from "./fit";
import { NotPrintable, openHeldLink, passportAddress, printableOf, receiptOfSearch } from "./link";

const CORE = getAddress("0x65ac707E2AE7392583de5d6192C619F1D8862309");
const RAISER = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const TOKEN = getAddress("0x6B867aFa284Ce84eE76424373420E1170da2eE7b");
const SITE = "http://127.0.0.1:18351";

describe("what fits the tag and the card", () => {
  test("the tag takes version 13 and no more; its module is 31/77 mm", () => {
    expect(maxVersionOf("tag")).toBe(TAG_MAX_VERSION);
    expect(fits(sideOf(13), "tag")).toBe(true);
    expect(fits(sideOf(14), "tag")).toBe(false);
    expect(MIN_MODULE_MM).toBeCloseTo(31 / 77, 10);
    expect(QUIET_MODULES).toBe(QR_QUIET_MODULES);
  });

  test("the card's 50 mm code takes up to version 24, at the tag's module or larger", () => {
    expect(maxVersionOf("card")).toBe(24);
    expect(moduleMm(sideOf(24), CODE_MM.card)).toBeGreaterThanOrEqual(MIN_MODULE_MM);
    expect(moduleMm(sideOf(25), CODE_MM.card)).toBeLessThan(MIN_MODULE_MM);
  });

  test("nothing is offered for a code that fits no version", () => {
    expect(offered(undefined)).toEqual([]);
    expect(offered(sideOf(9))).toEqual(["tag", "card"]);
    expect(offered(sideOf(20))).toEqual(["card"]);
    expect(offered(sideOf(30))).toEqual([]);
  });
});

/** A Hand whose root key is a seed's key, as a raise would make it, with no chain at all. */
function handOf(dataHash: Hand["dataHash"]) {
  const seed = newSeed();
  const hand: Hand = { handId: 7n, raiser: RAISER, token: TOKEN, rootKey: privateKeyToAddress(keyOfSeed(seed)), payoutGasK: 250, minClaimBps: 7000, dataHash };
  return { seed, hand, chain: domain(31337, CORE) };
}

describe("the printed link: bare, everything inside, digits", () => {
  test("an unlisted address with d= becomes a bare digits address that opens with the same words", async () => {
    const described = describeHand({ mode: "unlisted", title: "A quiet room in Tbilisi", content: "Old town, a week from the 3rd.", inbox: `0x${"11".repeat(32)}` });
    const { seed, hand, chain } = handOf(described.dataHash);
    const outside = described.outside && packAttachments(described.outside);
    const link = await encodeLive({ domain: chain, hand, signedShakes: [], seed, attachments: described.inside }, { outside });
    const address = toAddress({ site: SITE, link, shape: described.shape, outside: described.outside });
    expect(address).toContain("?d=");

    const getHand = async () => hand;
    const hash = address.indexOf("#");
    const opened = await openHeldLink({ before: address.slice(0, hash), fragment: address.slice(hash + 1) }, getHand, {});
    const printable = await printableOf(opened, SITE, {});

    expect(printable.address.startsWith(`${SITE}/#`)).toBe(true);
    const digits = printable.address.slice(printable.address.indexOf("#") + 1);
    expect(digits).toMatch(/^[0-9]+$/);
    expect(printable.description).toEqual({ status: "attached", title: "A quiet room in Tbilisi", content: "Old town, a week from the 3rd.", inbox: `0x${"11".repeat(32)}` });

    const again = await openLink(fromText(digits), getHand, {});
    expect(again.seed).toBe(seed);
    expect(again.outside.statements).toEqual([]);
    const code = qrOf(printable.address, 40);
    expect(code.side).toBe(sideOf(code.version!));
  });

  test("a held bare link pasted alone opens as bare; a give link or a link without its seed is refused", async () => {
    const { seed, hand, chain } = handOf(`0x${"00".repeat(32)}`);
    const link = await encodeLive({ domain: chain, hand, signedShakes: [], seed }, {});
    const text = toAddress({ site: SITE, link, shape: "bare" });
    const opened = await openHeldLink({ before: "", fragment: text.slice(text.indexOf("#") + 1) }, async () => hand, {});
    expect(opened.seen.shape).toBe("bare");
    expect((await printableOf(opened, SITE, {})).description.status).toBe("none");
    await expect(printableOf({ ...opened, seed: undefined }, SITE, {})).rejects.toBeInstanceOf(NotPrintable);
  });
});

describe("the receipt variant", () => {
  test("?receipt=<chain>/<hand> names a Hand; anything else names none", () => {
    expect(receiptOfSearch("?receipt=31337/7")).toEqual({ chainId: 31337, handId: 7n });
    expect(receiptOfSearch("?receipt=31337/x")).toBeUndefined();
    expect(receiptOfSearch("")).toBeUndefined();
  });

  test("the passport's address leaves the canonical Core out and names any other", () => {
    expect(passportAddress(SITE, 31337, CORE, 7n, CORE)).toBe(`${SITE}/31337/7/proof`);
    expect(passportAddress(SITE, 31337, CORE, 7n)).toBe(`${SITE}/31337/${CORE.toLowerCase()}/7/proof`);
    expect(passportAddress(SITE, 31337, CORE, 7n, zeroAddress)).toBe(`${SITE}/31337/${CORE.toLowerCase()}/7/proof`);
  });
});

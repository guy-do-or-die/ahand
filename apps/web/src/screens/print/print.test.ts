import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { describeHand, domain, encodeLive, fromText, keyOfSeed, newSeed, openLink, packAttachments, toAddress, type Hand, type ReceiptRow } from "@ahand/sdk";
import { getAddress, zeroAddress } from "viem";
import { privateKeyToAddress } from "viem/accounts";

import { day } from "../../ui/format";
import { QR_QUIET_MODULES, qrOf } from "../../ui/qr-code";
import { CODE_MM, MIN_MODULE_MM, QUIET_MODULES, TAG_MAX_VERSION, fits, maxVersionOf, moduleMm, offered, sideOf } from "./fit";
import { NotPrintable, openHeldLink, passportAddress, printableOf, receiptOfSearch } from "./link";
import { closingOf, namesHand, paperDate } from "./head";
import en from "./en";
import ru from "./ru";

const CORE = getAddress("0x0f0555972388151D2C187f636A0855b6eE9B9685");
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
    const publicPart = described.publicPart && packAttachments(described.publicPart);
    const link = await encodeLive({ domain: chain, hand, signedShakes: [], seed, attachments: described.linkPart }, { publicPart });
    const address = toAddress({ site: SITE, link, shape: described.shape, publicPart: described.publicPart });
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
    expect(again.publicPart.statements).toEqual([]);
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

describe("the printed receipt's head", () => {
  const log = (eventName: ReceiptRow["eventName"], blockNumber: bigint): ReceiptRow => ({
    eventName,
    log: { eventName, args: {}, blockNumber, blockHash: `0x${"00".repeat(32)}`, transactionHash: `0x${"11".repeat(32)}`, logIndex: 0 },
  });

  test("it says how the Hand closed and in which block, from Core's closing row", () => {
    expect(closingOf([log("Thanked", 19n), log("Shaken", 19n), log("Given", 19n), log("Paid", 19n)])).toEqual({ how: "thanked", block: 19n });
    expect(closingOf([log("Refunded", 16n), log("Paid", 16n)])).toEqual({ how: "refunded", block: 16n });
    expect(closingOf([])).toBeUndefined();
  });

  test("a date on paper carries its year, in the same time zone as the day", () => {
    const second = Date.UTC(2026, 11, 30, 12) / 1000;
    expect(paperDate(second, (at) => day(at, "en", "UTC"), "UTC")).toBe("30 Dec 2026");
    expect(paperDate(second, (at) => day(at, "ru", "UTC"), "UTC")).toBe("30 дек 2026");
  });

  test("the question comes only from a held link that names this very Hand", () => {
    const head = { chainId: 31337, core: CORE, handId: 3n };
    expect(namesHand(head, 31337, CORE.toLowerCase(), 3n)).toBe(true);
    expect(namesHand(head, 31337, CORE, 4n)).toBe(false);
    expect(namesHand(head, 8453, CORE, 3n)).toBe(false);
    expect(namesHand({ ...head, core: zeroAddress }, 31337, CORE, 3n)).toBe(false);
    expect(namesHand(undefined, 31337, CORE, 3n)).toBe(false);
  });

  test("its words exist in both languages, in the wording of the review", () => {
    expect(en["print.header"]).toBe("Receipt · hand #{id}");
    expect(ru["print.header"]).toBe("Квитанция · рука №{id}");
    expect(en["print.closed.thanked"]).toBe("Thanked on {date}, block {block}");
    expect(ru["print.closed.thanked"]).toBe("Спасибо сказано {date}, блок {block}");
  });

  test("on paper the rows lose the dashed flip foot and the amount loses the chip's padding", () => {
    const css = readFileSync(new URL("../../design/print.css", import.meta.url), "utf8");
    const print = css.slice(css.indexOf("@media print"));
    expect(print).toMatch(/\.ah-print-sheet \.ah-receipt__what \{\s*text-decoration: none;/);
    expect(print).toMatch(/\.ah-print-sheet \.ah-receipt__amount--chip \{[^}]*padding: 0;/);
  });
});

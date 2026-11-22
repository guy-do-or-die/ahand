import { keccak256, stringToBytes, zeroHash, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { openAddress, toAddress, type AddressShape, type OpenedAddress } from "../src/address.js";
import { dataHashOf, normalizeText } from "../src/data.js";
import * as Sdk from "../src/index.js";
import * as App from "../src/app.js";
import { PUBLIC_PART_MAX_CHARS } from "../src/app.js";
import {
  DescriptionTooLarge,
  STATEMENT,
  canReshape,
  carryFor,
  describeHand,
  readDescription,
  readDescriptionOf,
  type DescribeMode,
} from "../src/describe.js";
import { LinkError, encodeLive, fromText, packAttachments, passOn, toText, type Attachments } from "../src/link.js";
import { ownDomain, ownHand, ownOptions, payeeAt, rootSeed as seed } from "./link-fixtures.js";

const SITE = "https://ahand.app";
const title = "Who can fix a 1978 Vespa in Lisbon?";
const content = "Mine stalls at idle.\r\nCarburettor cleaned twice; the spark looks fine. Café on me.";
const inbox: Hex = "0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const salt: Hex = keccak256(stringToBytes("salt of the describe tests"));

async function raise(mode: DescribeMode, words: { title?: string; content?: string } = {}) {
  const described = describeHand({ mode, title: words.title ?? title, content: words.content ?? content, inbox, salt: mode === "public" ? undefined : salt });
  const hand = ownHand(described.dataHash);
  const getHand = async () => hand;
  const publicPart = described.publicPart && packAttachments(described.publicPart);
  const link = await encodeLive({ domain: ownDomain, hand, signedShakes: [], seed, attachments: described.linkPart }, { ...ownOptions, publicPart });
  const address = toAddress({ site: SITE, link, shape: described.shape, publicPart: described.publicPart }, ownOptions);
  return { described, hand, getHand, link, address };
}

/** One pass, the way a holder makes it: keep the shape or go bare, carrying what `carryFor` says. */
async function passAs(opened: OpenedAddress, shape: AddressShape, position: number, dataHash?: Hex, attachments?: Attachments) {
  const carry = carryFor(opened, shape);
  const publicPart = carry.publicPart && packAttachments(carry.publicPart);
  const { link } = await passOn(
    opened,
    { payee: payeeAt(position), nextClaimBps: opened.end.claimBps - 100, dataHash },
    { ...ownOptions, publicPart },
    attachments ?? carry.linkPart,
  );
  return toAddress({ site: SITE, link, shape, publicPart: carry.publicPart }, ownOptions);
}

const fragmentOf = (address: string) => address.slice(address.indexOf("#") + 1);

describe("normalizeText", () => {
  it("brings text to NFC with LF line ends", () => {
    expect(normalizeText("Café")).toBe("Café");
    expect(normalizeText("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
    expect(normalizeText(normalizeText(content))).toBe(normalizeText(content));
  });
});

describe("describeHand", () => {
  it("public: the whole list and both texts in the public part, a described address, no salt", () => {
    const d = describeHand({ mode: "public", title, content, inbox });
    expect(d.shape).toBe("described");
    expect(d.linkPart).toBeUndefined();
    expect(d.salt).toBeUndefined();
    const [list] = d.publicPart!.statements!;
    expect(list.map(({ name }) => name).sort()).toEqual([STATEMENT.content, STATEMENT.inbox, STATEMENT.title].sort());
    expect(d.publicPart!.texts).toEqual([title, normalizeText(content)]);
    expect(d.dataHash).toBe(dataHashOf(list));
    expect(() => describeHand({ mode: "public", title, salt })).toThrow(/no salt/);
  });

  it("unlisted: the title and the hidden list's hash in the public part; details, salt and inbox in the link part", () => {
    const d = describeHand({ mode: "unlisted", title, content, inbox, salt });
    expect(d.shape).toBe("described");
    const [shown] = d.publicPart!.statements!;
    const [hidden] = d.linkPart!.statements!;
    expect(shown.map(({ name }) => name).sort()).toEqual([STATEMENT.private, STATEMENT.title]);
    expect(hidden.map(({ name }) => name).sort()).toEqual([STATEMENT.content, STATEMENT.inbox, STATEMENT.salt]);
    expect(shown.find(({ name }) => name === STATEMENT.private)!.value).toBe(dataHashOf(hidden));
    expect(d.publicPart!.texts).toEqual([title]);
    expect(d.linkPart!.texts).toEqual([normalizeText(content)]);
    expect(d.dataHash).toBe(dataHashOf(shown));
    expect(d.salt).toBe(salt);
  });

  it("dark: everything in the link part, with a salt, and a bare address", () => {
    const d = describeHand({ mode: "dark", title, content, inbox, salt });
    expect(d.shape).toBe("bare");
    expect(d.publicPart).toBeUndefined();
    const [list] = d.linkPart!.statements!;
    expect(list.map(({ name }) => name).sort()).toEqual([STATEMENT.content, STATEMENT.inbox, STATEMENT.salt, STATEMENT.title].sort());
    expect(d.linkPart!.texts).toEqual([title, normalizeText(content)]);
  });

  it("makes a fresh salt when none is given, so equal words give different hashes", () => {
    const a = describeHand({ mode: "dark", title, content });
    const b = describeHand({ mode: "dark", title, content });
    expect(a.salt).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.salt).not.toBe(b.salt);
    expect(a.dataHash).not.toBe(b.dataHash);
  });

  it("hashes the normalised words, whatever the device typed", () => {
    const typed = describeHand({ mode: "dark", title: "Café", content: "a\r\nb", salt });
    const clean = describeHand({ mode: "dark", title: "Café", content: "a\nb", salt });
    expect(typed.dataHash).toBe(clean.dataHash);
  });

  it("refuses an empty title and an inbox that is not 32 bytes; empty details count as none", () => {
    expect(() => describeHand({ mode: "dark", title: " \n " })).toThrow(/title/);
    expect(() => describeHand({ mode: "dark", title, inbox: "0x1234" })).toThrow(/32 bytes/);
    const bare = describeHand({ mode: "unlisted", title, content: "", salt });
    expect(bare.linkPart!.texts).toEqual([]);
    expect(bare.linkPart!.statements![0].map(({ name }) => name)).toEqual([STATEMENT.salt]);
  });
});

describe("the size of a public description: what a site's server takes before #", () => {
  const limits = { publicPartMaxChars: PUBLIC_PART_MAX_CHARS };
  /** The longest details, in ASCII letters, that a public description with this title still takes. */
  function longestPublic(): number {
    let low = 0;
    let high = 2 * PUBLIC_PART_MAX_CHARS;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      try {
        describeHand({ mode: "public", title, content: "a".repeat(mid), inbox }, limits);
        low = mid;
      } catch {
        high = mid - 1;
      }
    }
    return low;
  }

  it("is the application's 8 KiB limit on d, from @ahand/sdk/app; the protocol's entry has none", () => {
    expect(PUBLIC_PART_MAX_CHARS).toBe(8192);
    expect(App.PUBLIC_PART_MAX_CHARS).toBe(8192);
    expect("PUBLIC_PART_MAX_CHARS" in Sdk).toBe(false);
    expect(Sdk.DescriptionTooLarge).toBe(DescriptionTooLarge);
    // Without a limit, the same words are described: the limit is the site's, not the format's.
    expect(describeHand({ mode: "public", title, content: "a".repeat(20_000) }).publicPart!.texts).toHaveLength(2);
  });

  it("a public description at the limit is written; its d takes at most 8192 characters", async () => {
    const n = longestPublic();
    // 8192 characters of base64url are 6144 bytes: the texts, the list and their framing.
    expect(n).toBeGreaterThan(5_900);
    expect(n).toBeLessThan(6_144);
    const { address } = await raise("public", { content: "a".repeat(n) });
    const d = address.split("#")[0]!.split("?d=")[1]!;
    expect(d.length).toBeLessThanOrEqual(PUBLIC_PART_MAX_CHARS);
    expect(d.length).toBeGreaterThan(PUBLIC_PART_MAX_CHARS - 4);
  });

  it("one more byte of words throws DescriptionTooLarge with the size of d and the limit", () => {
    const n = longestPublic();
    let thrown: unknown;
    try {
      describeHand({ mode: "public", title, content: "a".repeat(n + 1), inbox }, limits);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DescriptionTooLarge);
    const tooLarge = thrown as DescriptionTooLarge;
    expect(tooLarge.name).toBe("DescriptionTooLarge");
    expect(tooLarge.max).toBe(PUBLIC_PART_MAX_CHARS);
    expect(tooLarge.chars).toBeGreaterThan(PUBLIC_PART_MAX_CHARS);
    expect(tooLarge.chars).toBeLessThanOrEqual(PUBLIC_PART_MAX_CHARS + 2);
  });

  it("counts bytes, not letters: 4,200 Cyrillic letters (8.4 kB) are refused in public", () => {
    expect(() => describeHand({ mode: "public", title, content: "ж".repeat(4_200) }, limits)).toThrow(DescriptionTooLarge);
  });

  it("unlisted and dark carry the same 50 kB of details: they ride after #", () => {
    const huge = "a".repeat(50_000);
    expect(describeHand({ mode: "unlisted", title, content: huge, salt }, limits).linkPart!.texts).toEqual([huge]);
    expect(describeHand({ mode: "dark", title, content: huge, salt }, limits).linkPart!.texts).toEqual([title, huge]);
  });
});

describe("each mode round-trips: describeHand → encodeLive → toAddress → openAddress → readDescription", () => {
  for (const mode of ["public", "unlisted", "dark"] as const) {
    it(`${mode}: the words arrive whole`, async () => {
      const { address, getHand, described } = await raise(mode);
      const opened = await openAddress(address, getHand, ownOptions);
      expect(opened.seen.shape).toBe(described.shape);
      expect(readDescription(opened)).toEqual({ status: "attached", title, content: normalizeText(content), inbox });
      // The same reader without an opened link: a Hand and what matched its dataHash.
      expect(readDescriptionOf(opened.hand, opened.ofHand)).toEqual(readDescription(opened));
      expect(readDescriptionOf({ dataHash: zeroHash }, opened.ofHand)).toEqual({ status: "none" });
    });

    it(`${mode}: three passes in the same shape keep the words`, async () => {
      const { address, getHand } = await raise(mode);
      let current = address;
      for (let position = 0; position < 3; ++position) {
        const opened = await openAddress(current, getHand, ownOptions);
        current = await passAs(opened, opened.seen.shape, position);
      }
      const last = await openAddress(current, getHand, ownOptions);
      expect(last.signedShakes.length).toBe(3);
      expect(readDescription(last).status).toBe("attached");
      expect(readDescription(last).title).toBe(title);
    });

    it(`${mode}: going bare carries everything in the link part, also as QR digits`, async () => {
      const { address, getHand } = await raise(mode);
      const bare = await passAs(await openAddress(address, getHand, ownOptions), "bare", 0);
      expect(bare.startsWith(`${SITE}/#`)).toBe(true);
      const opened = await openAddress(bare, getHand, ownOptions);
      expect(readDescription(opened)).toEqual({ status: "attached", title, content: normalizeText(content), inbox });
      const digits = toAddress({ site: SITE, link: fromText(fragmentOf(bare)), shape: "bare", form: "digits" }, ownOptions);
      expect(digits).toMatch(/^https:\/\/ahand\.app\/#[0-9]+$/);
      expect(readDescription(await openAddress(digits, getHand, ownOptions)).status).toBe("attached");
    });
  }

  it("unlisted: the link cut from its d is a LinkError", async () => {
    const { address, getHand } = await raise("unlisted");
    const cut = `${SITE}/#${fragmentOf(address)}`;
    await expect(openAddress(cut, getHand, ownOptions)).rejects.toBeInstanceOf(LinkError);
    await expect(openAddress(cut, getHand, ownOptions)).rejects.toMatchObject({ code: "unmatched-data" });
  });

  it("public: the link cut from its d still opens, and the words are lost", async () => {
    const { address, getHand } = await raise("public");
    const opened = await openAddress(`${SITE}/#${fragmentOf(address)}`, getHand, ownOptions);
    expect(readDescription(opened)).toEqual({ status: "lost" });
  });

  it("a link written without attachments: lost", async () => {
    for (const mode of ["unlisted", "dark"] as const) {
      const { hand, getHand } = await raise(mode);
      const link = await encodeLive({ domain: ownDomain, hand, signedShakes: [], seed }, ownOptions);
      const opened = await openAddress(toAddress({ site: SITE, link, shape: "bare" }, ownOptions), getHand, ownOptions);
      expect(readDescription(opened)).toEqual({ status: "lost" });
    }
  });

  it("unlisted with the link part dropped by a holder: lost, and the title that arrived is kept", async () => {
    const { address, getHand } = await raise("unlisted");
    const passed = await passAs(await openAddress(address, getHand, ownOptions), "described", 0, undefined, {});
    const opened = await openAddress(passed, getHand, ownOptions);
    expect(readDescription(opened)).toEqual({ status: "lost", title });
  });

  it("a Hand raised without a description: none", async () => {
    const hand = ownHand(zeroHash);
    const link = await encodeLive({ domain: ownDomain, hand, signedShakes: [], seed }, ownOptions);
    const opened = await openAddress(toAddress({ site: SITE, link, shape: "bare" }, ownOptions), async () => hand, ownOptions);
    expect(readDescription(opened)).toEqual({ status: "none" });
  });

  it("reads only what hangs on the Hand: a holder's own list with a title is not the description", async () => {
    const { address, getHand } = await raise("dark");
    const opened = await openAddress(address, getHand, ownOptions);
    const forged = [{ name: STATEMENT.title, value: keccak256(stringToBytes("Send me the reward")) }];
    const carry = carryFor(opened, "bare");
    const attachments = { statements: [...carry.linkPart.statements!, forged], texts: [...carry.linkPart.texts!, "Send me the reward"] };
    const passed = await passAs(opened, "bare", 0, dataHashOf(forged), attachments);
    const next = await openAddress(passed, getHand, ownOptions);
    expect(next.texts).toContain("Send me the reward");
    expect(readDescription(next).title).toBe(title);
  });
});

describe("canReshape and carryFor", () => {
  it("allows the same shape or bare, never lighter", () => {
    const shapes: AddressShape[] = ["bare", "numbered", "described"];
    const allowed = shapes.flatMap((from) => shapes.filter((to) => canReshape(from, to)).map((to) => `${from}→${to}`));
    expect(allowed.sort()).toEqual(["bare→bare", "described→bare", "described→described", "numbered→bare", "numbered→numbered"]);
  });

  it("refuses to write a bare link as a described address", async () => {
    const { address, getHand } = await raise("dark");
    const opened = await openAddress(address, getHand, ownOptions);
    expect(() => carryFor(opened, "described")).toThrow(/cannot be passed on described/);
  });

  it("keeps d as it came when the shape is kept", async () => {
    const { address, getHand } = await raise("unlisted");
    const opened = await openAddress(address, getHand, ownOptions);
    const carry = carryFor(opened, "described");
    expect(toText(packAttachments(carry.publicPart))).toBe(address.slice(address.indexOf("?d=") + 3, address.indexOf("#")));
  });
});

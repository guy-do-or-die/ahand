import { describe, expect, it } from "vitest";
import { bytesToHex, stringToBytes, zeroHash } from "viem";

import {
  LinkError,
  dataHashOf,
  encodeLive,
  faceOf,
  openAddress,
  openLink,
  openOutside,
  packAttachments,
  passOn,
  seenIn,
  textValue,
  toAddress,
  toText,
  type Hand,
  type LinkErrorCode,
  type Statement,
} from "../src/index.js";
import { describeHand, ownDomain, ownHand, ownOptions, payeeAt, rootSeed, testSalt, type Described, type Visibility } from "./link-fixtures.js";

/**
 * The link inside a web address, and the three ways a Hand is shown: public, unlisted and dark.
 * What a site sees before `#`, what a reader gets, what survives passing on, what is refused.
 */

const SITE = "https://ahand.app";
const title = "Кто починит Vespa 1978 года в Лиссабоне?";
const content = "Нужен мастер по двухтактным моторам, готовый приехать в Алфаму. Мотор глохнет на холостых.";

async function code(run: Promise<unknown> | (() => unknown)): Promise<LinkErrorCode | "opened" | string> {
  try {
    await (typeof run === "function" ? run() : run);
    return "opened";
  } catch (error) {
    return error instanceof LinkError ? error.code : `not a LinkError: ${(error as Error).name}`;
  }
}

interface Raised {
  described: Described;
  hand: Hand;
  getHand: () => Promise<Hand>;
  /** The Hand's first live link, and its address in the shape of its option. */
  link: Uint8Array;
  address: string;
}

async function raise(visibility: Visibility, handId = 123_456n): Promise<Raised> {
  const described = describeHand(visibility, title, content, testSalt(visibility));
  const hand = ownHand(described.dataHash, handId);
  // What rides before `#` is given to the encoder too: in the unlisted option the part inside the
  // link is checked through the part outside it.
  const outside = described.outside ? packAttachments(described.outside) : undefined;
  const link = await encodeLive(
    { domain: ownDomain, hand, signedShakes: [], seed: rootSeed, attachments: described.inside },
    { ...ownOptions, outside },
  );
  const address = toAddress({ site: SITE, link, shape: described.shape, outside: described.outside }, ownOptions);
  return { described, hand, getHand: async () => hand, link, address };
}

const beforeHash = (address: string) => address.slice(0, address.indexOf("#"));
const fromHash = (address: string) => address.slice(address.indexOf("#"));

describe("dark: nothing is seen before #", () => {
  it("shows a site nothing, and gives the reader the whole description", async () => {
    const { address, getHand, hand } = await raise("dark");
    expect(beforeHash(address)).toBe(`${SITE}/`);
    expect(await faceOf(address, getHand, ownOptions)).toEqual({ seen: { shape: "bare" } });

    const opened = await openAddress(address, getHand, ownOptions);
    expect([...opened.texts].sort()).toEqual([title, content].sort());
    expect(opened.outside).toEqual({ statements: [], texts: [] });
    expect(dataHashOf(opened.statements[0])).toBe(hand.dataHash);
  });

  it("keeps the dataHash on the chain from confirming a guess", async () => {
    const { hand } = await raise("dark");
    // Someone who guessed both texts still cannot rebuild the dataHash: the salt is not theirs.
    const guessed = [
      { name: "title", value: textValue(title) },
      { name: "content", value: textValue(content) },
    ];
    expect(dataHashOf(guessed)).not.toBe(hand.dataHash);
    expect(dataHashOf([...guessed, { name: "salt", value: zeroHash }])).not.toBe(hand.dataHash);
    // Without a salt the same guess is confirmed: this is what a public Hand's dataHash allows.
    expect(dataHashOf(guessed)).toBe((await raise("public")).hand.dataHash);
  });
});

describe("unlisted: the title is seen, the rest is not", () => {
  it("lets a site show the title, checked against Core's dataHash, and nothing more", async () => {
    const { address, getHand, described } = await raise("unlisted");
    const seen = beforeHash(address);
    expect(seen.startsWith(`${SITE}/8453/123456?d=`)).toBe(true);
    const site = await faceOf(address, getHand, ownOptions);
    expect(site.face!.texts).toEqual([title]);
    expect(dataHashOf(site.face!.statements[0])).toBe(described.dataHash);
    expect(site.face!.statements[0].map(({ name }) => name)).toEqual(["private", "title"]);
    // The content is not before `#` in any form: not its text, and not a hash a guess could be tried against.
    const open = bytesToHex(seenIn(seen, ownOptions).data!);
    expect(open.includes(bytesToHex(stringToBytes(content)).slice(2))).toBe(false);
    expect(open.includes(textValue(content).slice(2))).toBe(false);
  });

  it("gives the reader both parts, and says which travelled where", async () => {
    const { address, getHand } = await raise("unlisted");
    const opened = await openAddress(address, getHand, ownOptions);
    expect([...opened.texts].sort()).toEqual([title, content].sort());
    expect(opened.outside.texts).toEqual([title]);
    expect(opened.inside.texts).toEqual([content]);
    expect(opened.statements.length).toBe(2);
    // Both hang on the Hand's own dataHash, the second through the first: both are the Hand's.
    expect([...opened.ofHand.texts].sort()).toEqual([title, content].sort());
  });

  it("refuses a title that is not the Hand's, at the site and at the reader", async () => {
    const { address, getHand, described } = await raise("unlisted");
    const link = fromHash(address);
    const forged = packAttachments({ statements: described.outside!.statements, texts: ["Раздаём 1000 USDC каждому"] });
    const lying = `${SITE}/8453/123456?d=${toText(forged)}${link}`;
    expect(await code(faceOf(lying, getHand, ownOptions))).toBe("unmatched-data");
    expect(await code(openAddress(lying, getHand, ownOptions))).toBe("unmatched-data");

    // A whole face made for the lie: its list is not behind the dataHash Core keeps.
    const other = describeHand("unlisted", "Раздаём 1000 USDC каждому", content, testSalt("unlisted"));
    const swapped = `${SITE}/8453/123456?d=${toText(packAttachments(other.outside))}${link}`;
    expect(await code(faceOf(swapped, getHand, ownOptions))).toBe("unmatched-data");
    expect(await code(openAddress(swapped, getHand, ownOptions))).toBe("unmatched-data");
  });

  it("refuses an address that shows one Hand and carries a link for another", async () => {
    const first = await raise("unlisted", 123_456n);
    const second = await raise("unlisted", 123_457n);
    // The site would show the first Hand; the link is for the second, with the same description.
    const crossed = `${beforeHash(first.address)}${fromHash(second.address)}`;
    expect(await code(openAddress(crossed, second.getHand, ownOptions))).toBe("another-hand");
  });

  it("refuses the same attachment in both places", async () => {
    const { described, hand, getHand } = await raise("unlisted");
    const link = await encodeLive(
      { domain: ownDomain, hand, signedShakes: [], seed: rootSeed, attachments: { statements: described.outside!.statements } },
      ownOptions,
    );
    const address = toAddress({ site: SITE, link, shape: "faced", outside: described.outside }, ownOptions);
    expect(await code(openAddress(address, getHand, ownOptions))).toBe("non-canonical");
  });

  it("does not open the link alone, cut off from its public part", async () => {
    const { address, getHand } = await raise("unlisted");
    expect(await code(openAddress(`${SITE}/${fromHash(address)}`, getHand, ownOptions))).toBe("unmatched-data");
  });

  it("does not let the private part be confirmed from the public one", async () => {
    const { described } = await raise("unlisted");
    const hidden = described.outside!.statements![0].find(({ name }) => name === "private")!.value;
    expect(dataHashOf([{ name: "content", value: textValue(content) }])).not.toBe(hidden);
  });

  it("does not take the public part cut anywhere", async () => {
    const { described, hand } = await raise("unlisted");
    const outside = packAttachments(described.outside);
    expect(openOutside(outside, hand).texts).toEqual([title]);
    for (let length = 0; length < outside.length; ++length) {
      expect(await code(() => openOutside(outside.slice(0, length), hand))).not.toBe("opened");
    }
  });
});

describe("public: the number is seen, the description is published", () => {
  it("shows a site the Hand's number; the description comes from where the board is", async () => {
    const { address, getHand, hand, described } = await raise("public");
    expect(beforeHash(address)).toBe(`${SITE}/8453/123456`);
    const site = await faceOf(address, getHand, ownOptions);
    expect(site.seen.shape).toBe("numbered");
    expect(site.face).toBeUndefined();

    const opened = await openAddress(address, getHand, ownOptions);
    expect(opened.texts).toEqual([]);
    // The board answers with the published attachments; they are checked like any others.
    const published = openOutside(packAttachments(described.published), hand);
    expect([...published.texts].sort()).toEqual([title, content].sort());
    expect(await code(() => openOutside(packAttachments({ ...described.published, texts: ["another question"] }), hand))).toBe("unmatched-data");
  });

  it("is open: the board's entry is the first live link, and anyone may take it on", async () => {
    const { address, getHand } = await raise("public");
    const opened = await openAddress(address, getHand, ownOptions);
    const { link } = await passOn(opened, { payee: payeeAt(0), nextClaimBps: 9_000 }, ownOptions);
    expect((await openLink(link, getHand, ownOptions)).signedShakes.length).toBe(1);
  });
});

describe("every option", () => {
  for (const visibility of ["public", "unlisted", "dark"] as const) {
    it(`${visibility}: three passes keep the route, the shape and the description`, async () => {
      const { address, getHand, described } = await raise(visibility);
      let current = address;
      for (let position = 0; position < 3; ++position) {
        const opened = await openAddress(current, getHand, ownOptions);
        const { link } = await passOn(
          opened,
          { payee: payeeAt(position), nextClaimBps: opened.end.claimBps - 100 },
          { ...ownOptions, outside: opened.seen.data },
        );
        // The holder writes the same shape it was given, with the same public part.
        const outside = opened.seen.shape === "faced" ? opened.outside : undefined;
        current = toAddress({ site: SITE, link, shape: opened.seen.shape, outside }, ownOptions);
      }
      const last = await openAddress(current, getHand, ownOptions);
      expect(last.signedShakes.length).toBe(3);
      expect(last.seen.shape).toBe(described.shape);
      expect([...last.texts].sort()).toEqual(visibility === "public" ? [] : [title, content].sort());
      expect(beforeHash(current)).toBe(beforeHash(address));
    });

    it(`${visibility}: the QR form is the bare address with everything inside, in digits`, async () => {
      const { hand, getHand, described } = await raise(visibility);
      const everything = {
        statements: [...(described.outside?.statements ?? []), ...(described.inside?.statements ?? [])],
        texts: [...(described.outside?.texts ?? []), ...(described.inside?.texts ?? [])],
      };
      const link = await encodeLive({ domain: ownDomain, hand, signedShakes: [], seed: rootSeed, attachments: everything }, ownOptions);
      const address = toAddress({ site: SITE, link, shape: "bare", form: "digits" }, ownOptions);
      expect(/^https:\/\/ahand\.app\/#[0-9]+$/.test(address)).toBe(true);
      const opened = await openAddress(address, getHand, ownOptions);
      expect([...opened.texts].sort()).toEqual(visibility === "public" ? [] : [title, content].sort());
    });
  }

  it("skips query parameters that are not its own, and refuses its own written twice or loosely", async () => {
    const { address, getHand } = await raise("unlisted");
    const [seen, link] = [beforeHash(address), fromHash(address)];
    expect(await code(openAddress(`${seen}&fbclid=IwAR0abc&utm_source=tg${link}`, getHand, ownOptions))).toBe("opened");
    expect(await code(openAddress(`${seen}&d=AQ${link}`, getHand, ownOptions))).toBe("non-canonical");
    expect(await code(openAddress(seen.replace("/8453/123456", "/8453/0123456") + link, getHand, ownOptions))).toBe("non-canonical");
    expect(await code(openAddress(seen.replace("/8453/123456", "") + link, getHand, ownOptions))).toBe("malformed");
    expect(await code(openAddress(seen, getHand, ownOptions))).toBe("malformed");
  });

  it("has one spelling, and what is not an address is refused as a link error", async () => {
    const { address, getHand, described, link } = await raise("unlisted");
    expect(await code(openAddress(address, getHand, ownOptions))).toBe("opened");
    const [before, after] = [beforeHash(address), fromHash(address)];
    const d = before.slice(before.indexOf("?d=") + 3);
    const spellings = [
      before.replace("/8453/", "//8453/./"),
      before.replace("/8453/", "/8453//"),
      before.replace("/8453/", "/x/../8453/").replace("/123456", "/1234\t56"),
      ` ${before}`,
      before.replace("/8453/123456", "\\8453\\123456"),
      before.replace("?d=", "?%64="),
      before.replace(d, d.replace("A", "%41")),
      before.replace("/8453/", "/08453/"),
    ];
    for (const spelling of spellings) expect(await code(openAddress(spelling + after, getHand, ownOptions))).not.toBe("opened");
    for (const junk of ["ahand.app/#E", "#E", "https://#E", "/8453/123456#E", ""]) {
      expect((await code(openAddress(junk, getHand, ownOptions))).startsWith("not a LinkError")).toBe(false);
      expect((await code(faceOf(junk, getHand, ownOptions))).startsWith("not a LinkError")).toBe(false);
    }
    // A site with a path of its own is written and read.
    const deep = toAddress({ site: "https://example.org/hands", link, shape: "faced", outside: described.outside }, ownOptions);
    expect(await code(openAddress(deep, getHand, ownOptions))).toBe("opened");
    expect(seenIn("https://example.org/hands/", ownOptions).shape).toBe("bare");
  });

  it("names the Hand of its link, the canonical Core by leaving its address out, and shows only what its shape shows", async () => {
    const hand = ownHand();
    const getHand = async () => hand;
    const bare = await encodeLive({ domain: ownDomain, hand, signedShakes: [], seed: rootSeed }, ownOptions);
    const text = toText(bare);
    const core = ownDomain.verifyingContract.toLowerCase();
    expect(await code(openAddress(`${SITE}/#${text}`, getHand, ownOptions))).toBe("opened");
    expect(await code(openAddress(`https://ahand .app/#${text}`, getHand, ownOptions))).toBe("malformed");
    expect(await code(openAddress(`${SITE}/8453/123456#${text}`, getHand, ownOptions))).toBe("opened");
    expect(await code(openAddress(`${SITE}/8453/123457#${text}`, getHand, ownOptions))).toBe("another-hand");
    expect(await code(openAddress(`${SITE}/1/123456#${text}`, getHand, ownOptions))).toBe("another-hand");
    // The canonical Core written out; a reader that knows none takes it written, in lower case only.
    expect(await code(openAddress(`${SITE}/8453/${core}/123456#${text}`, getHand, ownOptions))).toBe("non-canonical");
    const written = await encodeLive({ domain: ownDomain, hand, signedShakes: [], seed: rootSeed }, {});
    expect(toAddress({ site: SITE, link: written, shape: "numbered" }, {})).toBe(`${SITE}/8453/${core}/123456#${toText(written)}`);
    expect(await code(openAddress(`${SITE}/8453/${core}/123456#${toText(written)}`, getHand, {}))).toBe("opened");
    expect(await code(openAddress(`${SITE}/8453/${core.replace("c0de", "C0DE")}/123456#${toText(written)}`, getHand, {}))).toBe("non-canonical");
    expect(await code(openAddress(`${SITE}/8453/123456#${toText(written)}`, getHand, {}))).toBe("unsupported");
    // An address that names one Core and carries a link for another.
    const other = `0x${"ab".repeat(20)}`;
    expect(await code(openAddress(`${SITE}/8453/${other}/123456#${toText(written)}`, getHand, {}))).toBe("another-hand");
    expect(await code(openAddress(`${SITE}/8453/${other}/123456#${text}`, getHand, ownOptions))).toBe("another-hand");
    // A public part without the Hand it belongs to; a site answering with another Hand.
    const lie = "Раздаём 1000 USDC";
    const forged: Statement[] = [{ name: "title", value: textValue(lie) }];
    const outside = packAttachments({ statements: [forged], texts: [lie] });
    expect(await code(openAddress(`${SITE}/?d=${toText(outside)}#${text}`, getHand, ownOptions))).toBe("malformed");
    expect(await code(faceOf(`${SITE}/8453/123456`, async () => ownHand(undefined, 7n), ownOptions))).toBe("another-hand");
    // Each shape is written with what it shows, and with nothing else.
    const shown = { statements: [forged], texts: [lie] };
    expect(await code(() => toAddress({ site: SITE, link: bare, shape: "bare", outside: shown }, ownOptions))).toBe("malformed");
    expect(await code(() => toAddress({ site: SITE, link: bare, shape: "numbered", outside: shown }, ownOptions))).toBe("malformed");
    expect(await code(() => toAddress({ site: SITE, link: bare, shape: "faced" }, ownOptions))).toBe("malformed");
    expect(await code(() => toAddress({ site: SITE, link: bare, shape: "faced", outside: {} }, ownOptions))).toBe("malformed");
  });
});

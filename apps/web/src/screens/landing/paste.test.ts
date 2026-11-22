import { describe, expect, test } from "bun:test";

import { readPaste } from "./paste";

const HERE = "http://127.0.0.1:18361";
const LINK = "AQIDBAUGBwgJCgsMDQ4PEA";
const CORE = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

describe("readPaste: what the landing's box was given", () => {
  test("nothing, or only white space", () => {
    expect(readPaste("", HERE)).toEqual({ kind: "empty" });
    expect(readPaste("  \n ", HERE)).toEqual({ kind: "empty" });
  });

  test("a bare link, in base64url or as QR digits, opens on / as the Hand view", () => {
    expect(readPaste(` ${LINK}\n`, HERE)).toEqual({ kind: "link", fragment: LINK });
    expect(readPaste("123456789012345678901234567890", HERE)).toEqual({ kind: "link", fragment: "123456789012345678901234567890" });
    expect(readPaste(`#${LINK}`, HERE)).toEqual({ kind: "link", fragment: LINK });
  });

  test("an address on this site keeps its path and its d, and is not foreign", () => {
    expect(readPaste(`${HERE}/31337/12?d=AbC_d-#${LINK}`, HERE)).toEqual({
      kind: "address",
      before: `${HERE}/31337/12?d=AbC_d-`,
      fragment: LINK,
      to: "/31337/12?d=AbC_d-",
      host: "127.0.0.1:18361",
      foreign: false,
    });
  });

  test("a bare address opens on / and keeps the site before #", () => {
    expect(readPaste(`${HERE}/#${LINK}`, HERE)).toEqual({ kind: "address", before: `${HERE}/`, fragment: LINK, to: "/", host: "127.0.0.1:18361", foreign: false });
  });

  test("an address made for another site is said to be foreign and is opened here, under this site", () => {
    const read = readPaste(`https://elsewhere.example/app/31337/${CORE}/7?x=1&d=QQ#${LINK}`, HERE);
    expect(read).toEqual({
      kind: "address",
      before: `${HERE}/31337/${CORE}/7?d=QQ`,
      fragment: LINK,
      to: `/31337/${CORE}/7?d=QQ`,
      host: "elsewhere.example",
      foreign: true,
    });
  });

  test("an address without a scheme, as messengers show it, is read as https", () => {
    const read = readPaste(`elsewhere.example/#${LINK}`, HERE);
    expect(read).toMatchObject({ kind: "address", host: "elsewhere.example", foreign: true, to: "/", fragment: LINK });
  });

  test("a numbered address with no link opens the Hand's public view", () => {
    expect(readPaste(`${HERE}/31337/12`, HERE)).toEqual({ kind: "public", to: "/31337/12", host: "127.0.0.1:18361", foreign: false });
  });

  test("anything else is not a link, and nothing is kept", () => {
    expect(readPaste("hello there", HERE)).toEqual({ kind: "bad" });
    expect(readPaste(`${HERE}/about#${LINK}`, HERE)).toEqual({ kind: "bad" });
    expect(readPaste(`${HERE}/`, HERE)).toEqual({ kind: "bad" });
    expect(readPaste("ftp://x.example/#link", HERE)).toEqual({ kind: "bad" });
    expect(readPaste(`${HERE}/31337/12#`, HERE)).toEqual({ kind: "public", to: "/31337/12", host: "127.0.0.1:18361", foreign: false });
  });
});

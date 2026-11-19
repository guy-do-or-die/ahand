import { describe, expect, it } from "vitest";
import { pad, type Hex } from "viem";

import vectors from "../../../contracts/test/fixtures/sdk-vectors.json" with { type: "json" };
import { DATA_FORMAT, dataHashOf, isDataOf, nameOf, textValue, type Statement } from "../src/index.js";

/** The list and its hash as Solidity computes them: written by contracts/test/SdkVectors.t.sol. */
const statements = vectors.data.statements as Statement[];
const alice = statements[0].value;

describe("a list of statements behind a dataHash", () => {
  it("hashes to what abi.encode(format, names, values) hashes to in Solidity", () => {
    expect(DATA_FORMAT).toBe(vectors.data.format);
    expect(dataHashOf(statements)).toBe(vectors.data.dataHash);
    expect(statements.map(({ name }) => name)).toEqual(["author", "content", "judge", "series"]);
  });

  it("the value of the statement about the ask's text is the text's hash", () => {
    expect(textValue("Who can fix a 1978 Vespa in Lisbon?")).toBe(statements[1].value);
  });

  it("is the same in whatever order the statements are given", () => {
    expect(dataHashOf([...statements].reverse())).toBe(dataHashOf(statements));
  });

  it("changes with any name, any value and with a statement more or less", () => {
    const base = dataHashOf(statements);
    expect(dataHashOf([{ ...statements[0], value: pad("0x08") as Hex }, ...statements.slice(1)])).not.toBe(base);
    expect(dataHashOf([{ ...statements[0], name: "serie" }, ...statements.slice(1)])).not.toBe(base);
    expect(dataHashOf(statements.slice(1))).not.toBe(base);
  });

  it("refuses a name that stands twice", () => {
    expect(() => dataHashOf([...statements, { name: "judge", value: alice }])).toThrow();
    expect(isDataOf(dataHashOf(statements), [...statements, { name: "judge", value: alice }])).toBe(false);
  });

  it("is checked whole: a part of the list is not the list", () => {
    const hash = dataHashOf(statements);
    expect(isDataOf(hash, statements)).toBe(true);
    expect(isDataOf(hash, statements.slice(0, 3))).toBe(false);
  });

  it("an empty list has a hash of its own, not zero", () => {
    expect(dataHashOf([])).toMatch(/^0x[0-9a-f]{64}$/);
    expect(dataHashOf([])).not.toBe(pad("0x00"));
  });

  it("names are 1 to 32 bytes of text", () => {
    expect(nameOf("author")).toBe("0x617574686f720000000000000000000000000000000000000000000000000000");
    expect(() => nameOf("")).toThrow();
    expect(() => nameOf("a".repeat(33))).toThrow();
  });

  it("takes no name with a zero character: padded, it would be another name's twin", () => {
    expect(() => nameOf("content\u0000")).toThrow();
    expect(() => nameOf("con\u0000tent")).toThrow();
    expect(() => dataHashOf([{ name: "content\u0000", value: textValue("x") }])).toThrow();
  });
});

describe("the value of a statement about a text", () => {
  it("does not depend on line ends or on how an accented letter was typed", () => {
    expect(textValue("line one\r\nline two")).toBe(textValue("line one\nline two"));
    expect(textValue("café")).toBe(textValue("café"));
    expect(textValue("a")).not.toBe(textValue("b"));
  });
});

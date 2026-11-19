import { encodeAbiParameters, keccak256, stringToBytes, stringToHex, type Hex } from "viem";

/**
 * What stands behind a `dataHash`: a list of named statements, (name, value), sorted by name and
 * hashed whole under a format tag:
 *
 *   dataHash = keccak256(abi.encode(DATA_FORMAT, names, values))
 *
 * Core never reads it: this is an agreement between applications and readers. A reader is given
 * the whole list, checks it against the `dataHash` Core keeps or the signatures cover, and then
 * reads the one statement it cares about. Because the list is whole and sorted, a name cannot
 * stand twice and a missing name is seen to be missing.
 *
 * How it can be improved later without breaking Hands already raised: new statements are new
 * names, which old readers skip; a new way of arranging the statements, a tree for example, is a
 * new format tag, and a `dataHash` made under one tag can never be read as one made under another.
 * A Hand keeps the format it was raised with; a reader that should read both knows both tags.
 *
 * The formula is written out in Solidity too (contracts/test/SdkVectors.t.sol) and this code is
 * checked against it.
 */

/** The tag of this way of arranging statements. */
export const DATA_FORMAT: Hex = keccak256(stringToBytes("aHand.data/1"));

/** One statement: a name of up to 32 bytes of text, and a 32-byte value. */
export interface Statement {
  name: string;
  value: Hex;
}

/** A name as it is hashed: its text, padded on the right to 32 bytes. */
export function nameOf(text: string): Hex {
  if (stringToBytes(text).length === 0 || stringToBytes(text).length > 32) {
    throw new Error(`a statement's name is 1 to 32 bytes of text: "${text}"`);
  }
  return stringToHex(text, { size: 32 });
}

/** The `dataHash` of a list of statements, in any order; a name that stands twice is refused. */
export function dataHashOf(statements: readonly Statement[]): Hex {
  const sorted = statements
    .map(({ name, value }) => ({ name: nameOf(name), value }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (let index = 1; index < sorted.length; ++index) {
    if (sorted[index].name === sorted[index - 1].name) throw new Error("a statement's name stands twice");
  }
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32[]" }, { type: "bytes32[]" }],
      [DATA_FORMAT, sorted.map(({ name }) => name), sorted.map(({ value }) => value)],
    ),
  );
}

/** Whether `statements` is the whole list behind `dataHash`. */
export function isDataOf(dataHash: Hex, statements: readonly Statement[]): boolean {
  try {
    return dataHashOf(statements).toLowerCase() === dataHash.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * The value of a statement about a text: the hash of the text as everyone will see it, whatever
 * the device it was typed on. The text is brought to Unicode form NFC and its line ends to LF.
 */
export function textValue(text: string): Hex {
  return keccak256(stringToBytes(text.normalize("NFC").replace(/\r\n?/g, "\n")));
}

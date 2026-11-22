/**
 * `recover`: rebuild a Hand's root key from the raiser's keys signature and the device's book
 *.
 *
 * The signature is read from standard input, never from an argument, so it does not land in the
 * shell's history or in the process list. The default output says only whether a number n was
 * found and the first characters of the root key it gives; the live link itself is printed only
 * with --print-link, under a warning. What it cannot give back: the Hand's words, which were
 * never on chain in any mode; they travel only in the saved link.
 */
import { isAddressEqual, isHex, recoverTypedDataAddress, size, type Hex } from "viem";

import { toAddress } from "../../packages/sdk/src/address.ts";
import { chainNow, readHand } from "../../packages/sdk/src/chain.ts";
import { BOOK_BYTES, MATCH_ROOT_MAX_N, keysTypedData, masterOf, matchRoot, rootSeedOf } from "../../packages/sdk/src/keys.ts";
import { encodeLive, toText } from "../../packages/sdk/src/link.ts";
import { domain } from "../../packages/sdk/src/types.ts";
import { Fail, clean, connect, group, handIdOf, trustedCore, wholeFlag, type Args } from "./cli.ts";

const USAGE = "recover --book HEX [--max N] --rpc URL [--core 0x...] <handId> [--print-link [--site URL]] < signature";
const MAX_SEARCH = 1_000_000;

/** The book: 8 bytes, as 16 hex characters with or without 0x (the code the first device shows). */
export function bookOf(text: string | undefined): Hex {
  if (!text) throw new Fail(`give the device's book: ${USAGE}`, 2);
  const hex = (text.startsWith("0x") || text.startsWith("0X") ? `0x${text.slice(2)}` : `0x${text}`) as Hex;
  if (!isHex(hex, { strict: true }) || size(hex) !== BOOK_BYTES) throw new Fail(`--book is ${BOOK_BYTES} bytes: ${BOOK_BYTES * 2} hex characters`, 2);
  return hex.toLowerCase() as Hex;
}

/** The keys signature from standard input: hex, with or without 0x, surrounding white space ignored. */
async function signatureFromStdin(): Promise<Hex> {
  if (process.stdin.isTTY) console.error("paste the signature of the keys message, then press Enter and Ctrl-D (it is not echoed anywhere else):");
  const text = (await Bun.stdin.text()).trim();
  if (!text) throw new Fail("no signature on standard input: pipe it in (for example: pbpaste | bun tools/ahand.ts recover ...)", 2);
  const hex = (text.startsWith("0x") ? text : `0x${text}`) as Hex;
  if (!isHex(hex, { strict: true }) || size(hex) === 0) throw new Fail("standard input is not a signature: hex bytes expected", 2);
  return hex;
}

export async function recoverCommand(args: Args): Promise<number> {
  const handId = handIdOf(args.positional[0], USAGE);
  const book = bookOf(args.flags.get("--book"));
  const max = wholeFlag(args, "--max", MATCH_ROOT_MAX_N, 0, MAX_SEARCH);
  const printLink = args.flags.has("--print-link");
  const site = args.flags.get("--site");
  if (site !== undefined) {
    if (!printLink) throw new Fail("--site only shapes the link that --print-link prints", 2);
    if (!/^https?:\/\/[^/\s#?]+(\/[^\s#?]*)?$/.test(site) || site.endsWith("/")) throw new Fail("--site is a web address with no slash at the end, such as https://example.org", 2);
  }
  const chain = (await connect(args, true))!;
  const trusted = trustedCore(args, chain.chainId);
  const signature = await signatureFromStdin();

  let read;
  try {
    read = await readHand(chain.client, trusted.core, handId);
  } catch (error) {
    throw new Fail(`could not read Hand ${handId} on Core ${trusted.core}: ${clean(error instanceof Error ? error.message.split("\n")[0]! : String(error), 300)}`);
  }
  const { coreHand, hand } = read;
  if (coreHand.openedAt === 0) throw new Fail(`Hand ${handId} is not raised on Core ${trusted.core} (chain ${chain.chainId})`);

  // A key's signature names its signer: say so at once when it is not the raiser's.
  let signerNote = "";
  if (size(signature) === 65) {
    try {
      const signer = await recoverTypedDataAddress({ ...keysTypedData(chain.chainId, trusted.core, coreHand.raiser), signature });
      if (!isAddressEqual(signer, coreHand.raiser)) signerNote = ` The signature is a key's, and that key is ${signer}, not the raiser ${coreHand.raiser}.`;
    } catch {
      // not a recoverable key signature: an account's own, used as it came
    }
  }

  let master: Hex;
  try {
    master = await masterOf(signature, { chainId: chain.chainId, core: trusted.core, raiser: coreHand.raiser });
  } catch {
    throw new Fail(`the signature is not the raiser's own key's signature of the keys message for this Core and chain, and keys are made only from that one.${signerNote}`);
  }
  console.error(`recover: searching Hand numbers 0 to ${group(max)} of book ${book} for Hand ${handId}'s root key...`);
  const n = await matchRoot(master, book, coreHand.rootKey, max);
  if (n === undefined) {
    throw new Fail(
      `no n from 0 to ${group(max)} in book ${book} gives the root key of Hand ${handId}: the signature, the book or the Core differs from the raise, or n is above --max.${signerNote}`,
    );
  }
  const now = await chainNow(chain.client);
  const out = [
    `found: n = ${n} in book ${book}`,
    `root key ${coreHand.rootKey.slice(0, 10)}… is Hand ${handId}'s (first characters only)`,
    `the Hand is ${read.stateAt(now.timestamp)} by block ${now.number}`,
  ];
  if (!printLink) {
    out.push("the live link is not printed; add --print-link to print it (it is the Hand's link: whoever has it can pass it on)");
    console.log(out.join("\n"));
    return 0;
  }

  const seed = await rootSeedOf(master, book, n);
  const link = await encodeLive({ domain: domain(chain.chainId, trusted.core), hand, signedShakes: [], seed }, { canonicalCore: trusted.core });
  const written = site ? toAddress({ site, link, shape: "bare" }, { canonicalCore: trusted.core }) : toText(link);
  console.log(out.join("\n"));
  console.error("");
  console.error("WARNING: the next line is this Hand's live link. Whoever has it can pass the Hand on and sign as its first holder.");
  console.error("Share it only as you would the original. Its words did not come back: they were never on chain; the saved link has them.");
  if (!site) console.error("It is the link alone; any aHand site opens it as <site>/#<link>.");
  console.log(written);
  return 0;
}

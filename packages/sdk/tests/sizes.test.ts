import { keccak256, stringToBytes, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { openAddress, toAddress, type OpenedAddress } from "../src/address.js";
import { carryFor, describeHand, readDescription, type DescribeMode } from "../src/describe.js";
import { encodeLive, packAttachments, passOn, toDigits } from "../src/link.js";
import { ownDomain, ownHand, ownOptions, payeeAt, rootSeed as seed } from "./link-fixtures.js";

/**
 * How big links and addresses get, for docs/links.md: the three modes at 0, 1, 3, 6 and 10 paid
 * Shakes (a payee and a 1% margin each), with the inbox statement, the canonical Core, and texts of
 * the sizes ARCHITECTURE §0 measured with (a 68-byte title, 157-byte details).
 *
 *   link       bytes after `#` (the link itself)
 *   address    characters of the whole address in the mode's shape, as text (base64url)
 *   d          characters of the public part before `#` (`?d=…`), 0 for bare
 *   qr digits  the bare address with everything inside, as one decimal number (numeric-mode QR)
 *   qr text    the whole QR text: the site, `/#`, then the digits
 */

const SITE = "https://ahand.app";
const title = "Who can fix a 1978 Vespa in Lisbon this week? Carburettor, not spark"; // 68 bytes
const content =
  "Mine stalls at idle once warm. Carburettor cleaned twice, new plug, fuel flows. Somebody who knows old Vespas, near Graça. I pay for the parts and coffee!!!"; // 157 bytes
const inbox: Hex = "0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const salt: Hex = keccak256(stringToBytes("sizes"));
const COUNTS = [0, 1, 3, 6, 10];
/** A young Hand: its number takes one byte in the link (Hand 123 456 would take three). */
const HAND_ID = 1n;

interface Row {
  mode: DescribeMode;
  shakes: number;
  link: number;
  address: number;
  d: number;
  qrDigits: number;
  qrText: number;
}

async function measure(mode: DescribeMode): Promise<Row[]> {
  const described = describeHand({ mode, title, content, inbox, salt: mode === "public" ? undefined : salt });
  const hand = ownHand(described.dataHash, HAND_ID);
  const getHand = async () => hand;
  const outside = described.outside && packAttachments(described.outside);
  let link = await encodeLive({ domain: ownDomain, hand, signedShakes: [], seed, attachments: described.inside }, { ...ownOptions, outside });
  let address = toAddress({ site: SITE, link, shape: described.shape, outside: described.outside }, ownOptions);
  const rows: Row[] = [];
  for (let shakes = 0; shakes <= COUNTS[COUNTS.length - 1]; ++shakes) {
    const opened: OpenedAddress = await openAddress(address, getHand, ownOptions);
    expect(readDescription(opened).status).toBe("attached");
    if (COUNTS.includes(shakes)) {
      const everything = carryFor(opened, "bare");
      const qrLink = await encodeLive({ domain: ownDomain, hand, signedShakes: opened.signedShakes, seed: opened.seed!, attachments: everything.attachments }, ownOptions);
      const qr = toAddress({ site: SITE, link: qrLink, shape: "bare", form: "digits" }, ownOptions);
      expect(qr.slice(qr.indexOf("#") + 1)).toBe(toDigits(qrLink));
      const before = address.slice(0, address.indexOf("#"));
      rows.push({
        mode,
        shakes,
        link: link.length,
        address: address.length,
        d: before.includes("?d=") ? before.length - before.indexOf("?d=") - 3 : 0,
        qrDigits: toDigits(qrLink).length,
        qrText: qr.length,
      });
    }
    if (shakes === COUNTS[COUNTS.length - 1]) break;
    const carry = carryFor(opened, opened.seen.shape);
    ({ link } = await passOn(
      opened,
      { payee: payeeAt(shakes), nextClaimBps: opened.end.claimBps - 100 },
      { ...ownOptions, outside: carry.outside && packAttachments(carry.outside) },
      carry.attachments,
    ));
    address = toAddress({ site: SITE, link, shape: opened.seen.shape, outside: carry.outside }, ownOptions);
  }
  return rows;
}

describe("sizes of links and addresses", () => {
  it("prints the table for the docs", async () => {
    expect(stringToBytes(title).length).toBe(68);
    expect(stringToBytes(content).length).toBe(157);
    const rows = [...(await measure("public")), ...(await measure("unlisted")), ...(await measure("dark"))];
    const header = "| mode | Shakes | link, bytes | address, chars | of it `d`, chars | QR digits | QR text, chars |";
    const lines = [header, "|---|---|---|---|---|---|---|", ...rows.map((r) => `| ${r.mode} | ${r.shakes} | ${r.link} | ${r.address} | ${r.d} | ${r.qrDigits} | ${r.qrText} |`)];
    console.log(`\n${lines.join("\n")}\n`);

    // ARCHITECTURE §0 measured these link sizes at 0 Shakes; the code that writes them must agree.
    const at0 = (mode: DescribeMode) => rows.find((r) => r.mode === mode && r.shakes === 0)!;
    expect([at0("public").link, at0("unlisted").link, at0("dark").link]).toEqual([37, 319, 428]);
    // Address lengths depend on the site's own address and the Hand's number as well; §0 had 550, 658 and 589.
    expect(at0("dark").qrDigits).toBe(1030);
    // Every Shake adds the same bytes in every mode: what a pass adds does not depend on the description.
    for (const mode of ["public", "unlisted", "dark"] as const) {
      const grown = rows.filter((r) => r.mode === mode).map((r) => r.link - at0(mode).link);
      expect(grown).toEqual(rows.filter((r) => r.mode === "public").map((r) => r.link - at0("public").link));
    }
  }, 60_000);
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { getAddress, getContractAddress, zeroHash, type Address, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";

import {
  CANONICAL_CORE,
  CANONICAL_CORE_BUILD,
  LinkError,
  coreAddressOf,
  domain,
  encodeLive,
  keyOfSeed,
  newSeed,
  openAddress,
  openLink,
  peekLink,
  seenIn,
  toAddress,
  toText,
  type Hand,
} from "../src/index.js";
import { REPO_ROOT } from "./helpers/anvil.js";

/**
 * The canonical Core: one address on every chain, given by CREATE2 from the deterministic
 * deployer, a fixed salt and the hash of Core's initcode. A link or an address that leaves Core's
 * address out names this Core, and a reader knows it without being told.
 */

const record = JSON.parse(readFileSync(join(REPO_ROOT, "contracts/deployments/84532.json"), "utf8")) as {
  core: Address;
  factory: Address;
  salt: Hex;
  initcodeHash: Hex;
};

const seed = newSeed();
const hand: Hand = {
  handId: 5n,
  raiser: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  token: "0x00000000000000000000000000000000000000aa",
  rootKey: privateKeyToAddress(keyOfSeed(seed)),
  payoutGasK: 250,
  minClaimBps: 7_000,
  dataHash: zeroHash,
};
const getHand = async () => hand;

async function thrown(run: () => unknown): Promise<LinkError> {
  try {
    await run();
  } catch (error) {
    return error as LinkError;
  }
  throw new Error("did not throw");
}

describe("the canonical Core", () => {
  it("is the CREATE2 address of its factory, salt and initcode hash: the Core the deployment record names", () => {
    expect(CANONICAL_CORE).toBe("0x0f0555972388151D2C187f636A0855b6eE9B9685");
    expect(coreAddressOf(CANONICAL_CORE_BUILD)).toBe(CANONICAL_CORE);
    expect(
      getContractAddress({
        opcode: "CREATE2",
        from: CANONICAL_CORE_BUILD.factory,
        salt: CANONICAL_CORE_BUILD.salt,
        bytecodeHash: CANONICAL_CORE_BUILD.initcodeHash,
      }),
    ).toBe(CANONICAL_CORE);
    expect(getAddress(record.core)).toBe(CANONICAL_CORE);
    expect(getAddress(record.factory)).toBe(CANONICAL_CORE_BUILD.factory);
    expect(record.salt).toBe(CANONICAL_CORE_BUILD.salt);
    expect(record.initcodeHash).toBe(CANONICAL_CORE_BUILD.initcodeHash);
  });

  it("is the default of a reader and a writer: a link for it leaves the address out and opens with no options", async () => {
    const link = await encodeLive({ domain: domain(8453, CANONICAL_CORE), hand, signedShakes: [], seed });
    // Version 1 and no flags: no CORE flag, so no address in the link.
    expect(link[0]).toBe(0x10);
    expect(peekLink(link).core).toBe(CANONICAL_CORE);
    expect((await openLink(link, getHand)).head.core).toBe(CANONICAL_CORE);

    const address = toAddress({ site: "https://example.org", link, shape: "numbered" });
    expect(address.startsWith("https://example.org/8453/5#")).toBe(true);
    expect(seenIn(address.split("#")[0]!).core).toBe(CANONICAL_CORE);
    expect((await openAddress(address, getHand)).head.core).toBe(CANONICAL_CORE);
  });

  it("is never written out by default: an address or a link that names it is refused as non-canonical", async () => {
    expect((await thrown(() => seenIn(`https://example.org/8453/${CANONICAL_CORE.toLowerCase()}/5`))).code).toBe("non-canonical");
    const named = await encodeLive({ domain: domain(8453, CANONICAL_CORE), hand, signedShakes: [], seed }, { canonicalCore: null });
    expect(named[0]).toBe(0x14);
    expect((await thrown(() => peekLink(named))).code).toBe("non-canonical");
  });

  it("writes another Core's address, which a default reader takes as written", async () => {
    const other = getAddress("0x00000000000000000000000000000000000000bb");
    const link = await encodeLive({ domain: domain(8453, other), hand, signedShakes: [], seed });
    expect(link[0]).toBe(0x14);
    expect(peekLink(link).core).toBe(other);
    expect(seenIn(`https://example.org/8453/${other.toLowerCase()}/5`).core).toBe(other);
  });

  it("can be switched off: with canonicalCore null, a link or an address without Core's address is no-canonical-core", async () => {
    const link = await encodeLive({ domain: domain(8453, CANONICAL_CORE), hand, signedShakes: [], seed });
    const fromLink = await thrown(() => peekLink(link, { canonicalCore: null }));
    const fromAddress = await thrown(() => seenIn("https://example.org/8453/5", { canonicalCore: null }));
    for (const error of [fromLink, fromAddress]) {
      expect(error).toBeInstanceOf(LinkError);
      expect(error.code).toBe("no-canonical-core");
    }
  });

  it("refuses canonicalCore given as undefined: an unset value is neither the canonical Core nor none", async () => {
    const link = await encodeLive({ domain: domain(8453, CANONICAL_CORE), hand, signedShakes: [], seed });
    expect(() => peekLink(link, { canonicalCore: undefined })).toThrow(TypeError);
    expect(() => seenIn("https://example.org/8453/5", { canonicalCore: undefined })).toThrow(TypeError);
    expect(peekLink(link, {}).core).toBe(CANONICAL_CORE);
  });

  it("opens a link written with the address out against the canonical Core's domain only", async () => {
    const link = await encodeLive({ domain: domain(8453, CANONICAL_CORE), hand, signedShakes: [], seed });
    // Read as another Core's link, the pin no longer fits the Hand's terms.
    const elsewhere = await thrown(() => openLink(link, getHand, { canonicalCore: "0x00000000000000000000000000000000000000aa" }));
    expect(elsewhere.code).toBe("not-this-hand");
    expect(toText(link).startsWith("E")).toBe(true);
  });
});

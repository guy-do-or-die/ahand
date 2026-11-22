import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  BaseError,
  ContractFunctionRevertedError,
  RawContractError,
  createPublicClient,
  encodeAbiParameters,
  encodeErrorResult,
  http,
  toFunctionSelector,
  zeroHash,
  type Abi,
  type AbiParameter,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAddress } from "viem/accounts";

import { AHandCoreAbi } from "./helpers/built.js";
import {
  CORE_ERRORS_ABI,
  CORE_OWN_ERRORS,
  CoreRefused,
  LinkError,
  Refusal,
  UntrustedCore,
  decodeCoreError,
  domain,
  encodeLive,
  getHandFor,
  keyOfSeed,
  newSeed,
  openAddress,
  peekLink,
  seenIn,
  toText,
  type Hand,
} from "../src/index.js";
import { messageIdOf } from "../src/app.js";
import { REPO_ROOT } from "./helpers/anvil.js";

type AbiError = { type: "error"; name: string; inputs: readonly AbiParameter[] };

/** Core's errors and the message ids of every failure a person may meet. No chain is needed here. */

const errorSignature = (item: AbiError) => `${item.name}(${item.inputs.map((input) => input.type).join(",")})`;

/** Sample arguments for an error's inputs. */
const sample = (item: AbiError): unknown[] =>
  item.inputs.map((input) =>
    input.type === "uint256" ? 3n : input.type === "address" ? "0x00000000000000000000000000000000000000AA" : "too long",
  );

describe("Core's errors", () => {
  it("are the 23 errors AHandCore.sol declares, and the 26 of its ABI", () => {
    const source = readFileSync(join(REPO_ROOT, "contracts/src/AHandCore.sol"), "utf8");
    const declared = [...source.matchAll(/^\s*error (\w+)\(/gm)].map((match) => match[1]);
    expect(declared).toHaveLength(23);
    expect(CORE_OWN_ERRORS).toEqual(declared);

    const built = (AHandCoreAbi as Abi).filter((item): item is AbiError => item.type === "error").map(errorSignature).sort();
    expect(built).toHaveLength(26);
    expect(CORE_ERRORS_ABI.map((item) => errorSignature(item as AbiError)).sort()).toEqual(built);
  });

  it("decodes every one of the 26 with its arguments, from bytes and from what viem throws", () => {
    for (const item of CORE_ERRORS_ABI as readonly AbiError[]) {
      const args = sample(item);
      const data = encodeErrorResult({ abi: [item], errorName: item.name, args });
      const positioned = ["InvalidClaim", "AnonymousMargin", "InvalidKeySig"].includes(item.name);
      const expected = { name: item.name, args, ...(positioned ? { position: 3 } : {}) };

      expect(decodeCoreError(data), item.name).toEqual(expected);
      // A raw call error, as client.call throws it, buried under a wrapper.
      const raw = new BaseError("call failed", { cause: new RawContractError({ data }) });
      expect(decodeCoreError(raw), item.name).toEqual(expected);
      // A revert viem already decoded with Core's ABI, as readContract throws it.
      const decoded = new ContractFunctionRevertedError({ abi: AHandCoreAbi as Abi, data, functionName: "thank" });
      expect(decodeCoreError(new BaseError("wrapped", { cause: decoded })), item.name).toEqual(expected);
      // An RPC error whose data carries the revert.
      expect(decodeCoreError({ cause: { code: 3, data: { data } } }), item.name).toEqual(expected);
      // A thrown CoreRefused gives back what it carries.
      expect(decodeCoreError(new CoreRefused(expected as never)), item.name).toEqual(expected);
    }
  });

  it("gives nothing for what is not one of Core's errors", () => {
    const revertString = encodeErrorResult({
      abi: [{ type: "error", name: "Error", inputs: [{ type: "string", name: "message" }] }],
      errorName: "Error",
      args: ["Multicall3: call failed"],
    });
    const panic = `0x4e487b71${encodeAbiParameters([{ type: "uint256" }], [17n]).slice(2)}` as Hex;
    const allowance = `${toFunctionSelector("ERC20InsufficientAllowance(address,uint256,uint256)")}${"00".repeat(96)}` as Hex;
    for (const other of [revertString, panic, allowance, "0x", "0x1234", new Error("network down"), undefined, null, 42, zeroHash]) {
      expect(decodeCoreError(other)).toBeUndefined();
    }
  });

  it("names a thrown refusal by Core's error, with its position", () => {
    const refused = new CoreRefused({ name: "InvalidKeySig", position: 2, args: [2n] });
    expect(refused).toBeInstanceOf(Error);
    expect(refused.name).toBe("InvalidKeySig");
    expect(refused.position).toBe(2);
    expect(refused.message).toBe("Core refuses: InvalidKeySig(2)");
    expect(new CoreRefused({ name: "NotOpen" }).message).toBe("Core refuses: NotOpen");
  });
});

describe("message ids", () => {
  const seed = newSeed();
  const core = "0x65ac707E2AE7392583de5d6192C619F1D8862309" as Address;
  const hand: Hand = {
    handId: 5n,
    raiser: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    token: "0x00000000000000000000000000000000000000aa",
    rootKey: privateKeyToAddress(keyOfSeed(seed)),
    payoutGasK: 250,
    minClaimBps: 7_000,
    dataHash: zeroHash,
  };
  const route = { domain: domain(31337, core), hand, signedShakes: [], seed };

  it("reads a contract outside the trusted list as link.untrusted", async () => {
    // Refused before the network is asked: the client below points nowhere.
    const nowhere = createPublicClient({ transport: http("http://127.0.0.1:9") });
    const getHand = getHandFor({ 31337: nowhere as never }, [{ chainId: 31337, core }]);
    const other = await getHand({ chainId: 31337, core: "0x00000000000000000000000000000000000000bb", handId: 5n }).catch((e) => e);
    const unknownChain = await getHand({ chainId: 8453, core, handId: 5n }).catch((e) => e);
    for (const thrown of [other, unknownChain]) {
      expect(thrown).toBeInstanceOf(UntrustedCore);
      expect(thrown).not.toBeInstanceOf(LinkError);
      expect(messageIdOf(thrown)).toBe("link.untrusted");
    }
    // openAddress lets it through unchanged.
    const link = toText(await encodeLive(route));
    const opened = await openAddress(`https://ahand.example/#${link}`, getHandFor({}, [])).catch((e) => e);
    expect(opened).toBeInstanceOf(UntrustedCore);
    expect(messageIdOf(opened)).toBe("link.untrusted");
  });

  it("reads a newer format as link.unsupported", async () => {
    const bytes = await encodeLive(route);
    const newer = Uint8Array.from(bytes);
    newer[0] = (2 << 4) | (newer[0]! & 0x0f);
    const thrown = (() => {
      try {
        peekLink(newer);
      } catch (error) {
        return error;
      }
    })() as LinkError;
    expect(thrown).toBeInstanceOf(LinkError);
    expect(thrown.code).toBe("unsupported");
    expect(messageIdOf(thrown)).toBe("link.unsupported");
  });

  it("reads a link or an address that names the canonical Core, where the reader knows none, as link.no-canonical-core", async () => {
    const short = await encodeLive(route);
    expect(peekLink(short).core).toBe(core);
    const none = { canonicalCore: null };
    const fromLink = (() => {
      try {
        peekLink(short, none);
      } catch (error) {
        return error;
      }
    })() as LinkError;
    const fromAddress = (() => {
      try {
        seenIn("https://ahand.example/31337/5", none);
      } catch (error) {
        return error;
      }
    })() as LinkError;
    for (const thrown of [fromLink, fromAddress]) {
      expect(thrown).toBeInstanceOf(LinkError);
      // Told apart by its code, never by its words.
      expect(thrown.code).toBe("no-canonical-core");
      expect(messageIdOf(thrown)).toBe("link.no-canonical-core");
    }
    expect(messageIdOf(new LinkError("no-canonical-core", "any words at all"))).toBe("link.no-canonical-core");
    expect(messageIdOf(new LinkError("unsupported", "the link names the canonical Core and none is known"))).toBe("link.unsupported");
  });

  it("gives each other link error its code, and Core's refusals core.<error>", () => {
    for (const code of ["malformed", "non-canonical", "too-long", "another-hand", "not-this-hand", "invalid", "unmatched-data"] as const) {
      expect(messageIdOf(new LinkError(code, "x"))).toBe(`link.${code}`);
    }
    expect(messageIdOf(new Refusal("InvalidClaim", 2))).toBe("core.InvalidClaim");
    expect(messageIdOf(new Refusal("InvalidGiverSig"))).toBe("core.InvalidGiverSig");
    expect(messageIdOf({ name: "BelowMinClaim" })).toBe("core.BelowMinClaim");
    expect(messageIdOf(new CoreRefused({ name: "AnonymousMargin", position: 0 }))).toBe("core.AnonymousMargin");
    expect(() => messageIdOf(new Error("x") as never)).toThrow(TypeError);
  });
});

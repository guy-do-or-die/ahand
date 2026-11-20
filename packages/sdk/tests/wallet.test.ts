import {
  encodeFunctionData,
  keccak256,
  parseAbi,
  serializeCompactSignature,
  parseSignature,
  serializeErc6492Signature,
  signatureToCompactSignature,
  size,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { domainSeparator, digest, giveHash } from "../src/hash.js";
import { giveTypedData, signGiveWithKey, type GiveSigner } from "../src/sign.js";
import type { Give } from "../src/types.js";
import { Refusal, checkGive, isKeySignature } from "../src/verify.js";
import { askSigner, isErc6492, signGive, unwrap6492, walletKind } from "../src/wallet.js";
import { startChain, ANVIL_KEYS, type Chain } from "./helpers/anvil.js";
import { liveLink, ownDomain, ownHand } from "./link-fixtures.js";

const factoryAbi = parseAbi([
  "function createAccount(address owner, uint256 salt) returns (address)",
  "function getAddress(address owner, uint256 salt) view returns (address)",
]);

const owner = privateKeyToAccount(ANVIL_KEYS[7]!);
const stranger = privateKeyToAccount(ANVIL_KEYS[8]!);
const SALT = 1n;

describe("unwrap6492 and isErc6492", () => {
  const factory: Address = "0x1111111111111111111111111111111111111111";
  const factoryData: Hex = "0xdeadbeef";

  it("gives back the factory, its data and the inner signature of a wrapped signature", async () => {
    const inner = await owner.signMessage({ message: "inner" });
    const wrapped = serializeErc6492Signature({ address: factory, data: factoryData, signature: inner });
    expect(isErc6492(wrapped)).toBe(true);
    expect(unwrap6492(wrapped)).toEqual({ factory, factoryData, signature: inner });
  });

  it("is undefined for a plain signature", async () => {
    const plain = await owner.signMessage({ message: "plain" });
    expect(isErc6492(plain)).toBe(false);
    expect(unwrap6492(plain)).toBeUndefined();
  });
});

describe("on the helper chain", () => {
  let chain: Chain;
  let factory: Address;
  let account: Address;

  beforeAll(async () => {
    chain = await startChain({ port: 15052 });
    if (!chain.accountFactory) throw new Error("the helper chain has no KeyAccountFactory: build contracts/out");
    factory = chain.accountFactory;
    account = await chain.client.readContract({ address: factory, abi: factoryAbi, functionName: "getAddress", args: [owner.address, SALT] });
  }, 60_000);
  afterAll(async () => {
    await chain?.stop();
  });

  /** A Give by the counterfactual account at the end of a real one-Shake route. */
  async function give() {
    const hand = ownHand();
    const { opened } = await liveLink(hand, 1);
    const g: Give = { signer: account, payee: account, claimBps: opened.end.claimBps, routeHash: opened.end.routeHash, dataHash: `0x${"00".repeat(32)}` };
    const keySig = await signGiveWithKey(opened.linkKey!, opened.domain, hand, g);
    const signed = digest(domainSeparator(opened.domain), giveHash(hand, g));
    return { hand, opened, give: g, keySig, signed };
  }

  const setupData = () => encodeFunctionData({ abi: factoryAbi, functionName: "createAccount", args: [owner.address, SALT] });

  it("walletKind: a key, a contract, and an EIP-7702 delegated key", async () => {
    expect(await walletKind(chain.client, owner.address)).toBe("key");
    expect(await walletKind(chain.client, account)).toBe("key"); // not deployed yet: no code
    expect(await walletKind(chain.client, chain.core)).toBe("code");

    const delegator = privateKeyToAccount(ANVIL_KEYS[9]!);
    // The authorization takes effect whatever the transaction calls; it calls a plain key, so no code runs.
    const authorization = await chain.wallet.signAuthorization({ account: delegator, contractAddress: factory });
    const hash = await chain.wallet.sendTransaction({ account: chain.deployer, chain: chain.wallet.chain, to: chain.deployer.address, authorizationList: [authorization] });
    expect((await chain.client.waitForTransactionReceipt({ hash })).status).toBe("success");
    expect((await chain.client.getCode({ address: delegator.address }))?.toLowerCase()).toBe(`0xef0100${factory.slice(2).toLowerCase()}`);
    expect(await walletKind(chain.client, delegator.address)).toBe("delegated");
  });

  it("askSigner: before the account exists, a wrapped signature of its owner is accepted and another key's is refused", async () => {
    const { hand, opened, give: g, keySig, signed } = await give();
    expect(await chain.client.getCode({ address: account })).toBeUndefined();
    const ask = askSigner(chain.client);

    const byOwner = await signGiveWithKey(ANVIL_KEYS[7]!, opened.domain, hand, g);
    const wrapped = serializeErc6492Signature({ address: factory, data: setupData(), signature: byOwner });
    expect(await ask(account, signed, wrapped)).toBe(true);
    // The SDK's offline checkGive takes it through askSigner and returns the Give's hash.
    expect(await checkGive(opened.domain, hand, opened.signedShakes, { give: g, keySig, giverSig: wrapped }, ask)).toBe(giveHash(hand, g));

    const byStranger = serializeErc6492Signature({ address: factory, data: setupData(), signature: await signGiveWithKey(ANVIL_KEYS[8]!, opened.domain, hand, g) });
    expect(await ask(account, signed, byStranger)).toBe(false);
    await expect(checkGive(opened.domain, hand, opened.signedShakes, { give: g, keySig, giverSig: byStranger }, ask)).rejects.toEqual(new Refusal("InvalidGiverSig"));

    // Plain, with no code to ask: refused, as Core refuses it.
    expect(await ask(account, signed, byOwner)).toBe(false);
    // Nothing was deployed by asking.
    expect(await chain.client.getCode({ address: account })).toBeUndefined();
  });

  it("askSigner: after the account is deployed, its owner's plain signature is accepted and another key's refused", async () => {
    const hash = await chain.wallet.writeContract({ account: chain.deployer, chain: chain.wallet.chain, address: factory, abi: factoryAbi, functionName: "createAccount", args: [owner.address, SALT] });
    expect((await chain.client.waitForTransactionReceipt({ hash })).status).toBe("success");
    expect(await walletKind(chain.client, account)).toBe("code");

    const { hand, opened, give: g, keySig, signed } = await give();
    const ask = askSigner(chain.client);
    const byOwner = await signGiveWithKey(ANVIL_KEYS[7]!, opened.domain, hand, g);
    expect(await ask(account, signed, byOwner)).toBe(true);
    expect(await checkGive(opened.domain, hand, opened.signedShakes, { give: g, keySig, giverSig: byOwner }, ask)).toBe(giveHash(hand, g));
    expect(await ask(account, signed, await signGiveWithKey(ANVIL_KEYS[8]!, opened.domain, hand, g))).toBe(false);
    // A wrapper that arrives after the account exists still reads.
    expect(await ask(account, signed, serializeErc6492Signature({ address: factory, data: setupData(), signature: byOwner }))).toBe(true);
    // An address that is a plain key gets no say from askSigner: its own key decides, in checkGive.
    expect(await ask(stranger.address, signed, await signGiveWithKey(ANVIL_KEYS[8]!, opened.domain, hand, g))).toBe(false);
  });
});

describe("signGive", () => {
  const hand = ownHand();
  const theGive = (signer: Address): Give => ({ signer, payee: signer, claimBps: 10_000, routeHash: keccak256(stringToBytes("route")), dataHash: `0x${"00".repeat(32)}` });
  const domain = ownDomain;

  it("a key's answer comes back in Core's 65-byte form, from any of the forms wallets give", async () => {
    const g = theGive(owner.address);
    const canonical = await signGiveWithKey(ANVIL_KEYS[7]!, domain, hand, g);
    const compactWallet: GiveSigner = {
      signTypedData: async (typed: ReturnType<typeof giveTypedData>) =>
        serializeCompactSignature(signatureToCompactSignature(parseSignature(await owner.signTypedData(typed)))),
    };
    const compact = await compactWallet.signTypedData(giveTypedData(domain, hand, g));
    expect(size(compact)).toBe(64);
    for (const kind of ["key", "delegated"] as const) {
      expect(await signGive(owner, kind, domain, hand, g)).toBe(canonical);
      expect(await signGive(compactWallet, kind, domain, hand, g)).toBe(canonical);
    }
    expect(isKeySignature(canonical)).toBe(true);
  });

  it("a wrapped or a contract's signature is returned as it came", async () => {
    const g = theGive(owner.address);
    const wrapped = serializeErc6492Signature({ address: "0x1111111111111111111111111111111111111111", data: "0x01", signature: await owner.signTypedData(giveTypedData(domain, hand, g)) });
    const wrappingWallet: GiveSigner = { signTypedData: async () => wrapped };
    expect(await signGive(wrappingWallet, "key", domain, hand, g)).toBe(wrapped);
    const contractAnswer: Hex = `0x${"ab".repeat(100)}`;
    const contractWallet: GiveSigner = { signTypedData: async () => contractAnswer };
    expect(await signGive(contractWallet, "code", domain, hand, g)).toBe(contractAnswer);
    expect(await signGive(contractWallet, "delegated", domain, hand, g)).toBe(contractAnswer);
    // A 65-byte answer from a contract is not touched either.
    const raw: Hex = `0x${"cd".repeat(65)}`;
    expect(await signGive({ signTypedData: async () => raw }, "code", domain, hand, g)).toBe(raw);
  });
});

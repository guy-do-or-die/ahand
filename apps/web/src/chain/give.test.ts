import { describe, expect, test } from "bun:test";
import type { AccountSetup, SignedGive } from "@ahand/sdk";
import { HttpRequestError, serializeErc6492Signature, zeroHash, type Address, type Hex, type PublicClient } from "viem";

import { isNetworkError } from "./errors";
import { giveOnChain } from "./give";

/**
 * `giveOnChain` with a stand-in for the RPC and for Core's `checkGive`: which form of the Give is
 * put to Core, and what an RPC failure becomes. The chain itself is exercised by the e2e flows.
 */

const core: Address = "0x65ac707E2AE7392583de5d6192C619F1D8862309";
const signer: Address = "0x00000000000000000000000000000000000000a1";
const factory: Address = "0x00000000000000000000000000000000000000f1";
const forwarder: Address = "0x00000000000000000000000000000000000000c1";
const inner: Hex = `0x${"11".repeat(65)}`;
const wrappedSig = serializeErc6492Signature({ address: factory, data: "0xabcd", signature: inner });

const giveWith = (giverSig: Hex): SignedGive => ({
  give: { signer, payee: signer, claimBps: 0, routeHash: zeroHash, dataHash: zeroHash },
  keySig: inner,
  giverSig,
});

function clientWith(code: () => Promise<Hex | undefined>): PublicClient {
  return { getBlockNumber: async () => 7n, getCode: code } as unknown as PublicClient;
}

type Asked = { giverSig: Hex; setup?: AccountSetup };
function recorder() {
  const asked: Asked[] = [];
  const check = (async (_c: PublicClient, _core: Address, _id: bigint, _s: unknown, signedGive: SignedGive, setup?: AccountSetup) => {
    asked.push({ giverSig: signedGive.giverSig, ...(setup ? { setup } : {}) });
  }) as never;
  return { asked, check };
}

describe("giveOnChain: Core is asked about a Give in any signer form", () => {
  test("a plain signature is asked as it is, without reading code", async () => {
    const { asked, check } = recorder();
    const result = await giveOnChain({ client: clientWith(async () => { throw new Error("must not read code"); }), core, handId: 1n, signedShakes: [], signedGive: giveWith(inner), forwarder: null, check });
    expect(result).toMatchObject({ ok: true, block: 7n });
    expect(asked).toEqual([{ giverSig: inner }]);
  });

  test("a wrapper whose account has code is asked with its inner signature", async () => {
    const { asked, check } = recorder();
    const result = await giveOnChain({ client: clientWith(async () => "0x6000"), core, handId: 1n, signedShakes: [], signedGive: giveWith(wrappedSig), forwarder, check });
    expect(result).toMatchObject({ ok: true, wrapped: { factory, factoryData: "0xabcd", deployed: true } });
    expect(result.ok && result.setup).toBeFalsy();
    expect(asked).toEqual([{ giverSig: inner }]);
  });

  test("a wrapper with no code yet is asked through the forwarder with its setup", async () => {
    const { asked, check } = recorder();
    const result = await giveOnChain({ client: clientWith(async () => undefined), core, handId: 1n, signedShakes: [], signedGive: giveWith(wrappedSig), forwarder, check });
    const setup: AccountSetup = { forwarder, factory, factoryData: "0xabcd" };
    expect(result).toMatchObject({ ok: true, setup, wrapped: { deployed: false } });
    expect(asked).toEqual([{ giverSig: wrappedSig, setup }]);
  });

  test("with no forwarder a wrapper with no code is not asked at all", async () => {
    const { asked, check } = recorder();
    expect(await giveOnChain({ client: clientWith(async () => "0x"), core, handId: 1n, signedShakes: [], signedGive: giveWith(wrappedSig), forwarder: null, check })).toEqual({ ok: false, reason: "no-forwarder" });
    expect(asked).toEqual([]);
  });

  test("an RPC failure reading the account's code is thrown as the network, never taken for 'needs setup'", async () => {
    const { asked, check } = recorder();
    const failing = clientWith(async () => {
      throw new HttpRequestError({ url: "http://127.0.0.1:1" });
    });
    const error = await giveOnChain({ client: failing, core, handId: 1n, signedShakes: [], signedGive: giveWith(wrappedSig), forwarder, check }).catch((e: unknown) => e);
    expect(isNetworkError(error)).toBe(true);
    expect(asked).toEqual([]);
  });
});

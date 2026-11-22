import { checkGiveOnChain, innerGiverSig, unwrapErc6492, type AccountSetup, type SignedGive, type SignedShake } from "@ahand/sdk";
import type { Address, Hex, PublicClient } from "viem";

/**
 * Core's own `checkGive` by `eth_call` for a Give in any signer form: the one way /thank and /my ask Core whether a Give is an answer.
 *
 *  - a plain signature (a key, a delegated or deployed account) is asked as it is;
 *  - an ERC-6492 wrapper whose account has code by now is asked with its inner signature, as the
 *    thank will send it;
 *  - a wrapper whose account has no code yet is asked through the forwarder with its setup first,
 *    and the thank then needs that setup step. With no forwarder configured there is no way to
 *    ask: `no-forwarder`, before any call.
 *
 * Whatever fails is thrown as it came: Core's refusal (decode it with `decodeCoreError`) or the
 * network not answering (`isNetworkError`). An RPC failure while reading the account's code is
 * such a network failure; it is never taken for "no code", so it never reads as "needs setup".
 */

export type GiveOnChain =
  | {
      ok: true;
      /** The block read just before Core was asked: its answer is from that block or a later one. */
      block: bigint;
      /** The Give as Core takes it: the inner signature of a wrapper. */
      coreGive: SignedGive;
      /** Set when the account has no code yet: the thank sends this setup first. */
      setup?: AccountSetup;
      /** The wrapper's factory and data, when the signature came wrapped (set up by now or not). */
      wrapped?: { factory: Address; factoryData: Hex; deployed: boolean };
    }
  | { ok: false; reason: "no-forwarder" };

export interface GiveOnChainInput {
  client: PublicClient;
  core: Address;
  handId: bigint;
  signedShakes: readonly SignedShake[];
  signedGive: SignedGive;
  forwarder: Address | null;
  /** Core's checkGive; the SDK's `checkGiveOnChain` unless a unit test stands in for the chain. */
  check?: typeof checkGiveOnChain;
}

export async function giveOnChain(input: GiveOnChainInput): Promise<GiveOnChain> {
  const { client, core, handId, signedShakes, signedGive, forwarder } = input;
  const check = input.check ?? checkGiveOnChain;
  const coreGive: SignedGive = { ...signedGive, giverSig: innerGiverSig(signedGive.giverSig) };
  const block = await client.getBlockNumber();
  const unwrapped = unwrapErc6492(signedGive.giverSig);
  if (!unwrapped) {
    await check(client, core, handId, signedShakes, signedGive);
    return { ok: true, block, coreGive };
  }
  const code = await client.getCode({ address: signedGive.give.signer });
  const deployed = code !== undefined && code !== "0x";
  const wrapped = { factory: unwrapped.factory, factoryData: unwrapped.factoryData, deployed };
  if (deployed) {
    await check(client, core, handId, signedShakes, coreGive);
    return { ok: true, block, coreGive, wrapped };
  }
  if (!forwarder) return { ok: false, reason: "no-forwarder" };
  const setup: AccountSetup = { forwarder, factory: unwrapped.factory, factoryData: unwrapped.factoryData };
  await check(client, core, handId, signedShakes, signedGive, setup);
  return { ok: true, block, coreGive, setup, wrapped };
}

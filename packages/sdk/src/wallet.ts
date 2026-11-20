import { isErc6492Signature, parseErc6492Signature, size, type Address, type Hex, type PublicClient } from "viem";
import { verifyHash } from "viem/actions";

import { signGiveWithWallet, toCoreSignature, type GiveSigner } from "./sign.js";
import type { Eip712Domain, Give, Hand } from "./types.js";
import type { AskSignerCode } from "./verify.js";

/**
 * What kind of account signs, and what to do with its signature.
 *
 *   key        no code: a plain key; Core takes its signature only in the 65-byte form
 *   delegated  EIP-7702: code that is 0xef0100 and an address; the key still signs for itself
 *   code       a contract (a smart account): Core asks its code (ERC-1271)
 *
 * An account that is not deployed yet has no code, so it reads as `key` here; its wallet answers
 * with an ERC-6492 wrapper, which `isErc6492` tells apart.
 */
export type WalletKind = "key" | "delegated" | "code";

/** The EIP-7702 delegation marker: code 0xef0100 followed by the 20-byte delegate. */
export const DELEGATION_MARKER = "0xef0100";

export async function walletKind(client: PublicClient, address: Address): Promise<WalletKind> {
  const code = await client.getCode({ address });
  if (code === undefined || code === "0x") return "key";
  if (code.toLowerCase().startsWith(DELEGATION_MARKER) && size(code) === 23) return "delegated";
  return "code";
}

/** Whether a signature is wrapped per ERC-6492 (an account that is not deployed yet). */
export function isErc6492(signature: Hex): boolean {
  return isErc6492Signature(signature);
}

/** viem's parser: the factory, its data and the inner signature; undefined for a plain signature. */
export function unwrap6492(signature: Hex): { factory: Address; factoryData: Hex; signature: Hex } | undefined {
  if (!isErc6492Signature(signature)) return undefined;
  const parsed = parseErc6492Signature(signature);
  if (parsed.address === undefined || parsed.data === undefined) return undefined;
  return { factory: parsed.address, factoryData: parsed.data, signature: parsed.signature };
}

/**
 * The question the SDK's offline `checkGive` asks when the signer's own key did not sign: what the
 * account's code says about the signature. Answered with viem's `verifyHash`, which asks a deployed
 * account by ERC-1271 and an account that is not deployed yet by ERC-6492 (in one `eth_call` that
 * deploys it in simulation first). A plain signature for an address without code is refused, as
 * Core refuses it: there is no code to ask.
 *
 * A yes for a wrapped signature means the account will accept it once it exists; Core itself does
 * not unwrap, so the thank sends the account's setup call first (ARCHITECTURE §11, D-62).
 */
export function askSigner(client: PublicClient): AskSignerCode {
  return async (signer, hash, signature) => {
    if (!isErc6492Signature(signature)) {
      const code = await client.getCode({ address: signer });
      if (code === undefined || code === "0x") return false;
    }
    // A refusal by the account is `false`; a network that does not answer throws, so that it is
    // said as "can't reach the network" and never as a bad signature.
    return verifyHash(client, { address: signer, hash, signature });
  };
}

/**
 * Asks the giver's wallet to sign a Give. For a key or a delegated account the answer is brought
 * to Core's 65-byte form; an ERC-6492 wrapper or a contract's own signature is returned as it came.
 */
export async function signGive(
  signer: GiveSigner,
  kind: WalletKind,
  domain: Eip712Domain,
  hand: Hand,
  give: Give,
): Promise<Hex> {
  const signature = await signGiveWithWallet(signer, domain, hand, give);
  if (kind === "code" || isErc6492Signature(signature)) return signature;
  const length = size(signature);
  if (length !== 64 && length !== 65) return signature;
  try {
    return toCoreSignature(signature);
  } catch {
    // 64 or 65 bytes that are not a key's signature: a contract's format, for its code to judge.
    return signature;
  }
}

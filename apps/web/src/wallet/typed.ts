import { isErc6492, walletKind, type WalletKind } from "@ahand/sdk";
import type { Hex, PublicClient, TypedDataDefinition } from "viem";

import type { SignedInWallet } from "./send";

/**
 * Typed-data confirmations: always `eth_signTypedData_v4` with
 * the full typed structure, so the wallet shows every field; never a plain-message request.
 * Pure, so tests run it on a dev provider; `useTypedSigner` is the hook screens use.
 */

export interface TypedAnswer {
  signature: Hex;
  /** "code" for a smart account, deployed or not; "delegated" for an EIP-7702 account; "key" otherwise. */
  kind: WalletKind;
  /** The answer is wrapped per ERC-6492: the account is not deployed yet. */
  wrapped: boolean;
}


/**
 * Asks `wallet` for a typed-data signature and says what kind of account gave it. A wrapped
 * answer means a smart account that has no code yet, which `walletKind` alone would take for a key.
 */
export async function signTypedWith(wallet: SignedInWallet, client: PublicClient, typedData: TypedDataDefinition): Promise<TypedAnswer> {
  const signature = await wallet.signTypedData({ ...typedData, account: wallet.account } as Parameters<SignedInWallet["signTypedData"]>[0]);
  const wrapped = isErc6492(signature);
  const kind: WalletKind = wrapped ? "code" : await walletKind(client, wallet.account.address);
  return { signature, kind, wrapped };
}


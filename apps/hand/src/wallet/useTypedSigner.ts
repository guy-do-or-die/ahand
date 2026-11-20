import { useCallback, useState } from "react";
import type { TypedDataDefinition } from "viem";

import { config as app } from "../config";
import { clientOf } from "../chain/hooks";
import { signTypedWith, type TypedAnswer } from "./typed";
import { connectedWallet, switchToAppChain } from "./state";

/**
 * Typed-data confirmations from the connected wallet (R-23, ARCHITECTURE §11 Signing): always
 * `eth_signTypedData_v4` with the full typed structure, so the wallet shows every field; never a
 * plain-message request. It returns the raw answer as the wallet gave it (an ERC-6492 wrapper
 * included: a Give carries it unchanged) and what kind of account answered.
 *
 * The typed data names the build's chain, and a wallet on another network refuses it (or worse,
 * shows it under the wrong network). So the wallet is first asked to switch, as `useSend` does
 * (FINDINGS W-4); a switch that fails is "wrong-network", and nothing is asked to be signed.
 */

export type TypedOutcome = ({ ok: true } & TypedAnswer) | { ok: false; reason: "no-wallet" | "rejected" | "failed" | "wrong-network"; message?: string };

function rejected(error: unknown): boolean {
  let node: unknown = error;
  const seen = new Set<unknown>();
  while (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    if ((node as { code?: unknown }).code === 4001) return true;
    node = (node as { cause?: unknown }).cause;
  }
  return false;
}

export interface UseTypedSigner {
  sign(typedData: TypedDataDefinition): Promise<TypedOutcome>;
  /** True while the wallet is being asked. */
  asking: boolean;
}

export function useTypedSigner(): UseTypedSigner {
  const [asking, setAsking] = useState(false);
  const sign = useCallback(async (typedData: TypedDataDefinition): Promise<TypedOutcome> => {
    let wallet = await connectedWallet();
    if (!wallet) return { ok: false, reason: "no-wallet" };
    setAsking(true);
    try {
      if ((await wallet.getChainId().catch(() => undefined)) !== app.chain.id) {
        if (!(await switchToAppChain())) return { ok: false, reason: "wrong-network" };
        wallet = (await connectedWallet()) ?? wallet;
        if ((await wallet.getChainId().catch(() => undefined)) !== app.chain.id) return { ok: false, reason: "wrong-network" };
      }
      return { ok: true, ...(await signTypedWith(wallet, clientOf(app.chain.id), typedData)) };
    } catch (error) {
      return rejected(error) ? { ok: false, reason: "rejected" } : { ok: false, reason: "failed", message: error instanceof Error ? error.message.split("\n")[0] : String(error) };
    } finally {
      setAsking(false);
    }
  }, []);
  return { sign, asking };
}

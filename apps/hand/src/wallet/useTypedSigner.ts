import { useCallback, useState } from "react";
import type { TypedDataDefinition } from "viem";

import { config as app } from "../config";
import { clientOf } from "../chain/hooks";
import { signTypedWith, type TypedAnswer } from "./typed";
import { connectedWallet } from "./state";

/**
 * Typed-data confirmations from the connected wallet (R-23, ARCHITECTURE §11 Signing): always
 * `eth_signTypedData_v4` with the full typed structure, so the wallet shows every field; never a
 * plain-message request. It returns the raw answer as the wallet gave it (an ERC-6492 wrapper
 * included: a Give carries it unchanged) and what kind of account answered.
 */

export type TypedOutcome = ({ ok: true } & TypedAnswer) | { ok: false; reason: "no-wallet" | "rejected" | "failed"; message?: string };

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
    const wallet = await connectedWallet();
    if (!wallet) return { ok: false, reason: "no-wallet" };
    setAsking(true);
    try {
      return { ok: true, ...(await signTypedWith(wallet, clientOf(app.chain.id), typedData)) };
    } catch (error) {
      return rejected(error) ? { ok: false, reason: "rejected" } : { ok: false, reason: "failed", message: error instanceof Error ? error.message.split("\n")[0] : String(error) };
    } finally {
      setAsking(false);
    }
  }, []);
  return { sign, asking };
}

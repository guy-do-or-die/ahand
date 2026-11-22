// How a wallet's errors are read, without React or wagmi (tested on its own).

/**
 * Whether a connect failed because the wallet does not know the build's network.
 * The wallet answers the switch with 4902, then the request to add the network fails; wagmi
 * wraps that failure as a UserRejectedRequestError (4001) whatever it was. So: a 4902 anywhere in
 * the cause chain, or a 4001 whose own cause is an error with another code (the person did not
 * refuse; the wallet could not add the network). A real "no" to the add prompt stays a 4001 all
 * the way down, and reads as a refusal.
 */
export function unknownNetwork(error: unknown): boolean {
  let node: unknown = error;
  const seen = new Set<unknown>();
  let wrapped = false;
  while (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    const { code, message } = node as { code?: unknown; message?: unknown };
    if (code === 4902) return true;
    if (typeof message === "string" && /wallet_addEthereumChain|unrecognized chain/i.test(message)) return true;
    if (wrapped && typeof code === "number" && code !== 4001) return true;
    if (code === 4001) wrapped = true;
    node = (node as { cause?: unknown }).cause;
  }
  return false;
}

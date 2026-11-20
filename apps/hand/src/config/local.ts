/**
 * The one rule for `chain.local` (ARCHITECTURE §7 Wallets, D-29): a build may call its chain local,
 * and so carry the dev wallet with anvil's public mnemonic and the gallery, only when that chain
 * is anvil's own chain id. Read by the build (`vite.shared.ts isLocalChain`), by `parseConfig`
 * when the app starts, and by the dev wallet before it answers anything. Plain data in, a sentence
 * out: no imports, so the Vite config can load it as it is.
 */

/** anvil's default chain id: the only chain a local build may name. */
export const LOCAL_CHAIN_ID = 31337;

/**
 * Why this chain section may not be built as it is: `chain.local` true on a chain that is not
 * 31337. Undefined when it is fine (not local, or local on 31337).
 */
export function localChainProblem(chain: { id?: unknown; local?: unknown } | null | undefined): string | undefined {
  if (chain?.local !== true) return undefined;
  if (chain.id === LOCAL_CHAIN_ID) return undefined;
  return `chain.local is true, but chain.id is ${JSON.stringify(chain.id)}: only chain ${LOCAL_CHAIN_ID} (anvil) may be local, because a local build carries anvil's public test keys`;
}

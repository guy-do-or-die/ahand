import { createConfig, injected, type Config, type CreateConnectorFn } from "wagmi";

import { config as app } from "../config";
import type { ChainConfig } from "../config/schema";
import { chainOf, transportOf } from "../chain/clients";

/**
 * The wagmi configuration (ARCHITECTURE §7 Wallets, D-29): the build's one chain, browser wallets
 * found by EIP-6963 announcements, the page's own `window.ethereum` as a fallback for an app's
 * browser that sets it without announcing (many phone wallets' built-in browsers; ConnectSheet
 * lists it only when nothing announced), and in local builds the dev wallet. Nothing is persisted:
 * `storage: null`, so no wallet state is written to this device's storage (ARCHITECTURE §11);
 * after a reload the person connects again (a sent action is still followed: `useSend.resume`
 * needs only its stored hash and the RPC).
 *
 * Screens never import wagmi: they use `wallet/index.ts`.
 */

/** A wagmi configuration for one chain, with these extra connectors. Pure, for tests and the app. */
export function walletConfigOf(chain: ChainConfig, connectors: CreateConnectorFn[] = []): Config {
  const viemChain = chainOf(chain);
  return createConfig({
    chains: [viemChain],
    connectors,
    transports: { [viemChain.id]: transportOf(chain) },
    multiInjectedProviderDiscovery: true,
    storage: null,
    ssr: false,
    pollingInterval: chain.blockTimeMs,
  });
}

/**
 * `window.ethereum` as a connector. No `shimDisconnect`: nothing is kept on this device, and
 * "Use another account" asks the app itself.
 */
export function browserFallback(): CreateConnectorFn {
  return injected({ shimDisconnect: false });
}

/**
 * Set by the build (a `define` in vite.config.ts) from `chain.local`: with false, the dev
 * wallet's import below is dead code and its chunk, with anvil's test mnemonic, is never emitted.
 */
declare const __AHAND_LOCAL__: boolean | undefined;
export const LOCAL: boolean = typeof __AHAND_LOCAL__ === "boolean" ? __AHAND_LOCAL__ : app.chain.local;

let made: Promise<Config> | undefined;

/** The app's one wagmi configuration, made on first use. */
export function walletConfig(): Promise<Config> {
  made ??= (async () => {
    const dev = LOCAL ? (await import("./dev")).devConnectors(app) : [];
    return walletConfigOf(app.chain, [...dev, browserFallback()]);
  })();
  return made;
}

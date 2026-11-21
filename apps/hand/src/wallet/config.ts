import { createConfig, injected, type Config, type CreateConnectorFn } from "wagmi";

import { config as app } from "../config";
import { pollMsOf, type ChainConfig } from "../config/schema";
import { chainOf, transportOf } from "../chain/clients";
import { privyAllowsOrigin, privyConnector, PrivyUnavailableError } from "./privy";

/**
 * The wagmi configuration (ARCHITECTURE §7 Wallets, D-29): the build's one chain, browser wallets
 * found by EIP-6963 announcements, the page's own `window.ethereum` as a fallback for an app's
 * browser that sets it without announcing (many phone wallets' built-in browsers; ConnectSheet
 * lists it only when nothing announced), email through Privy when the configuration has `privy`
 * (wallet/privy.ts; its SDK loads only when email is picked), and in local builds the dev wallet. Nothing is persisted:
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
    pollingInterval: pollMsOf(chain),
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

/**
 * Set by the build from the configuration's `privy`: with false, the email connector's import
 * below is dead code, and Privy's SDK (wallet/privy-host.tsx and everything under it) is never emitted.
 */
declare const __AHAND_PRIVY__: boolean | undefined;
export const PRIVY: boolean = typeof __AHAND_PRIVY__ === "boolean" ? __AHAND_PRIVY__ : app.privy !== undefined;

let made: Promise<Config> | undefined;

/** The app's one wagmi configuration, made on first use. */
export function walletConfig(): Promise<Config> {
  made ??= (async () => {
    const dev = LOCAL ? (await import("./dev")).devConnectors(app) : [];
    // The SDK's import stays inside this branch, so a build without Privy drops it and its chunks.
    // On a site address Privy's dashboard does not allow, its email window would still open and
    // fail only after the person typed their email: say at once that email can't be reached here.
    const email =
      PRIVY && app.privy
        ? [
            privyConnector(app.privy, app.chain, async (settings, chain) => {
              if (!privyAllowsOrigin(settings, location.origin)) throw new PrivyUnavailableError(`Privy does not allow ${location.origin}`);
              return (await import("./privy-host")).mountPrivy(settings, chain);
            }),
          ]
        : [];
    return walletConfigOf(app.chain, [...dev, ...email, browserFallback()]);
  })();
  return made;
}

import raw from "virtual:ahand-config";

import { parseConfig } from "./load";
import { isTestnet } from "./schema";

export type * from "./schema";
export { isTestnet } from "./schema";
export { ConfigError, parseConfig } from "./load";

/** This build's configuration, read from AHAND_CONFIG at build time and checked once at start. */
export const config = parseConfig(raw);

/** This build's chain is a test network (local, or a public one such as Base Sepolia): its money is test money. */
export const TESTNET = isTestnet(config.chain);

/**
 * A server in front of the site (face, or face's Vercel Function on the public test deployment)
 * writes a Hand's address's link-preview tags. False on a static-only host: a chat's preview of
 * any link shows only the site's name.
 */
export const PREVIEWS = config.previews ?? true;

/** The explorer's page for a transaction or an address on this build's chain, or undefined when the configuration names no explorer. */
export function explorerUrl(kind: "tx" | "address", value: string): string | undefined {
  return config.chain.explorer ? `${config.chain.explorer}/${kind}/${value}` : undefined;
}

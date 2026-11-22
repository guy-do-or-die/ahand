import { domain, getHandFor, type Eip712Domain, type LinkOptions } from "@ahand/sdk";
import type { Address } from "viem";

import { CLIENTS } from "../../chain";
import { config } from "../../config";

/**
 * The build's facts this screen writes and reads links with: the canonical Core (links leave
 * its address out), the trusted Cores only (`getHandFor` fails closed on any other), and the
 * site's own address for what stands before `#`.
 */

export const OPTIONS: LinkOptions = { canonicalCore: config.cores.canonical ?? null };

export const GET_HAND = getHandFor(
  CLIENTS,
  config.cores.trusted.map(({ chainId, core }) => ({ chainId, core })),
);

export const SITE = config.site.replace(/\/+$/, "");

/** The Core this build reads on a chain: the canonical one if it is there, else the first trusted. */
export function coreOn(chainId: number): Address | undefined {
  const trusted = config.cores.trusted.filter((entry) => entry.chainId === chainId);
  const canonical = config.cores.canonical;
  if (canonical && trusted.some((entry) => entry.core.toLowerCase() === canonical.toLowerCase())) return canonical;
  return trusted[0]?.core;
}

export function domainOn(chainId: number, core: Address): Eip712Domain {
  return domain(chainId, core);
}

/** The token's decimals from the build's list; 18 for a token this build does not list. */
export function decimalsOf(token: Address): number {
  return config.tokens.find((entry) => entry.address.toLowerCase() === token.toLowerCase())?.decimals ?? 18;
}

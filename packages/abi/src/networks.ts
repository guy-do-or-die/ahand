// The networks aHand runs on: each one's USDC and, where it is deployed, AHandCore. Hand-written;
// index.ts re-exports it.
import type { Deployment, HexAddress } from "./deployment.js";
import { DEPLOYMENTS } from "./generated.js";

/** Circle's USDC on one network, as its contract answers. */
export interface Usdc {
  readonly address: HexAddress;
  /** `symbol()` */
  readonly symbol: string;
  /** `name()`: the name in the EIP-712 domain of the token's permit signatures. */
  readonly name: string;
  /** `version()`: the version in the EIP-712 domain of the token's permit signatures. */
  readonly version: string;
  /** `decimals()` */
  readonly decimals: number;
}

export interface Network {
  readonly chainId: number;
  readonly name: string;
  readonly usdc: Usdc;
  /** AHandCore's deployment record on this network, or undefined where Core is not deployed. */
  readonly deployment: Deployment | undefined;
}

/**
 * The USDC addresses were checked on chain on 2026-11-22 with read-only calls, each through the
 * network's public endpoint:
 *
 *   Base, https://mainnet.base.org (eth_chainId 8453, block 60755660),
 *   0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913: 1852 bytes of code (a proxy), symbol() "USDC",
 *   name() "USD Coin", decimals() 6; version() "2" (read at block 60759991).
 *
 *   Base Sepolia, https://sepolia.base.org (eth_chainId 84532, block 62098209),
 *   0x036CbD53842c5426634e7929541eC2318f3dCF7e: 1798 bytes of code (a proxy), symbol() "USDC",
 *   name() "USDC", decimals() 6; version() "2" (read at block 62102528).
 *
 * A permit's EIP-712 domain is { name, version, chainId, verifyingContract }. The two tokens answer
 * different names, so a client builds each network's domain from that network's own `name` and
 * `version` here, never from one constant: a domain with the other network's name gives a signature
 * the token refuses. (A permit for one network never verifies on the other anyway, since chainId and
 * verifyingContract differ.)
 *
 * NETWORKS and everything in it is frozen: no code that imports it can change where money goes.
 */
export const NETWORKS = {
  8453: {
    chainId: 8453,
    name: "Base",
    usdc: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", name: "USD Coin", version: "2", decimals: 6 },
    // AHandCore is not deployed on Base yet: there is no contracts/deployments/8453.json.
    deployment: undefined,
  },
  84532: {
    chainId: 84532,
    name: "Base Sepolia",
    usdc: { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", symbol: "USDC", name: "USDC", version: "2", decimals: 6 },
    deployment: DEPLOYMENTS[84532],
  },
} as const satisfies Record<number, Network>;
for (const network of Object.values(NETWORKS)) Object.freeze(Object.freeze(network).usdc);
Object.freeze(NETWORKS);

/** The network with this chain id, or undefined when aHand does not run there. */
export function networkOf(chainId: number): Network | undefined {
  return Object.hasOwn(NETWORKS, chainId) ? NETWORKS[chainId as keyof typeof NETWORKS] : undefined;
}

/** AHandCore's address on a chain, or undefined where it is not deployed (Base, today). */
export function coreOf(chainId: number): HexAddress | undefined {
  return networkOf(chainId)?.deployment?.core;
}

/** The USDC of a network, or undefined when aHand does not run there. */
export function usdcOf(chainId: number): Usdc | undefined {
  return networkOf(chainId)?.usdc;
}

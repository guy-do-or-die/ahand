import { defineChain, getAddress, type Address, type Chain } from "viem";
import { base, baseSepolia, foundry, mainnet, sepolia } from "viem/chains";

import { LOCAL_CHAIN_ID } from "./local";
import type { ChainConfig, ChainInput } from "./schema";

/**
 * The chains aHand knows, as viem describes them: name, currency, explorer, Multicall3, ENS and, on
 * Base, the OP Stack's formatters and serializers. A configuration names its chain by id only and
 * adds what belongs to its own deployment (RPC URLs, polling, the log window); everything else is
 * read from here. A configuration on any other chain id is refused.
 *
 * What is changed from viem:
 * - Base and Base Sepolia make a block every 200 ms: blocks 61 429 229 and 61 441 608 are 2 476 s
 *   apart (2026-11-21), and over 10 000 blocks on both networks on 2026-11-23. viem 2.52 still says
 *   2 000 (2.58 says 200); the SDK's `findBlockAt` guesses with it and took 35 reads with 2 000
 *   where 200 takes five. Drop the line once viem is past 2.58.
 * - Sepolia has no `blockTime` in viem: 12 s, a slot, as Ethereum.
 * - The stand's anvil (31337) is viem's `foundry` with the name screens show, a second's pace (the
 *   stand mines a block a second) and marked a test network.
 */
const BASE_BLOCK_MS = 200;

export const LOCAL_CHAIN: Chain = defineChain({ ...foundry, name: "Local test network", blockTime: 1_000, testnet: true });

const KNOWN: Readonly<Record<number, Chain>> = Object.freeze({
  [mainnet.id]: mainnet,
  [sepolia.id]: defineChain({ ...sepolia, blockTime: 12_000 }),
  [base.id]: defineChain({ ...base, blockTime: BASE_BLOCK_MS }),
  [baseSepolia.id]: defineChain({ ...baseSepolia, blockTime: BASE_BLOCK_MS }),
  [LOCAL_CHAIN_ID]: LOCAL_CHAIN,
});

/** viem's descriptions of the chains aHand knows. The bundle carries them whole (tests/bundle/audit.ts reads their addresses from here). */
export const KNOWN_CHAINS: readonly Chain[] = Object.freeze(Object.values(KNOWN));

/** The ids aHand knows: Ethereum, Sepolia, Base, Base Sepolia and the stand's anvil. */
export const KNOWN_CHAIN_IDS: readonly number[] = Object.freeze(Object.keys(KNOWN).map(Number));

/** viem's description of a chain aHand knows, or undefined for any other id. */
export function knownChain(id: number): Chain | undefined {
  return Object.hasOwn(KNOWN, id) ? KNOWN[id] : undefined;
}

/** What a configuration's chain takes from viem's description. */
export interface ChainFacts {
  name: string;
  /** The chain's real pace in milliseconds. */
  blockTimeMs: number;
  /** An OP Stack chain with Ethereum behind it: viem names the chain it settles on (`sourceId`). */
  hasL1: boolean;
  /** viem marks it a test network. */
  testnet: boolean;
  /** The chain's block explorer, without a trailing slash; undefined where viem names none (anvil). */
  explorer?: string;
  /** Multicall3 on the chain, checksummed; null where viem names none (anvil). */
  multicall3: Address | null;
}

/** The facts of a known chain. Throws for an id aHand does not know. */
export function chainFacts(id: number): ChainFacts {
  const chain = knownChain(id);
  if (!chain) throw new Error(`chain ${id} is not one aHand knows: ${KNOWN_CHAIN_IDS.join(", ")}`);
  const explorer = chain.blockExplorers?.default.url.replace(/\/+$/, "");
  const multicall3 = chain.contracts?.multicall3?.address;
  return {
    name: chain.name,
    blockTimeMs: chain.blockTime ?? 1_000,
    hasL1: chain.sourceId !== undefined,
    testnet: chain.testnet === true,
    ...(explorer ? { explorer } : {}),
    multicall3: multicall3 ? getAddress(multicall3) : null,
  };
}

/** A configuration's chain section with viem's facts for its id: what the app reads as `config.chain`. Throws for an unknown id. */
export function chainConfigOf(input: ChainInput): ChainConfig {
  const { multicall3: _, explorer, ...facts } = chainFacts(input.id);
  return { ...input, ...facts, ...(explorer ? { explorer } : {}) };
}

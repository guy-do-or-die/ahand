/**
 * The app's build-time configuration (ARCHITECTURE §7). The stand writes it per slot; a real
 * deployment writes its own. It is public: it holds no secret, only addresses and choices.
 */

export type Hex = `0x${string}`;
export type Address = Hex;

export interface ChainConfig {
  id: number;
  name: string;
  rpcUrls: string[];
  /** How often the block watcher polls: the chain's block time. */
  blockTimeMs: number;
  /** A local test chain: the dev wallet and the LOCAL STAND-IN tags exist only here. */
  local: boolean;
  /** An OP Stack chain with Ethereum behind it (L1 fee, "Recorded on Ethereum"). */
  hasL1: boolean;
}

export interface TrustedCoreConfig {
  chainId: number;
  core: Address;
}

export interface DeploymentFacts {
  /** The CREATE2 deployer Core came through. */
  factory: Address;
  salt: Hex;
  initcodeHash: Hex;
  deployBlock: number;
  commit: string;
  dirty: boolean;
}

export type TokenKind = "usd" | "blacklist" | "usdc" | (string & {});

export interface TokenConfig {
  address: Address;
  symbol: string;
  decimals: number;
  kind: TokenKind;
  /** What people read, e.g. "Test dollars". */
  label: string;
}

export interface PriceSnapshot {
  date: string;
  ethUsd: number;
  base: { gwei: number };
  ethereum: { gwei: number };
  source: string;
}

export interface Defaults {
  /** The least the helper gets, in basis points. */
  minClaimBps: number;
  /** Gas each payout may use, in thousands. */
  payoutGasK: number;
  expiryDays: number;
}

export interface AppConfig {
  chain: ChainConfig;
  cores: { trusted: TrustedCoreConfig[]; canonical: Address | null };
  deployment: DeploymentFacts | null;
  tokens: TokenConfig[];
  /** The forwarder that runs an undeployed account's setup call (Multicall3 on real networks). */
  forwarder: Address | null;
  /** The test account factory; null off the stand. */
  accountFactory: Address | null;
  /** Relay URLs for delivering a Give; none by default. */
  relays: string[];
  /** The site's own origin, e.g. "https://ahand.example". */
  site: string;
  prices: PriceSnapshot;
  defaults: Defaults;
}

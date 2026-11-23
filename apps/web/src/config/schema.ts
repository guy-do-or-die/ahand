/**
 * The app's build-time configuration. The stand writes it per slot; a real
 * deployment writes its own. It is public: it holds no secret, only addresses and choices.
 */

export type Hex = `0x${string}`;
export type Address = Hex;

/**
 * The chain section a configuration file writes: the chain's id and what belongs to this one
 * deployment. Everything else about the chain (its name, pace, explorer, Multicall3, whether it is a
 * test network or an OP Stack chain) comes from viem/chains by id (config/chains.ts). Such a field
 * left in an older file (a stand slot brought up before) is passed over, and viem's value stands.
 */
export interface ChainInput {
  /** One of the chains aHand knows: 1, 11155111, 8453, 84532, or the stand's 31337. */
  id: number;
  rpcUrls: string[];
  /**
   * How often the app asks the chain for news (the block watcher, viem's and wagmi's polling), in
   * milliseconds. Absent: the block time, but at least a second (`pollMsOf`). Base Sepolia sets
   * 2 000, so its public RPC is not asked five times a second.
   */
  pollMs?: number;
  /**
   * The widest `eth_getLogs` range, in blocks, that the chain's RPCs take, when it is below the
   * SDK's 2 000 (Base Sepolia's public RPC: 200). Log reads start at it rather than learning it
   * from a refusal. Absent: 2 000, and a node that takes less still makes the window shrink.
   */
  logWindow?: number;
  /** A local test chain: the dev wallet and the LOCAL STAND-IN tags exist only here. */
  local: boolean;
}

/** A configuration's chain as the app reads it: the file's section and viem's facts for its id. */
export interface ChainConfig extends ChainInput {
  /** viem's name for the chain ("Base Sepolia"), the one a wallet stores when it adds the network. */
  name: string;
  /**
   * The chain's real pace: one block every so many milliseconds (Base: 200). The SDK's
   * `findBlockAt` guesses a block from a time with it. Not how often the app asks: see `pollMs`.
   */
  blockTimeMs: number;
  /** An OP Stack chain with Ethereum behind it (L1 fee, "Recorded on Ethereum"). */
  hasL1: boolean;
  /**
   * A test network (Sepolia, Base Sepolia, the stand): its money is worth nothing, and the header
   * says so. See `isTestnet`.
   */
  testnet: boolean;
  /** The chain's block explorer, e.g. "https://sepolia.basescan.org": transactions and addresses link there. None on the stand. */
  explorer?: string;
}

/** Where test money comes from on a test network: one faucet per asset ("USDC", "ETH"). */
export interface FaucetConfig {
  /** The asset's symbol, as people read it: "USDC", "ETH". */
  asset: string;
  url: string;
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

/**
 * Logging in through Privy: one window with email, social accounts, a
 * passkey and crypto wallets; whoever comes without a crypto wallet gets one Privy keeps for them.
 * The app id is public: it ships in every page. Absent means no Privy: the app's own sheet with
 * the wallets this browser has.
 */
export interface PrivyConfig {
  /** The Privy app's public id, from the Privy dashboard. */
  appId: string;
  /**
   * The site addresses the Privy dashboard allows, as it lists them ("https://ahand.in",
   * "https://*.ahand.in", "http://localhost:3300"). On any other address Privy still opens its window
   * but cannot make the wallet, so the app says at once that logging in can't be reached there. Left out, every
   * address is tried.
   */
  origins?: string[];
}

export interface AppConfig {
  chain: ChainConfig;
  cores: { trusted: TrustedCoreConfig[]; canonical: Address | null };
  deployment: DeploymentFacts | null;
  tokens: TokenConfig[];
  /**
   * The forwarder that runs an undeployed account's setup call. A file that leaves it out gets the
   * chain's Multicall3 from viem/chains (none on the stand's anvil, so null there); the stand writes
   * the one it deploys.
   */
  forwarder: Address | null;
  /** The test account factory; null off the stand. */
  accountFactory: Address | null;
  /** Relay URLs for delivering a Give; none by default. */
  relays: string[];
  /** The site's own origin, e.g. "https://ahand.example". */
  site: string;
  prices: PriceSnapshot;
  defaults: Defaults;
  /** Faucets for this test network's money; none on a real network (and absent means none). */
  faucets?: FaucetConfig[];
  /**
   * Whether a server in front of the site (the view server) writes each page address's link-preview tags.
   * False for a static-only host: every address is /index.html as built, and a chat's preview
   * shows only the site's name. Absent means true. The public test deployment on Vercel says true:
   * a Vercel Function runs the view server for a Hand's address and its card (apps/web/deploy.ts).
   */
  previews?: boolean;
  /** Logging in through Privy; absent means none (the local stand has none). */
  privy?: PrivyConfig;
}

/** How often the app polls a chain: its `pollMs`, else its block time but at least a second. */
export function pollMsOf(chain: Pick<ChainConfig, "blockTimeMs" | "pollMs">): number {
  return chain.pollMs ?? Math.max(chain.blockTimeMs, 1_000);
}

/** A test network: local, or one viem marks a testnet (its money is test money). */
export function isTestnet(chain: Pick<ChainConfig, "local" | "testnet">): boolean {
  return chain.testnet || chain.local;
}

/** A configuration as its file writes it: the chain by id with this deployment's fields, the forwarder optional. */
export type AppConfigInput = Omit<AppConfig, "chain" | "forwarder"> & { chain: ChainInput; forwarder?: Address | null };

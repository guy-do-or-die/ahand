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
  /**
   * A public test network (Base Sepolia): its money is worth nothing, and the header says so.
   * Absent means `local` (a local chain is a test network too). See `isTestnet`.
   */
  testnet?: boolean;
  /** The chain's block explorer, e.g. "https://sepolia.basescan.org": transactions and addresses link there. */
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
 * Email sign-in through Privy (ARCHITECTURE §7 Wallets): a person without a crypto app signs in
 * with an emailed code and gets a wallet Privy keeps for them. The app id is public: it ships in
 * every page. Absent means no email sign-in: only the wallets this browser has.
 */
export interface PrivyConfig {
  /** The Privy app's public id, from the Privy dashboard. */
  appId: string;
  /**
   * The site addresses the Privy dashboard allows, as it lists them ("https://ahand.in",
   * "https://*.ahand.in"). On any other address Privy still opens its email window but cannot
   * make the wallet, so the app says at once that email can't be reached there. Left out, every
   * address is tried.
   */
  origins?: string[];
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
  /** Faucets for this test network's money; none on a real network (and absent means none). */
  faucets?: FaucetConfig[];
  /**
   * Whether a server in front of the site (face) writes each page address's link-preview tags.
   * False for a static-only host: every address is /index.html as built, and a chat's preview
   * shows only the site's name. Absent means true. The public test deployment on Vercel says true:
   * a Vercel Function runs face for a Hand's address and its card (apps/hand/vercel.ts).
   */
  previews?: boolean;
  /** Email sign-in through Privy; absent means none (the local stand has none). */
  privy?: PrivyConfig;
}

/** A test network: local, or marked `testnet` (its money is test money). */
export function isTestnet(chain: Pick<ChainConfig, "local" | "testnet">): boolean {
  return chain.testnet ?? chain.local;
}

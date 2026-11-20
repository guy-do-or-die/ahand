// The deployment JSON that contracts/script/Deploy.s.sol writes (ARCHITECTURE §3), and a reader
// that refuses anything else. Hand-written; index.ts re-exports it.

/** `usd`: MockUSD. `blacklist`: BlacklistToken (a blocked payee's payout waits: D-14). */
export type TokenKind = "usd" | "blacklist";

export type HexAddress = `0x${string}`;
export type Hex32 = `0x${string}`;

export interface DeploymentToken {
  address: HexAddress;
  symbol: string;
  decimals: number;
  kind: TokenKind;
}

export interface Deployment {
  chainId: number;
  /** AHandCore: create2(factory, salt, initcodeHash). */
  core: HexAddress;
  /** The deterministic deployer, 0x4e59b44847b379578588920cA78FbF26c0B4956C. */
  factory: HexAddress;
  /** keccak256("aHand.core/1"). */
  salt: Hex32;
  /** keccak256 of AHandCore's creation code: reproducible from `commit` with the settings below. */
  initcodeHash: Hex32;
  /** keccak256 of the code at `core`. Information only: EIP-712 immutables differ per chain. */
  runtimeHash: Hex32;
  /** A block at or before Core's deployment; 0 when unknown (scan from genesis). */
  deployBlock: number;
  /** The test tokens on 31337; empty elsewhere. */
  tokens: DeploymentToken[];
  /** The test stand-in for Multicall3's aggregate3 on 31337 (D-62); null elsewhere. */
  forwarder: HexAddress | null;
  /** KeyAccountFactory on 31337; null elsewhere. */
  accountFactory: HexAddress | null;
  /** The git commit the Core was built from, when the deployer said so. */
  commit: string | null;
  /** Whether src/ or foundry.toml differed from `commit`, when the deployer said so. */
  dirty: boolean | null;
  solc: string;
  optimizerRuns: number;
  evmVersion: string;
  oz: string;
}

export class DeploymentError extends Error {
  constructor(message: string) {
    super(`deployment JSON: ${message}`);
    this.name = "DeploymentError";
  }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const KINDS: readonly TokenKind[] = ["usd", "blacklist"];
const FIELDS = [
  "chainId", "core", "factory", "salt", "initcodeHash", "runtimeHash", "deployBlock", "tokens",
  "forwarder", "accountFactory", "commit", "dirty", "solc", "optimizerRuns", "evmVersion", "oz",
] as const;

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new DeploymentError(`${where} is not an object`);
  return value as Record<string, unknown>;
}

function address(value: unknown, where: string): HexAddress {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw new DeploymentError(`${where} is not an address`);
  return value as HexAddress;
}

function hash(value: unknown, where: string): Hex32 {
  if (typeof value !== "string" || !HASH.test(value)) throw new DeploymentError(`${where} is not a 32-byte hex value`);
  return value as Hex32;
}

function count(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new DeploymentError(`${where} is not a whole number`);
  return value;
}

function text(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) throw new DeploymentError(`${where} is not a text`);
  return value;
}

/**
 * Reads a deployment JSON (parsed or as text) and returns it typed, or throws DeploymentError naming
 * the first field that is missing or malformed. It checks the shape only: whether the chain agrees is
 * the job of `contracts/script/check-deployment.sh` and of the app's Core check.
 */
export function parseDeployment(input: unknown): Deployment {
  const raw = record(typeof input === "string" ? JSON.parse(input) : input, "the file");
  for (const key of FIELDS) {
    if (!(key in raw)) throw new DeploymentError(`field ${key} is missing`);
  }

  const chainId = count(raw.chainId, "chainId");
  const local = chainId === 31337;

  if (!Array.isArray(raw.tokens)) throw new DeploymentError("tokens is not a list");
  const tokens = raw.tokens.map((entry, i): DeploymentToken => {
    const token = record(entry, `tokens[${i}]`);
    const kind = token.kind;
    if (!KINDS.includes(kind as TokenKind)) throw new DeploymentError(`tokens[${i}].kind is not one of ${KINDS.join(", ")}`);
    const decimals = count(token.decimals, `tokens[${i}].decimals`);
    if (decimals > 255) throw new DeploymentError(`tokens[${i}].decimals is above 255`);
    return {
      address: address(token.address, `tokens[${i}].address`),
      symbol: text(token.symbol, `tokens[${i}].symbol`),
      decimals,
      kind: kind as TokenKind,
    };
  });

  const helper = (key: "forwarder" | "accountFactory"): HexAddress | null => {
    if (raw[key] === null) {
      if (local) throw new DeploymentError(`${key} is null on chain 31337`);
      return null;
    }
    if (!local) throw new DeploymentError(`${key} is set off chain 31337: test code is never deployed there`);
    return address(raw[key], key);
  };

  if (raw.commit !== null && (typeof raw.commit !== "string" || !COMMIT.test(raw.commit))) {
    throw new DeploymentError("commit is neither null nor a 40-digit commit");
  }
  if (raw.dirty !== null && typeof raw.dirty !== "boolean") throw new DeploymentError("dirty is neither null nor true or false");

  return {
    chainId,
    core: address(raw.core, "core"),
    factory: address(raw.factory, "factory"),
    salt: hash(raw.salt, "salt"),
    initcodeHash: hash(raw.initcodeHash, "initcodeHash"),
    runtimeHash: hash(raw.runtimeHash, "runtimeHash"),
    deployBlock: count(raw.deployBlock, "deployBlock"),
    tokens,
    forwarder: helper("forwarder"),
    accountFactory: helper("accountFactory"),
    commit: raw.commit as string | null,
    dirty: raw.dirty as boolean | null,
    solc: text(raw.solc, "solc"),
    optimizerRuns: count(raw.optimizerRuns, "optimizerRuns"),
    evmVersion: text(raw.evmVersion, "evmVersion"),
    oz: text(raw.oz, "oz"),
  };
}

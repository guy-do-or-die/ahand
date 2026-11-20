/**
 * Build facts, from a clone and nothing else: the hash of a built folder, the Core's initcode as
 * this tree builds it, the compiler settings that made it, and the manifest of a deployment.
 *
 * `tools/ahand.ts manifest` and `core-check` use it; the stand imports `hashDir` to write the
 * `build.json` that the `/core` screen fetches (ARCHITECTURE §7).
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseDeployment, type Deployment } from "@ahand/abi";
import { getContractAddress, keccak256, stringToBytes, type Address, type Hex } from "viem";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CONTRACTS = join(REPO_ROOT, "contracts");
export const CORE_ARTIFACT = join(CONTRACTS, "out/AHandCore.sol/AHandCore.json");
export const CORE_SOURCE = join(CONTRACTS, "src/AHandCore.sol");

/** The deterministic deployer every chain has, and the one salt (ARCHITECTURE §3, D-10). */
export const CREATE2_FACTORY: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
export const CORE_SALT: Hex = keccak256(stringToBytes("aHand.core/1"));

/* ---------------------------------------------------------------- hashDir */

export interface HashedFile {
  /** The path inside the folder, with `/` between parts. */
  path: string;
  sha256: string;
  bytes: number;
}

export interface DirHash {
  /** sha256 over the lines `<sha256>  <path>\n` of every file, sorted by the path's bytes. */
  hash: string;
  files: HashedFile[];
}

/** `build.json` is what the stand writes beside a build from this very hash, so it is never part of it. */
export const HASH_DIR_SKIP = ["build.json"];

/**
 * The sha256 of every file in `dir` and one hash over the sorted list. The list is written as
 * `sha256sum` writes it, so the hash can be checked without this code:
 *
 *   cd <dir> && find . -type f ! -path ./build.json -printf '%P\n' | LC_ALL=C sort | xargs -d '\n' sha256sum | sha256sum
 *
 * A symbolic link is refused: what it points to is not part of the folder. Files named in `skip`
 * (paths inside the folder) are left out; by default only a top-level `build.json`.
 */
export function hashDir(dir: string, skip: readonly string[] = HASH_DIR_SKIP): DirHash {
  const root = resolve(dir);
  if (!existsSync(root) || !lstatSync(root).isDirectory()) throw new Error(`${dir} is not a folder`);
  const files: HashedFile[] = [];
  const walk = (folder: string) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      const stat = lstatSync(path);
      const inside = relative(root, path).split(sep).join("/");
      if (stat.isSymbolicLink()) throw new Error(`${inside} is a symbolic link; a built folder holds files only`);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) {
        if (skip.includes(inside)) continue;
        const bytes = readFileSync(path);
        files.push({ path: inside, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
      }
    }
  };
  walk(root);
  files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const list = files.map((file) => `${file.sha256}  ${file.path}\n`).join("");
  return { hash: createHash("sha256").update(list).digest("hex"), files };
}

/** The command that recomputes `hashDir(dir).hash` with coreutils alone. */
export function hashDirCommand(dir: string): string {
  return `cd ${dir} && find . -type f ! -path ./build.json -printf '%P\\n' | LC_ALL=C sort | xargs -d '\\n' sha256sum | sha256sum`;
}

/* ----------------------------------------------------------- Core's build */

export interface CompilerSettings {
  solc: string;
  optimizer: boolean;
  optimizerRuns: number;
  evmVersion: string;
  viaIR: boolean;
  /** How the metadata hash is appended to the code (`ipfs` by default): it is part of the initcode. */
  bytecodeHash: string;
  /**
   * The remappings the compiler was given: they are part of the metadata, so of the initcode too.
   * This clone's own folder is written `<repo>/`, so a manifest never carries a home path.
   */
  remappings: string[];
  /**
   * Whether a remapping names an absolute path. Foundry's auto-detected remappings can (a context
   * remapping for a nested library): the metadata hash, and with it the initcode hash and Core's
   * address, then depend on the folder the clone sits in.
   */
  pathDependent: boolean;
}

export interface CoreBuild {
  /** keccak256 of AHandCore's creation code in contracts/out. */
  initcodeHash: Hex;
  initcodeBytes: number;
  /** Whether contracts/src/AHandCore.sol is the source this artifact was compiled from (the metadata's keccak256). */
  sourceMatches: boolean;
  /** sha256 of contracts/src/AHandCore.sol, the number the owner's records cite. */
  sourceSha256: string;
  compiler: CompilerSettings;
}

/** Reads AHandCore's artifact from contracts/out; refuses a missing or stale one in a plain sentence. */
export function coreBuild(artifact = CORE_ARTIFACT, source = CORE_SOURCE): CoreBuild {
  if (!existsSync(artifact)) {
    throw new Error(`there is no built Core at ${relative(process.cwd(), artifact) || artifact}: build it first (${buildCommand()})`);
  }
  const json = JSON.parse(readFileSync(artifact, "utf8"));
  const bytecode = json.bytecode?.object as Hex | undefined;
  if (!bytecode || bytecode === "0x") throw new Error(`${artifact} holds no creation code`);
  const meta = json.metadata ?? JSON.parse(json.rawMetadata ?? "{}");
  const settings = meta.settings ?? {};
  const sourceBytes = existsSync(source) ? readFileSync(source) : undefined;
  const recorded = (Object.entries(meta.sources ?? {}) as [string, { keccak256?: string }][])
    .find(([path]) => path.endsWith("src/AHandCore.sol"))?.[1]?.keccak256;
  const remappings: string[] = Array.isArray(settings.remappings) ? settings.remappings.map(String) : [];
  return {
    initcodeHash: keccak256(bytecode),
    initcodeBytes: (bytecode.length - 2) / 2,
    sourceMatches: sourceBytes !== undefined && recorded !== undefined && keccak256(sourceBytes) === recorded.toLowerCase(),
    sourceSha256: sourceBytes ? createHash("sha256").update(sourceBytes).digest("hex") : "",
    compiler: {
      solc: String(meta.compiler?.version ?? "").replace(/\+commit\..*$/, ""),
      optimizer: Boolean(settings.optimizer?.enabled),
      optimizerRuns: Number(settings.optimizer?.runs ?? 0),
      evmVersion: String(settings.evmVersion ?? ""),
      viaIR: Boolean(settings.viaIR),
      bytecodeHash: String(settings.metadata?.bytecodeHash ?? "ipfs"),
      remappings: remappings.map((entry) => entry.split(REPO_ROOT + sep).join("<repo>/")),
      pathDependent: remappings.some((entry) => entry.split(/[:=]/).some((part) => part.startsWith("/"))),
    },
  };
}

/** The Core address `create2(factory, salt, initcodeHash)`: the trust anchor of D-10. */
export function coreAddressOf(initcodeHash: Hex, factory: Address = CREATE2_FACTORY, salt: Hex = CORE_SALT): Address {
  return getContractAddress({ opcode: "CREATE2", from: factory, salt, bytecodeHash: initcodeHash });
}

function foundryCommand(tool: "forge" | "cast"): string {
  return `"\${FOUNDRY_BIN:-$HOME/.foundry/bin}/${tool}"`;
}

export function buildCommand(): string {
  return `cd contracts && ${foundryCommand("forge")} build`;
}

/** The one command that rebuilds Core in a clone and prints its initcode hash. */
export function reproduceCommand(commit?: string | null): string {
  const checkout = commit ? `git checkout ${commit} && ` : "";
  return `${checkout}${buildCommand()} && ${foundryCommand("cast")} keccak "$(jq -r .bytecode.object out/AHandCore.sol/AHandCore.json)"`;
}

/* ------------------------------------------------------------------- tree */

export interface TreeState {
  /** The commit checked out here, or null outside git. */
  commit: string | null;
  /** Whether Core's build inputs (contracts/src, contracts/foundry.toml) differ from that commit. */
  dirty: boolean | null;
}

export function treeState(): TreeState {
  const git = (args: string[]) => spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  const head = git(["rev-parse", "HEAD"]);
  if (head.status !== 0) return { commit: null, dirty: null };
  const status = git(["status", "--porcelain", "--", "contracts/src", "contracts/foundry.toml"]);
  return { commit: head.stdout.trim(), dirty: status.status === 0 ? status.stdout.trim() !== "" : null };
}

export function sdkVersion(): string {
  return JSON.parse(readFileSync(join(REPO_ROOT, "packages/sdk/package.json"), "utf8")).version as string;
}

/* --------------------------------------------------------------- manifest */

export interface Manifest extends Deployment {
  /** Where `commit` and `dirty` come from: the deployment file, or this tree when the file had none and the initcode matches. */
  commitFrom: "deployment" | "tree" | null;
  /** The clone the manifest was written in. */
  tree: TreeState;
  /** The settings this tree's Core artifact was compiled with. */
  compiler: CompilerSettings;
  /** Whether the deployment's initcodeHash is the one this tree builds, and that hash. */
  initcode: { tree: Hex; matches: boolean; sourceMatches: boolean; sourceSha256: string; reproduce: string };
  sdk: { version: string };
  /** The built app folder, when one was given. */
  app: { hash: string; files: number; reproduce: string } | null;
}

/** Reads a deployment JSON, or a stand file that holds one under `deployment`. */
export function readDeployment(file: string): Deployment {
  if (!existsSync(file)) throw new Error(`there is no deployment file at ${file}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${file} is not JSON`);
  }
  const inner = (raw as { deployment?: unknown }).deployment;
  return parseDeployment(inner !== undefined && typeof inner === "object" ? inner : raw);
}

export function deploymentPath(chainId: number): string {
  return join(CONTRACTS, "deployments", `${chainId}.json`);
}

/** The manifest of a deployment: its own fields, plus what this clone says about the build. */
export function manifestOf(deployment: Deployment, options: { app?: string; build?: CoreBuild; tree?: TreeState } = {}): Manifest {
  const build = options.build ?? coreBuild();
  const tree = options.tree ?? treeState();
  const matches = build.initcodeHash.toLowerCase() === deployment.initcodeHash.toLowerCase();
  let { commit, dirty } = deployment;
  let commitFrom: Manifest["commitFrom"] = commit !== null && dirty !== null ? "deployment" : null;
  // A file written without deploy.sh does not say its commit. This tree may say it for the file
  // only if it builds the very initcode the file names.
  if (commitFrom === null && matches && tree.commit !== null) {
    commit = commit ?? tree.commit;
    dirty = dirty ?? tree.dirty;
    commitFrom = "tree";
  }
  let app: Manifest["app"] = null;
  if (options.app) {
    const hashed = hashDir(options.app);
    app = { hash: hashed.hash, files: hashed.files.length, reproduce: hashDirCommand(options.app) };
  }
  return {
    ...deployment,
    commit,
    dirty,
    commitFrom,
    tree,
    compiler: build.compiler,
    initcode: {
      tree: build.initcodeHash,
      matches,
      sourceMatches: build.sourceMatches,
      sourceSha256: build.sourceSha256,
      reproduce: reproduceCommand(commit),
    },
    sdk: { version: sdkVersion() },
    app,
  };
}

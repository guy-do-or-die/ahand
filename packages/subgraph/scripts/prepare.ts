#!/usr/bin/env bun
/**
 * Emits subgraph.<chain>.yaml from subgraph.template.yaml.
 *
 * Usage: bun run scripts/prepare.ts [chain]        (default: base-sepolia)
 *
 * Single source of truth: ../abi/src/addresses.<chain>.json, expected shape
 *   {
 *     "AHandCore": "0x...",              // required — datasource address
 *     "deployBlock": 12345678,           // preferred — startBlock
 *     // or per-contract: "deployBlock": { "AHandCore": 12345678 }
 *     ...other contracts/roles ignored here
 *   }
 * Missing deployBlock falls back to startBlock 1 with a loud warning (full
 * wasteful scan — fine for placeholders, wrong for a real Studio deploy).
 * For chain "anvil" the un-suffixed addresses.json is used as fallback.
 *
 * ABI preference: packages/abi/abis/AHandCore.json (raw ABI emitted by
 * packages/abi/scripts/generate.ts from forge artifacts) is used IF it
 * declares all nine Core events with the frozen signatures; otherwise the
 * hand-written ./abis/AHandCore.events.json fragments are used. This guards
 * against a stale pre-revamp artifact silently breaking `graph build`.
 */
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "fs";

const PKG_DIR = join(import.meta.dirname, "..");
const ABI_PKG_DIR = join(PKG_DIR, "../abi");

const NETWORK_NAMES: Record<string, string> = {
  // Chain key (addresses file suffix) → The Graph network name.
  // "base-sepolia" is the Subgraph Studio network name for Base Sepolia.
  "base-sepolia": "base-sepolia",
  base: "base",
  sepolia: "sepolia",
  anvil: "anvil", // local graph-node: name it "anvil" in its config
};

function fail(message: string): never {
  console.error(`[prepare] ERROR: ${message}`);
  process.exit(1);
}

function warn(message: string): void {
  console.warn(`[prepare] WARN: ${message}`);
}

/** Canonical "Name(type1,type2,...)" signatures of every event in an ABI. */
function eventSignatures(abi: unknown): Set<string> {
  if (!Array.isArray(abi)) return new Set();
  const out = new Set<string>();
  for (const item of abi) {
    if (item && typeof item === "object" && (item as any).type === "event") {
      const name = (item as any).name;
      const inputs = ((item as any).inputs ?? []) as Array<{ type: string }>;
      out.add(`${name}(${inputs.map((i) => i.type).join(",")})`);
    }
  }
  return out;
}

const chain = process.argv[2] ?? process.env.AHAND_CHAIN ?? "base-sepolia";
const network = NETWORK_NAMES[chain] ?? chain;
if (!(chain in NETWORK_NAMES)) {
  warn(`unknown chain "${chain}" — using it verbatim as the network name`);
}

// --- addresses + deployBlock -------------------------------------------------
let addressesPath = join(ABI_PKG_DIR, `src/addresses.${chain}.json`);
if (!existsSync(addressesPath) && chain === "anvil") {
  addressesPath = join(ABI_PKG_DIR, "src/addresses.json");
}
if (!existsSync(addressesPath)) {
  fail(`addresses file not found: ${addressesPath}`);
}
const addresses = JSON.parse(readFileSync(addressesPath, "utf-8"));

const address: string | undefined = addresses.AHandCore;
if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
  fail(`"AHandCore" missing or malformed in ${addressesPath}`);
}

let startBlock = 1;
const deployBlock = addresses.deployBlock;
if (typeof deployBlock === "number") {
  startBlock = deployBlock;
} else if (deployBlock && typeof deployBlock === "object" && typeof deployBlock.AHandCore === "number") {
  startBlock = deployBlock.AHandCore;
} else {
  warn(
    `no usable "deployBlock" in ${addressesPath} — defaulting startBlock to 1 (placeholder only; add deployBlock before a real deploy)`
  );
}

// --- ABI selection -----------------------------------------------------------
const eventsOnlyPath = join(PKG_DIR, "abis/AHandCore.events.json");
const requiredSignatures = eventSignatures(
  JSON.parse(readFileSync(eventsOnlyPath, "utf-8"))
);

let abiFile = "./abis/AHandCore.events.json";
const generatedAbiPath = join(ABI_PKG_DIR, "abis/AHandCore.json");
if (existsSync(generatedAbiPath)) {
  const generated = eventSignatures(
    JSON.parse(readFileSync(generatedAbiPath, "utf-8"))
  );
  const missing = [...requiredSignatures].filter((s) => !generated.has(s));
  if (missing.length === 0) {
    // Copy locally so the manifest never references outside the package.
    copyFileSync(generatedAbiPath, join(PKG_DIR, "abis/AHandCore.json"));
    abiFile = "./abis/AHandCore.json";
    console.log(`[prepare] using generated full ABI: ${generatedAbiPath}`);
  } else {
    warn(
      `generated ABI ${generatedAbiPath} lacks expected events (stale artifact?):\n  ${missing.join(
        "\n  "
      )}\nfalling back to events-only fragments`
    );
  }
} else {
  console.log(
    "[prepare] generated full ABI not found — using events-only fragments"
  );
}

// --- render ------------------------------------------------------------------
const template = readFileSync(join(PKG_DIR, "subgraph.template.yaml"), "utf-8");
const rendered = template
  .replace(/\{\{network\}\}/g, network)
  .replace(/\{\{address\}\}/g, address)
  .replace(/\{\{startBlock\}\}/g, String(startBlock))
  .replace(/\{\{abiFile\}\}/g, abiFile);

if (/\{\{[a-zA-Z]+\}\}/.test(rendered)) {
  fail("unreplaced placeholder left in rendered manifest");
}

const outPath = join(PKG_DIR, `subgraph.${chain}.yaml`);
writeFileSync(outPath, rendered);
console.log(
  `[prepare] wrote ${outPath} (network=${network} address=${address} startBlock=${startBlock} abi=${abiFile})`
);

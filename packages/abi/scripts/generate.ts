import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";

const ROOT_DIR = join(import.meta.dirname, "../../../");
const OUT_DIR = join(import.meta.dirname, "../src");
// Raw ABI JSONs for non-TS consumers (e.g. packages/subgraph graph-cli).
const ABIS_DIR = join(import.meta.dirname, "../abis");

const TARGETS = {
  AHandCore: "contracts/out/AHandCore.sol/AHandCore.json",
  AHandSignals: "contracts/out/AHandSignals.sol/AHandSignals.json",
  AHandWitness: "contracts/out/AHandWitness.sol/AHandWitness.json",
  MockUSD: "contracts/out/MockUSD.sol/MockUSD.json",
};

let output = `// Generated automatically from Solidity artifacts. Do not modify manually.
`;

mkdirSync(ABIS_DIR, { recursive: true });
for (const [name, relPath] of Object.entries(TARGETS)) {
  const fullPath = join(ROOT_DIR, relPath);
  if (!existsSync(fullPath)) {
    throw new Error(`No forge artifact for ${name} at ${relPath}`);
  }
  const data = JSON.parse(readFileSync(fullPath, "utf-8"));
  if (!data.abi) {
    throw new Error(`No ABI found for ${name} at ${relPath}`);
  }
  output += `
export const ${name}Abi = ${JSON.stringify(data.abi, null, 2)} as const;
`;
  // Also emit the raw ABI (packages/abi/abis/<Name>.json) for consumers that
  // need plain JSON, e.g. packages/subgraph's prepare.ts / graph-cli.
  writeFileSync(join(ABIS_DIR, `${name}.json`), JSON.stringify(data.abi, null, 2) + "\n");
}

// AHAND_CHAIN=base-sepolia picks addresses.base-sepolia.json; default is the anvil stand.
const chain = process.env.AHAND_CHAIN;
const chainPath = chain ? join(OUT_DIR, `addresses.${chain}.json`) : null;
if (chainPath && !existsSync(chainPath)) {
  throw new Error(`AHAND_CHAIN=${chain} but ${chainPath} does not exist`);
}
const addressesPath = chainPath ?? join(OUT_DIR, "addresses.json");
if (existsSync(addressesPath)) {
  const addrData = JSON.parse(readFileSync(addressesPath, "utf-8"));
  output += `
export const DeployedAddresses = ${JSON.stringify(addrData, null, 2)} as const;
`;
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "index.ts"), output);
console.log("Successfully generated ABIs at packages/abi/src/index.ts");

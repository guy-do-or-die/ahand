import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";

const ROOT_DIR = join(import.meta.dirname, "../../../");
const OUT_DIR = join(import.meta.dirname, "../src");

const TARGETS = {
  AHandCore: "contracts/out/AHandCore.sol/AHandCore.json",
  AHandSignals: "contracts/out/AHandSignals.sol/AHandSignals.json",
  AHandWitness: "contracts/out/AHandWitness.sol/AHandWitness.json",
  StaticAnchor: "contracts/out/StaticAnchor.sol/StaticAnchor.json",
  MockERC20: "contracts/out/AHand.attacks.t.sol/MockERC20.json",
};

let output = `// Generated automatically from Solidity artifacts. Do not modify manually.
`;

for (const [name, relPath] of Object.entries(TARGETS)) {
  const fullPath = join(ROOT_DIR, relPath);
  const data = JSON.parse(readFileSync(fullPath, "utf-8"));
  if (!data.abi) {
    throw new Error(`No ABI found for ${name} at ${relPath}`);
  }
  output += `
export const ${name}Abi = ${JSON.stringify(data.abi, null, 2)} as const;
`;
}

const addressesPath = join(OUT_DIR, "addresses.json");
if (existsSync(addressesPath)) {
  const addrData = JSON.parse(readFileSync(addressesPath, "utf-8"));
  output += `
export const DeployedAddresses = ${JSON.stringify(addrData, null, 2)} as const;
`;
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "index.ts"), output);
console.log("Successfully generated ABIs at packages/abi/src/index.ts");

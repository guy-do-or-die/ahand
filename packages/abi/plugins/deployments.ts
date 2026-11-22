// A @wagmi/cli plugin: writes DEPLOYMENTS, the deployment records of contracts/deployments/<chainId>.json,
// into the generated file, next to the ABIs the foundry plugin gives. @wagmi/cli has no plugin for a
// record like ours, so this is the one piece of the generation that is aHand's own.
//
// A record is shipped to apps as the place their money goes, so the plugin checks its values, not
// only its shape, before it writes it (see checkRecord): checksummed addresses, the deterministic
// deployer, aHand's salt, the initcode hash of the AHandCore this tree builds (contracts/out), and
// core = create2(factory, salt, initcodeHash). The local chain's 31337*.json files are not included.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Plugin } from "@wagmi/cli";
import { getAddress, getContractAddress, keccak256, toBytes, type Hex } from "viem";

import { parseDeployment, type Deployment } from "../src/deployment.js";

/** The deterministic deployer every record's Core is created through. */
export const FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
/** The salt of aHand's Core on every chain. */
export const SALT = keccak256(toBytes("aHand.core/1"));

export interface DeploymentsConfig {
  /** The folder of the records, contracts/deployments. */
  records: string;
  /** The forge artifact of the AHandCore this tree builds, contracts/out/AHandCore.sol/AHandCore.json. */
  artifact: string;
}

/** keccak256 of the creation code in a forge artifact. */
export function initcodeHashOf(artifact: string): Hex {
  if (!existsSync(artifact)) throw new Error(`No forge artifact at ${artifact}: run forge build in contracts/`);
  const bytecode = JSON.parse(readFileSync(artifact, "utf-8")).bytecode?.object;
  if (typeof bytecode !== "string" || !/^0x[0-9a-fA-F]+$/.test(bytecode)) throw new Error(`No creation code in ${artifact}`);
  return keccak256(bytecode as Hex);
}

/**
 * Checks a record's values: it must name the Core this tree builds, at the address that Core gets
 * from the deterministic deployer with aHand's salt, with every address in its EIP-55 checksum.
 */
export function checkRecord(file: string, deployment: Deployment, initcodeHash: Hex): void {
  const fail = (message: string): never => {
    throw new Error(`contracts/deployments/${file}: ${message}`);
  };
  const addresses: [string, string | null][] = [
    ["core", deployment.core],
    ["factory", deployment.factory],
    ["forwarder", deployment.forwarder],
    ["accountFactory", deployment.accountFactory],
    ...deployment.tokens.map((token, i): [string, string] => [`tokens[${i}].address`, token.address]),
  ];
  for (const [field, value] of addresses) {
    if (value !== null && getAddress(value) !== value) fail(`${field} ${value} is not in its EIP-55 checksum (${getAddress(value)})`);
  }
  if (deployment.factory !== FACTORY) fail(`factory is ${deployment.factory}, not the deterministic deployer ${FACTORY}`);
  if (deployment.salt !== SALT) fail(`salt is ${deployment.salt}, not keccak256("aHand.core/1") ${SALT}`);
  if (deployment.initcodeHash !== initcodeHash) {
    fail(`initcodeHash is ${deployment.initcodeHash}, but the AHandCore this tree builds hashes to ${initcodeHash}`);
  }
  const core = getContractAddress({ opcode: "CREATE2", from: FACTORY, salt: SALT, bytecodeHash: initcodeHash });
  if (deployment.core !== core) fail(`core is ${deployment.core}, but create2(factory, salt, initcodeHash) is ${core}`);
}

/** The checked records, by chain id in ascending order, from <records>/<chainId>.json. */
export function readRecords(config: DeploymentsConfig): Map<number, Deployment> {
  const initcodeHash = initcodeHashOf(config.artifact);
  const found = new Map<number, Deployment>();
  const files = readdirSync(config.records)
    .map((file) => ({ file, match: /^(\d+)\.json$/.exec(file) }))
    .filter(({ match }) => match !== null && match[1] !== "31337")
    .sort((a, b) => Number(a.match![1]) - Number(b.match![1]));
  for (const { file, match } of files) {
    const deployment = parseDeployment(readFileSync(join(config.records, file), "utf-8"));
    if (deployment.chainId !== Number(match![1])) {
      throw new Error(`contracts/deployments/${file} records chain ${deployment.chainId}`);
    }
    checkRecord(file, deployment, initcodeHash);
    found.set(deployment.chainId, deployment);
  }
  return found;
}

/** The plugin: DEPLOYMENTS, frozen like NETWORKS, typed with the chains that have a record. */
export function deployments(config: DeploymentsConfig): Plugin {
  return {
    name: "Deployments",
    run() {
      const records = readRecords(config);
      const type = [...records.keys()].map((chainId) => `  readonly ${chainId}: Deployment\n`).join("");
      const values = [...records].map(([chainId, record]) => `  ${chainId}: freezeDeployment(${JSON.stringify(record)}),\n`).join("");
      return {
        // The first lines of the file: @wagmi/cli writes no header of its own.
        imports: [
          "// Generated by @wagmi/cli from packages/abi/wagmi.config.ts (bun run generate). Do not edit by hand.",
          "import { freezeDeployment, type Deployment } from './deployment.js'",
        ].join("\n"),
        content: [
          "/**",
          " * Every chain with a recorded deployment of AHandCore, from contracts/deployments/<chainId>.json as",
          " * parseDeployment reads them, checked by checkRecord (plugins/deployments.ts). A chain that is not",
          " * here has none.",
          " */",
          `export const DEPLOYMENTS: {\n${type}} = Object.freeze({\n${values}})`,
        ].join("\n"),
      };
    },
  };
}

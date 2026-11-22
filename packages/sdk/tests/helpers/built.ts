import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Abi } from "viem";

import { REPO_ROOT } from "./anvil.js";

/**
 * The ABIs the contracts' own build writes (`forge build` in contracts/), for tests that compare
 * the SDK's hand-written ABI with them. They are read from the build here until the ABI package
 * for this Core arrives in this repository; then these tests take it from there.
 */
function builtAbi(file: string, name: string): Abi {
  const path = join(REPO_ROOT, "contracts/out", file, `${name}.json`);
  try {
    return JSON.parse(readFileSync(path, "utf8")).abi as Abi;
  } catch (error) {
    throw new Error(`${path} cannot be read: build the contracts first (forge build in contracts/): ${(error as Error).message}`);
  }
}

export const AHandCoreAbi = builtAbi("AHandCore.sol", "AHandCore");
export const ForwarderAbi = builtAbi("Forwarder.sol", "Forwarder");
export const KeyAccountFactoryAbi = builtAbi("KeyAccount.sol", "KeyAccountFactory");

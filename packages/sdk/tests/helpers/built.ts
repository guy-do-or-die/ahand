import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Abi } from "viem";

import { REPO_ROOT } from "./anvil.js";

/**
 * The ABIs the contracts' own build writes (`forge build` in contracts/), read from the build
 * itself: the tests compare `@ahand/abi`, which the SDK takes Core's ABI from, with Core's, and the
 * SDK's Multicall3 fragment with the forwarder that stands in for it on the local chain.
 */
function builtAbi(file: string, name: string): Abi {
  const path = join(REPO_ROOT, "contracts/out", file, `${name}.json`);
  try {
    return JSON.parse(readFileSync(path, "utf8")).abi as Abi;
  } catch (error) {
    throw new Error(`${path} cannot be read: build the contracts first (forge build in contracts/): ${(error as Error).message}`);
  }
}

export const BuiltCoreAbi = builtAbi("AHandCore.sol", "AHandCore");
export const ForwarderAbi = builtAbi("Forwarder.sol", "Forwarder");
export const KeyAccountFactoryAbi = builtAbi("KeyAccount.sol", "KeyAccountFactory");

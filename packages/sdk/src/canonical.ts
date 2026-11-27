import { getContractAddress, type Address, type Hex } from "viem";

/**
 * The canonical Core: the one AHandCore everyone reads, at one address on every chain.
 *
 * Core cannot be changed or replaced at its address. It is created through the deterministic
 * CREATE2 deployer with a fixed salt, so its address follows from the hash of its initcode, and
 * anyone can rebuild that initcode from the repository and check it (contracts/deployments/ and
 * the deployment-record test in contracts/test/Deploy.t.sol). A new version of Core would be
 * another contract at another address.
 *
 * Links of version 1 and site addresses that leave Core's address out name this Core
 * (`LinkOptions.canonicalCore`), and the passport trusts this Core unless the caller names
 * another (`ProofOptions.coreBuild`): tests do, against a Core of their own, and so could a reader of
 * a future version.
 */

/** How a Core was created: CREATE2 from `factory`, with `salt`, of the initcode whose keccak256 is `initcodeHash`. */
export interface CoreBuild {
  /** The deterministic deployer Core is created through. */
  factory: Address;
  salt: Hex;
  /** keccak256 of Core's initcode, reproducible from the commit. */
  initcodeHash: Hex;
}

/** The canonical Core's CREATE2 inputs, as contracts/deployments/84532.json records them. */
export const CANONICAL_CORE_BUILD: CoreBuild = {
  // The deterministic deployment proxy that every EVM chain and every anvil has.
  factory: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
  // keccak256("aHand.core/1"): the same salt on every chain.
  salt: "0x4f0ff848a233427c84043ed87224bdfcb9f141e864d27833ac5d1344e3a3347d",
  initcodeHash: "0x9ccc895f301e01520380241bbf8a8a04afc8f0fed6f3b4a7d1ea9fc14ad6c47d",
};

/** The address CREATE2 gives a Core built this way. */
export function coreAddressOf(build: CoreBuild): Address {
  return getContractAddress({ opcode: "CREATE2", from: build.factory, salt: build.salt, bytecodeHash: build.initcodeHash });
}

/** The canonical Core's address, the same on every chain (tests check it is `coreAddressOf(CANONICAL_CORE_BUILD)`). */
export const CANONICAL_CORE: Address = "0x0f0555972388151D2C187f636A0855b6eE9B9685";

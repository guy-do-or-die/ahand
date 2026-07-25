import type { Address, Hex } from "viem";
import {
  ENTRY_POINT_V06_CREATECALL,
  ENTRY_POINT_V07_CREATECALL,
  ENTRY_POINT_V08_CREATECALL,
} from "./vendor/core";
import { SIMPLE_ACCOUNT_IMPLEMENTATION_V08_CREATECALL } from "./vendor/simple";

// Arachnid deterministic-deployment proxy — pre-deployed in anvil's genesis.
// Every CREATECALL below is `salt (32 bytes) ++ creationCode`, sent as tx data
// to this proxy, which CREATE2s the contract at a chain-independent address.
export const DETERMINISTIC_DEPLOYER: Address =
  "0x4e59b44847b379578588920ca78fbf26c0b4956c";

// One-time presigned deployment of the proxy itself (Nick's method), used only
// if a chain is missing it. Signer address must be funded first.
export const DEPLOYER_SIGNER: Address = "0x3fab184622dc19b6109349b94811493bf2a45362";
export const DEPLOYER_RAW_TX: Hex =
  "0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222";

// anvil account #0 — used as the utility/executor key for deploys and alto.
export const ANVIL_KEY_0: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export type AaContract = { name: string; createcall: Hex; canonical: Address };

// Canonical addresses are asserted after CREATE2-address computation — a
// mismatch means the vendored blob drifted from the ecosystem-standard deploy.
export const AA_CONTRACTS: AaContract[] = [
  {
    name: "EntryPoint v0.6",
    createcall: ENTRY_POINT_V06_CREATECALL,
    canonical: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
  },
  {
    name: "EntryPoint v0.7",
    createcall: ENTRY_POINT_V07_CREATECALL,
    canonical: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  },
  {
    name: "EntryPoint v0.8",
    createcall: ENTRY_POINT_V08_CREATECALL,
    canonical: "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
  },
  {
    name: "Simple7702Account (v0.8)",
    createcall: SIMPLE_ACCOUNT_IMPLEMENTATION_V08_CREATECALL,
    canonical: "0xe6Cae83BdE06E4c305530e199D7217f42808555B",
  },
];

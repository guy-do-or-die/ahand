/// <reference types="vite/client" />
import type { Address } from "viem";
import { entryPoint08Address } from "viem/account-abstraction";

/**
 * Account-abstraction knobs. Both roles go through the app's own /api/aa,
 * which holds the provider key and the sponsorship policy and screens every
 * op server-side (on the local stand it forwards to the mock paymaster, which
 * serves pm_* and relays bundler methods to alto). There is deliberately no
 * browser-side override: a direct provider URL would skip the screen and the
 * policy, and ship its key in the bundle.
 */
export const AA = {
  /** Master switch: social logins + sponsored sends. Default on. */
  enabled: (import.meta.env.VITE_AA_ENABLED as string | undefined) !== "false",
  bundlerUrl: "/api/aa",
  paymasterUrl: "/api/aa",
  entryPoint: { address: entryPoint08Address, version: "0.8" as const },
} as const;

/** Canonical eth-infinitism Simple7702Account (v0.8) — same address on every chain. */
export const SIMPLE_7702_IMPLEMENTATION = ((import.meta.env
  .VITE_AA_IMPLEMENTATION as string | undefined) ??
  "0xe6Cae83BdE06E4c305530e199D7217f42808555B") as Address;

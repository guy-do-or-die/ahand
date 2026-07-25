/// <reference types="vite/client" />
import type { Address } from "viem";
import { entryPoint08Address } from "viem/account-abstraction";

/**
 * Account-abstraction knobs. Local dev defaults to the stand's mock
 * paymaster proxy (it serves pm_* AND forwards bundler methods to alto,
 * so one URL covers both roles). In production point both URLs at a real
 * provider, e.g. https://api.pimlico.io/v2/8453/rpc?apikey=...
 */
export const AA = {
  /** Master switch: social logins + sponsored sends. Default on. */
  enabled: (import.meta.env.VITE_AA_ENABLED as string | undefined) !== "false",
  bundlerUrl: (import.meta.env.VITE_AA_BUNDLER_URL as string | undefined) ?? "/api/aa",
  paymasterUrl: (import.meta.env.VITE_AA_PAYMASTER_URL as string | undefined) ?? "/api/aa",
  entryPoint: { address: entryPoint08Address, version: "0.8" as const },
  sponsorshipPolicyId: import.meta.env.VITE_AA_SPONSORSHIP_POLICY_ID as string | undefined,
} as const;

/** Canonical eth-infinitism Simple7702Account (v0.8) — same address on every chain. */
export const SIMPLE_7702_IMPLEMENTATION = ((import.meta.env
  .VITE_AA_IMPLEMENTATION as string | undefined) ??
  "0xe6Cae83BdE06E4c305530e199D7217f42808555B") as Address;

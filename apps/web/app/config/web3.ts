/// <reference types="vite/client" />
import { http } from "wagmi";
import { createConfig } from "@privy-io/wagmi";
import { defineChain } from "viem";
import { base, baseSepolia, mainnet, worldchain } from "viem/chains";

export const PRIVY_APP_ID =
  (import.meta.env.VITE_PRIVY_APP_ID as string | undefined) ?? "clt69jwp204btq1o3q72cupji";

/** aHand's public Shaker identity on board routes — display resolution only;
 *  the server-held APP_SHAKER_KEY signs, this just names the hop in the UI. */
export const APP_SHAKER_ADDRESS = (
  (import.meta.env.VITE_APP_SHAKER_ADDRESS as string | undefined) ??
  "0x9092a223be934f6756F8496714063E755eBE5dd2"
).toLowerCase();

const rpcUrl = typeof window !== "undefined" ? "/api/rpc" : "http://127.0.0.1:8545";

const anvil = defineChain({
  id: 31337,
  name: "Anvil Localhost",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [rpcUrl] },
  },
});

// "anvil" (default) | "base" | "baseSepolia" | "worldchain" — public chains keep
// their built-in public RPC unless VITE_RPC_URL overrides it.
// Local dev talks to the anvil stand; a production build (ahand.in) targets
// Base Sepolia. VITE_CHAIN overrides either way.
const chainName =
  (import.meta.env.VITE_CHAIN as string | undefined) ?? (import.meta.env.PROD ? "baseSepolia" : "anvil");
const rpcOverride = import.meta.env.VITE_RPC_URL as string | undefined;

export const activeChain =
  chainName === "base"
    ? base
    : chainName === "baseSepolia"
      ? baseSepolia
      : chainName === "worldchain"
        ? worldchain
        : anvil;

// Mainnet rides along read-only for ENS resolution — names live there no
// matter which chain the app transacts on. VITE_ENS_RPC overrides the
// public default when rate limits bite.
const ensRpc = import.meta.env.VITE_ENS_RPC as string | undefined;

export const config = createConfig({
  chains: [activeChain, mainnet],
  ssr: true,
  transports: {
    [anvil.id]: http(rpcUrl),
    [base.id]: http(rpcOverride),
    [baseSepolia.id]: http(rpcOverride),
    [worldchain.id]: http(rpcOverride),
    [mainnet.id]: http(ensRpc),
  },
});

export const POLLING_INTERVAL = activeChain.id === 31337 ? 100 : 2000;

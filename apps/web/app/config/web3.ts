/// <reference types="vite/client" />
import { http } from "wagmi";
import { createConfig } from "@privy-io/wagmi";
import { defineChain } from "viem";
import { base, baseSepolia, worldchain } from "viem/chains";

export const PRIVY_APP_ID =
  (import.meta.env.VITE_PRIVY_APP_ID as string | undefined) ?? "clt69jwp204btq1o3q72cupji";

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
const chainName = (import.meta.env.VITE_CHAIN as string | undefined) ?? "anvil";
const rpcOverride = import.meta.env.VITE_RPC_URL as string | undefined;

export const activeChain =
  chainName === "base"
    ? base
    : chainName === "baseSepolia"
      ? baseSepolia
      : chainName === "worldchain"
        ? worldchain
        : anvil;

export const config = createConfig({
  chains: [activeChain],
  ssr: true,
  transports: {
    [anvil.id]: http(rpcUrl),
    [base.id]: http(rpcOverride),
    [baseSepolia.id]: http(rpcOverride),
    [worldchain.id]: http(rpcOverride),
  },
});

export const POLLING_INTERVAL = activeChain.id === 31337 ? 100 : 2000;

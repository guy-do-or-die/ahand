import { http, createConfig } from "wagmi";
import { defineChain } from "viem";

const rpcUrl = typeof window !== "undefined" ? "/api/rpc" : "http://127.0.0.1:8545";

export const activeChain = defineChain({
  id: 31337,
  name: "Anvil Localhost",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [rpcUrl] },
  },
});

export const config = createConfig({
  chains: [activeChain],
  ssr: true,
  transports: {
    [activeChain.id]: http(rpcUrl),
  },
});

export const POLLING_INTERVAL = activeChain.id === 31337 ? 100 : 2000;

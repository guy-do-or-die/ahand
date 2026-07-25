import { http, createConfig } from "wagmi";
import { defineChain } from "viem";

export const activeChain = defineChain({
  id: 31337,
  name: "Anvil Localhost",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
});

export const config = createConfig({
  chains: [activeChain],
  transports: {
    [activeChain.id]: http("http://127.0.0.1:8545"),
  },
});

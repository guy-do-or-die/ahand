import { WagmiConfig, configureChains, createConfig } from "wagmi";
import { foundry, polygon, polygonMumbai } from "wagmi/chains";

import { jsonRpcProvider } from "wagmi/providers/jsonRpc";
import { alchemyProvider } from "wagmi/providers/alchemy";

import { RainbowKitProvider, getDefaultWallets, connectorsForWallets } from "@rainbow-me/rainbowkit";

import { rainbowConfig } from "./rainbow";


const { chains, publicClient, webSocketPublicClient } = configureChains(
  [polygon, polygonMumbai],

  [
    alchemyProvider({ apiKey: import.meta.env.VITE_ALCHEMY_API_KEY! }),
    jsonRpcProvider({
      rpc: (chain) => {
        if (chain.id === foundry.id) {
          return { http: "http://localhost:8545" };
        }

        return { http: chain.rpcUrls.default.http[0] };
      },
    }),
  ],
);


const { wallets, connectors: walletConnectors } = getDefaultWallets({
    projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID, 
    appName: "aHand",
    chains,
});


const connectors = connectorsForWallets([...wallets])


const config = createConfig({
  autoConnect: true,
  connectors, 

  publicClient,
  webSocketPublicClient,
});


export const WagmiWrapper = ({children}) => {
  return (
    <WagmiConfig config={config}>
      <RainbowKitProvider chains={chains} theme={rainbowConfig.theme} modalSize="compact">
        {children}
      </RainbowKitProvider>
    </WagmiConfig>
  )
}

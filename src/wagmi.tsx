import { WagmiConfig, configureChains, createConfig } from "wagmi";
import { foundry, polygon, polygonMumbai, /*scroll,*/ scrollSepolia } from "wagmi/chains";

import { jsonRpcProvider } from "wagmi/providers/jsonRpc";
import { alchemyProvider } from "wagmi/providers/alchemy";

import { googleWallet, facebookWallet, githubWallet, discordWallet, twitterWallet } from '@zerodev/wagmi/rainbowkit';
import { RainbowKitProvider, getDefaultWallets, connectorsForWallets } from "@rainbow-me/rainbowkit";

import { rainbowConfig } from "./rainbow";


const { chains, publicClient, webSocketPublicClient } = configureChains(
  [polygonMumbai],

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


const accountConfig = {
  chains,
  options: {
    projectId: import.meta.env.VITE_ZERODEV_PROJECT_ID_POLYGON_MUMBAI,
    shimDisconnect: true
  }
}


const connectors = connectorsForWallets([
  {
    groupName: 'Connect Account',
    wallets: [
      googleWallet(accountConfig),
      githubWallet(accountConfig),
      discordWallet(accountConfig),
      twitterWallet(accountConfig),
    ]
  },

  ...wallets.map(group => ({...group, groupName: "Connect Wallet"})),
])


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

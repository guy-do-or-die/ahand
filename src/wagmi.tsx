import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig } from "wagmi";
import * as wagmiChains from "wagmi/chains";

import { http } from 'viem';

import { WalletProvider } from './wallet';


const chains = [wagmiChains.baseSepolia, wagmiChains.foundry];

const config = createConfig({
  chains,
  transports: {
    [wagmiChains.baseSepolia.id]: http(),
    [wagmiChains.foundry.id]: http("http://localhost:8545")
  }
});


const queryClient = new QueryClient();


export const WagmiWrapper = ({children}) => {
  return (
    <WalletProvider>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={config}>
          {children}
        </WagmiProvider>
      </QueryClientProvider>
    </WalletProvider>
  )
}

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig } from "wagmi";
import * as wagmiChains from "wagmi/chains";

import { ZeroDevProvider } from "@zerodev/privy";
import { PrivyProvider } from '@privy-io/react-auth';

import { http } from 'viem';


const chains = [wagmiChains.polygonMumbai, wagmiChains.foundry];

const config = createConfig({
  chains,
  transports: {
    [wagmiChains.polygonMumbai.id]: http(),
    [wagmiChains.foundry.id]: http("http://localhost:8545")
  }
});


const queryClient = new QueryClient();


export const WagmiWrapper = ({children}) => {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ZeroDevProvider projectId={import.meta.env.VITE_ZERODEV_PROJECT_ID_POLYGON_MUMBAI}>
          <PrivyProvider appId={import.meta.env.VITE_PRIVY_APP_ID}>
            {children}
          </PrivyProvider>
        </ZeroDevProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

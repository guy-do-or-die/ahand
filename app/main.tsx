import * as React from "react";
import * as ReactDOM from "react-dom/client";

import { OnchainKitProvider } from '@coinbase/onchainkit';

import { WalletProvider, chain } from "./wallet";
import { App } from "./App";


ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WalletProvider>
      <OnchainKitProvider apiKey={import.meta.env.VITE_ONCHAIN_KIT_API_KEY} chain={chain.id}>
        <App />
      </OnchainKitProvider>
    </WalletProvider>
  </React.StrictMode>,
);

import * as React from "react";
import * as ReactDOM from "react-dom/client";

import { WalletProvider } from "./wallet";
import { App } from "./App";


ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WalletProvider>
      <App />
    </WalletProvider>
  </React.StrictMode>,
);

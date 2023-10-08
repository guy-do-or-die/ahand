import "@rainbow-me/rainbowkit/styles.css";

import * as React from "react";
import * as ReactDOM from "react-dom/client";

import { WagmiWrapper } from "./wagmi";
import { App } from "./App";


ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiWrapper>
      <App />
    </WagmiWrapper>
  </React.StrictMode>,
);

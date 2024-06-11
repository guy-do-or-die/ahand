import { useState, useEffect } from 'react';

import { PrivyProvider } from '@privy-io/react-auth';
import { ZeroDevProvider } from "@zerodev/privy";

import { useConfig } from './Store';


export const ZeroDev = ({props, children}) => {
  return <>
    <ZeroDevProvider projectId={import.meta.env.VITE_ZERODEV_PROJECT_ID_POLYGON_MUMBAI}>
      {children}
    </ZeroDevProvider>
  </>
}

export const Privy = ({props, children}) => {

  const {config: globalConfig} = useConfig();

  const config = {
    appearance: {
      theme: globalConfig.theme || 'light',
    }
  }

  return <>
    <PrivyProvider appId={import.meta.env.VITE_PRIVY_APP_ID} config={config}> 
      {children}
    </PrivyProvider>
  </>
}


export const WalletProvider = ({props, children}) => {
  return <>
      <ZeroDev>
        <Privy>
          {children}
        </Privy>
      </ZeroDev>
  </>
}

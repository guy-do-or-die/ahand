import { createContext, useContext, useEffect, useMemo, useState } from "react"

import { createConfig, usePublicClient, useAccount as useWagmiAccount, useConnect, useDisconnect } from "wagmi"
import * as chains from "wagmi/chains"

import { http, toFunctionSelector } from "viem"

import { providerToSmartAccountSigner, ENTRYPOINT_ADDRESS_V06 } from "permissionless"

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth"
import { WagmiProvider, useSetActiveWallet } from "@privy-io/wagmi"

import { createKernelAccount, createZeroDevPaymasterClient } from "@zerodev/sdk"
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator"

import { kernelSmartAccount } from './connectors/kernelSmartAccount'
import { hide } from './components/Notification'
import { useConfig } from './Store'


const ZERODEV_PROJECT_ID = import.meta.env.VITE_ZERODEV_PROJECT_ID_BASE_SEPOLIA
const ZERODEV_RPC = import.meta.env.VITE_ZERODEV_RPC
const entryPoint = ENTRYPOINT_ADDRESS_V06

const supportedChains = {
  'main': chains.base,
  'test': chains.baseSepolia,
  'local': chains.foundry,
}

export const chain = supportedChains[import.meta.env.VITE_CHAIN]
export const RPC_URL = import.meta.env.VITE_RPC

export const Privy = ({children}) => {

  const { config } = useConfig()

  const privyConfig = {
    defaultChain: chain,
    supportedChains: [chain],
    loginMethods: [
      'email',
      'wallet',
      'farcaster',
      'google',
      'discord',
      'twitter',
      'github',
      'linkedin',
      'telegram',
      'instagram',
      'facebook',
    ],
    appearance: {
      theme: config.theme || 'light',
    },
    embeddedWallets: {
      createOnLogin: 'users-without-wallets',
      noPromptOnSignature: true,
    },
    externalWallets: {
      coinbaseWallet: {
        connectionOptions: 'smartWalletOnly',
      },
    },
  }

  return <>
    <PrivyProvider appId={import.meta.env.VITE_PRIVY_APP_ID} config={privyConfig}> 
      {children}
    </PrivyProvider>
  </>
}


export const useAccount = () => {

  const {
    user,
    ready,
    authenticated,
    login: privyLogin,
    logout: privyLogout,
    ...props
  } = usePrivy()

  //const { setActiveWallet } = useSetActiveWallet()
  //const { ready: walletsReady, wallets } = useWallets()
  //const { data: walletClient } = useWalletClient()

  //const account = useWagmiAccount()

  //const [smartAccountClient, setSmartAccountClient] = useState()
  //const [address, setAddress] = useState()
  //
  //const wallet = wallets.find((wallet) => wallet.address === user?.wallet.address)

  const connected = ready && authenticated && !!user?.wallet?.address

  const login = async () => {
    await privyLogin()
  }

  const logout = async () => {
    await privyLogout()
    hide()
  }

  return {
    connected,
    login,
    logout,
    ...props,
    ...user?.wallet,
  }
}


const Wallet = ({children}) => {

  const { user } = usePrivy()

  const { connectAsync } = useConnect()

  const { setActiveWallet } = useSetActiveWallet()
  const { ready: walletsReady, wallets } = useWallets()

  const embeddedWallet = wallets.find(wallet => wallet.walletClientType === "privy")

  const publicClient = usePublicClient()


  useEffect(() => {
    if (walletsReady) {
      const wallet = wallets.find(wallet => wallet.address === user?.wallet?.address)

      wallet && setActiveWallet(wallet)
    }
  }, [walletsReady])

  useEffect(() => {
    if (embeddedWallet) {
      (async () => {
        const provider = await embeddedWallet.getEthereumProvider()
        const signer = await providerToSmartAccountSigner(provider)

        const ecdsaValidator = await signerToEcdsaValidator(publicClient, {signer, entryPoint})
        const account = await createKernelAccount(publicClient, {plugins: {sudo: ecdsaValidator}, entryPoint})
        const address = account.address

        const connector = await kernelSmartAccount({
          bundlerTransport: http(`${ZERODEV_RPC}/bundler/${ZERODEV_PROJECT_ID}`),
          publicClient,
          entryPoint,
          address,
          signer,
          sponsorUserOperation: async ({ userOperation }) => {
            const zeroDevPaymaster = createZeroDevPaymasterClient({
              transport: http(`${ZERODEV_RPC}/paymaster/${ZERODEV_PROJECT_ID}`),
              entryPoint,
              chain,
            })

            return zeroDevPaymaster.sponsorUserOperation({
              userOperation,
              entryPoint,
            })
          },
        })

        await connectAsync(
          {
            connector
          },
          {
            onSuccess: data => {
              console.log(data)
            }
          }
        )
      })()
    }
  }, [embeddedWallet])

  return <>
    {children}
  </>

}


export const WalletProvider = ({children}) => {

  const queryClient = new QueryClient()
  const wagmiConfig = createConfig({
    chains: [chain],
    transports: {[chain.id]: http(RPC_URL)}
  })

  return <>
    <Privy>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <Wallet>
            {children}
          </Wallet>
        </WagmiProvider>
      </QueryClientProvider>
    </Privy>
  </>
}

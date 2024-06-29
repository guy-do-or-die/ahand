import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import { createConfig, usePublicClient, useAccount as useWagmiAccount, useWalletClient, useConnectorClient, useConnections, useConnect, useDisconnect } from 'wagmi'
import * as chains from 'wagmi/chains'

import { http, createPublicClient, zeroAddress } from 'viem'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth'
import { WagmiProvider, useSetActiveWallet } from '@privy-io/wagmi'

import { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient } from '@zerodev/sdk'
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator'
import { KERNEL_V3_1 } from '@zerodev/sdk/constants'

import { providerToSmartAccountSigner, ENTRYPOINT_ADDRESS_V07 } from 'permissionless'
import { createPimlicoPaymasterClient } from 'permissionless/clients/pimlico'
import { walletClientToSmartAccountSigner } from 'permissionless/utils'
import { smartAccount } from '@permissionless/wagmi'

import { hide } from './components/Notification'
import { useConfig } from './Store'


const supportedChains = {
  'main': chains.base,
  'test': chains.baseSepolia,
  'local': chains.foundry,
}

export const chain = supportedChains[import.meta.env.VITE_CHAIN]
export const RPC_URL = import.meta.env.VITE_RPC

const ZERODEV_PROJECT_ID = {
  'base': import.meta.env.VITE_ZERODEV_PROJECT_ID_BASE,
  'base-sepolia': import.meta.env.VITE_ZERODEV_PROJECT_ID_BASE_SEPOLIA,
}[chain.network]

const ZERODEV_RPC = import.meta.env.VITE_ZERODEV_RPC
const ZERODEV_PAYMASTER_ENTRYPOINT = ENTRYPOINT_ADDRESS_V07 
const ZERODEV_BUNDLER_ENTRYPOINT = ENTRYPOINT_ADDRESS_V07
const ZERODEV_PAYMASTER_RPC = `${ZERODEV_RPC}/paymaster/${ZERODEV_PROJECT_ID}`
const ZERODEV_BUNDLER_RPC = `${ZERODEV_RPC}/bundler/${ZERODEV_PROJECT_ID}`

const COINBASE_PAYMASTER_ENTRYPOINT = import.meta.env.VITE_PAYMASTER_ENTRYPOINT
const COINBASE_BUNDLER_ENTRYPOINT = COINBASE_PAYMASTER_ENTRYPOINT

const COINBASE_PAYMASTER_RPC = import.meta.env.VITE_PAYMASTER_RPC.replace('{chain}', chain.network)
const COINBASE_BUNDLER_RPC = COINBASE_PAYMASTER_RPC


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

  const { config, setConfig } = useConfig()

  const { ready: walletsReady, wallets } = useWallets()
  
  const { disconnectAsync } = useDisconnect()

  const wallet = wallets.find((wallet) => wallet.address === user?.wallet?.address)
  const embeddedWallet = wallets.find(wallet => wallet.walletClientType === "privy")

  const address = (config?.smartAccount || embeddedWallet) ? config?.smartAccount?.address : user?.wallet?.address
  const connected = ready && authenticated && !!address 

  const login = async () => {
    await privyLogin()
  }

  const logout = async () => {
    setConfig("smartAccount", null)
    await disconnectAsync()
    await privyLogout()
    hide()
  }

  return {
    connected,
    login,
    logout,
    ...props,
    ...user?.wallet,
    address,
  }
}


const Wallet = ({children}) => {

  const { user } = usePrivy()

  const { config, setConfig } = useConfig()

  const { setActiveWallet } = useSetActiveWallet()
  const { ready: walletsReady, wallets } = useWallets()

  const { connectAsync } = useConnect()

  const embeddedWallet = wallets.find(wallet => wallet.walletClientType === "privy")

  useEffect(() => {
    if (walletsReady) {
      const wallet = wallets.find(wallet => wallet.address === user?.wallet?.address)

      wallet && setActiveWallet(wallet)
    }
  }, [walletsReady])

  useEffect(() => {
    if (embeddedWallet) {
      (async () => {
        const publicClient = createPublicClient({transport: http(RPC_URL)})
        const provider = await embeddedWallet.getEthereumProvider()
        const signer = await providerToSmartAccountSigner(provider)

        const kernelSettings = {entryPoint: ENTRYPOINT_ADDRESS_V07, kernelVersion: KERNEL_V3_1}
        const ecdsaValidator = await signerToEcdsaValidator(publicClient, {signer, ...kernelSettings})
        const account = await createKernelAccount(publicClient, {plugins: {sudo: ecdsaValidator}, ...kernelSettings})

        const smartAccountClient = await createKernelAccountClient({
          bundlerTransport: http(ZERODEV_BUNDLER_RPC),
          entryPoint: ZERODEV_BUNDLER_ENTRYPOINT,
          middleware: {
            sponsorUserOperation: async ({userOperation}) => {
              const entryPoint = ZERODEV_PAYMASTER_ENTRYPOINT

              const paymaster = createZeroDevPaymasterClient({
                transport: http(ZERODEV_PAYMASTER_RPC),
                entryPoint,
                chain,
              })

              return paymaster.sponsorUserOperation({
                userOperation,
                entryPoint
              })
            },
          },
          publicClient,
          account,
          signer,
          chain,
        })

        //const smartAccountClient = await createKernelAccountClient({
        //  bundlerTransport: http(COINBASE_BUNDLER_RPC),
        //  entryPoint: COINBASE_BUNDLER_ENTRYPOINT,
        //  middleware: {
        //    sponsorUserOperation: async ({userOperation}) => {
        //      const entryPoint = COINBASE_PAYMASTER_ENTRYPOINT

        //      const paymaster = createPimlicoPaymasterClient({
        //        transport: http(COINBASE_PAYMASTER_RPC),
        //        entryPoint,
        //        chain,
        //      })

        //      return paymaster.sponsorUserOperation({
        //        userOperation,
        //        entryPoint
        //      })
        //    },
        //  },
        //  publicClient,
        //  account,
        //  signer,
        //  chain,
        //})

        const connector = smartAccount({smartAccountClient})
        await connectAsync({connector}, {onSuccess: data => console.log(data)})

        setConfig("smartAccount", account)
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

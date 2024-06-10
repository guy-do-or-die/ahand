import { useState } from "react"

import { useAccount, useBalance } from "wagmi"
import { useSwitchChain } from 'wagmi'

import { base, baseSepolia } from '@wagmi/core/chains'

import { formatEther } from 'viem'

import { CopyToClipboard } from 'react-copy-to-clipboard'

import { usePrivy } from "@privy-io/react-auth"

import { Link } from "wouter"

import { ThemeToggle } from "./Theme"
import { CurrencyToggle } from "./Currency"

import { Address } from "./Utils"

import { notify } from "./Notification"

import { aHandBaseAddress } from '../contracts'


const Logo = () => {
  return <div className="mx-5 mt-1 mb-4 cursor-pointer" title="Raise, shake, give and get rewarded!">
    <Link href="/">
      <span className="text-6xl sm:text-5xl">a</span>
      <span className="text-7xl sm:text-6xl mr-1">🙌</span>
      <span className="text-6xl sm:text-5xl">and</span>
    </Link>
  </div>
}


const SwitchChain = ({callback}) => {

  const { chains, switchChain } = useSwitchChain()

  const doSwitch = () => switchChain({
    chainId: baseSepolia.id,
    onSuccess: ({data}) => {
      notify(`Succesfully switched: ${error}`, 'success')
      callback()
    },
    onError: ({error}) => {
      notify(`Can't switch: ${error}`, 'error')
    }
  })

  return <div>
    Please, <a href="#" onClick={doSwitch} className="font-bold underline">switch</a> to Base
  </div>
}


export const Header = () => {
 
  const { ready, authenticated, login, logout } = usePrivy()

  const { address, chainId } = useAccount()
  const { data: balanceData } = useBalance({ address })

  if (ready && authenticated && !aHandBaseAddress[chainId]) {
    notify(<SwitchChain callback={() => {}} />, 'error', {id: 'wrong-chain', duration: Infinity})
  }

  return <div className="flex flex-col items-center justify-start w-full sm:flex-row sm:justify-between p-2">
    <div className="w-full text-center sm:text-left">
      <Logo />
    </div>

    <div className="flex items-center order-1 m-4 sm:m-0 sm:order-2 sm:absolute sm:top-5 sm:right-6">
      <ThemeToggle /> 
      {
        ready && authenticated
          ?
        <div className="dropdown dropdown-end dropdown-hover">
          <div className="join">
            <CurrencyToggle /> 
            <div tabIndex="0" role="button" className="btn btn-outline btn-sm md:btn-md join-item w-32 md:text-lg">{balanceData?.formatted.slice(0, 7)}</div>
          </div>
          <ul tabIndex="0" className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-full">
            <li>
              <CopyToClipboard text={address} onCopy={() => notify(`Copied to Clipboard`, 'success', {duration: 1000})}>
                <span><Address address={address} maxChars={12}/></span>
              </CopyToClipboard>
            </li>
            <div className="divider m-0"></div>
            <li>
              <button>Deposit</button>
            </li>
            <li>
              <button>Withdraw</button>
            </li>
            <div className="divider m-0"></div>
            <li>
              <button onClick={logout}>Log Out</button>
            </li>
          </ul>
        </div>
          :
        <button className="btn btn-sm md:btn-md w-32" onClick={login}>
          Log In
        </button>
       }
    </div>
  </div>
}

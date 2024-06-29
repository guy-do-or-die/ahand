import { useState, useEffect } from "react"

import { useBlockNumber, useReadContracts, useBalance, useSwitchChain } from "wagmi"

import { formatEther } from 'viem'

import { CopyToClipboard } from 'react-copy-to-clipboard'

import { Link } from "wouter"

import { ThemeToggle } from "./Theme"
import { CurrencyToggle } from "./Currency"

import { Address } from "./Utils"

import { BaseStat, UserStat } from "./Stat"
import { notify, hide, notImplemented } from "./Notification"

import { aHandBaseAddress, aHandBaseAbi } from '../contracts'

import { useAccount, chain } from '../wallet'


const Logo = () => {
  return <div className="mx-2 mt-1 mb-4 text-nowrap cursor-pointer" title="Raise, shake, give and get rewarded!">
    <Link href="/">
      <span className="text-6xl sm:text-5xl">a</span>
      <span className="text-7xl sm:text-6xl mr-1">🙌</span>
      <span className="text-6xl sm:text-5xl">and</span>
    </Link>
  </div>
}


const SwitchChain = ({onSuccess, onError}) => {

  const { chains, switchChain } = useSwitchChain()

  const doSwitch = () => switchChain({
      chainId: chain.id,
    }, {
    onSuccess: data => {
      notify(`Succesfully switched to ${data.name}`, 'success')
      onSuccess?.()
    },
    onError: error => {
      notify(`Can't switch: ${error}`, 'error')
      onError?.()
    }
  })

  return <div>
    {`Please, `}
    <a href="#" onClick={doSwitch} className="font-bold underline">switch</a>
    {` to ${chain.name}`}
  </div>
}


export const Connection = () => {

  const { address, connected, login, logout, link,  walletClientType } = useAccount()
  const { data: balanceData } = useBalance({ address })

  if (connected && !aHandBaseAddress[chain.id]) {
    const wrongChainNotificationId = 'wrong-chain'

    notify(<SwitchChain onSuccess={() => hide(wrongChainNotificationId)} />, 'error', {id: wrongChainNotificationId, duration: Infinity})
  }

  return <>
    {
      connected
        ?
      <div className="dropdown dropdown-end dropdown-hover">
        <div className="join">
          <CurrencyToggle />
          <div tabIndex="0" role="button" className="btn btn-outline btn-sm md:btn-md join-item w-32 md:text-lg">{balanceData?.formatted.slice(0, 7)}</div>
        </div>
        <ul tabIndex="0" className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-full flex flex-col items-stretch">
          <li className="w-full">
            <Link href={`/user/${address}`} className="w-full justify-center">
              <UserStat address={address} full={false} />
            </Link>
          </li>
          <li className="w-full">
            <CopyToClipboard text={address} onCopy={() => notify(`Copied to Clipboard`, 'success', {duration: 1000})}>
              <div className="w-full justify-center">
                <Address address={address} maxChars={12}/>
              </div>
            </CopyToClipboard>
          </li>
          {
            walletClientType === "privy"
              ?
            <>
              <div className="divider m-0"></div>
              <li className="w-full">
                <button className="w-full justify-center" onClick={notImplemented}>Deposit</button>
              </li>
              <li className="w-full">
                <button className="w-full justify-center" onClick={notImplemented}>Withdraw</button>
              </li>
              <li className="w-full">
                <button className="w-full justify-center" onClick={notImplemented}>Link</button>
              </li>
            </>
              :
            ""
          }
          <div className="divider m-0"></div>
          <li className="w-full">
            <button className="w-full justify-center" onClick={logout}>Log Out</button>
          </li>
        </ul>
      </div>
        :
      <button className="btn btn-sm md:btn-md w-32" onClick={login}>
        Log In
      </button>
    }
  </>
}


export const Header = () => {
  return (
    <div className="flex flex-col items-center justify-start w-full p-4 md:flex-row md:justify-between md:p-2">
      <div className="w-full text-center md:text-left md:w-auto md:order-1">
        <Logo />
      </div>

      <div className="flex w-full justify-center md:justify-end md:w-auto md:order-3 space-x-1 mr-2 mt-2 md:mt-0">
        <ThemeToggle />
        <Connection />
      </div>

      <div className="w-full text-center justify-center mt-4 md:mt-0 md:w-auto md:flex-1 md:order-2">
        <BaseStat />
      </div>
    </div>
  )
}

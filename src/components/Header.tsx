import { useState, useEffect } from "react"

import { useBlockNumber, useReadContracts, useBalance, useSwitchChain } from "wagmi"

import { formatEther } from 'viem'

import { CopyToClipboard } from 'react-copy-to-clipboard'

import { Link } from "wouter"

import { ThemeToggle } from "./Theme"
import { CurrencyToggle } from "./Currency"

import { Address } from "./Utils"

import { notify, hide } from "./Notification"

import { aHandBaseAddress, aHandBaseAbi } from '../contracts'

import { useAccount, chain } from '../wallet'


const Logo = () => {
  return <div className="mx-5 mt-1 mb-4 cursor-pointer" title="Raise, shake, give and get rewarded!">
    <Link href="/">
      <span className="text-6xl sm:text-5xl">a</span>
      <span className="text-7xl sm:text-6xl mr-1">🙌</span>
      <span className="text-6xl sm:text-5xl">and</span>
    </Link>
  </div>
}


const Stat = () => {

  const fields = [
    { name: 'raisedHandsNumber', label: 'Raised' },
    { name: 'solvedHandsNumber', label: 'Solved' },
    { name: 'shakesNumber', label: 'Shakes' },
    { name: 'givesNumber', label: 'Gives' },
    { name: 'thanksNumber', label: 'Thanks' },
    { name: 'rewardsDistributed', label: 'Rewards' },
  ]

  const { data: blockNumber } = useBlockNumber({ watch: true })
  const { data } = useReadContracts({
    blockNumber,
    contracts: fields.map(field => ({
      functionName: field.name,
      address: aHandBaseAddress[chain.id],
      abi: aHandBaseAbi,
    }))
  })

  const [stats, setStats] = useState([])
  const [changedIndex, setChangedIndex] = useState(null)

  useEffect(() => {
    if (data) {
      const newStats = fields.map((field, i) => ({
        label: field.label,
        value: Number(data?.[i]?.result || 0),
      }))
      setStats(prevStats => {
        newStats.forEach((newStat, index) => {
          if (prevStats[index] && prevStats[index].value !== newStat.value) {
            setChangedIndex(index)
            setTimeout(() => setChangedIndex(null), 1000)
          }
        })
        return newStats
      })
    }
  }, [data])

  return (
    <div className="flex items-center justify-center space-x-4 sm:space-x-8 md:space-x-16 mt-2 mb-4 md:mb-0">
      {stats.map((stat, index) => (
        <div key={index} className={`flex flex-col items-center text-center ${changedIndex === index ? 'animate-pulse font-bold' : ''}`}>
          <span className="text-lg font-semibold">
            {stat.value}
          </span>
          <span className="text-xs">{stat.label}</span>
        </div>
      ))}
    </div>
  )
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

  const { address, connected, login, logout, walletClientType } = useAccount()
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
        <ul tabIndex="0" className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-full">
          <li>
            <CopyToClipboard text={address} onCopy={() => notify(`Copied to Clipboard`, 'success', {duration: 1000})}>
              <span><Address address={address} maxChars={12}/></span>
            </CopyToClipboard>
          </li>
          {
            walletClientType === "privy"
              ?
            <>
              <div className="divider m-0"></div>
              <li>
                <button>Deposit</button>
              </li>
              <li>
                <button>Withdraw</button>
              </li>
            </>
              :
            ""
          }
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
  </>
}


export const Header = () => {
  return (
    <div className="flex flex-col items-center justify-start w-full p-4 sm:flex-row sm:justify-between sm:p-2">
      <div className="w-full text-center sm:text-left sm:w-auto sm:order-1">
        <Logo />
      </div>

      <div className="w-full text-center justify-center sm:mt-0 sm:w-auto sm:flex-1 sm:order-2">
        <Stat />
      </div>

      <div className="flex w-full justify-center sm:justify-end sm:w-auto sm:order-3 mt-2 sm:mt-0">
        <ThemeToggle />
        <Connection />
      </div>

    </div>
  )
}

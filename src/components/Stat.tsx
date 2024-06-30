import { useState, useEffect } from "react"

import { useBlockNumber, useReadContracts } from "wagmi"

import { EthValue } from "./Currency"

import { chain } from "../wallet"

import {
  aHandBaseAbi,
  aHandBaseAddress,
  useReadAHandBaseBalanceOf,
  useSimulateAHandBaseThumbUp,
  useSimulateAHandBaseThumbDown,
  useWriteAHandBaseThumbUp,
  useWriteAHandBaseThumbDown,
} from "../contracts"


export const BaseStat = () => {

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
    <div className="flex items-center justify-center space-x-4 sm:space-x-4 md:space-x-16 mt-2 mb-4 md:mb-0">
      {stats.map((stat, index) => (
        <div key={index} className={`flex flex-col items-center text-center ${changedIndex === index ? 'animate-pulse font-bold' : ''}`}>
          <span className="text-lg font-semibold">
            {stat.label === 'Rewards' ? <EthValue value={stat.value} /> : stat.value}
          </span>
          <span className="text-xs">{stat.label}</span>
        </div>
      ))}
    </div>
  )
}


export const UserStat = ({address, full=true}) => {

  const fields = full ? [
    { id: 4, label: 'Ups' },
    { id: 5, label: 'Downs' },
    { id: 0, label: 'Raised' },
    { id: 1, label: 'Shakes' },
    { id: 2, label: 'Gives' },
    { id: 3, label: 'Thanks' },
  ] : [
    { id: 4, label: 'Ups' },
    { id: 5, label: 'Downs' },
  ]

  const { data: blockNumber } = useBlockNumber({ watch: true })

  const { data, error } = useReadContracts({
    blockNumber,
    contracts: [
      {
        args: [address],
        functionName: 'trust',
        address: aHandBaseAddress[chain.id],
        abi: aHandBaseAbi,
      },
      ...fields.map(field => ({
        args: [address, field.id],
        functionName: 'balanceOf',
        address: aHandBaseAddress[chain.id],
        abi: aHandBaseAbi,
      }))
    ]
  })

  const [stats, setStats] = useState([])
  const [changedIndex, setChangedIndex] = useState(null)

  useEffect(() => {
    if (data) {
      const newStats = [{label: 'Trust'}, ...fields].map((field, i) => ({
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
    <div className={`flex items-center justify-center space-x-4 ${full ? 'sm:space-x-4 md:space-x-8' : ''} mt-2 mb-4 md:mb-0`}>
      {stats.map((stat, index) => (
        <div key={index} className={`flex flex-col items-center text-center ${stat.label === 'Trust' ? 'font-bold' : ''} ${changedIndex === index ? 'animate-pulse font-bold' : ''} ${ stat.value < 0 ? 'text-red-500' : ''}`}>
          <span className={`${full ? 'text-lg': 'text-md'} font-semibold`}>
            {stat.value}
          </span>
          <span className="text-xs">{stat.label}</span>
        </div>
      ))}
    </div>
  )
}

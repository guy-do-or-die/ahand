import { useState, useEffect } from 'react'

import { formatEther } from 'viem'

import axios from 'axios'

import { useConfig } from '../Store'
import { useAccount } from '../wallet'

import { notify, hide } from './Notification'


const USD = 'usd'
const ETH = 'eth'

const USD_SIGN = '$'
const ETH_SIGN = 'Ξ'

const DEFAULT_CURRENCY = import.meta.env.DEFAULT_CURRENCY || USD


export const EthValue = ({value, maxLen=8}) => {

  const {config} = useConfig()
  const {connected} = useAccount()

  const currency = config.currency || DEFAULT_CURRENCY

  const floatValue = parseFloat(formatEther(value || 0))

  if (currency == USD && !config.price) {
    return <span class="loading loading-spinner loading-sm"></span>
  }

  const converted = currency === USD ? floatValue * config.price : floatValue
  const precision = currency === USD ? 2 : 5

  const rounded = Number(converted.toFixed(precision))

  const sign = currency === USD ? USD_SIGN : ETH_SIGN

  return `${connected ? '' : sign}${formatFloat(rounded, maxLen)}`
}


export const CurrencyFetch = () => {

  const {config, setConfig} = useConfig()

  useEffect(() => {
    const fetchEthPrice = async () => {
      const fetchPriceId = 'fetch-price'

      notify('Fetching price...', 'loading', {id: fetchPriceId})

      try {
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd')
        setConfig('price', response?.data?.ethereum?.usd)
      } catch (error) {
        norify('Failed to fetch price', 'error')
        console.error('Error fetching ETH price:', error)
      } finally {
        hide(fetchPriceId)
      }
    }

    fetchEthPrice()

    const interval = setInterval(fetchEthPrice, 60000)
    return () => clearInterval(interval)
  }, [])

  return null

}


export const CurrencyToggle = () => {

  const {config, setConfig} = useConfig()

  const currency = config.currency || DEFAULT_CURRENCY

  const toggleCurrency = () => {
    setConfig('currency', currency === 'eth' ? USD : 'eth')
  }

  return (
    <button className="btn btn-outline btn-sm md:btn-md join-item md:text-lg w-8 md:w-12" title={currency === USD ? 'Dollar' : 'Ether'} onClick={toggleCurrency}>
      {currency === USD ? USD_SIGN : ETH_SIGN}
    </button>
  )
}


const formatFloat = (value, maxLength) => {
  if (typeof value !== 'number' || isNaN(value)) {
    return 'NaN'
  }

  // Handle zero
  if (value === 0) {
    return '0'
  }

  // Handle negative numbers
  const sign = value < 0 ? '-' : ''
  value = Math.abs(value)

  // Check for very small numbers
  if (value < Math.pow(10, -(maxLength - 2))) {
    return sign + '<0.0{' + (maxLength - 3) + '}1'
  }

  // Handle thousands and millions
  if (value >= 1000000) {
    return sign + (value / 1000000).toFixed(2) + 'M'
  }
  if (value >= 1000) {
    return sign + (value / 1000).toFixed(2) + 'K'
  }

  // Convert to string and split into integer and fractional parts
  let [intPart, fracPart] = value.toString().split('.')

  // Handle cases where integer part is already too long
  if (intPart.length >= maxLength) {
    return sign + intPart.slice(0, maxLength - 1) + '+'
  }

  // Format fractional part
  if (fracPart) {
    const remainingLength = maxLength - intPart.length - 1; // -1 for decimal point
    if (remainingLength > 0) {
      fracPart = fracPart.slice(0, remainingLength)
      // Remove trailing zeros
      fracPart = fracPart.replace(/0+$/, '')
    } else {
      fracPart = ''
    }
  }

  // Combine parts
  let result = sign + intPart
  if (fracPart) {
    result += '.' + fracPart
  }

  // Handle brace shorthand for many zeros
  if (intPart === '0' && fracPart) {
    const zeroCount = fracPart.match(/^0+/)?.[0].length

    if (zeroCount > 3) {
      result = sign + '0.0{' + (zeroCount - 1) + '}' + fracPart.slice(zeroCount)
    }
  }

  return result
}

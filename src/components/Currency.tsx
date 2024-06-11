import { useState, useEffect } from 'react'

import { useConfig } from '../Store'


export const CurrencyToggle = () => {

  const {config, setConfig} = useConfig()

  const currency = config.currency || 'dollar'

  const toggleCurrency = () => {
    const newCurrency = currency === 'dollar' ? 'ether' : 'dollar'
    setConfig('currency', newCurrency)
  }

  return (
    <button className="btn btn-outline btn-sm md:btn-md join-item md:text-lg w-8 md:w-12" title={currency === 'dollar' ? 'Dollar' : 'Ether'} onClick={toggleCurrency}>
      {currency === 'dollar' ? '$' : 'Ξ'}
    </button>
  )
}

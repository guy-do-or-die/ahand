import { useState, useEffect } from 'react';


export const CurrencyToggle = () => {
  const [currency, setCurrency] = useState(() => {
    return localStorage.getItem('currency') || 'dollar';
  });

  useEffect(() => {
    localStorage.setItem('currency', currency);
  }, [currency]);

  const toggleCurrency = () => {
    const newCurrency = currency === 'dollar' ? 'ether' : 'dollar';
    setCurrency(newCurrency);
  };

  return (
    <button className="btn btn-outline btn-sm md:btn-md join-item md:text-lg w-8 md:w-12" title={currency === 'dollar' ? 'Dollar' : 'Ether'} onClick={toggleCurrency}>
      {currency === 'dollar' ? '$' : 'Ξ'}
    </button>
  );
};

import { useState, useEffect } from 'react'

import { useConfig } from '../Store'


export const ThemeToggle = () => {

  const THEMES = {
    'light': 'light',
    'dark': 'black',
  }

  const {config, setConfig} = useConfig()

  const theme = config.theme || 'light'

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', THEMES[newTheme])
    setConfig('theme', newTheme)
  }

  return (
    <button className="btn btn-ghost mr-2 text-lg w-8 md:w-12" title={theme === 'dark' ? 'Light Theme' : 'Dark Theme'} onClick={toggleTheme}>
      {theme === 'dark' ? '🌞' : '🌚'}
    </button>
  )
}

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
    document.documentElement.setAttribute('class', THEMES[newTheme])
    setConfig('theme', newTheme)
  }

  return (
    <button className="btn btn-ghost btn-sm md:btn-md w-8 md:w-12 flex items-center justify-center text-lg"
            title={theme === 'dark' ? 'Light Theme' : 'Dark Theme'} onClick={toggleTheme}>
      {theme === 'dark' ? '🌞' : '🌚'}
    </button>
  )
}

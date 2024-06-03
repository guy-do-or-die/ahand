import { useState, useEffect } from 'react';


export const getTheme = () => localStorage.getItem('theme') || 'light';
export const setTheme = (theme) => localStorage.setItem('theme', theme);

export const ThemeToggle = () => {

  const THEMES = {
    'light': 'light',
    'dark': 'black',
  }

  const [theme, setThemeState] = useState(() => {
    return getTheme();
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', THEMES[theme]);
    setTheme(theme);
  }, [theme]);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', THEMES[newTheme]);
    setThemeState(newTheme);
  };

  return (
    <button className="btn btn-ghost mr-2 text-lg w-8 md:w-12" title={theme === 'dark' ? 'Light Theme' : 'Dark Theme'} onClick={toggleTheme}>
      {theme === 'dark' ? '🌞' : '🌚'}
    </button>
  );
};

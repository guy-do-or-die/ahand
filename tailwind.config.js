const defaultTheme = require('tailwindcss/defaultTheme');


/** @type {import('tailwindcss').Config} */
export default {
  mode: 'jit',
  content: [
    "./index.html",
    "./src/**/*.{html,js,jsx,ts,tsx,vue}",
  ],
  theme: {
    extend: {
      fontFamily: {
         'sans': ['"AnonymousPro"', ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [
    require("daisyui")
  ],
  daisyui: {
    themes: ["light", "dark", "black"],
  },
}

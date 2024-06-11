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
         'sans': "AnonymousPro"
      },
      animation: {
        'handshake': 'handshake 1s ease-in-out infinite',
      },
      keyframes: {
        handshake: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) rotate(3deg)' },
          '10%, 90%': { transform: 'translate3d(-1px, 0, 0) rotate(-1deg)' },
          '20%, 80%': { transform: 'translate3d(2px, 0, 0) rotate(1deg)' },
          '30%, 70%': { transform: 'translate3d(-4px, 0, 0) rotate(-3deg)' },
          '40%, 60%': { transform: 'translate3d(4px, 0, 0) rotate(3deg)' },
          '50%': { transform: 'translate3d(-4px, 0, 0) rotate(-3deg)' },
        },
      },
    },
  },
  plugins: [
    require("daisyui")
  ],
  daisyui: {
    themes: ["light", "dark", "black", "night", "dim"],
  },
  extend: {
    opacity: ['group-hover'],
    visibility: ['group-hover'],
  },
}

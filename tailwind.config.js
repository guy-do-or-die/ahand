// ************************************************************************** //
//                                                                            //
//                                                        :::      ::::::::   //
//   tailwind.config.js                                 :+:      :+:    :+:   //
//                                                    +:+ +:+         +:+     //
//   By: egusev <egusev@student.42yerevan.am>       +#+  +:+       +#+        //
//                                                +#+#+#+#+#+   +#+           //
//   Created: 2024/05/11 19:49:20 by egusev            #+#    #+#             //
//   Updated: 2024/05/30 16:24:30 by egusev           ###   ########.fr       //
//                                                                            //
// ************************************************************************** //

const defaultTheme = require('tailwindcss/defaultTheme');


/** @type {import('tailwindcss').Config} */
export default {
  mode: 'jit',
  content: [
    "./index.html",
    "./src/**/*.{html,js,jsx,ts,tsx,vue}",
  ],
  darkMode: ['selector', '[data-theme="dark"]'],
  important: '#app',
  theme: {
    extend: {
      fontFamily: {
         'sans': "AnonymousPro"
      },
      animation: {
        'handshake': 'handshake 1.5s',
      },
      keyframes: {
        handshake: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) rotate(0deg) scale(1, 1)' },
          '10%, 90%': { transform: 'translate3d(-1px, 0, 0) rotate(-1deg) scale(1, 0.8)', transformOrigin: 'center center' },
          '20%, 80%': { transform: 'translate3d(2px, 0, 0) rotate(1deg) scale(1.05, 0.8)', transformOrigin: 'center center' },
          '30%, 70%': { transform: 'translate3d(-4px, 0, 0) rotate(-3deg) scale(1.05, 0.8)' },
          '40%, 60%': { transform: 'translate3d(4px, 0, 0) rotate(3deg) scale(1.05, 0.8)' },
          '50%': { transform: 'translate3d(-4px, 0, 0) rotate(-3deg) scale(1, 0.8)' },
        },
      },
    },
  },
  plugins: [
    require("daisyui")
  ],
  daisyui: {
    themes: ["light", "black"],
  },
  extend: {
    opacity: ['group-hover'],
    visibility: ['group-hover'],
  },
}

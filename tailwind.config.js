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
        pixel: "PixelGosub"
      },
    },
  },
  plugins: [],
}

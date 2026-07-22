/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cyan: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#10b981', // Emerald 500
          500: '#059669', // Emerald 600
          600: '#047857', // Emerald 700
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
          950: '#052e16',
        }
      }
    },
  },
  plugins: [],
}

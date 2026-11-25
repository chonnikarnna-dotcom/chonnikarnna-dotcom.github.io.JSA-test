/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"IBM Plex Sans Thai"', 'system-ui', 'sans-serif'] },
      colors: {
        brand: { 50: '#eef5fa', 100: '#d6e6f1', 200: '#adcde3', 500: '#1d6a99', 600: '#155a85', 700: '#0f4a6e', 800: '#0f3d5e', 900: '#0b2c44' },
      },
    },
  },
  plugins: [],
};

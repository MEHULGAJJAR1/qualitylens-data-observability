/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 950: '#101828', 900: '#17233b', 800: '#213353' },
        brand: { 50: '#eef3ff', 100: '#dce7ff', 500: '#5678f5', 600: '#4164e8', 700: '#3151cc' },
      },
      boxShadow: {
        card: '0 2px 8px rgba(16, 24, 40, 0.035), 0 1px 2px rgba(16, 24, 40, 0.04)',
        raised: '0 18px 48px rgba(16, 24, 40, 0.12)',
      },
      animation: {
        'fade-in': 'fadeIn .28s ease-out',
        'slide-up': 'slideUp .3s ease-out',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        surfaceAlt: 'var(--color-surface-alt)',
        border: 'var(--color-border)',
        text: 'var(--color-text)',
        muted: 'var(--color-muted)',
        primary: 'var(--color-primary)',
        onPrimary: 'var(--color-on-primary)',
        accent: 'var(--color-accent)',
        positive: 'var(--color-positive)',
        negative: 'var(--color-negative)',
        onNegative: 'var(--color-on-negative)',
      },
    },
  },
  plugins: [],
};

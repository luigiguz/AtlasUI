/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        zinc: {
          50: "rgb(var(--atlas-zinc-50) / <alpha-value>)",
          100: "rgb(var(--atlas-zinc-100) / <alpha-value>)",
          200: "rgb(var(--atlas-zinc-200) / <alpha-value>)",
          300: "rgb(var(--atlas-zinc-300) / <alpha-value>)",
          400: "rgb(var(--atlas-zinc-400) / <alpha-value>)",
          500: "rgb(var(--atlas-zinc-500) / <alpha-value>)",
          600: "rgb(var(--atlas-zinc-600) / <alpha-value>)",
          700: "rgb(var(--atlas-zinc-700) / <alpha-value>)",
          800: "rgb(var(--atlas-zinc-800) / <alpha-value>)",
          900: "rgb(var(--atlas-zinc-900) / <alpha-value>)",
          950: "rgb(var(--atlas-zinc-950) / <alpha-value>)",
        },
        cf: {
          orange: "rgb(var(--atlas-accent) / <alpha-value>)",
          "orange-dim": "rgb(var(--atlas-accent-dim) / <alpha-value>)",
          ink: "rgb(var(--atlas-ink) / <alpha-value>)",
          panel: "rgb(var(--atlas-panel) / <alpha-value>)",
          card: "rgb(var(--atlas-card) / <alpha-value>)",
          line: "rgb(var(--atlas-line) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["Segoe UI", "system-ui", "sans-serif"],
        display: ["Outfit", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["Consolas", "ui-monospace", "monospace"],
      },
      animation: {
        "pulse-ring": "pulse-ring 2.2s ease-out infinite",
        float: "float 18s ease-in-out infinite",
        shimmer: "shimmer 2.5s linear infinite",
      },
      keyframes: {
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(61, 214, 132, 0.45)" },
          "70%": { boxShadow: "0 0 0 12px rgba(61, 214, 132, 0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(61, 214, 132, 0)" },
        },
        float: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(30px, -20px) scale(1.05)" },
          "66%": { transform: "translate(-20px, 15px) scale(0.95)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
    },
  },
  plugins: [],
};

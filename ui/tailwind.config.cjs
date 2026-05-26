/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        cf: {
          orange: "#F48120",
          "orange-dim": "#C9650E",
          ink: "#0B0D10",
          panel: "#111418",
          card: "#161B22",
          line: "#30363D",
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

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Aptos", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Georgia", "ui-serif", "serif"],
      },
      boxShadow: {
        rule: "0 1px 0 rgba(15, 23, 42, 0.08)",
      },
    },
  },
  plugins: [],
};

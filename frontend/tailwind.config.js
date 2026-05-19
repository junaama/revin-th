/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "GT America Regular",
          "GT America",
          "Aptos",
          "Helvetica Neue",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        display: [
          "GT America Medium",
          "GT America",
          "Aptos",
          "Helvetica Neue",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "GT America Mono Regular",
          "SFMono-Regular",
          "ui-monospace",
          "monospace",
        ],
      },
      boxShadow: {
        rule: "0 1px 2px rgba(26, 25, 25, 0.04)",
      },
    },
  },
  plugins: [],
};

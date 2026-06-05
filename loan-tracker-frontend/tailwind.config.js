/** @type {import('tailwindcss').Config} */
// NOTE: This project runs Tailwind v4 (`@import "tailwindcss"` with no
// `@config`), so this file is NOT auto-loaded. The ACTIVE source of
// truth for the LendFest design tokens is the `@theme` block in
// src/index.css. This config mirrors that palette for documentation and
// for any future migration/tooling that reads the JS config.
//
// The `ocean`/`navy` names are stable identifiers; their values are the
// LendFest brand palette (ocean = teal→green primary ramp, navy = ink).
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Hanken Grotesk", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Bricolage Grotesque", "Hanken Grotesk", "sans-serif"],
      },
      colors: {
        ocean: {
          50: "#ecfbf5",
          100: "#cff6e6",
          200: "#a3ecd1",
          300: "#69dcb6",
          400: "#22b488", // brand green — bright accent
          500: "#14a07c",
          600: "#0e8a6e", // brand teal — primary
          700: "#0a5c4c", // brand teal-deep
          800: "#0a4d40",
          900: "#0b3e34",
          950: "#07271f",
        },
        navy: {
          800: "#17363a",
          900: "#122a2e", // brand ink — sidebar background
          950: "#0b1c1f", // deepest
        },
        amber: {
          300: "#f8c061",
          400: "#f6a92b", // brand spark
          500: "#e0941a",
        },
        cream: {
          50: "#fbf7ef", // brand cream
          100: "#f3ecdd", // brand cream-2
        },
      },
      backgroundImage: {
        "ocean-gradient": "linear-gradient(135deg, #22b488 0%, #0a5c4c 100%)",
        "ocean-gradient-soft":
          "linear-gradient(135deg, #ecfbf5 0%, #cff6e6 100%)",
        "app-bg": "linear-gradient(180deg, #fbf7ef 0%, #f3ecdd 100%)",
      },
      boxShadow: {
        tile: "0 8px 20px -6px rgba(14, 138, 110, 0.35)",
      },
    },
  },
  plugins: [],
};

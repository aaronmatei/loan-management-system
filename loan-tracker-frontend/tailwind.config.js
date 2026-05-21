/** @type {import('tailwindcss').Config} */
// NOTE: This project runs Tailwind v4 (`@import "tailwindcss"` with no
// `@config`), so this file is NOT auto-loaded. The ACTIVE source of
// truth for the ocean/navy design tokens is the `@theme` block in
// src/index.css. This config mirrors that palette for documentation and
// for any future migration/tooling that reads the JS config.
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ocean: {
          50: "#eff9ff",
          100: "#def2ff",
          200: "#b6e7ff",
          300: "#75d4ff",
          400: "#2cbeff",
          500: "#06a6f0", // primary cyan-blue
          600: "#0086cc", // primary blue
          700: "#006ba6",
          800: "#075a88",
          900: "#0c4b70",
          950: "#082f49",
        },
        navy: {
          800: "#0f1b2d",
          900: "#0a1422", // sidebar background
          950: "#060d18", // sidebar deepest
        },
      },
      backgroundImage: {
        "ocean-gradient": "linear-gradient(135deg, #2cbeff 0%, #0086cc 100%)",
        "ocean-gradient-soft":
          "linear-gradient(135deg, #eff9ff 0%, #def2ff 100%)",
        "app-bg": "linear-gradient(180deg, #f3f8fb 0%, #eaf2f7 100%)",
      },
      boxShadow: {
        tile: "0 8px 20px -6px rgba(6, 134, 240, 0.35)",
      },
    },
  },
  plugins: [],
};

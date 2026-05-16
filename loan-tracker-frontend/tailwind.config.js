/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#f0f0ff",
          100: "#e0e0ff",
          500: "#667eea",
          600: "#5568d3",
          700: "#4453b8",
        },
        secondary: {
          500: "#764ba2",
          600: "#653d8b",
        },
      },
    },
  },
  plugins: [],
};

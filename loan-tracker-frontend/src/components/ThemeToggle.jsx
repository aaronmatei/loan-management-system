import React from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "../context/ThemeContext";

// Light/dark toggle button. Presentation-only — flips the app theme, never
// touches data. Lives in the app top bar.
export default function ThemeToggle({ className = "" }) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className={`p-2 rounded-lg text-slate-500 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-400 ${className}`}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

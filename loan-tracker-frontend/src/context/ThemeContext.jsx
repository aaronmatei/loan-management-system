import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

// App theme (light/dark) for the LenderFest staff app. Toggling adds/removes
// the `.dark` class on <html>, which drives the class-based `dark:` variant
// (see the @custom-variant in index.css) and the semantic surface tokens.
// The choice persists in localStorage; first visit follows the OS preference.

const STORAGE_KEY = "lf.theme";
const ThemeContext = createContext(null);

function resolveInitial() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  if (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(resolveInitial);

  // Apply synchronously on mount + whenever it changes so there's no flash.
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggleTheme = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  // Fallback keeps components that call useTheme() outside the provider safe.
  return (
    useContext(ThemeContext) || { theme: "light", setTheme: () => {}, toggleTheme: () => {} }
  );
}

import { useCallback, useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

const THEME_KEY = "theme-preference";

const getSystemTheme = (): ThemeMode =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const applyThemeClass = (theme: ThemeMode) => {
  document.documentElement.classList.toggle("dark", theme === "dark");
};

const getInitialTheme = (): ThemeMode => {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") {
    return saved;
  }
  return getSystemTheme();
};

export const useTheme = () => {
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());

  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleSystemThemeChange = () => {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") {
        return;
      }
      setTheme(getSystemTheme());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_KEY) {
        return;
      }
      const value = event.newValue;
      if (value === "light" || value === "dark") {
        setTheme(value);
        return;
      }
      setTheme(getSystemTheme());
    };

    mediaQuery.addEventListener("change", handleSystemThemeChange);
    window.addEventListener("storage", handleStorage);

    return () => {
      mediaQuery.removeEventListener("change", handleSystemThemeChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const setThemeMode = useCallback((nextTheme: ThemeMode) => {
    localStorage.setItem(THEME_KEY, nextTheme);
    setTheme(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }, []);

  const resetToSystemTheme = useCallback(() => {
    localStorage.removeItem(THEME_KEY);
    setTheme(getSystemTheme());
  }, []);

  return {
    theme,
    isDark: theme === "dark",
    setThemeMode,
    toggleTheme,
    resetToSystemTheme,
  };
};

export const initializeTheme = () => {
  const saved = localStorage.getItem(THEME_KEY);
  const initialTheme =
    saved === "light" || saved === "dark" ? saved : getSystemTheme();
  applyThemeClass(initialTheme);
};


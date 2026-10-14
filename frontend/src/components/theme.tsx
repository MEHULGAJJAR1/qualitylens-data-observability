import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

type ThemeContextValue = { dark: boolean; toggle: () => void };
const ThemeContext = createContext<ThemeContextValue>({ dark: false, toggle: () => undefined });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => localStorage.getItem('qualitylens-theme') === 'dark');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('qualitylens-theme', dark ? 'dark' : 'light');
  }, [dark]);
  const value = useMemo(() => ({ dark, toggle: () => setDark((current) => !current) }), [dark]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() { return useContext(ThemeContext); }

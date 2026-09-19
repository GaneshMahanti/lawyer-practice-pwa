'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type Theme = 'dark' | 'light';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  setTheme: () => {},
  toggleTheme: () => {},
});

// Mobile browser address-bar colour for each theme
const THEME_COLOR: Record<Theme, string> = {
  light: '#1a3a6b',
  dark: '#0f0f18',
};

function applyThemeToDocument(next: Theme) {
  try {
    document.documentElement.setAttribute('data-theme', next);
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', THEME_COLOR[next]);
    }
  } catch {}
}

function persistTheme(next: Theme) {
  try {
    localStorage.setItem('vakildesk_theme', next);
  } catch {}
  try {
    document.cookie = `vakildesk_theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {}
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    try {
      let saved: Theme | null = null;
      try {
        saved = localStorage.getItem('vakildesk_theme') as Theme;
      } catch {}

      if (!saved && typeof document !== 'undefined') {
        const match = document.cookie.match(/(?:^|;\s*)vakildesk_theme=([^;]*)/);
        if (match) saved = match[1] as Theme;
      }

      const initial: Theme = saved === 'light' || saved === 'dark' ? saved : 'dark';
      setThemeState(initial);
      applyThemeToDocument(initial);
    } catch {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }, []);

  // Single source of truth: state, <html data-theme>, and storage always change together.
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyThemeToDocument(next);
    persistTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

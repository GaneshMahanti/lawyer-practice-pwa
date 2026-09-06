'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export type Theme = 'dark' | 'light';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');

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
      setTheme(initial);
      document.documentElement.setAttribute('data-theme', initial);

      // Update mobile browser address bar color
      const metaThemeColor = document.querySelector('meta[name="theme-color"]');
      if (metaThemeColor) {
        metaThemeColor.setAttribute('content', initial === 'light' ? '#1a3a6b' : '#0f0f18');
      }
    } catch {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('vakildesk_theme', next);
      } catch {}
      try {
        if (typeof document !== 'undefined') {
          document.cookie = `vakildesk_theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
          const metaThemeColor = document.querySelector('meta[name="theme-color"]');
          if (metaThemeColor) {
            metaThemeColor.setAttribute('content', next === 'light' ? '#1a3a6b' : '#0f0f18');
          }
        }
      } catch {}
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', next);
      }
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

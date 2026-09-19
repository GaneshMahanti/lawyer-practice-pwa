'use client';

import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/lib/theme/context';

interface ThemeSwitchProps {
  /** 'sm' for the header, 'md' for Settings. */
  size?: 'sm' | 'md';
  /** Show the "Light Mode" / "Dark Mode" text to the left of the switch. */
  showLabel?: boolean;
}

/**
 * Sun / Moon theme switch. Both icons are always visible and the ACTIVE mode
 * sits inside a circle, so the control can never look inverted:
 *   light mode -> sun circled, dark mode -> moon circled.
 * Rendered as a radio group (keyboard and screen-reader friendly).
 */
export function ThemeSwitch({ size = 'md', showLabel = false }: ThemeSwitchProps) {
  const { theme, setTheme } = useTheme();
  const isLight = theme === 'light';
  const iconSize = size === 'sm' ? 16 : 18;

  return (
    <div className={`theme-switch-wrap${showLabel ? ' with-label' : ''}`}>
      {showLabel && (
        <span className="theme-switch-label">{isLight ? 'Light Mode' : 'Dark Mode'}</span>
      )}
      <div
        role="radiogroup"
        aria-label="Colour theme"
        className={`theme-switch theme-switch-${size}`}
      >
        <button
          type="button"
          role="radio"
          aria-checked={isLight}
          aria-label="Light mode"
          title="Light mode"
          className={`theme-switch-opt${isLight ? ' is-active' : ''}`}
          onClick={() => setTheme('light')}
        >
          <Sun size={iconSize} aria-hidden="true" />
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!isLight}
          aria-label="Dark mode"
          title="Dark mode"
          className={`theme-switch-opt${!isLight ? ' is-active' : ''}`}
          onClick={() => setTheme('dark')}
        >
          <Moon size={iconSize} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

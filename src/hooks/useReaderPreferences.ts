'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'sl_reader_prefs';
const MIN_SIZE = 14;
const MAX_SIZE = 32;
const STEP = 2;
const DEFAULT_SIZE = 18;

export type ReaderTheme = 'paper' | 'sepia' | 'night';
const THEMES: ReaderTheme[] = ['paper', 'sepia', 'night'];
const DEFAULT_THEME: ReaderTheme = 'paper';

function computeLineHeight(fontSize: number): number {
  // 1.6 at 14px, 1.8 at 18px, 2.0 at 24px
  return 1.6 + (fontSize - MIN_SIZE) * 0.04;
}

interface ReaderPrefs {
  fontSize: number;
  theme: ReaderTheme;
}

function loadPrefs(): ReaderPrefs {
  const defaults: ReaderPrefs = { fontSize: DEFAULT_SIZE, theme: DEFAULT_THEME };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        fontSize: parsed.fontSize >= MIN_SIZE && parsed.fontSize <= MAX_SIZE ? parsed.fontSize : DEFAULT_SIZE,
        theme: THEMES.includes(parsed.theme) ? parsed.theme : DEFAULT_THEME,
      };
    }
  } catch { /* ignore */ }
  return defaults;
}

function savePrefs(prefs: ReaderPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch { /* ignore */ }
}

export function useReaderPreferences() {
  const [fontSize, setFontSize] = useState(DEFAULT_SIZE);
  const [theme, setThemeState] = useState<ReaderTheme>(DEFAULT_THEME);

  useEffect(() => {
    const prefs = loadPrefs();
    setFontSize(prefs.fontSize);
    setThemeState(prefs.theme);
  }, []);

  const increaseFontSize = useCallback(() => {
    setFontSize(prev => {
      const next = Math.min(prev + STEP, MAX_SIZE);
      savePrefs({ ...loadPrefs(), fontSize: next });
      return next;
    });
  }, []);

  const decreaseFontSize = useCallback(() => {
    setFontSize(prev => {
      const next = Math.max(prev - STEP, MIN_SIZE);
      savePrefs({ ...loadPrefs(), fontSize: next });
      return next;
    });
  }, []);

  const resetFontSize = useCallback(() => {
    setFontSize(DEFAULT_SIZE);
    savePrefs({ ...loadPrefs(), fontSize: DEFAULT_SIZE });
  }, []);

  const setTheme = useCallback((next: ReaderTheme) => {
    setThemeState(next);
    savePrefs({ ...loadPrefs(), theme: next });
  }, []);

  return {
    fontSize,
    lineHeight: computeLineHeight(fontSize),
    increaseFontSize,
    decreaseFontSize,
    resetFontSize,
    isMinSize: fontSize <= MIN_SIZE,
    isMaxSize: fontSize >= MAX_SIZE,
    isDefaultSize: fontSize === DEFAULT_SIZE,
    theme,
    setTheme,
  };
}

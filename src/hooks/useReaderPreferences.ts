'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'sl_reader_prefs';
const MIN_SIZE = 14;
const MAX_SIZE = 24;
const STEP = 2;
const DEFAULT_SIZE = 18;

function computeLineHeight(fontSize: number): number {
  // 1.6 at 14px, 1.8 at 18px, 2.0 at 24px
  return 1.6 + (fontSize - MIN_SIZE) * 0.04;
}

interface ReaderPrefs {
  fontSize: number;
}

function loadPrefs(): ReaderPrefs {
  if (typeof window === 'undefined') return { fontSize: DEFAULT_SIZE };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.fontSize >= MIN_SIZE && parsed.fontSize <= MAX_SIZE) {
        return { fontSize: parsed.fontSize };
      }
    }
  } catch { /* ignore */ }
  return { fontSize: DEFAULT_SIZE };
}

function savePrefs(prefs: ReaderPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch { /* ignore */ }
}

export function useReaderPreferences() {
  const [fontSize, setFontSize] = useState(DEFAULT_SIZE);

  useEffect(() => {
    setFontSize(loadPrefs().fontSize);
  }, []);

  const increaseFontSize = useCallback(() => {
    setFontSize(prev => {
      const next = Math.min(prev + STEP, MAX_SIZE);
      savePrefs({ fontSize: next });
      return next;
    });
  }, []);

  const decreaseFontSize = useCallback(() => {
    setFontSize(prev => {
      const next = Math.max(prev - STEP, MIN_SIZE);
      savePrefs({ fontSize: next });
      return next;
    });
  }, []);

  const resetFontSize = useCallback(() => {
    setFontSize(DEFAULT_SIZE);
    savePrefs({ fontSize: DEFAULT_SIZE });
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
  };
}

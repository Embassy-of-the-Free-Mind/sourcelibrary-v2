'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import { useReaderPreferences } from '@/hooks/useReaderPreferences';

interface ReaderFocusModeProps {
  bookTitle: string;
  bookHref: string; // tenant-relative, e.g. `/book/<slug>` — never an absolute sourcelibrary.org URL
  pageLabel: string; // e.g. "12 / 340"
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

// Distraction-free reading mode. Self-contained on purpose: it owns its own
// state and applies focus mode by toggling a class on <body> (CSS in
// globals.css hides every [data-reader-chrome] element under .reader-focus).
// Do NOT move this state into TranslationEditor — inline interactive state
// there has silently failed before (see memory/ui-navigation.md, 2026-06-08).
export default function ReaderFocusMode({
  bookTitle,
  bookHref,
  pageLabel,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: ReaderFocusModeProps) {
  const [active, setActive] = useState(false);
  const [barVisible, setBarVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The bar is portaled to <body>, outside the reader's themed root — read the
  // theme here so the bar can carry its own data-reader-theme.
  const { theme } = useReaderPreferences();

  const clearHideTimer = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const showBarTemporarily = useCallback((ms = 2500) => {
    clearHideTimer();
    setBarVisible(true);
    hideTimer.current = setTimeout(() => setBarVisible(false), ms);
  }, []);

  const enter = useCallback(() => {
    setActive(true);
    showBarTemporarily(2500);
  }, [showBarTemporarily]);

  const exit = useCallback(() => {
    clearHideTimer();
    setActive(false);
    setBarVisible(false);
  }, []);

  // Apply/remove the body class that hides reader chrome
  useEffect(() => {
    if (!active) return;
    document.body.classList.add('reader-focus');
    return () => document.body.classList.remove('reader-focus');
  }, [active]);

  // Keyboard: `f` toggles, Escape exits
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        if (active) exit();
        else enter();
      } else if (e.key === 'Escape' && active) {
        exit();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [active, enter, exit]);

  // Desktop: reveal the bar when the pointer nears the top edge
  useEffect(() => {
    if (!active) return;
    const handleMove = (e: MouseEvent) => {
      if (e.clientY < 64) {
        clearHideTimer();
        setBarVisible(true);
      } else if (e.clientY > 180) {
        setBarVisible(false);
      }
    };
    window.addEventListener('mousemove', handleMove);
    return () => window.removeEventListener('mousemove', handleMove);
  }, [active]);

  // Mobile (and desktop): tapping non-interactive content toggles the bar.
  // Skip taps on links/buttons/inputs and skip when the reader is selecting
  // text (HighlightSelection fires a click at the end of a selection).
  useEffect(() => {
    if (!active) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('a, button, input, textarea, select, summary, [role="button"], [data-reader-focus-bar]')) return;
      if (window.getSelection()?.toString()) return;
      clearHideTimer();
      setBarVisible(prev => !prev);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [active]);

  // Never leave a stray timer behind
  useEffect(() => clearHideTimer, []);

  return (
    <>
      <button
        type="button"
        onClick={() => (active ? exit() : enter())}
        className="p-1.5 rounded-md text-xs font-medium transition-all hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-accent-rust focus-visible:outline-none"
        style={{ color: 'var(--text-muted)' }}
        aria-label={active ? 'Exit focus mode' : 'Enter focus mode'}
        aria-pressed={active}
        title="Focus mode (f)"
      >
        <Maximize2 className="w-4 h-4" aria-hidden="true" />
      </button>

      {/* The toggle button lives inside the (hidden-in-focus) toolbar, so the
          floating bar must escape that subtree — portal it to <body>. */}
      {active && createPortal(
        <div
          data-reader-focus-bar
          data-reader-theme={theme}
          className={`fixed top-0 inset-x-0 z-50 transition-transform duration-200 motion-reduce:transition-none ${barVisible ? 'translate-y-0' : '-translate-y-full'}`}
          style={{
            background: 'var(--bg-white)',
            borderBottom: '1px solid var(--border-light)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
          }}
          onMouseEnter={clearHideTimer}
          aria-hidden={!barVisible}
        >
          <div className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2">
            <a href={bookHref} className="min-w-0 flex-1 hover:opacity-70 transition-opacity">
              <span className="block text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                {bookTitle}
              </span>
            </a>
            <div className="flex items-center gap-1 shrink-0 rounded-lg p-1" style={{ background: 'var(--bg-warm)' }}>
              <button
                type="button"
                onClick={onPrev}
                disabled={!hasPrev}
                className="p-1.5 rounded-md transition-all disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-accent-rust focus-visible:outline-none"
                style={{ color: 'var(--text-secondary)' }}
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <span className="px-1 text-sm font-medium tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {pageLabel}
              </span>
              <button
                type="button"
                onClick={onNext}
                disabled={!hasNext}
                className="p-1.5 rounded-md transition-all disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-accent-rust focus-visible:outline-none"
                style={{ color: 'var(--text-secondary)' }}
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <button
              type="button"
              onClick={exit}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium shrink-0 transition-all hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-accent-rust focus-visible:outline-none"
              style={{ color: 'var(--text-secondary)' }}
              title="Exit focus mode (Esc)"
            >
              <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Exit focus</span>
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

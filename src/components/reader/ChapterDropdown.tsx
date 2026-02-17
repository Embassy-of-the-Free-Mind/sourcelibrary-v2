'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, X, List } from 'lucide-react';
import type { Chapter } from '@/lib/types';

interface ChapterDropdownProps {
  chapters: Chapter[];
  currentChapterIndex: number;
  onChapterSelect: (chapter: Chapter) => void;
}

// Display title: prefer English, fall back to original
function displayTitle(chapter: Chapter): string {
  return chapter.titleEn || chapter.title;
}

export default function ChapterDropdown({ chapters, currentChapterIndex, onChapterSelect }: ChapterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  // Close on click outside (desktop)
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen]);

  // Scroll active chapter into view when opened
  useEffect(() => {
    if (isOpen && activeItemRef.current) {
      activeItemRef.current.scrollIntoView({ block: 'center' });
    }
  }, [isOpen]);

  if (!chapters || chapters.length === 0) return null;

  const currentChapter = currentChapterIndex >= 0 ? chapters[currentChapterIndex] : null;

  const handleSelect = (chapter: Chapter) => {
    onChapterSelect(chapter);
    setIsOpen(false);
  };

  // Detect mobile via media query
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  // Whether any chapter has an English translation
  const hasEnglishTitles = chapters.some(ch => ch.titleEn);

  return (
    <>
      {/* Trigger button */}
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all hover:opacity-80 shrink-0 max-w-[200px] sm:max-w-[240px]"
        style={{ background: 'var(--bg-warm)', color: 'var(--text-secondary)' }}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={currentChapter ? `Chapter: ${displayTitle(currentChapter)}` : 'Table of contents'}
      >
        <List className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate hidden sm:inline">
          {currentChapter ? displayTitle(currentChapter) : 'Contents'}
        </span>
        <span className="sm:hidden">
          {currentChapter ? `Ch. ${currentChapterIndex + 1}` : 'ToC'}
        </span>
        <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {/* Desktop dropdown */}
      {isOpen && !isMobile && (
        <div
          ref={dropdownRef}
          className="absolute top-full right-0 mt-1 z-50 w-[26rem] max-h-[60vh] overflow-y-auto rounded-lg shadow-xl"
          style={{ background: 'var(--bg-white, #fff)', border: '1px solid var(--border-light)' }}
          role="listbox"
          aria-label="Table of contents"
        >
          <div className="sticky top-0 px-3 py-2 border-b" style={{ background: 'var(--bg-white, #fff)', borderColor: 'var(--border-light)' }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                Contents
              </span>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {chapters.length} chapters
              </span>
            </div>
          </div>
          {chapters.map((chapter, i) => (
            <button
              key={`${chapter.pageId}-${i}`}
              ref={i === currentChapterIndex ? activeItemRef : undefined}
              onClick={() => handleSelect(chapter)}
              className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-stone-50 flex items-baseline justify-between gap-2"
              style={{
                paddingLeft: chapter.level === 1 ? '12px' : chapter.level === 2 ? '28px' : '44px',
                background: i === currentChapterIndex ? 'rgba(180, 140, 60, 0.1)' : undefined,
                color: i === currentChapterIndex ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: i === currentChapterIndex ? 500 : (chapter.level === 1 ? 500 : 400),
              }}
              role="option"
              aria-selected={i === currentChapterIndex}
              title={hasEnglishTitles && chapter.titleEn ? chapter.title : undefined}
            >
              <span className="min-w-0">
                <span className="block truncate" style={{ fontSize: chapter.level === 1 ? '0.875rem' : '0.8125rem' }}>
                  {displayTitle(chapter)}
                </span>
                {hasEnglishTitles && chapter.titleEn && (
                  <span className="block truncate text-[11px] italic" style={{ color: 'var(--text-muted)', marginTop: '1px' }}>
                    {chapter.title}
                  </span>
                )}
              </span>
              <span className="text-[10px] shrink-0 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                p.{'\u00A0'}{chapter.pageNumber}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Mobile bottom sheet */}
      {isOpen && isMobile && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
          {/* Sheet */}
          <div
            ref={dropdownRef}
            className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl shadow-2xl"
            style={{ background: 'var(--bg-white, #fff)', maxHeight: '70vh' }}
            role="listbox"
            aria-label="Table of contents"
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-stone-300" />
            </div>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Contents
              </span>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-md"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Chapter list */}
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(70vh - 80px)' }}>
              {chapters.map((chapter, i) => (
                <button
                  key={`${chapter.pageId}-${i}`}
                  ref={i === currentChapterIndex ? activeItemRef : undefined}
                  onClick={() => handleSelect(chapter)}
                  className="w-full text-left px-4 py-3 flex items-baseline justify-between gap-2 transition-colors"
                  style={{
                    paddingLeft: chapter.level === 1 ? '16px' : chapter.level === 2 ? '32px' : '48px',
                    background: i === currentChapterIndex ? 'rgba(180, 140, 60, 0.1)' : undefined,
                    color: i === currentChapterIndex ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: i === currentChapterIndex ? 500 : (chapter.level === 1 ? 500 : 400),
                    minHeight: '44px',
                    borderBottom: '1px solid var(--border-light)',
                  }}
                  role="option"
                  aria-selected={i === currentChapterIndex}
                >
                  <span className="min-w-0">
                    <span className="block truncate" style={{ fontSize: chapter.level === 1 ? '0.9375rem' : '0.875rem' }}>
                      {displayTitle(chapter)}
                    </span>
                    {hasEnglishTitles && chapter.titleEn && (
                      <span className="block truncate text-xs italic" style={{ color: 'var(--text-muted)', marginTop: '2px' }}>
                        {chapter.title}
                      </span>
                    )}
                  </span>
                  <span className="text-xs shrink-0 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    p.{'\u00A0'}{chapter.pageNumber}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

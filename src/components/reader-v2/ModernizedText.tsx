'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import NotesRenderer from '@/components/reader/NotesRenderer';
import type { Page } from '@/lib/types';
import type { ReaderSettings } from './useReaderV2';
import { CapsLabel } from './ReaderV2Bits';

/**
 * "Modern prose" reading mode, restoring the old reader's Scholarly/Modern
 * toggle for the v2 reader (`modernizedMode` in
 * src/components/pipeline/TranslationEditor.tsx, ~line 480). An editor turns
 * the scholarly English translation into short, plain, read-aloud prose (the
 * `performModernization()` prompt in src/lib/ai.ts) — a different REGISTER of
 * the same English reading text, not a different language and not a
 * different source document. So this follows the exact pattern
 * ReaderSpanishToggle.tsx set for EN/ES: a toggle inside the existing
 * translation pane, never a fifth simultaneous pane.
 *
 * COVERAGE (measured 2026-08-21, sample + book-scoped count): the `modernized`
 * field is populated by a one-off batch script (scripts/tmp-batch-modernize.mjs
 * BOOK_ID), never a standing pipeline stage. Two independent ~50K-page random
 * samples of the 18.9M-row `pages` collection (no index on `modernized.data`,
 * so a full countDocuments times out — see
 * .claude/docs/invariants/request-path-queries.md) turned up 8 hits total,
 * ALL on book 69e9c969625ec74a14473450 ("De Orbe Novo Decades Octo", Peter
 * Martyr d'Anghiera). A direct book-scoped count against that id (fast — it
 * hits pages_book_pagenum_idx) confirms 211 of 220 pages. No other book was
 * found in ~100K sampled pages. So this renders for effectively one book
 * today; built anyway because it is cheap, purely additive (the toggle and
 * both components below render nothing unless `page.modernized?.data`
 * exists), and the same low-coverage shape as the Spanish toggle this file
 * imitates.
 *
 * New-file-only by design (see the reader-redesign worktree's brief): does
 * not edit Reader2C.tsx, ReaderV2Bits.tsx, or useReaderV2.ts. A couple of
 * small, purely-visual constants are intentionally duplicated from those
 * files (not exported there) rather than imported, same as
 * ReaderSpanishToggle.tsx.
 */

/** True if the given page has modernized ("modern prose") text to offer. */
export function modernizedEligible(page: Pick<Page, 'modernized'>): boolean {
  return !!page.modernized?.data;
}

// Mirrors LINE_WIDTH_CH in ReaderV2Bits.tsx (not exported there).
const LINE_WIDTH_CH = { narrow: 55, comfortable: 70, wide: 86 } as const;

/**
 * Reading text for the "Modern" register of the translation pane. Same
 * NotesRenderer pipeline and typography inputs as ReaderProse, kept as its
 * own component (rather than overlaying `page.translation`) for the same
 * reason SpanishProse is: ReaderProse hardcodes `language: 'English'` for its
 * 'translation' kind and an overlay risks the swapped object later being read
 * as the real canonical translation by code that doesn't know it was
 * substituted (an editor save path, a citation).
 *
 * `<section-intro>` tags (brief editorial context the modernization prompt
 * adds after an original heading) are converted to `<note>` tags so
 * NotesRenderer styles them as the same green editorial-note treatment the
 * old reader gave them (TranslationEditor.tsx ~line 2068) — this reuses the
 * EXISTING gold/editorial-note colour, not a new one.
 */
export function ModernizedProse({
  page, settings, baseSize,
}: {
  page: Page;
  settings: ReaderSettings;
  baseSize: number;
}) {
  const raw = page.modernized?.data || '';
  if (!raw) return null;
  const text = raw.replace(/<section-intro>([\s\S]*?)<\/section-intro>/g, '\n\n<note>$1</note>\n\n');
  const fontSize = Math.round(baseSize * settings.textScale * 10) / 10;

  return (
    <div
      className="prose-manuscript"
      data-reader-v2-typeface={settings.typeface}
      style={{
        ['--reader-font-size' as string]: `${fontSize}px`,
        ['--reader-line-height' as string]: settings.lineHeight,
        maxWidth: `${LINE_WIDTH_CH[settings.lineWidth]}ch`,
        marginInline: 'auto',
        color: 'var(--text-primary)',
        textWrap: 'pretty',
      }}
    >
      <NotesRenderer
        text={text}
        showMetadata={false}
        showNotes={settings.glosses}
        language="English"
        columns={page.columns}
        pageType={page.page_type}
      />
    </div>
  );
}

/**
 * Pane-header label + Scholarly/Modern switch. Visually identical to
 * TranslationLanguageHeader's EN/ES segmented control in
 * ReaderSpanishToggle.tsx (same border/background/color tokens), so the two
 * toggles read as one family when a book somehow offered both. Only rendered
 * by the caller when `modernizedEligible(page)` is true — mirrors the old
 * reader's "only show when modernized text exists" rule.
 */
export function ModernizedRegisterHeader({
  modernizedOn, onChange, editing = false,
}: {
  modernizedOn: boolean;
  onChange: (on: boolean) => void;
  editing?: boolean;
}) {
  if (editing) return <CapsLabel style={{ color: 'var(--text-muted)', letterSpacing: '0.16em' }}>English</CapsLabel>;
  return (
    <div className="flex overflow-hidden" style={{ border: '1px solid var(--border-medium)' }} role="group" aria-label="Reading register">
      {([false, true] as const).map((on) => (
        <button
          key={String(on)}
          type="button"
          onClick={() => onChange(on)}
          aria-pressed={modernizedOn === on}
          className="px-2 py-[3px] font-sans text-[10.5px] font-medium uppercase tracking-[0.1em] leading-none transition-colors border-l first:border-l-0"
          style={{
            borderColor: 'var(--border-medium)',
            background: modernizedOn === on ? 'var(--text-primary)' : 'transparent',
            color: modernizedOn === on ? 'var(--bg-cream)' : 'var(--text-muted)',
          }}
          title={on ? 'Switch to modern prose' : 'Switch to the scholarly translation'}
        >
          {on ? 'Modern' : 'Scholarly'}
        </button>
      ))}
    </div>
  );
}

/** Copy-to-clipboard for the modernized text — mirrors CopySpanishButton. */
export function CopyModernButton({ page }: { page: Page }) {
  const [copied, setCopied] = useState(false);
  const text = page.modernized?.data || '';
  if (!text) return null;
  const label = 'Copy the modern-prose text';
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text.replace(/<\/?section-intro>/g, '').trim());
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      aria-label={label}
      title={copied ? 'Copied' : label}
      className="h-[26px] w-[28px] flex items-center justify-center border transition-colors"
      style={{ color: copied ? 'var(--accent-sage-dark)' : 'var(--text-faint)', borderColor: 'var(--border-light)' }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

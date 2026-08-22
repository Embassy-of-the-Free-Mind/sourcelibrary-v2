'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import NotesRenderer from '@/components/reader/NotesRenderer';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { getTranslation } from '@/lib/page-translations';
import type { Page } from '@/lib/types';
import type { ReaderSettings } from './useReaderV2';
import { CapsLabel, AiChip } from './ReaderV2Bits';

/**
 * Spanish reading pane, restoring the old reader's EN/ES toggle (Source
 * Library's second-largest reading country is Argentina; see the comment in
 * scripts/maintenance/build-spanish-copy-candidates.mjs) for the v2 reader.
 *
 * DESIGN CHOICE — a toggle inside the existing translation pane, not a fifth
 * simultaneous pane. Two reasons:
 *   1. Spanish is another rendering of the SAME role the English pane fills
 *      (the reading translation), not a different kind of text the way OCR or
 *      a transliteration is. Nobody reads a page in English and Spanish at
 *      once; the old reader's own UI was a two-way toggle, not a third
 *      column, for exactly this reason.
 *   2. The v2 reader already goes up to four simultaneous panes (scan, OCR,
 *      transliteration, English). A fifth is real crowding on a laptop
 *      screen, for content that mutually excludes the pane beside it anyway.
 * Coverage is sparse and per-PAGE (mirrors the old reader's
 * `getTranslation(page, 'es')` check in PageEditorClient.tsx) — most pages of
 * most books have no Spanish edition, so the toggle only appears in a pane
 * header when the CURRENT page actually has one, exactly like the existing
 * "Roman" transliteration chip only appearing when `translitEligible`.
 *
 * This file is new-file-only by design (see the reader-redesign worktree's
 * brief): it does not edit Reader2C.tsx, ReaderV2Bits.tsx, or useReaderV2.ts.
 * A few small, purely-visual constants below are intentionally duplicated
 * from those files rather than imported, because they are not exported and
 * this file must not add exports to files another session is actively
 * editing. See the mount notes in the calling code for exactly what a later
 * pass should consolidate.
 */

/** True if the given page carries a Spanish translation (map or legacy field). */
export function spanishEligible(page: Pick<Page, 'translations' | 'translation_es'>): boolean {
  return !!getTranslation(page, 'es')?.data;
}

// Mirrors LINE_WIDTH_CH in ReaderV2Bits.tsx (not exported there).
const LINE_WIDTH_CH = { narrow: 55, comfortable: 70, wide: 86 } as const;

/**
 * Reading text for the Spanish pane, rendered through the same NotesRenderer
 * pipeline as ReaderProse (wrapper stripping, inline gloss/term/margin tags,
 * columns) — same typography inputs, same `settings`-driven scale. Kept as
 * its own small component (rather than routing Spanish text through
 * ReaderProse by overlaying it onto `page.translation`, the way the old
 * reader's PageEditorClient.tsx did) for two reasons: ReaderProse hardcodes
 * `language: 'English'` for its 'translation' kind, and overlaying
 * `page.translation` risks that object later being read as the real English
 * translation by other code (e.g. an editor save path) that doesn't know it
 * was swapped. NotesRenderer's own `language` prop only changes behaviour for
 * RTL scripts today (see getLanguageCode/isRTLLanguage in
 * src/components/reader/NotesRenderer.tsx and src/lib/types/language.ts), so
 * passing "Spanish" here has no visible effect yet — it is future-proofing
 * and correctness, not a fix for a live bug.
 */
export function SpanishProse({
  page, settings, baseSize, suppressBlockquote = false,
}: {
  page: Page;
  settings: ReaderSettings;
  baseSize: number;
  suppressBlockquote?: boolean;
}) {
  const raw = getTranslation(page, 'es')?.data || '';
  const text = suppressBlockquote ? raw.replace(/^[ \t]*>[ \t]?/gm, '') : raw;

  if (!text) {
    return (
      <p className="font-sans text-[13px] italic" style={{ color: 'var(--text-faint)' }}>
        No hay traducción al español para esta página.
      </p>
    );
  }

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
        language="Spanish"
        columns={page.columns}
        pageType={page.page_type}
      />
    </div>
  );
}

/**
 * Pane-header label + EN/ES switch, replacing the static "English" CapsLabel.
 * Visually a segmented control, matching SegButton/SegGroup in
 * ReaderSettingsControls.tsx (that file doesn't export them, so the two
 * classNames below are copied literally rather than imported — same
 * `--text-primary`/`--bg-cream`/`--border-medium` tokens, no new primitive).
 */
export function TranslationLanguageHeader({
  lang, onChange, spanishAvailable, editing = false,
}: {
  lang: 'en' | 'es';
  onChange: (lang: 'en' | 'es') => void;
  spanishAvailable: boolean;
  editing?: boolean;
}) {
  return (
    <>
      {spanishAvailable ? (
        <div className="flex overflow-hidden" style={{ border: '1px solid var(--border-medium)' }} role="group" aria-label="Reading language">
          {(['en', 'es'] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => onChange(code)}
              aria-pressed={lang === code}
              className="px-2 py-[3px] font-sans text-[10.5px] font-medium uppercase tracking-[0.1em] leading-none transition-colors border-l first:border-l-0"
              style={{
                borderColor: 'var(--border-medium)',
                background: lang === code ? 'var(--text-primary)' : 'transparent',
                color: lang === code ? 'var(--bg-cream)' : 'var(--text-muted)',
              }}
            >
              {code === 'en' ? 'EN' : 'ES'}
            </button>
          ))}
        </div>
      ) : (
        <CapsLabel style={{ color: 'var(--text-muted)', letterSpacing: '0.16em' }}>English</CapsLabel>
      )}
      <AiChip short />
      {editing && <CapsLabel style={{ color: 'var(--accent-rust)' }}>Editing</CapsLabel>}
    </>
  );
}

/** Copy-to-clipboard for the Spanish text — mirrors CopyTextButton in Reader2C.tsx,
 * which is not exported and hardcodes page.translation (English). */
export function CopySpanishButton({ page }: { page: Page }) {
  const [copied, setCopied] = useState(false);
  const text = getTranslation(page, 'es')?.data || '';
  if (!text) return null;
  const label = 'Copy the Spanish translation';
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(stripEditorialWrappers(text).trim());
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

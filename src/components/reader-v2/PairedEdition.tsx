'use client';

import { BookOpen } from 'lucide-react';
import NotesRenderer from '@/components/reader/NotesRenderer';
import AiBadge from '@/components/ui/AiBadge';
import { usePairedEdition, type PairedEdition } from '@/hooks/usePairedEdition';
import { MARCIANUS_BOOK_ID, MANUSCRIPT_OCR_FLAG } from '@/lib/marcianus-overlay.shared';
import type { Page } from '@/lib/types';
import type { ReaderSettings } from './useReaderV2';

/**
 * Restoring the old reader's "paired critical edition" overlay for the v2
 * reader (`usePairedEdition` in TranslationEditor.tsx ~line 632). Despite the
 * name, THIS IS NOT A FACING-PAGE / TWO-UP SPREAD VIEW — investigated and
 * confirmed against src/hooks/usePairedEdition.ts, src/lib/marcianus-overlay*
 * and .claude/docs/edition-facsimile-pairing.md. It is a single-manuscript
 * override: for Marcianus graecus Z. 299 (book 6a45298cc6d95bc278fbc8c3, the
 * "Corpus of the Greek Alchemists" codex), the manuscript's own OCR of a hard
 * 10th-c. Greek minuscule hand is unreliable (~0.62 run-to-run self-agreement;
 * documented hallucinations), so on folios the concordance can align, the
 * printed critical edition — Berthelot & Ruelle 1887–88 — fills the normal
 * transcription/translation columns as the text of record, and the
 * manuscript's own AI transcription is demoted to a flagged, collapsible aid
 * underneath. No other book in the corpus has anything resembling this; it is
 * intentionally book-specific, not a general reading mode. There is no
 * separate general facing-page/two-page-spread feature anywhere in the old
 * reader (grepped `paired`, `spread`, `facing` across TranslationEditor.tsx
 * and the wider repo) — `split_from_spread`/`page_type: archived-spread` are
 * an unrelated image-splitting concept (see
 * .claude/docs/invariants/image-classifiers-and-splits.md), not a reading UI.
 *
 * COVERAGE (measured 2026-08-21): exactly one book, 195 of 432 pages/folios
 * aligned per src/data/marcianus-berthelot-overlay.json (`stats.folios_aligned`).
 * Test page: book `6a45298cc6d95bc278fbc8c3`
 * (marcianus-graecus-299-greek-alchemists), page id
 * `6a45298cc6d95bc278fbc8df` (Marcianus page_number 28, folio 3r).
 *
 * Server-side plumbing (the hook, GET /api/books/[id]/paired-edition, the
 * concordance) already exists and is untouched by this file — it just was
 * never mounted in the v2 reader. Safe to build: every export here is a no-op
 * for the other ~37,800 visible books, since `usePairedEdition` returns null
 * for any book id other than MARCIANUS_BOOK_ID.
 *
 * New-file-only by design: does not edit Reader2C.tsx, ReaderV2Bits.tsx, or
 * useReaderV2.ts. LINE_WIDTH_CH is duplicated from ReaderV2Bits.tsx (not
 * exported there), same as ReaderSpanishToggle.tsx.
 */

export { usePairedEdition, MARCIANUS_BOOK_ID };
export type { PairedEdition };

// Mirrors LINE_WIDTH_CH in ReaderV2Bits.tsx (not exported there).
const LINE_WIDTH_CH = { narrow: 55, comfortable: 70, wide: 86 } as const;

/**
 * Slim gold notice, same accent as editorial notes (`--accent-gold`) since
 * this is the same kind of thing: an editorial fact about how this text was
 * assembled, not a warning (rust) or a trace/annotation affordance.
 */
export function PairedNoticeBanner({ paired }: { paired: PairedEdition }) {
  return (
    <div
      className="px-4 py-2 border-b text-xs flex items-center gap-2 font-sans"
      style={{ background: 'color-mix(in srgb, var(--accent-gold) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-gold) 25%, transparent)', color: 'var(--accent-gold-dark)' }}
    >
      <BookOpen className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
      <span>
        <span className="font-medium">Reading text from the critical edition</span> — Berthelot &amp; Ruelle 1887–88, folio {paired.folio}. The manuscript&rsquo;s own AI transcription is unverified; verify any quotation against the edition or the facsimile.
      </span>
    </div>
  );
}

/** Confidence/provenance chips for the transcription pane header. */
export function PairedBadgeRow({ paired }: { paired: PairedEdition }) {
  if (!paired.badges.length) return null;
  return (
    <>
      {paired.badges.map((b) => (
        <span key={b.label} className={`px-1.5 py-0.5 rounded text-[11px] cursor-help ${b.className}`} title={b.tooltip}>
          {b.label}
        </span>
      ))}
    </>
  );
}

function pairedProseStyle(settings: ReaderSettings, baseSize: number): React.CSSProperties {
  const fontSize = Math.round(baseSize * settings.textScale * 10) / 10;
  return {
    ['--reader-font-size' as string]: `${fontSize}px`,
    ['--reader-line-height' as string]: settings.lineHeight,
    maxWidth: `${LINE_WIDTH_CH[settings.lineWidth]}ch`,
    marginInline: 'auto',
    color: 'var(--text-primary)',
    textWrap: 'pretty',
  };
}

/**
 * Transcription pane content when a paired edition is active: Berthelot's
 * Greek as the text of record, with the manuscript's own (unreliable) OCR
 * demoted to a flagged collapsible underneath — never deleted, never
 * presented as authoritative. Replaces ReaderProse kind="ocr" for this one
 * book's aligned folios only.
 */
export function PairedTranscriptionProse({
  paired, page, settings, baseSize,
}: {
  paired: PairedEdition;
  page: Page;
  settings: ReaderSettings;
  baseSize: number;
}) {
  // Never surface a reading we judged not reliably legible (#4523), even in the
  // collapsed supplementary-OCR disclosure.
  const ocrText = page.ocr?.unreadable ? '' : (page.ocr?.data || '');
  return (
    <div className="prose-manuscript" data-reader-v2-typeface={settings.typeface} style={pairedProseStyle(settings, baseSize)} lang="el">
      <NotesRenderer text={paired.transcription} showMetadata={false} showNotes={settings.glosses} language="Ancient Greek" />
      {ocrText && (
        <details className="mt-6 pt-3 border-t" style={{ borderColor: 'var(--border-light)' }}>
          <summary className="cursor-pointer select-none inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }} title={MANUSCRIPT_OCR_FLAG.tooltip}>
            <AiBadge title={MANUSCRIPT_OCR_FLAG.tooltip} />
            {MANUSCRIPT_OCR_FLAG.label}
          </summary>
          <div className="prose-manuscript mt-3" data-reader-v2-typeface={settings.typeface} style={{ ...pairedProseStyle(settings, baseSize), maxWidth: 'none', color: 'var(--text-muted)' }} lang="el">
            <NotesRenderer text={ocrText} showMetadata={false} showNotes={settings.glosses} language="Ancient Greek" columns={page.columns} pageType={page.page_type} />
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Translation pane content when a paired edition is active: Berthelot's
 * English (AI-translated from his clean printed Greek, not from the
 * manuscript OCR) as the text of record, with the canonical
 * `page.translation` demoted the same way. Replaces ReaderProse
 * kind="translation" for this one book's aligned folios only.
 */
export function PairedTranslationProse({
  paired, page, settings, baseSize,
}: {
  paired: PairedEdition;
  page: Page;
  settings: ReaderSettings;
  baseSize: number;
}) {
  const translationText = page.translation?.data || '';
  return (
    <div className="prose-manuscript" data-reader-v2-typeface={settings.typeface} style={pairedProseStyle(settings, baseSize)}>
      <NotesRenderer text={paired.translation} showMetadata={false} showNotes={settings.glosses} />
      {translationText && (
        <details className="mt-6 pt-3 border-t" style={{ borderColor: 'var(--border-light)' }}>
          <summary className="cursor-pointer select-none inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }} title={MANUSCRIPT_OCR_FLAG.tooltip}>
            <AiBadge title={MANUSCRIPT_OCR_FLAG.tooltip} />
            {MANUSCRIPT_OCR_FLAG.label}
          </summary>
          <div className="prose-manuscript mt-3" data-reader-v2-typeface={settings.typeface} style={{ ...pairedProseStyle(settings, baseSize), maxWidth: 'none', color: 'var(--text-muted)' }}>
            <NotesRenderer text={translationText} showMetadata={false} showNotes={settings.glosses} columns={page.columns} pageType={page.page_type} />
          </div>
        </details>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { BookOpen, Info } from 'lucide-react';
import NotesRenderer from '@/components/reader/NotesRenderer';
import {
  MARCIANUS_BOOK_ID,
  BERTHELOT_LAYER_LABEL,
  type PairedEditionResponse,
} from '@/lib/marcianus-overlay.shared';

type Paired = NonNullable<PairedEditionResponse['paired']>;

interface PairedEditionPanelProps {
  bookId: string;
  pageId: string;
  pageNumber?: number | null;
  /** Notifies the parent reader so it can flag / demote the manuscript OCR. */
  onLoaded?: (hasPaired: boolean) => void;
}

/**
 * Non-destructive reading overlay: when the current Marcianus 299 folio is
 * aligned to Berthelot & Ruelle's critical edition, surface Berthelot's Greek +
 * English as the reading text of record above the manuscript's own OCR columns,
 * with honest per-folio confidence badges and a provenance note.
 *
 * Self-fetches per page (reader navigation is client-side), and renders nothing
 * for any book other than Marcianus 299 — so it can be mounted unconditionally.
 * See .claude/docs/edition-facsimile-pairing.md.
 */
export default function PairedEditionPanel({
  bookId,
  pageId,
  pageNumber,
  onLoaded,
}: PairedEditionPanelProps) {
  const [paired, setPaired] = useState<Paired | null>(null);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  useEffect(() => {
    // Only the registered manuscript has an overlay; skip the fetch otherwise.
    if (bookId !== MARCIANUS_BOOK_ID) {
      setPaired(null);
      onLoadedRef.current?.(false);
      return;
    }
    const ctrl = new AbortController();
    const params = new URLSearchParams();
    if (pageId) params.set('pageId', pageId);
    if (pageNumber != null) params.set('page', String(pageNumber));

    fetch(`/api/books/${encodeURIComponent(bookId)}/paired-edition?${params.toString()}`, {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : { paired: null }))
      .then((data: PairedEditionResponse) => {
        setPaired(data.paired);
        onLoadedRef.current?.(!!data.paired);
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setPaired(null);
        onLoadedRef.current?.(false);
      });
    return () => ctrl.abort();
  }, [bookId, pageId, pageNumber]);

  if (!paired) return null;

  return (
    <section
      data-reader-section="paired-edition"
      // Bounded + internally scrollable so this reading pane never crushes the
      // fixed-height facsimile / OCR columns below it (the shell is h-screen).
      className="flex-shrink-0 border-b overflow-y-auto max-h-[50vh] lg:max-h-[55vh]"
      style={{ background: 'var(--bg-cream)', borderColor: 'var(--border-light)' }}
      aria-label="Critical edition reading text"
    >
      <div className="mx-auto w-full max-w-5xl px-4 py-3">
        {/* Header: edition label + honest confidence chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide"
            style={{ color: 'var(--accent-gold-dark)' }}
          >
            <BookOpen className="w-3.5 h-3.5" />
            {BERTHELOT_LAYER_LABEL}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            f. {paired.folio}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {paired.badges.map((b) => (
              <span
                key={b.label}
                className={`px-1.5 py-0.5 rounded text-[11px] cursor-help ${b.className}`}
                title={b.tooltip}
              >
                {b.label}
              </span>
            ))}
          </div>
        </div>

        {/* Provenance / quality note */}
        <p
          className="mt-2 flex items-start gap-1.5 text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{paired.provenanceNote}</span>
        </p>

        {/* Reading text of record: Greek transcription + English translation */}
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {paired.transcription && (
            <div>
              <div
                className="text-[11px] font-medium uppercase tracking-wide mb-1"
                style={{ color: 'var(--text-muted)' }}
              >
                Greek (Berthelot)
              </div>
              <div className="prose-manuscript leading-relaxed" style={{ color: 'var(--text-secondary)' }} lang="el">
                <NotesRenderer text={paired.transcription} showNotes showMetadata={false} language="Ancient Greek" />
              </div>
            </div>
          )}
          {paired.translation && (
            <div>
              <div
                className="text-[11px] font-medium uppercase tracking-wide mb-1"
                style={{ color: 'var(--text-muted)' }}
              >
                English (Berthelot)
              </div>
              <div className="prose-manuscript leading-relaxed" style={{ color: 'var(--text-secondary)' }} lang="en">
                <NotesRenderer text={paired.translation} showNotes showMetadata={false} />
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

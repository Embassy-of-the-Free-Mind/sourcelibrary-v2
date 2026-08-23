'use client';

import { useEffect, useState } from 'react';
import { History, RotateCcw, ChevronDown, Loader2 } from 'lucide-react';
import { AuthCheck } from '@/components/auth/AuthCheck';
import { useLocale } from '@/lib/i18n';
import { getReaderStrings, type ReaderStrings } from '@/lib/reader-strings';
import type { Locale } from '@/lib/locale-path';
import { CapsLabel } from './ReaderV2Bits';
import type { PageRevision } from '@/lib/page-revisions';
import type { Book, Page } from '@/lib/types';

// Standalone left-drawer panel body for reader-v2's revision history. This is
// a NEW file, deliberately kept out of Reader2C.tsx (another session owns
// that file right now) — see the mount snippet in the accompanying report.
//
// It reuses the same GET /api/pages/[id]/revisions?field=ocr|translation and
// POST /api/pages/[id]/revisions/[revisionId]/restore endpoints the old
// reader's src/components/reader/RevisionHistory.tsx used, and the same
// editor-only gate on Restore (#3511 — restoring rewrites the page, so it
// must not render as clickable for a non-editor).

/** Friendly display names for the per-page AI model badge (kept in sync with
 * the old reader's RevisionHistory — Gemini ids fall through to a generic
 * strip, Claude ids get a clean short name). */
const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-8': 'Opus 4.8',
  'claude-opus-4-8[1m]': 'Opus 4.8',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-haiku-4-5': 'Haiku 4.5',
};
function formatModel(model: string) {
  return MODEL_LABELS[model] ?? model.replace('gemini-', '').replace('-preview', '');
}

function formatDate(date: string | Date, lang: Locale, t: ReaderStrings['history']) {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return t.today(d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }));
  if (diffDays === 1) return t.yesterday;
  if (diffDays < 7) return t.daysAgo(diffDays);
  return d.toLocaleDateString(lang, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function truncate(text: string, len: number) {
  if (text.length <= len) return text;
  return text.slice(0, len) + '…';
}

/**
 * `page_revisions` is a MIXED collection — pipeline output (real OCR/
 * translation passes and manual edits) sits alongside bulk maintenance
 * sweeps (text-relocation repairs, corpus imports, contamination fixes)
 * that happen to touch this page too. See .claude/docs/data-provenance.md
 * and .claude/docs/invariants/page-revisions-corpus.md: `shift-repair-
 * erara-2026-07` alone is 56K+ rows of text *relocation*, not fresh
 * reading, and a book caught in a sweep can carry dozens of maintenance
 * rows against a single real edit. Showing them undifferentiated would
 * make "this page was corrected 40 times" the reader's takeaway when the
 * truth is "a script moved text around a book this page happened to be
 * in, once."
 *
 * There is no closed enum of sweep labels — they're minted ad hoc per
 * incident (the doc's own words: "ad-hoc, e.g. 'shift-repair-erara-
 * 2026-07'"). So rather than deny-list known sweeps (which silently
 * admits the next one), this allow-lists the sources that represent a
 * genuine per-page read or a human edit made through the app. Anything
 * else — an unrecognized or future sweep label, `corpus`/`wikisource`
 * (imported text, not a model reading this page), `system` placeholders,
 * junk labels — is bucketed as "maintenance" and collapsed by default,
 * never hidden.
 */
const PIPELINE_SOURCES = new Set([
  'ai',
  'batch_api',
  'batch_api_recovery',
  'pipeline_preview',
  'realtime_api_sequential',
  'mineru',
  'manual',
  'manual-backfill',
  'contributor',
]);

function isPipelineSource(source: string | undefined | null): boolean {
  return !!source && PIPELINE_SOURCES.has(source);
}

interface Row extends PageRevision {
  __field: 'ocr' | 'translation';
}

function SourceBadge({ source }: { source: string }) {
  const t = getReaderStrings(useLocale()).history;
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    ai: { bg: 'rgba(124, 93, 181, 0.1)', color: 'var(--accent-violet-dark)', label: t.sourceAi },
    batch_api: { bg: 'rgba(124, 93, 181, 0.1)', color: 'var(--accent-violet-dark)', label: t.sourceBatch },
    batch_api_recovery: { bg: 'rgba(124, 93, 181, 0.1)', color: 'var(--accent-violet-dark)', label: t.sourceBatch },
    pipeline_preview: { bg: 'rgba(124, 93, 181, 0.1)', color: 'var(--accent-violet-dark)', label: t.sourceAi },
    realtime_api_sequential: { bg: 'rgba(124, 93, 181, 0.1)', color: 'var(--accent-violet-dark)', label: t.sourceAi },
    mineru: { bg: 'rgba(124, 93, 181, 0.1)', color: 'var(--accent-violet-dark)', label: t.sourceAi },
    manual: { bg: 'rgba(139, 154, 125, 0.15)', color: 'var(--accent-sage-dark)', label: t.sourceManual },
    'manual-backfill': { bg: 'rgba(139, 154, 125, 0.15)', color: 'var(--accent-sage-dark)', label: t.sourceManual },
    contributor: { bg: 'rgba(201, 168, 108, 0.15)', color: 'var(--accent-gold-dark)', label: t.sourceContributor },
  };
  const s = styles[source] || { bg: 'var(--border-light)', color: 'var(--text-muted)', label: t.sourceMaintenance };
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

function FieldBadge({ field }: { field: 'ocr' | 'translation' }) {
  const t = getReaderStrings(useLocale()).history;
  return (
    <span
      className="font-sans text-[10px] font-medium uppercase tracking-[0.08em] px-1.5 py-0.5"
      style={{ color: 'var(--text-muted)', border: '1px solid var(--border-medium)' }}
    >
      {field === 'ocr' ? t.fieldTranscript : t.fieldTranslation}
    </span>
  );
}

function RevisionRow({ row, expanded, onToggle, onRestore, restoring }: {
  row: Row;
  expanded: boolean;
  onToggle: () => void;
  onRestore: (row: Row) => void;
  restoring: boolean;
}) {
  const lang = useLocale();
  const t = getReaderStrings(lang).history;
  return (
    <div className="border-b" style={{ borderColor: 'var(--border-light)' }}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-[var(--bg-white)] transition-colors"
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          <FieldBadge field={row.__field} />
          <SourceBadge source={row.source} />
          {row.model && (
            <span className="font-sans text-[10.5px] truncate" style={{ color: 'var(--text-faint)' }}>
              {formatModel(row.model)}
            </span>
          )}
          {row.edited_by && (
            <span className="font-sans text-[10.5px] truncate" style={{ color: 'var(--text-faint)' }}>
              {row.edited_by}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="font-sans text-[10.5px]" style={{ color: 'var(--text-faint)' }}>
            {formatDate(row.original_date || row.created_at, lang, t)}
          </span>
          <ChevronDown
            className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
            style={{ color: 'var(--text-muted)' }}
          />
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3">
          <div
            className="font-sans text-[11.5px] leading-relaxed p-2.5 rounded mb-2 overflow-auto"
            style={{ background: 'var(--bg-warm)', color: 'var(--text-secondary)', maxHeight: '160px' }}
          >
            {truncate(row.data || '', 600)}
          </div>
          <div className="flex items-center justify-between">
            <span className="font-sans text-[10.5px]" style={{ color: 'var(--text-faint)' }}>
              {(row.data || '').length.toLocaleString(lang)} {t.chars}
            </span>
            {/* Reading history is open to everyone (it's provenance). Restoring
                rewrites the page, so it's gated the same as the route behind it
                (#3511) — mirrors the old reader's RevisionHistory component. */}
            <AuthCheck role="inner_circle">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRestore(row); }}
                disabled={restoring}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[10.5px] font-medium transition-colors hover:bg-accent-gold/8"
                style={{ color: 'var(--accent-rust)' }}
              >
                <RotateCcw className={`w-3 h-3 ${restoring ? 'animate-spin' : ''}`} />
                {restoring ? 'Restoring…' : 'Restore this version'}
              </button>
            </AuthCheck>
          </div>
        </div>
      )}
    </div>
  );
}

// `book` isn't currently needed by the panel body (everything scopes off the
// page id), but the props interface matches Reader2C's other panel components
// (InfoPanel, LibrarianPanel, DownloadsPanel) for a consistent mount signature.
export default function RevisionHistoryPanel({ page, book: _book }: { page: Page; book: Book }) {
  void _book;
  const t = getReaderStrings(useLocale()).history;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [showMaintenance, setShowMaintenance] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    Promise.all([
      fetch(`/api/pages/${page.id}/revisions?field=ocr&limit=100`).then(r => r.json()),
      fetch(`/api/pages/${page.id}/revisions?field=translation&limit=100`).then(r => r.json()),
    ])
      .then(([ocrRes, transRes]) => {
        if (cancelled) return;
        const ocrRows: Row[] = (ocrRes.revisions || []).map((r: PageRevision) => ({ ...r, __field: 'ocr' as const }));
        const transRows: Row[] = (transRes.revisions || []).map((r: PageRevision) => ({ ...r, __field: 'translation' as const }));
        const combined = [...ocrRows, ...transRows].sort((a, b) => {
          const ta = new Date(a.created_at).getTime();
          const tb = new Date(b.created_at).getTime();
          return tb - ta;
        });
        setRows(combined);
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page.id]);

  async function handleRestore(row: Row) {
    setRestoringId(row.id);
    try {
      const res = await fetch(`/api/pages/${page.id}/revisions/${row.id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch {
      // ignore — button just stops spinning
    } finally {
      setRestoringId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto pt-2 pb-6" style={{ overscrollBehavior: 'contain' }}>
        <div className="px-4 py-6 flex items-center gap-2 font-sans text-[13px]" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={14} className="animate-spin" />
          {t.loading}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto pt-2 pb-6" style={{ overscrollBehavior: 'contain' }}>
        <p className="px-4 py-6 font-sans text-[13px]" style={{ color: 'var(--text-muted)' }}>
          {t.loadFailed}
        </p>
      </div>
    );
  }

  const pipelineRows = rows.filter(r => isPipelineSource(r.source));
  const maintenanceRows = rows.filter(r => !isPipelineSource(r.source));

  if (rows.length === 0) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto pt-2 pb-6" style={{ overscrollBehavior: 'contain' }}>
        <div className="px-4 pb-2 flex items-center gap-1.5">
          <History size={13} style={{ color: 'var(--text-faint)' }} />
          <CapsLabel style={{ color: 'var(--text-faint)' }}>{t.title}</CapsLabel>
        </div>
        <p className="px-4 py-4 font-sans text-[13px]" style={{ color: 'var(--text-muted)' }}>
          {t.noRevisions}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pt-2 pb-6" style={{ overscrollBehavior: 'contain' }}>
      <CapsLabel className="block px-4 pb-2" style={{ color: 'var(--text-faint)' }}>
        {t.title}{pipelineRows.length > 0 && ` (${pipelineRows.length})`}
      </CapsLabel>

      {pipelineRows.length === 0 ? (
        <p className="px-4 py-3 font-sans text-[12.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {t.noRevisions} {maintenanceRows.length > 0 && t.onlyMaintenance}
        </p>
      ) : (
        pipelineRows.map(row => (
          <RevisionRow
            key={`${row.__field}-${row.id}`}
            row={row}
            expanded={expandedId === row.id}
            onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
            onRestore={handleRestore}
            restoring={restoringId === row.id}
          />
        ))
      )}

      {maintenanceRows.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowMaintenance(s => !s)}
            className="w-full px-4 py-2 flex items-center justify-between text-left"
          >
            <span className="font-sans text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
              {showMaintenance ? t.hideMaintenance(maintenanceRows.length) : t.showMaintenance(maintenanceRows.length)}
            </span>
            <ChevronDown
              className={`w-3 h-3 transition-transform ${showMaintenance ? 'rotate-180' : ''}`}
              style={{ color: 'var(--text-faint)' }}
            />
          </button>
          <p className="px-4 pb-2 font-sans text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            {t.maintenanceNote}
          </p>
          {showMaintenance && maintenanceRows.map(row => (
            <RevisionRow
              key={`${row.__field}-${row.id}`}
              row={row}
              expanded={expandedId === row.id}
              onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
              onRestore={handleRestore}
              restoring={restoringId === row.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

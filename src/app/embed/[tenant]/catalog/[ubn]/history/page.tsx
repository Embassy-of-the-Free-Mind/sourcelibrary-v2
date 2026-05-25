import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';

/**
 * BPH catalog entry revision history — append-only log of every change
 * applied through applyWorkRevision. Read-only, public to authenticated
 * users (anonymous visitors don't see editing affordances at all so we
 * keep this on the same axis).
 *
 * Source Library is becoming the BPH catalogue of record (issue #1878);
 * this page is the user-visible projection of the bph_works_revisions
 * append-only log. Mistakes are corrected by new revisions, not by
 * editing or deleting old ones — so even rejections/reverts appear here.
 *
 * Issue #1877 — Phase 1, PR-E.
 */

export const metadata: Metadata = {
  title: 'Revision history — BPH catalogue',
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ tenant: string; ubn: string }>;
}

interface FieldChange {
  from?: unknown;
  to: unknown;
  source?: string;
  evidence?: string;
}

interface RevisionRow {
  id: string;
  ubn: string;
  change_type: string;
  field_changes: Record<string, FieldChange>;
  editor_email: string;
  proposed_by: string | null;
  applied_at: string;
  note: string | null;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default async function CatalogHistoryPage({ params }: Props) {
  const { tenant, ubn } = await params;
  if (tenant !== 'bph') notFound();

  // Pull the work title so the page header is friendly.
  const { data: workRow } = await supabase
    .from('bph_works')
    .select('ubn, title, parallel_title, uniform_title')
    .eq('ubn', ubn)
    .maybeSingle();
  if (!workRow) notFound();
  const work = workRow as { ubn: string; title: string | null; parallel_title: string | null; uniform_title: string | null };
  const displayTitle = work.title || work.parallel_title || work.uniform_title || `(untitled — UBN ${work.ubn})`;

  const { data, error } = await supabase
    .from('bph_works_revisions')
    .select('id, ubn, change_type, field_changes, editor_email, proposed_by, applied_at, note')
    .eq('ubn', ubn)
    .order('applied_at', { ascending: false })
    .limit(200);

  const tableMissing = error?.message?.toLowerCase().includes('does not exist') || error?.message?.toLowerCase().includes('could not find');

  const rows = (data || []) as RevisionRow[];

  return (
    <div className="bg-cream min-h-screen">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <a
          href={`/catalog/${encodeURIComponent(ubn)}`}
          className="inline-flex items-center text-sm text-muted hover:text-primary mb-4 transition-colors"
        >
          ← Back to {displayTitle}
        </a>
        <h1 className="text-2xl sm:text-3xl text-primary font-display leading-tight mb-1">
          Revision history
        </h1>
        <p className="text-sm text-muted mb-6">UBN {work.ubn}</p>

        {tableMissing ? (
          <div className="p-4 rounded-lg border border-accent-rust/40 bg-accent-rust/5 text-sm text-secondary">
            <p className="font-medium text-accent-rust mb-1">Revisions table not initialised</p>
            <p>
              The <code className="text-xs">bph_works_revisions</code> table doesn&rsquo;t exist on this environment yet. Apply{' '}
              <code className="text-xs">scripts/migration/add-bph-works-revisions.sql</code> and reload.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 rounded-lg border border-border-light bg-white text-center text-muted text-sm">
            No revisions recorded for this work yet. New edits (from PR-C onwards) will appear here.
          </div>
        ) : (
          <ol className="space-y-3">
            {rows.map((rev) => {
              const fields = Object.entries(rev.field_changes || {});
              return (
                <li key={rev.id} className="border border-border-light rounded-lg bg-white p-4">
                  <header className="flex flex-wrap items-baseline gap-2 mb-3">
                    <span className="text-xs uppercase tracking-wider px-1.5 py-0.5 rounded bg-cream text-secondary">
                      {rev.change_type}
                    </span>
                    <span className="text-sm font-medium text-primary">
                      {fields.length} field{fields.length === 1 ? '' : 's'} changed
                    </span>
                    <span className="text-xs text-muted">{timeAgo(rev.applied_at)}</span>
                    <span className="text-xs text-muted ml-auto">
                      by {rev.editor_email}
                      {rev.proposed_by && rev.proposed_by !== rev.editor_email && (
                        <span> · proposed by {rev.proposed_by}</span>
                      )}
                    </span>
                  </header>
                  {rev.note && (
                    <p className="text-xs text-secondary italic mb-3">&ldquo;{rev.note}&rdquo;</p>
                  )}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wider text-muted">
                        <th className="text-left pb-1 pr-3 font-medium w-1/4">Field</th>
                        <th className="text-left pb-1 pr-3 font-medium w-1/3">From</th>
                        <th className="text-left pb-1 pr-3 font-medium w-1/3">To</th>
                        <th className="text-left pb-1 font-medium">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-light">
                      {fields.map(([field, change]) => (
                        <tr key={field} className="align-top">
                          <td className="py-1.5 pr-3 text-xs text-muted font-mono">{field}</td>
                          <td className="py-1.5 pr-3 text-primary line-through opacity-60 break-words">
                            {formatValue(change.from)}
                          </td>
                          <td className="py-1.5 pr-3 text-primary break-words">{formatValue(change.to)}</td>
                          <td className="py-1.5 text-xs text-muted break-words">
                            {change.source || '—'}
                            {change.evidence && (
                              <a href={change.evidence} target="_blank" rel="noopener noreferrer" className="ml-1 text-accent-rust hover:underline">
                                [link]
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </li>
              );
            })}
          </ol>
        )}

        <p className="text-xs text-muted border-t border-border-light pt-4 mt-6">
          The revision log is append-only: corrections are made by new revisions, not by editing or deleting old ones. Even a mistaken edit is permanent history.
        </p>
      </div>
    </div>
  );
}

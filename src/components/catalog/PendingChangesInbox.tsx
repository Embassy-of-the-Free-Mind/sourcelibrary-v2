'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, ChevronDown, ChevronRight } from 'lucide-react';

interface FieldChange {
  from?: unknown;
  to: unknown;
  source?: string;
  evidence?: string;
}

interface PendingRow {
  id: string;
  ubn: string | null;
  change_type: string;
  proposer_email: string;
  field_changes: Record<string, FieldChange>;
  note: string | null;
  status: string;
  created_at: string;
}

interface Props {
  tenant: string;
  rows: PendingRow[];
  titlesByUbn: Record<string, string>;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return String(v);
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
  return `${d}d ago`;
}

export default function PendingChangesInbox({ tenant, rows, titlesByUbn }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(rows.slice(0, 1).map(r => r.id)));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function decide(pendingId: string, action: 'approve' | 'reject') {
    setBusyId(pendingId);
    setErrors((e) => ({ ...e, [pendingId]: '' }));
    try {
      const body =
        action === 'reject' ? { reviewNote: rejectNotes[pendingId]?.trim() || null } : {};
      const res = await fetch(`/api/${tenant}/catalog/pending/${encodeURIComponent(pendingId)}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: res.statusText }));
        setErrors((e) => ({ ...e, [pendingId]: json.error || `${action} failed (${res.status})` }));
        setBusyId(null);
        return;
      }
      // Refresh server data so the decided row disappears from the inbox.
      startTransition(() => router.refresh());
    } catch (err) {
      setErrors((e) => ({ ...e, [pendingId]: (err as Error).message || 'Request failed' }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const title = row.ubn ? titlesByUbn[row.ubn] || `UBN ${row.ubn}` : '(new catalogue entry)';
        const fieldCount = Object.keys(row.field_changes).length;
        const isOpen = expanded.has(row.id);
        const isBusy = busyId === row.id;
        const error = errors[row.id];
        return (
          <li key={row.id} className="border border-border-light rounded-lg bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(row.id)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-warm transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                {isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-primary truncate">{title}</p>
                  <p className="text-xs text-muted">
                    {row.change_type} · {fieldCount} field{fieldCount === 1 ? '' : 's'} · {row.proposer_email} · {timeAgo(row.created_at)}
                  </p>
                </div>
              </div>
              {row.ubn && (
                <a
                  href={`/catalog/${encodeURIComponent(row.ubn)}`}
                  className="shrink-0 text-xs text-muted hover:text-accent-rust underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  View entry
                </a>
              )}
            </button>
            {isOpen && (
              <div className="border-t border-border-light p-4 space-y-4">
                {/* Diff table */}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wider text-muted">
                      <th className="text-left pb-2 pr-3 font-medium w-1/4">Field</th>
                      <th className="text-left pb-2 pr-3 font-medium w-1/3">From</th>
                      <th className="text-left pb-2 pr-3 font-medium w-1/3">To</th>
                      <th className="text-left pb-2 font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {Object.entries(row.field_changes).map(([field, change]) => (
                      <tr key={field} className="align-top">
                        <td className="py-2 pr-3 text-xs text-muted font-mono">{field}</td>
                        <td className="py-2 pr-3 text-primary line-through opacity-60 break-words">
                          {formatValue(change.from)}
                        </td>
                        <td className="py-2 pr-3 text-primary break-words">
                          {formatValue(change.to)}
                        </td>
                        <td className="py-2 text-xs text-muted break-words">
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

                {row.note && (
                  <p className="text-xs text-secondary italic">
                    Proposer&rsquo;s note: {row.note}
                  </p>
                )}

                {/* Reject note + actions */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <input
                    type="text"
                    value={rejectNotes[row.id] || ''}
                    onChange={(e) => setRejectNotes((m) => ({ ...m, [row.id]: e.target.value }))}
                    placeholder="Reject note (optional — appears on the proposer's view)"
                    className="flex-1 text-sm border border-border-light rounded-md px-3 py-1.5 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => decide(row.id, 'reject')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border-light text-secondary hover:bg-warm hover:text-primary disabled:opacity-50 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => decide(row.id, 'approve')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-accent-rust text-white hover:bg-accent-rust/90 disabled:opacity-50 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Approve
                    </button>
                  </div>
                </div>

                {error && <p className="text-xs text-accent-rust">{error}</p>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

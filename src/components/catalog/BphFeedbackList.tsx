'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, ExternalLink, Check, Columns3 } from 'lucide-react';
import type { LibrarianFeedback } from '@/lib/feedback-origin';

/**
 * Librarian-facing feedback list.
 *
 * Read-only in this phase: no status changes, no replies. Turning a message
 * into a tracked task is the board (next phase), and replying stays on the
 * admin path where the reply email and its idempotency guard already live.
 *
 * Rows arrive already stripped of PII by `toLibrarianFeedback()`. There is no
 * email or IP here to render even if someone tried.
 */

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'record', label: 'About a record' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

/**
 * Pull a UBN out of a catalogue path so a message about a record can link
 * straight back to it. Matches `/catalog/4201` and its embedded equivalent.
 */
function ubnFromPage(page: string | null): string | null {
  if (!page) return null;
  const match = page.match(/\/catalog(?:ue)?\/([^/?#]+)/);
  if (!match) return null;
  const candidate = decodeURIComponent(match[1]);
  // Static children of /catalog are pages, not records.
  const reserved = ['help', 'new', 'review', 'team', 'workspace', 'feedback', 'scholar'];
  if (reserved.includes(candidate)) return null;
  return candidate;
}

export default function BphFeedbackList({
  rows,
  basePath,
  tenant,
  promotedFeedbackIds = [],
}: {
  rows: LibrarianFeedback[];
  basePath: string;
  tenant?: string;
  /** Feedback already turned into a board card, so we don't offer it twice. */
  promotedFeedbackIds?: string[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [promoted, setPromoted] = useState<Set<string>>(() => new Set(promotedFeedbackIds));
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /**
   * Turn a message into a board card. The feedback row is NOT modified: it
   * stays an append-only record of what someone said, and the card is our
   * decision about it, linked by feedback_id.
   */
  async function addToBoard(row: LibrarianFeedback) {
    if (!tenant || promoted.has(row.id)) return;
    setBusy(row.id);
    try {
      const res = await fetch(`/api/${tenant}/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: row.message.replace(/\s+/g, ' ').slice(0, 120),
          body: row.message.length > 120 ? row.message : null,
          feedbackId: row.id,
          list: 'librarian',
        }),
      });
      if (res.ok) {
        setPromoted((s) => new Set(s).add(row.id));
        startTransition(() => router.refresh());
      }
    } finally {
      setBusy(null);
    }
  }

  const counts = useMemo(
    () => ({
      all: rows.length,
      unread: rows.filter((r) => !r.read).length,
      record: rows.filter((r) => ubnFromPage(r.page)).length,
    }),
    [rows]
  );

  const visible = useMemo(() => {
    if (filter === 'unread') return rows.filter((r) => !r.read);
    if (filter === 'record') return rows.filter((r) => ubnFromPage(r.page));
    return rows;
  }, [rows, filter]);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={
              'px-3 py-1.5 text-sm rounded-md border transition-colors ' +
              (filter === f.key
                ? 'border-border-light bg-warm text-primary'
                : 'border-border-light text-secondary hover:bg-warm hover:text-primary')
            }
          >
            {f.label}
            <span className="ml-1.5 text-xs text-muted">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="p-6 rounded-lg border border-border-light bg-white text-center text-muted text-sm">
          Nothing matches that filter.
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((row) => {
            const ubn = ubnFromPage(row.page);
            return (
              <li
                key={row.id}
                className="p-4 rounded-lg border border-border-light bg-white"
              >
                <div className="flex items-start gap-3">
                  <MessageSquare className="w-4 h-4 text-muted mt-1 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-primary whitespace-pre-wrap break-words">
                      {row.message}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span>{row.name || 'Anonymous'}</span>
                      {row.created_at && <span>{formatDate(row.created_at)}</span>}
                      {!row.read && (
                        <span className="px-1.5 py-0.5 rounded bg-warm text-primary">Unread</span>
                      )}
                      {row.addressed && (
                        <span className="px-1.5 py-0.5 rounded bg-warm text-primary">
                          Addressed
                        </span>
                      )}
                      {row.has_contact && <span>Reply address on file</span>}
                      {row.embedded && <span>via embed</span>}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {ubn && (
                        <a
                          href={`${basePath}/${encodeURIComponent(ubn)}`}
                          className="inline-flex items-center gap-1 text-xs text-accent-rust hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          UBN {ubn}
                        </a>
                      )}
                      {tenant &&
                        (promoted.has(row.id) ? (
                          <a
                            href={`${basePath}/inbox?tab=board`}
                            className="inline-flex items-center gap-1 text-xs text-muted hover:text-primary"
                          >
                            <Check className="w-3 h-3" />
                            On the board
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={() => addToBoard(row)}
                            disabled={busy === row.id}
                            className="inline-flex items-center gap-1 text-xs text-secondary hover:text-primary disabled:opacity-50"
                          >
                            <Columns3 className="w-3 h-3" />
                            {busy === row.id ? 'Adding…' : 'Add to board'}
                          </button>
                        ))}
                    </div>
                    {!ubn && row.page && (
                      <p className="mt-2 text-xs text-muted">Sent from {row.page}</p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

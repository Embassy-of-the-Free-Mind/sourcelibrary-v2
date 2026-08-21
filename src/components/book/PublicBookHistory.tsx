'use client';

import { useState } from 'react';
import PlusToggle from './PlusToggle';

interface PublicHistoryEvent {
  type: string;
  timestamp: string;
  description: string;
  pages?: number;
  version?: string;
  doi?: string;
  source_url?: string;
}

/**
 * A public, trimmed processing timeline nested under "Added to Source Library".
 * Shows the steps we took to make the book readable (imported, archived,
 * transcribed, translated, summarised, published) with their dates — but no AI
 * costs or model identities (those stay in the staff-only history). Fetched
 * lazily, only when the reader expands it.
 */
export default function PublicBookHistory({ bookId }: { bookId: string }) {
  const [events, setEvents] = useState<PublicHistoryEvent[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (events || loading) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/books/${bookId}/history/public`);
      setEvents(r.ok ? ((await r.json()).events ?? []) : []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  const fmt = (t: string) => {
    const d = new Date(t);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <details
      className="group rounded-lg border sl-collapse"
      style={{ borderColor: '#e6e0d3', background: '#fff' }}
      onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) load(); }}
    >
      <summary className="px-4 py-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-3">
        <span className="text-[13.5px] font-semibold" style={{ color: '#2b2620' }}>
          Processing history{events && events.length > 0 ? ` · ${events.length} steps` : ''}
        </span>
        <PlusToggle />
      </summary>
      <div className="px-4 pb-4">
        {loading && <div className="text-[13px]" style={{ color: '#948d80' }}>Loading…</div>}
        {events && !loading && events.length === 0 && (
          <div className="text-[13px]" style={{ color: '#948d80' }}>No processing history recorded yet.</div>
        )}
        {events && events.length > 0 && (
          <ol className="relative ml-1 border-l" style={{ borderColor: '#ece6da' }}>
            {events.map((e, i) => (
              <li key={i} className="relative pl-4 pb-3 last:pb-0">
                <span className="absolute -left-[4px] top-[6px] w-2 h-2 rounded-full" style={{ background: '#c9b8a0' }} />
                <div className="text-[10.5px] uppercase tracking-[0.06em]" style={{ color: '#a5503d' }}>{fmt(e.timestamp)}</div>
                <div className="text-[13px] leading-snug" style={{ color: '#2b2620' }}>{e.description}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}

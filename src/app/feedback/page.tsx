'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';

interface FeedbackItem {
  _id: string;
  message: string;
  page: string | null;
  name: string | null;
  email: string | null;
  created_at: string;
  read: boolean;
  /** Set from the SourceLibrary-MCP user-agent at submit time. Absent on pre-backfill rows. */
  channel?: 'mcp' | 'web' | null;
}

/**
 * Humans / Agents split. The public MCP `submit_feedback` tool writes rows that are
 * long, high-volume and confidently wrong at a nontrivial rate, so they must not sit
 * mixed in with the scarce human notes that are actually owed a reply. `/admin/feedback`
 * has had this split since the channel field landed; this page never got it.
 *
 * 'web' is the default view AND matches rows with no `channel` at all, so anything
 * predating the backfill still lists as human rather than disappearing.
 */
type Channel = 'web' | 'mcp' | 'all';

export default function FeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<Channel>('web');
  const [channelCounts, setChannelCounts] = useState<{ web: number; mcp: number }>({ web: 0, mcp: 0 });

  useEffect(() => {
    setLoading(true);
    const channelParam = channel === 'all' ? '' : `&channel=${channel}`;
    fetch(`/api/feedback?limit=100${channelParam}`)
      .then(r => r.json())
      .then(data => {
        setItems(data.feedback || []);
        setTotal(data.total || 0);
        setChannelCounts(data.channel_counts || { web: 0, mcp: 0 });
        setLoading(false);
      })
      .catch(() => {
        toast.error('Failed to load feedback');
        setLoading(false);
      });
  }, [channel]);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <header className="px-6 py-4" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <Link href="/" className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-medium" style={{ color: 'var(--text-primary)' }}>
            Feedback
          </h1>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {total} {total === 1 ? 'message' : 'messages'}
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Wraps rather than scrolls: three short pills fit two-up on a 320px screen. */}
        <div className="flex flex-wrap gap-2 mb-6" role="tablist" aria-label="Feedback source">
          {([
            ['web', `Humans (${channelCounts.web})`],
            ['mcp', `Agents (${channelCounts.mcp})`],
            ['all', 'All'],
          ] as [Channel, string][]).map(([c, label]) => {
            const active = channel === c;
            return (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setChannel(c)}
                className="px-4 py-2 rounded-full text-sm font-medium transition-colors"
                style={{
                  background: active ? 'rgba(158, 74, 58, 0.1)' : 'var(--bg-white)',
                  border: `1px solid ${active ? 'var(--accent-rust)' : 'var(--border-light)'}`,
                  color: active ? 'var(--accent-rust)' : 'var(--text-muted)',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="py-12"><BookLoader size="xs" /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-lg" style={{ color: 'var(--text-muted)' }}>
              {channel === 'mcp' ? 'No agent feedback yet.' : 'No feedback yet.'}
            </p>
            <p className="text-sm mt-2" style={{ color: 'var(--text-faint)' }}>
              {channel === 'mcp'
                ? 'Reports from the public MCP submit_feedback tool will appear here.'
                : 'Feedback submitted from the footer will appear here.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((item) => (
              <div
                key={item._id}
                className="p-5 rounded-xl"
                style={{
                  background: 'var(--bg-white)',
                  border: `1px solid ${item.read ? 'var(--border-light)' : 'var(--accent-amber)'}`,
                }}
              >
                <p className="text-base leading-relaxed mb-3" style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                  {item.message}
                </p>
                <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--text-faint)' }}>
                  {/* Only shown under "All", where the two kinds are interleaved and the
                      distinction is otherwise invisible. */}
                  {channel === 'all' && item.channel === 'mcp' && (
                    <span
                      className="px-1.5 py-0.5 rounded font-medium"
                      style={{ background: 'rgba(158, 74, 58, 0.1)', color: 'var(--accent-rust)' }}
                    >
                      agent
                    </span>
                  )}
                  {item.name && <span style={{ color: 'var(--text-muted)' }}>{item.name}</span>}
                  {item.email && <span>{item.email}</span>}
                  {item.page && (
                    <Link href={item.page} className="underline hover:text-accent-rust">
                      {item.page}
                    </Link>
                  )}
                  <span>{new Date(item.created_at).toLocaleString('en-US')}</span>
                  {!item.read && (
                    <span className="px-1.5 py-0.5 rounded text-xs font-medium" style={{ background: 'rgba(217, 119, 6, 0.1)', color: 'var(--accent-amber)' }}>
                      new
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

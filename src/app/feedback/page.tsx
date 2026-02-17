'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

interface FeedbackItem {
  _id: string;
  message: string;
  page: string | null;
  name: string | null;
  email: string | null;
  created_at: string;
  read: boolean;
}

export default function FeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/feedback?limit=100')
      .then(r => r.json())
      .then(data => {
        setItems(data.feedback || []);
        setTotal(data.total || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <header className="px-6 py-4" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <Link href="/" className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-medium" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
            Feedback
          </h1>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {total} {total === 1 ? 'message' : 'messages'}
          </span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-lg" style={{ color: 'var(--text-muted)' }}>No feedback yet.</p>
            <p className="text-sm mt-2" style={{ color: 'var(--text-faint)' }}>
              Feedback submitted from the footer will appear here.
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
                  {item.name && <span style={{ color: 'var(--text-muted)' }}>{item.name}</span>}
                  {item.email && <span>{item.email}</span>}
                  {item.page && (
                    <Link href={item.page} className="underline hover:text-amber-600">
                      {item.page}
                    </Link>
                  )}
                  <span>{new Date(item.created_at).toLocaleString()}</span>
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

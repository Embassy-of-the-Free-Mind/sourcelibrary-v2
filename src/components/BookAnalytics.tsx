'use client';

import { useEffect, useState } from 'react';
import { Eye, Edit3 } from 'lucide-react';

interface BookAnalyticsProps {
  bookId: string;
}

interface BookStats {
  reads: number;
  edits: number;
}

export default function BookAnalytics({ bookId }: BookAnalyticsProps) {
  const [stats, setStats] = useState<BookStats | null>(null);

  useEffect(() => {
    // Track the read
    fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'book_read', book_id: bookId }),
    }).catch(console.error);

    // Fetch stats
    fetch(`/api/analytics/stats?book_id=${bookId}`)
      .then(res => res.json())
      .then(data => {
        if (data.book_id) {
          setStats({ reads: data.reads, edits: data.edits });
        }
      })
      .catch(console.error);
  }, [bookId]);

  if (!stats) return null;

  return (
    <div className="flex items-center gap-4 text-sm text-stone-400">
      <div className="flex items-center gap-1.5" title="Times viewed">
        <Eye className="w-4 h-4" />
        <span>{stats.reads}</span>
      </div>
      {stats.edits > 0 && (
        <div className="flex items-center gap-1.5" title="Edits made">
          <Edit3 className="w-4 h-4" />
          <span>{stats.edits}</span>
        </div>
      )}
    </div>
  );
}

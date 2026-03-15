'use client';

import { useEffect, useState } from 'react';
import { Eye, Edit3 } from 'lucide-react';
import { analytics } from '@/lib/api-client';

interface BookAnalyticsProps {
  bookId: string;
  className?: string;
}

interface BookStats {
  reads?: number;
  edits?: number;
}

export default function BookAnalytics({ bookId, className }: BookAnalyticsProps) {
  const [stats, setStats] = useState<BookStats | null>(null);

  useEffect(() => {
    // Track the read (fire-and-forget via sendBeacon to avoid blocking hydration)
    try {
      const blob = new Blob([JSON.stringify({ event: 'book_read', book_id: bookId })], { type: 'application/json' });
      navigator.sendBeacon('/api/analytics/track', blob);
    } catch { /* ignore */ }
    // Fetch stats
    analytics.stats(bookId)
      .then(data => {
        if (data.book_id) {
          setStats({ reads: data.reads, edits: data.edits });
        }
      })
      .catch(console.error);
  }, [bookId]);

  const colorClass = className || 'text-stone-400';

  // Show placeholder while loading to prevent layout shift
  if (!stats) {
    return (
      <div className={`flex items-center gap-4 text-sm ${colorClass}`}>
        <div className="flex items-center gap-1.5">
          <Eye className="w-4 h-4 opacity-50" />
          <span className="w-8 h-4 bg-current/20 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-4 text-sm ${colorClass}`}>
      <div className="flex items-center gap-1.5" title="Times viewed">
        <Eye className="w-4 h-4" />
        <span>{stats.reads}</span>
      </div>
      {(stats.edits ?? 0) > 0 && (
        <div className="flex items-center gap-1.5" title="Edits made">
          <Edit3 className="w-4 h-4" />
          <span>{stats.edits}</span>
        </div>
      )}
    </div>
  );
}

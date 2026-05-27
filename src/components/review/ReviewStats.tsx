'use client';

import { useEffect, useState } from 'react';
import { getOrCreateVolunteerId } from '@/lib/volunteer-id';

export default function ReviewStats() {
  const [stats, setStats] = useState<{ total: number; mine: number | null } | null>(null);
  useEffect(() => {
    const id = getOrCreateVolunteerId();
    fetch(`/api/review/stats?volunteer_id=${id}`)
      .then(r => r.json())
      .then(d => setStats({ total: d.total ?? 0, mine: d.mine }))
      .catch(() => {});
  }, []);
  if (!stats) return <div className="text-stone-500 text-sm">Loading totals…</div>;
  return (
    <div className="bg-accent-cream/60 border border-stone-200 rounded-lg px-4 py-3 text-sm text-stone-700">
      <b>{stats.total.toLocaleString()}</b> ratings collected so far
      {stats.mine != null && stats.mine > 0 && (
        <span className="ml-2 text-stone-600">
          — <b>{stats.mine.toLocaleString()}</b> from this browser
        </span>
      )}
    </div>
  );
}

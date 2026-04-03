'use client';

import dynamic from 'next/dynamic';
import type { BookLocation } from './BookMap';

const BookMap = dynamic(() => import('./BookMap'), {
  ssr: false,
  loading: () => (
    <div
      className="flex items-center justify-center h-[calc(100vh-64px)]"
      style={{ background: 'var(--bg-cream)' }}
    >
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Loading map...
      </p>
    </div>
  ),
});

interface BookMapLoaderProps {
  locations: BookLocation[];
  stats: {
    total_books: number;
    total_locations: number;
    by_type: Record<string, number>;
  };
}

export default function BookMapLoader({ locations, stats }: BookMapLoaderProps) {
  return <BookMap locations={locations} stats={stats} />;
}

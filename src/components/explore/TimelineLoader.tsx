'use client';

import dynamic from 'next/dynamic';
import type { TimelineEntity } from './Timeline';

const Timeline = dynamic(() => import('./Timeline'), {
  ssr: false,
  loading: () => (
    <div
      className="flex items-center justify-center h-[calc(100vh-64px)]"
      style={{ background: 'var(--bg-cream)' }}
    >
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Loading timeline...
      </p>
    </div>
  ),
});

interface TimelineLoaderProps {
  entities: TimelineEntity[];
  stats: {
    total: number;
    year_range: [number, number];
    by_century: Record<string, number>;
  };
}

export default function TimelineLoader({ entities, stats }: TimelineLoaderProps) {
  return <Timeline entities={entities} stats={stats} />;
}

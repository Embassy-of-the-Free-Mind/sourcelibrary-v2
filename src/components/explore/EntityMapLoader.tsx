'use client';

import dynamic from 'next/dynamic';
import type { MapEntity } from './EntityMap';

const EntityMap = dynamic(() => import('./EntityMap'), {
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

interface EntityMapLoaderProps {
  entities: MapEntity[];
  stats: {
    total: number;
    by_type: Record<string, number>;
    by_century: Record<string, number>;
  };
}

export default function EntityMapLoader({ entities, stats }: EntityMapLoaderProps) {
  return <EntityMap entities={entities} stats={stats} />;
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ENTITY_TYPE_STYLES, type EntityType } from '@/lib/style-constants';

interface EraEntity {
  name: string;
  type: string;
  book_count: number;
}

interface Era {
  century: number;
  entities: EraEntity[];
}

interface EraHighlightsProps {
  eras: Era[];
}

function centuryLabel(c: number): string {
  if (c <= 0) return `${Math.abs(c) + 1}th c. BCE`;
  const mod10 = c % 10;
  const mod100 = c % 100;
  const suffix =
    mod100 >= 11 && mod100 <= 13 ? 'th' : mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th';
  return `${c}${suffix} Century`;
}

function centuryYearRange(c: number): string {
  const start = (c - 1) * 100;
  const end = c * 100 - 1;
  return `${start}–${end}`;
}

export default function EraHighlights({ eras }: EraHighlightsProps) {
  const [expandedCount, setExpandedCount] = useState(4);

  // Only show eras with at least 2 entities
  const significantEras = eras.filter(e => e.entities.length >= 2);
  const visible = significantEras.slice(0, expandedCount);
  const hasMore = expandedCount < significantEras.length;

  if (significantEras.length === 0) return null;

  return (
    <div className="space-y-6">
      <h2 className="font-serif text-2xl" style={{ color: 'var(--text-primary)' }}>
        Highlights by Era
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        {visible.map((era) => (
          <div
            key={era.century}
            className="rounded-xl p-5"
            style={{ background: 'var(--bg-white, #fff)', border: '1px solid var(--border-light)' }}
          >
            <div className="flex items-baseline gap-2 mb-3">
              <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                {centuryLabel(era.century)}
              </h3>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {centuryYearRange(era.century)}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {era.entities.map((entity) => {
                const styles = ENTITY_TYPE_STYLES[entity.type as EntityType];
                return (
                  <Link
                    key={`${entity.name}-${entity.type}`}
                    href={`/encyclopedia/${encodeURIComponent(entity.name)}`}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm transition-colors ${styles?.badge || 'bg-stone-100 text-stone-700'} ${styles?.pillHover || 'hover:bg-stone-200'}`}
                  >
                    <span className="font-medium">{entity.name}</span>
                    <span className="opacity-60 text-xs">{entity.book_count}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => setExpandedCount(c => c + 4)}
          className="text-sm font-medium hover:opacity-70 transition-opacity"
          style={{ color: 'var(--accent-rust)' }}
        >
          Show more eras ({significantEras.length - expandedCount} remaining)
        </button>
      )}
    </div>
  );
}

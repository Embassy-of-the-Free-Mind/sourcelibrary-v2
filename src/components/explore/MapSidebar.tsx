'use client';

import Link from 'next/link';
import { ENTITY_TYPE_STYLES, ENTITY_TYPE_LABELS, type EntityType } from '@/lib/style-constants';
import type { MapEntity } from './EntityMap';

interface MapSidebarProps {
  entity: MapEntity | null;
  onClose: () => void;
}

export default function MapSidebar({ entity, onClose }: MapSidebarProps) {
  if (!entity) {
    return (
      <div
        className="w-full lg:w-80 shrink-0 p-6 flex items-center justify-center"
        style={{ background: 'var(--bg-cream)', borderLeft: '1px solid var(--border-light)' }}
      >
        <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>
          Click a marker to see details
        </p>
      </div>
    );
  }

  const styles = ENTITY_TYPE_STYLES[entity.type as EntityType];
  const label = ENTITY_TYPE_LABELS[entity.type as EntityType] || entity.type;

  return (
    <div
      className="w-full lg:w-80 shrink-0 overflow-y-auto"
      style={{ background: 'var(--bg-cream)', borderLeft: '1px solid var(--border-light)' }}
    >
      <div className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="font-serif text-xl leading-tight" style={{ color: 'var(--text-primary)' }}>
              {entity.name}
            </h2>
            <span className={`inline-block mt-1.5 px-2 py-0.5 rounded text-xs font-medium ${styles?.badge || 'bg-stone-100 text-stone-700'}`}>
              {label}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-black/5 transition-colors ml-2"
            style={{ color: 'var(--text-muted)' }}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Description */}
        {entity.description && (
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {entity.description}
          </p>
        )}

        {/* Stats */}
        <div className="flex gap-4">
          <div>
            <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {entity.book_count}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>books</div>
          </div>
          <div>
            <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {entity.total_mentions}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>mentions</div>
          </div>
          {entity.century_range && (
            <div>
              <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {entity.century_range[0] === entity.century_range[1]
                  ? `${entity.century_range[0]}th c.`
                  : `${entity.century_range[0]}–${entity.century_range[1]}th c.`}
              </div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>era</div>
            </div>
          )}
        </div>

        {/* Coordinates */}
        <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
          {entity.coordinates.lat.toFixed(4)}, {entity.coordinates.lng.toFixed(4)}
        </div>

        {/* Links */}
        <div className="flex flex-col gap-2 pt-2" style={{ borderTop: '1px solid var(--border-light)' }}>
          <Link
            href={`/encyclopedia/${encodeURIComponent(entity.name)}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium hover:opacity-70 transition-opacity"
            style={{ color: 'var(--accent-rust)' }}
          >
            View in Encyclopedia
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
          {entity.wikidata_id && (
            <a
              href={`https://www.wikidata.org/wiki/${entity.wikidata_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-muted)' }}
            >
              Wikidata ({entity.wikidata_id})
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

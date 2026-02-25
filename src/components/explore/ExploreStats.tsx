'use client';

interface ExploreStatsProps {
  totals: {
    entities: number;
    with_dates: number;
    with_coordinates: number;
    with_wikidata: number;
    books: number;
  };
}

const CARDS = [
  { key: 'entities' as const, label: 'Entities', sub: 'people, places, concepts' },
  { key: 'with_wikidata' as const, label: 'Linked to Wikidata', sub: 'with QIDs' },
  { key: 'with_dates' as const, label: 'With Dates', sub: 'birth/death years' },
  { key: 'with_coordinates' as const, label: 'Mapped', sub: 'with coordinates' },
  { key: 'books' as const, label: 'Source Books', sub: 'digitized texts' },
];

export default function ExploreStats({ totals }: ExploreStatsProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {CARDS.map(({ key, label, sub }) => (
        <div
          key={key}
          className="rounded-xl px-5 py-4"
          style={{ background: 'var(--bg-white, #fff)', border: '1px solid var(--border-light)' }}
        >
          <div className="text-2xl sm:text-3xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {totals[key].toLocaleString()}
          </div>
          <div className="text-sm font-medium mt-1" style={{ color: 'var(--text-secondary)' }}>
            {label}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {sub}
          </div>
        </div>
      ))}
    </div>
  );
}

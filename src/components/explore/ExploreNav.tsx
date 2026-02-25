import Link from 'next/link';

interface ExploreNavProps {
  totals: {
    with_coordinates: number;
    with_dates: number;
    entities: number;
  };
}

const VIZ_CARDS = [
  {
    href: '/explore/map',
    title: 'Map',
    description: 'Geographic distribution of places, institutions, and people across Europe and beyond.',
    statKey: 'with_coordinates' as const,
    statLabel: 'locations plotted',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
        <circle cx="12" cy="9" r="2.5" />
      </svg>
    ),
    color: 'var(--accent-sage)',
    available: true,
  },
  {
    href: '/explore/timeline',
    title: 'Timeline',
    description: 'Lifespans of historical figures — who was alive when, and how intellectual movements clustered.',
    statKey: 'with_dates' as const,
    statLabel: 'dated figures',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8">
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="6" y1="8" x2="14" y2="8" />
        <line x1="8" y1="16" x2="18" y2="16" />
        <circle cx="6" cy="8" r="1.5" fill="currentColor" />
        <circle cx="8" cy="16" r="1.5" fill="currentColor" />
      </svg>
    ),
    color: 'var(--accent-rust)',
    available: true,
  },
  {
    href: '/explore/network',
    title: 'Network',
    description: 'How entities connect through shared books — revealing intellectual clusters and bridging figures.',
    statKey: 'entities' as const,
    statLabel: 'connected entities',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8">
        <circle cx="12" cy="5" r="2" />
        <circle cx="5" cy="18" r="2" />
        <circle cx="19" cy="18" r="2" />
        <circle cx="19" cy="10" r="2" />
        <line x1="12" y1="7" x2="5" y2="16" />
        <line x1="12" y1="7" x2="19" y2="16" />
        <line x1="12" y1="7" x2="19" y2="10" />
        <line x1="7" y1="18" x2="17" y2="18" />
      </svg>
    ),
    color: 'var(--accent-violet)',
    available: false,
  },
];

function CardContent({ card, count }: { card: typeof VIZ_CARDS[number]; count: number }) {
  return (
    <>
      <div className="flex items-start justify-between mb-3">
        <div style={{ color: card.color }}>
          {card.icon}
        </div>
        {!card.available && (
          <span
            className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded"
            style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)' }}
          >
            Coming soon
          </span>
        )}
      </div>
      <h3 className="font-semibold text-lg mb-1" style={{ color: 'var(--text-primary)' }}>
        {card.title}
      </h3>
      <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--text-muted)' }}>
        {card.description}
      </p>
      <div className="text-sm font-medium" style={{ color: card.color }}>
        {count.toLocaleString()} {card.statLabel}
      </div>
    </>
  );
}

export default function ExploreNav({ totals }: ExploreNavProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {VIZ_CARDS.map((card) => {
        const count = totals[card.statKey];
        const sharedClass = `group rounded-xl p-6 transition-all ${
          card.available
            ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer'
            : 'opacity-60 cursor-default'
        }`;
        const sharedStyle = {
          background: 'var(--bg-white, #fff)',
          border: '1px solid var(--border-light)',
        };

        if (card.available) {
          return (
            <Link key={card.title} href={card.href} className={sharedClass} style={sharedStyle}>
              <CardContent card={card} count={count} />
            </Link>
          );
        }

        return (
          <div key={card.title} className={sharedClass} style={sharedStyle}>
            <CardContent card={card} count={count} />
          </div>
        );
      })}
    </div>
  );
}

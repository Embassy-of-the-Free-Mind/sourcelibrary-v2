import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Browse - Source Library',
  description: 'Browse the Source Library collection alphabetically by title, author, or publication year.',
  alternates: { canonical: '/browse' },
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const CENTURIES = [
  { label: 'Ancient', slug: 'ancient', range: 'Before 500 CE' },
  { label: 'Medieval', slug: 'medieval', range: '500–1400' },
  { label: '15th century', slug: '1400s', range: '1400–1499' },
  { label: '16th century', slug: '1500s', range: '1500–1599' },
  { label: '17th century', slug: '1600s', range: '1600–1699' },
  { label: '18th century', slug: '1700s', range: '1700–1799' },
  { label: '19th century', slug: '1800s', range: '1800–1899' },
  { label: '20th century', slug: '1900s', range: '1900–1930' },
];

export default function BrowsePage() {
  return (
    <div className="max-w-4xl mx-auto px-6 md:px-12 py-12 md:py-20">
      <Link href="/" className="inline-flex items-center gap-2 text-sm mb-8 hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Home
      </Link>

      <h1 className="text-3xl md:text-4xl font-display mb-2" style={{ color: 'var(--text-primary)' }}>
        Browse the Collection
      </h1>
      <p className="text-lg mb-12" style={{ color: 'var(--text-muted)' }}>
        Pre-built indexes for browsing without search.
      </p>

      {/* By Title */}
      <section className="mb-12">
        <h2 className="text-xl font-display mb-4" style={{ color: 'var(--text-primary)' }}>
          By Title
        </h2>
        <div className="flex flex-wrap gap-2">
          {LETTERS.map(letter => (
            <Link
              key={letter}
              href={`/browse/titles/${letter}`}
              className="w-10 h-10 flex items-center justify-center rounded-lg text-sm font-medium transition-colors hover:opacity-80"
              style={{ background: 'var(--bg-warm)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }}
            >
              {letter}
            </Link>
          ))}
        </div>
      </section>

      {/* By Author */}
      <section className="mb-12">
        <h2 className="text-xl font-display mb-4" style={{ color: 'var(--text-primary)' }}>
          By Author
        </h2>
        <div className="flex flex-wrap gap-2">
          {LETTERS.map(letter => (
            <Link
              key={letter}
              href={`/browse/authors/${letter}`}
              className="w-10 h-10 flex items-center justify-center rounded-lg text-sm font-medium transition-colors hover:opacity-80"
              style={{ background: 'var(--bg-warm)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }}
            >
              {letter}
            </Link>
          ))}
        </div>
      </section>

      {/* By Period */}
      <section className="mb-12">
        <h2 className="text-xl font-display mb-4" style={{ color: 'var(--text-primary)' }}>
          By Period
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {CENTURIES.map(c => (
            <Link
              key={c.slug}
              href={`/browse/years/${c.slug}`}
              className="rounded-lg p-4 transition-colors hover:opacity-80"
              style={{ background: 'var(--bg-warm)', border: '1px solid var(--border-light)' }}
            >
              <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{c.label}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.range}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

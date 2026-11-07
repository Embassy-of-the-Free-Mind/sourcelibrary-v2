import type { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import summary from './summary.json';
import { MAP_THEMES, sourcesHref } from '@/lib/explore-maps';

// The source surveys (#4922, #7646). Static: the figures come from summary.json, written by
// scripts/maintenance/import-atlas-maps.mjs alongside the copied artifacts. A theme with a conceptual history is not
// listed here: its map is that history's sources view, and /explore/maps/<theme> redirects there (next.config.ts).

const TITLE = 'Source surveys | Source Library';
const DESCRIPTION =
  'Every source the library holds on a theme, tradition by tradition: what you can read now, what is held but not yet readable, and what is missing.';
const OG_IMAGE = { url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library: Digitizing and translating ancient texts' };

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/explore/maps' },
  openGraph: { title: TITLE, description: DESCRIPTION, url: 'https://sourcelibrary.org/explore/maps', siteName: 'Source Library', type: 'website', images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [OG_IMAGE.url] },
};

const fmt = (n: number) => n.toLocaleString('en-US');
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

type Card = { href: string; lead: string; word: string; blurb: string; figures: string; kind: string };

const CARDS: Card[] = [
  {
    href: '/explore/maps/ritual',
    lead: 'Sources on', word: 'Ritual',
    kind: 'Survey',
    blurb: 'Every primary source on liturgy, sacrifice, initiation, magic, funerary and calendar rite, monastic rule and ceremonial that the library holds, in eight traditions from Egypt to the Americas.',
    figures: `${fmt(summary.ritual.books)} books · ${fmt(summary.ritual.readable)} readable, ${fmt(summary.ritual.partial)} partly · checked ${day(summary.ritual.checked)}`,
  },
  {
    href: '/blog/techniques-of-the-body',
    lead: 'Sources on', word: 'Techniques of the Body',
    kind: 'Document',
    blurb: 'Postures, breathing methods and exercises quoted from the books that prescribe them, in Chinese, Sanskrit, Tibetan, Greek, Latin, Hebrew, Arabic and the European vernaculars, each original beside its translation.',
    figures: 'Eight regions · 70 plates',
  },
];

export default function MapsIndexPage() {
  return (
    <ContentPageLayout
      header={<ContentHeader title="Source surveys" subtitle={DESCRIPTION} />}
    >
      <div className="space-y-6">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          <Link href="/explore" className="hover:underline">Explore</Link> / Source surveys
        </p>
        <div className="grid gap-4">
          {CARDS.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="group block rounded-xl p-6 transition-all hover:shadow-md hover:-translate-y-0.5"
              style={{ background: 'var(--bg-white, #fff)', border: '1px solid var(--border-light)' }}
            >
              <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{c.kind}</p>
              <h2 className="font-serif text-3xl mb-2" style={{ color: 'var(--text-primary)' }}>
                {c.lead} <em style={{ color: 'var(--accent-rust)' }}>{c.word}</em>
              </h2>
              <p className="leading-relaxed mb-3" style={{ color: 'var(--text-secondary)' }}>{c.blurb}</p>
              <p className="text-sm font-medium" style={{ color: 'var(--accent-rust)' }}>{c.figures}</p>
            </Link>
          ))}
        </div>
        <section className="pt-4 space-y-3">
          <h2 className="font-serif text-2xl" style={{ color: 'var(--text-primary)' }}>Concepts with a history</h2>
          <p className="leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Consciousness, harmony and magic are surveyed the same way, by tradition and date, as part of their{' '}
            <Link href="/explore/histories" className="underline">conceptual histories</Link>: each history opens its
            sources, with the works it quotes marked.
          </p>
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {MAP_THEMES.filter((t) => sourcesHref(t)).map((t) => (
              <li key={t.slug}>
                <Link href={sourcesHref(t)!} className="font-serif text-lg hover:underline" style={{ color: 'var(--text-primary)' }}>The sources on {t.word.toLowerCase()}</Link>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}> · {fmt(summary[t.slug as 'consciousness' | 'harmony' | 'magic'].works)} works</span>
              </li>
            ))}
          </ul>
        </section>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Surveys of wisdom literature, meditation and dreams are still on the{' '}
          <a href="https://sourcelibrary-atlas.vercel.app" className="underline">Source Library atlas</a>{' '}
          and will move here next.
        </p>
      </div>
    </ContentPageLayout>
  );
}

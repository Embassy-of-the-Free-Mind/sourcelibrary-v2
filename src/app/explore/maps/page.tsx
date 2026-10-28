import type { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import summary from './summary.json';
import { HISTORIES } from '../histories/histories';

// Theme maps moved from the atlas (#4922). Static: the figures come from summary.json,
// written by scripts/maintenance/import-atlas-maps.mjs alongside the copied artifacts.

const TITLE = 'Maps of the library | Source Library';
const DESCRIPTION =
  'What the library holds on a theme, tradition by tradition: what you can read now, what is held but not yet readable, and what is missing.';
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
    href: '/explore/maps/consciousness',
    lead: 'A Map of', word: 'Consciousness',
    kind: 'Timeline map',
    blurb: 'What people across traditions thought the mind is: soul, self, perception, dreams and trance, from the Egyptian ba and the Māṇḍūkya Upaniṣad to Avicenna, Descartes, the Abhidharma and William James. Readable works open with a summary, key terms and passages to start from.',
    figures: `${fmt(summary.consciousness.readable)} of ${fmt(summary.consciousness.works)} works readable now · ${fmt(summary.consciousness.absent)} not held · checked ${day(summary.consciousness.generated)}`,
  },
  {
    href: '/explore/maps/harmony',
    lead: 'A Map of', word: 'Harmony',
    kind: 'Timeline map',
    blurb: 'What people across traditions took harmony and resonance to be: ratio and consonance, unlike things joined in one whole, balance, concord, and strings that answer each other, from the Ṛgveda and Yanzi’s soup to Kepler, Zhu Zaiyu and Helmholtz. Most works open with a reader’s notes and passages checked against the page.',
    figures: `${fmt(summary.harmony.readable)} of ${fmt(summary.harmony.works)} works readable now · ${fmt(summary.harmony.absent)} not held · checked ${day(summary.harmony.generated)}`,
  },
  {
    href: '/explore/maps/magic',
    lead: 'A Map of', word: 'Magic',
    kind: 'Timeline map',
    blurb: 'What people across traditions took magic to be: hidden virtues and sympathy, the stars drawn into images, spirits called and bound, words and names, divination, the witch and her trial, and the power of mind, from the Atharvaveda and the Greek magical papyri to Agrippa, Bodin, Frazer and New Thought. Many works open with a reader’s notes and passages checked against the page.',
    figures: `${fmt(summary.magic.readable)} of ${fmt(summary.magic.works)} works readable now · ${fmt(summary.magic.absent)} not held · checked ${day(summary.magic.generated)}`,
  },
  {
    href: '/explore/maps/ritual',
    lead: 'A Map of', word: 'Ritual',
    kind: 'Survey',
    blurb: 'Every primary source on liturgy, sacrifice, initiation, magic, funerary and calendar rite, monastic rule and ceremonial that the library holds, in eight traditions from Egypt to the Americas.',
    figures: `${fmt(summary.ritual.books)} books · ${fmt(summary.ritual.readable)} readable, ${fmt(summary.ritual.partial)} partly · checked ${day(summary.ritual.checked)}`,
  },
  {
    href: '/blog/techniques-of-the-body',
    lead: 'Techniques of', word: 'the Body',
    kind: 'Document',
    blurb: 'Postures, breathing methods and exercises quoted from the books that prescribe them, in Chinese, Sanskrit, Tibetan, Greek, Latin, Hebrew, Arabic and the European vernaculars, each original beside its translation.',
    figures: 'Eight regions · 70 plates',
  },
];

export default function MapsIndexPage() {
  return (
    <ContentPageLayout
      header={<ContentHeader title="Maps of the library" subtitle={DESCRIPTION} />}
    >
      <div className="space-y-6">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          <Link href="/explore" className="hover:underline">Explore</Link> / Maps
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
          <h2 className="font-serif text-2xl" style={{ color: 'var(--text-primary)' }}>Conceptual histories</h2>
          <p className="leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            One concept followed through its words, across time and languages, in essays whose every claim links to the
            page it quotes. The maps of consciousness, harmony and magic each have one.
          </p>
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {HISTORIES.concepts.map((c) => (
              <li key={c.slug}>
                <Link href={`/explore/histories/${c.slug}`} className="font-serif text-lg hover:underline" style={{ color: 'var(--text-primary)' }}>{c.title}</Link>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}> · {c.essays.length} essays · {fmt(c.counts.verified + c.counts.partial)} claims</span>
              </li>
            ))}
          </ul>
          <p className="text-sm"><Link href="/explore/histories" className="underline" style={{ color: 'var(--text-secondary)' }}>All conceptual histories</Link></p>
        </section>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Maps of wisdom literature, meditation and dreams are still on the{' '}
          <a href="https://sourcelibrary-atlas.vercel.app" className="underline">Source Library atlas</a>{' '}
          and will move here next.
        </p>
      </div>
    </ContentPageLayout>
  );
}

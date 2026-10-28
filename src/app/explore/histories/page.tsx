import type { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { HISTORIES, fmt, day } from './histories';

// Static (#7623): every figure comes from content/index.json, written by
// scripts/maintenance/import-concept-histories.mjs.

const TITLE = 'Conceptual histories | Source Library';
const DESCRIPTION =
  'A concept followed through its words, across time and languages: soul, harmony, magic, sympathy and more, in essays whose every claim links to the page it quotes.';
const OG_IMAGE = { url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library: Digitizing and translating ancient texts' };

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/explore/histories' },
  openGraph: { title: TITLE, description: DESCRIPTION, url: 'https://sourcelibrary.org/explore/histories', siteName: 'Source Library', type: 'website', images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [OG_IMAGE.url] },
};

export default function HistoriesIndexPage() {
  return (
    <ContentPageLayout
      header={<ContentHeader title="Conceptual histories" subtitle={DESCRIPTION} backHref="/explore/maps" backLabel="Maps of the library" />}
    >
      <div className="space-y-6">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          <Link href="/explore">Explore</Link> / Histories
        </p>
        <p className="leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Each history follows one concept through the words that carried it, in the manner of Koselleck’s history of
          concepts and Cassin’s dictionary of untranslatables. Every claim is tied to the page it quotes, so you can open
          the original and read it. Only claims checked against their page are shown; partly verified ones are marked.
          The essays and claims were drafted by AI from the library’s pages. How far they were checked is stated on each
          history.
        </p>
        <div className="grid gap-4">
          {HISTORIES.concepts.map((c) => (
            <Link
              key={c.slug}
              href={`/explore/histories/${c.slug}`}
              // bg-white opts the card out of the .article-page link underline
              className="group block rounded-xl p-6 bg-white transition-all hover:shadow-md hover:-translate-y-0.5"
              style={{ border: '1px solid var(--border-light)' }}
            >
              <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Conceptual history</p>
              <h2 className="font-serif text-3xl mb-2" style={{ color: 'var(--text-primary)' }}>{c.title}</h2>
              <p className="leading-relaxed mb-3" style={{ color: 'var(--text-secondary)' }}>{c.question}</p>
              <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                {fmt(c.counts.essays)} essays · {fmt(c.counts.verified + c.counts.partial)} checked claims
                {c.audit ? ` · audited ${day(c.audit.date)}` : ''}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </ContentPageLayout>
  );
}

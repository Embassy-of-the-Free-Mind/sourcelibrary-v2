import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { HISTORIES, PICKS, cardQuote, pickFor, authorYear } from './histories';

// Static (#7623): every figure comes from content/index.json, written by
// scripts/maintenance/import-concept-histories.mjs; the pictures and quotes from
// content/picks.json (chosen by eye) and content/figures.json.

const TITLE = 'Conceptual histories | Source Library';
const DESCRIPTION =
  'Soul, harmony, magic, sympathy and more, followed through the words that carried them across time and languages, with every claim linked to the page it quotes.';
const HERO = pickFor(PICKS.hero).image;
const OG_IMAGE = { url: HERO.src, alt: HERO.alt };

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/explore/histories' },
  openGraph: { title: TITLE, description: DESCRIPTION, url: 'https://sourcelibrary.org/explore/histories', siteName: 'Source Library', type: 'website', images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [OG_IMAGE.url] },
};

/** The question's first sentence: one line under the quote. */
const firstSentence = (s: string) => s.match(/^.+?[.?!](?=\s|$)/)?.[0] ?? s;

export default function HistoriesIndexPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Conceptual histories"
          subtitle="Eight ideas followed through the words that carried them, in the library’s own books."
          image={HERO.src}
          imageAlt={HERO.alt}
          headerVariant="dark"
        />
      }
    >
      <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
        <Link href="/explore">Explore</Link> / Histories
      </p>
      <div className="grid gap-8 md:grid-cols-2">
        {HISTORIES.concepts.map((c) => {
          const pick = pickFor(c.slug);
          const q = cardQuote(c.slug);
          const href = `/explore/histories/${c.slug}`;
          return (
            <article
              key={c.slug}
              data-card
              className="group relative flex flex-col rounded-xl overflow-hidden transition-shadow hover:shadow-md"
              style={{ background: 'var(--bg-white, #fff)', border: '1px solid var(--border-light)' }}
            >
              <div className="relative h-64" style={{ background: 'var(--bg-warm)' }}>
                <Image src={pick.image.src} alt={pick.image.alt} fill sizes="(max-width: 768px) 100vw, 460px" className="object-contain p-3" />
              </div>
              <div className="flex flex-col flex-1 p-6">
                <p className="font-serif text-lg mb-1" style={{ color: 'var(--text-muted)' }}>
                  {pick.word} <span className="italic text-base">{pick.translit}</span>
                </p>
                <h2 className="font-serif text-3xl mb-4" style={{ color: 'var(--text-primary)' }}>
                  {/* the title link covers the card; the quote's citation link sits above it */}
                  <Link href={href} className="after:absolute after:inset-0" style={{ color: 'inherit' }}>{c.title}</Link>
                </h2>
                {q && (
                  <blockquote className="border-l-2 border-accent-gold/60 pl-4 mb-4 font-body leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                    <p>“{q.q}”</p>
                    <footer className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                      <Link href={q.u} className="relative z-10 underline decoration-accent-gold/70 underline-offset-4">{authorYear(q.l)}</Link>
                    </footer>
                  </blockquote>
                )}
                <p className="text-sm leading-relaxed mt-auto" style={{ color: 'var(--text-secondary)' }}>{firstSentence(c.question)}</p>
              </div>
            </article>
          );
        })}
      </div>

      <section className="mt-16 pt-8" style={{ borderTop: '1px solid var(--border-light)' }}>
        <h2 className="font-serif text-xl mb-3" style={{ color: 'var(--text-primary)' }}>How these were made</h2>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Each history follows one idea through the words different languages used for it. The essays and the claims
          under them were drafted by AI (Claude) from the library’s pages. Every claim names the page it rests on, so you
          can open the book and read the passage yourself. Only claims that were checked against their page are shown,
          and the partly supported ones are marked. Each history says at its foot how far it was checked.
        </p>
      </section>
    </ContentPageLayout>
  );
}

import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import doc from './document.json';
import './body.css';

// The document body was built in the atlas (~/sourcelibrary-atlas/scripts/build-body.mjs),
// with its images moved to public/blog/techniques-of-the-body/ and its stylesheet
// (body.css, scoped under .bodymap) mapped onto the site's colour and font tokens.
// It replaced the prose note "Where the Instructions Are"; that URL 308s here (next.config.ts).

const HERO = 'https://images.sourcelibrary.org/gallery/6992ce183ea667fbac8281b4/6992ce193ea667fbac8281b8-0.jpg';
const HERO_ALT =
  'Woodcut from the Sancai tuhui of 1609: a seated figure performing the exercise prescribed for the fortnight of Rain Water, with the instruction printed beside him.';
const DESCRIPTION =
  'Postures, breathing methods and exercises quoted from the manuals that prescribe them: the Ming seasonal exercises and Eight Brocades, Hua Tuo’s five animals, the seat and breath retentions of haṭha yoga, and the Greek, Arabic and Latin rites. Each original beside its translation.';

export const metadata: Metadata = {
  title: 'Techniques of the Body - Research Notes - Source Library',
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: 'Techniques of the Body',
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/blog/techniques-of-the-body' },
};

const FONTS =
  'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600&family=Noto+Serif+Devanagari:wght@400;600&display=swap';

export default function TechniquesOfTheBodyPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader title="Techniques of the Body" subtitle={DESCRIPTION} image={HERO} imageAlt={HERO_ALT}>
          <p className="text-stone-400 text-sm mt-4">15 September 2026</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      {/* Chinese and Devanagari faces are not in the site stylesheet; this page quotes both at length. */}
      <link rel="stylesheet" href={FONTS} />
      <div className="mb-8">
        <Link href="/blog" className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>
      <article className="bodymap" dangerouslySetInnerHTML={{ __html: doc.body }} />
    </ContentPageLayout>
  );
}

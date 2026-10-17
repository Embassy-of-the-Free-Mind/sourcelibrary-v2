import { Metadata } from 'next';
import doc from './document.json';
import TechniquesDocument, { COPY, HERO_PATH } from './TechniquesDocument';

// The document body was built in the atlas (~/sourcelibrary-atlas/scripts/build-body.mjs),
// with its images moved to public/articles/techniques-of-the-body/ and its stylesheet
// (body.css, scoped under .bodymap) mapped onto the site's colour and font tokens.
// It replaced the prose note "Where the Instructions Are"; that URL 308s here (next.config.ts).
// Spanish twin: src/app/es/blog/techniques-of-the-body.

const HERO = `https://sourcelibrary.org${HERO_PATH}`;
const { title, description, heroAlt } = COPY.en;

export const metadata: Metadata = {
  title: 'Techniques of the Body - Articles - Source Library',
  description,
  openGraph: { images: [{ url: HERO, alt: heroAlt }], title, description },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: heroAlt }] },
  alternates: {
    canonical: '/articles/techniques-of-the-body',
    languages: { en: '/articles/techniques-of-the-body', es: '/es/blog/techniques-of-the-body' },
  },
};

export default function TechniquesOfTheBodyPage() {
  return <TechniquesDocument lang="en" body={doc.body} />;
}

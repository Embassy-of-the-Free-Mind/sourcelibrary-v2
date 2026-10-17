import { Metadata } from 'next';
import doc from '@/app/blog/techniques-of-the-body/document.es.json';
import TechniquesDocument, { COPY, HERO_PATH } from '@/app/blog/techniques-of-the-body/TechniquesDocument';

// Spanish twin of /blog/techniques-of-the-body. The body is document.es.json, built from
// the English document by scripts/maintenance/translate-html-document.mjs (originals kept
// byte for byte; re-run it after editing document.json).

const HERO = `https://sourcelibrary.org${HERO_PATH}`;
const { title, description, heroAlt } = COPY.es;

export const metadata: Metadata = {
  title: 'Técnicas del cuerpo - Notas de investigación - Source Library',
  description,
  openGraph: { images: [{ url: HERO, alt: heroAlt }], title, description, locale: 'es_ES' },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: heroAlt }] },
  alternates: {
    canonical: '/es/blog/techniques-of-the-body',
    languages: { en: '/blog/techniques-of-the-body', es: '/es/blog/techniques-of-the-body' },
  },
};

export default function TecnicasDelCuerpoPage() {
  return <TechniquesDocument lang="es" body={doc.body} />;
}

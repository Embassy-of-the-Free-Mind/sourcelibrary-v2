import type { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import ThemeMap from '@/components/explore/maps/ThemeMap';
import { MAP_THEMES, mapThemeForConcept, sourcesHref } from '@/lib/explore-maps';
import { conceptBySlug } from '../../histories';

// A concept's sources view (#7646): its map, drawn on the client from public/data/maps/, with the works the history
// cites ringed (<slug>-cited.json, scripts/maintenance/link-history-sources.mjs). Only a concept that has a map gets
// one; dynamicParams=false makes any other a routing-level 404, not a soft 200 under /explore's loading.tsx
// (rendering-and-seo.md). data-articles-index opts the map out of the histories' article link styles.
export const dynamicParams = false;
export function generateStaticParams() {
  return MAP_THEMES.filter((t) => t.history && conceptBySlug(t.slug)).map((t) => ({ concept: t.slug }));
}

const OG_IMAGE = { url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library: Digitizing and translating ancient texts' };

export async function generateMetadata({ params }: { params: Promise<{ concept: string }> }): Promise<Metadata> {
  const t = mapThemeForConcept((await params).concept);
  if (!t) return {};
  const path = sourcesHref(t)!;
  const word = t.word.toLowerCase();
  const title = `The sources on ${word} | Source Library`;
  const description = `Every work on ${word} the library knows of, by tradition and date: what you can read now, what we hold untranslated, what we lack.`;
  return {
    title, description,
    alternates: { canonical: path },
    openGraph: { title, description, url: `https://sourcelibrary.org${path}`, siteName: 'Source Library', type: 'website', images: [OG_IMAGE] },
    twitter: { card: 'summary_large_image', title, description, images: [OG_IMAGE.url] },
  };
}

export default async function SourcesPage({ params }: { params: Promise<{ concept: string }> }) {
  const concept = (await params).concept;
  // generateStaticParams lists exactly the concepts with both, and dynamicParams=false refuses the rest
  const t = mapThemeForConcept(concept)!;
  const c = conceptBySlug(concept)!;
  return (
    <>
      <SiteHeader variant="light" />
      <main data-articles-index><ThemeMap theme={t} sources={{ concept: c.slug, title: c.title, history: t.history! }} /></main>
    </>
  );
}

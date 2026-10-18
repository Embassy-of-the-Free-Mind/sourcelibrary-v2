import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SiteHeader from '@/components/layout/SiteHeader';
import ThemeMap from '@/components/explore/maps/ThemeMap';
import { MAP_THEMES, mapThemeBySlug } from '@/lib/explore-maps';
import { FEED_TYPES } from '@/lib/feed-links';

// Static: the map is drawn on the client from copied JSON in public/data/maps/ (#4922).
// dynamicParams=false makes an unknown slug a routing-level 404, not a notFound() under
// /explore's loading.tsx (which would be a soft 200, rendering-and-seo.md).
export const dynamicParams = false;
export function generateStaticParams() { return MAP_THEMES.map((t) => ({ theme: t.slug })); }

const OG_IMAGE = { url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library: Digitizing and translating ancient texts' };

export async function generateMetadata({ params }: { params: Promise<{ theme: string }> }): Promise<Metadata> {
  const t = mapThemeBySlug((await params).theme);
  if (!t) return {};
  const title = `${t.title} | Source Library`;
  const url = `https://sourcelibrary.org/explore/maps/${t.slug}`;
  return {
    title, description: t.short,
    alternates: { canonical: `/explore/maps/${t.slug}`, types: { ...FEED_TYPES } },
    openGraph: { title, description: t.short, url, siteName: 'Source Library', type: 'website', images: [OG_IMAGE] },
    twitter: { card: 'summary_large_image', title, description: t.short, images: [OG_IMAGE.url] },
  };
}

export default async function MapThemePage({ params }: { params: Promise<{ theme: string }> }) {
  const t = mapThemeBySlug((await params).theme);
  if (!t) notFound();
  return (
    <>
      <SiteHeader variant="light" />
      <main><ThemeMap theme={t} /></main>
    </>
  );
}

import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/mongodb';
import { Book } from '@/lib/types';
import SiteHeader from '@/components/layout/SiteHeader';
import ArtworkInfo from '@/components/artwork/ArtworkInfo';

export const revalidate = 3600;
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function getArtwork(slug: string) {
  const db = await getDb();

  // Try exact slug match, then with art- prefix
  const slugsToTry = [slug, `art-${slug}`];
  const artwork = await db.collection('books').findOne(
    { slug: { $in: slugsToTry }, resource_type: { $exists: true } },
  );
  if (!artwork) return null;

  // Get collections this artwork belongs to
  const collectionSlugs = (artwork.collections as string[]) || [];
  const collections = collectionSlugs.length > 0
    ? await db.collection('collections')
        .find({ slug: { $in: collectionSlugs } })
        .project({ _id: 0, slug: 1, name: 1, subtitle: 1, color: 1 })
        .toArray()
    : [];

  return {
    artwork: JSON.parse(JSON.stringify(artwork)) as Book,
    collections: collections as { slug: string; name: string; subtitle?: string; color?: string }[],
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await getArtwork(slug);
  if (!data) return { title: 'Not Found' };
  const { artwork } = data;
  return {
    title: `${artwork.display_title || artwork.title} — ${artwork.author} — Source Library`,
    description: (artwork as any).commons_description?.slice(0, 200) || `${artwork.title} by ${artwork.author}`,
    openGraph: {
      title: `${artwork.display_title || artwork.title} by ${artwork.author}`,
      images: [artwork.thumbnail_blob || artwork.thumbnail || ''],
    },
  };
}

export default async function ArtworkPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await getArtwork(slug);
  if (!data) notFound();

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <SiteHeader variant="dark" />
      <ArtworkInfo book={data.artwork} collections={data.collections} />
    </div>
  );
}

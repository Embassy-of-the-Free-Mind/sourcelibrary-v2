import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import { Book } from '@/lib/types';
import SiteHeader from '@/components/layout/SiteHeader';
import ArtworkInfo from '@/components/artwork/ArtworkInfo';

export const revalidate = false;
export const dynamicParams = true;

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function getArtwork(slug: string) {
  const db = await getReadDb();

  // Try exact slug match, then with art- prefix
  const slugsToTry = [slug, `art-${slug}`];
  const artwork = await db.collection('books').findOne(
    { slug: { $in: slugsToTry }, resource_type: { $exists: true } },
  );
  if (!artwork) return null;

  // Get collections this artwork belongs to
  const collectionSlugs = (artwork.collections as string[]) || [];

  // Scope prev/next navigation to the artwork's collection when it has one — so the
  // arrows walk that set in order (e.g. the 49 hashika-e measles prints). This matters
  // most for collections of anonymous works, where author-scoping would otherwise wander
  // through every "Anonymous" artwork in the library. Falls back to same-artist when the
  // work isn't in any collection.
  const navScope: Record<string, unknown> = collectionSlugs.length > 0
    ? { collections: collectionSlugs[0] }
    : { author: artwork.author };

  // Get prev/next works (chronologically by published date, then title)
  const [collections, prevWorkRaw, nextWorkRaw] = await Promise.all([
    collectionSlugs.length > 0
      ? db.collection('collections')
          .find({ slug: { $in: collectionSlugs } })
          .project({ _id: 0, slug: 1, name: 1, subtitle: 1, color: 1 })
          .toArray()
      : Promise.resolve([]),
    // Previous: earlier in sort order within scope
    db.collection('books').findOne(
      {
        ...navScope,
        resource_type: { $exists: true },
        $or: [
          { published: { $lt: artwork.published || '' } },
          { published: artwork.published || '', title: { $lt: artwork.title } },
        ],
      },
      { projection: { slug: 1, title: 1, display_title: 1 }, sort: { published: -1, title: -1 } }
    ),
    // Next: later in sort order within scope
    db.collection('books').findOne(
      {
        ...navScope,
        resource_type: { $exists: true },
        $or: [
          { published: { $gt: artwork.published || '' } },
          { published: artwork.published || '', title: { $gt: artwork.title } },
        ],
      },
      { projection: { slug: 1, title: 1, display_title: 1 }, sort: { published: 1, title: 1 } }
    ),
  ]);

  const prevWork = prevWorkRaw ? { slug: prevWorkRaw.slug, title: prevWorkRaw.display_title || prevWorkRaw.title } : null;
  const nextWork = nextWorkRaw ? { slug: nextWorkRaw.slug, title: nextWorkRaw.display_title || nextWorkRaw.title } : null;

  return {
    artwork: JSON.parse(JSON.stringify(artwork)) as Book,
    collections: collections as { slug: string; name: string; subtitle?: string; color?: string }[],
    prevWork,
    nextWork,
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  let data: Awaited<ReturnType<typeof getArtwork>>;
  try {
    data = await getArtwork(slug);
  } catch {
    return { title: 'Source Library', robots: { index: false, follow: false } };
  }
  if (!data) return { title: 'Not Found', robots: { index: false, follow: true } };
  const { artwork } = data;
  return {
    title: `${artwork.display_title || artwork.title} — ${artwork.author} — Source Library`,
    description: (artwork as any).commons_description?.slice(0, 200) || `${artwork.title} by ${artwork.author}`,
    robots: { index: true, follow: true },
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
      <SiteHeader variant="light" />
      <ArtworkInfo book={data.artwork} collections={data.collections} prevWork={data.prevWork} nextWork={data.nextWork} />
    </div>
  );
}

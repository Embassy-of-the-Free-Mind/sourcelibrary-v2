import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import { Book } from '@/lib/types';
import SiteHeader from '@/components/layout/SiteHeader';
import ArtworkInfo from '@/components/artwork/ArtworkInfo';
import { isHiddenBook } from '@/lib/book-access';
import { pickArtworkRecord } from '@/lib/artwork-slug';

// Must be a finite number — `false` would cache a bad-render fallback forever
// (e.g. the noindex metadata below) until the next deploy.
export const revalidate = 21600;
export const dynamicParams = true;

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function getArtwork(slug: string) {
  const db = await getReadDb();

  // Exact slug, the legacy `art-` prefixed twin, or the record id. Fetch ALL
  // and choose deliberately — a single findOne over an $in returns an arbitrary
  // match, so a hidden duplicate twin could shadow the visible canonical and
  // 404 a live artwork (see src/lib/artwork-slug.ts). Id resolution matters
  // because /favorites and saved links address artworks by id, and /book/<id>
  // permanently redirects those here.
  const candidates = await db.collection('books').find(
    // content_type:'book' wins: never render a textual book as artwork even via a direct /artwork/<slug> URL.
    {
      $or: [{ slug: { $in: [slug, `art-${slug}`] } }, { id: slug }],
      resource_type: { $exists: true },
      content_type: { $ne: 'book' },
    },
  ).toArray();
  const artwork = pickArtworkRecord(candidates, slug);
  if (!artwork) return null;
  // Hidden (visible:false) artworks are not public — mirror the /book route's
  // gate. The main lookup above had no visibility filter, so a hidden artwork
  // rendered fully via a direct /artwork/<slug> URL even though it's excluded
  // from search/gallery (hidden-readpath-gate invariant; this is how Julika's
  // "searched toltec → clicked → error" hit a record that should never resolve).
  if (isHiddenBook(artwork)) return null;

  // Get collections this artwork belongs to
  const collectionSlugs = (artwork.collections as string[]) || [];

  // Scope prev/next navigation to the artwork's collections — so the arrows walk
  // that set in order (e.g. the 49 hashika-e measles prints). One pair is computed
  // per collection the work belongs to: the page is statically rendered, so it
  // can't read the ?from=<collection> param a visitor arrived with — ArtworkHero
  // picks the matching pair client-side, defaulting to the first collection's pair.
  // Falls back to same-artist when the work isn't in any collection — but NOT for
  // generic/placeholder author values ("Various", "Unknown", "Anonymous", …), where
  // same-author scoping would walk through hundreds of unrelated works (e.g. ~160
  // author:"Various" prints). In that case we suppress prev/next entirely: no
  // arrows is better than jumping to something unrelated.
  const GENERIC_AUTHOR = /^\s*(various|unknown|unidentified|unattributed|anonymous|anon|n\.?\s*a\.?)\s*$/i;
  const hasUsableAuthor =
    typeof artwork.author === 'string' && artwork.author.trim() !== '' && !GENERIC_AUTHOR.test(artwork.author);

  // Prev/next within a scope, chronologically by published date, then title.
  // visible: true keeps the arrows off hidden works.
  const navNeighbor = (scope: Record<string, unknown>, dir: 'prev' | 'next') =>
    db.collection('books').findOne(
      {
        ...scope,
        resource_type: { $exists: true },
        content_type: { $ne: 'book' },
        visible: true,
        $or: dir === 'prev'
          ? [
              { published: { $lt: artwork.published || '' } },
              { published: artwork.published || '', title: { $lt: artwork.title } },
            ]
          : [
              { published: { $gt: artwork.published || '' } },
              { published: artwork.published || '', title: { $gt: artwork.title } },
            ],
      },
      {
        projection: { slug: 1, title: 1, display_title: 1 },
        sort: dir === 'prev' ? { published: -1, title: -1 } : { published: 1, title: 1 },
      }
    ).then(doc => (doc ? { slug: doc.slug as string, title: (doc.display_title || doc.title) as string } : null));

  const navCollections = collectionSlugs.slice(0, 4);
  const useAuthorScope = navCollections.length === 0 && hasUsableAuthor;
  const [collections, authorPrev, authorNext, ...collectionPairs] = await Promise.all([
    collectionSlugs.length > 0
      ? db.collection('collections')
          .find({ slug: { $in: collectionSlugs } })
          .project({ _id: 0, slug: 1, name: 1, subtitle: 1, color: 1 })
          .toArray()
      : Promise.resolve([]),
    useAuthorScope ? navNeighbor({ author: artwork.author }, 'prev') : Promise.resolve(null),
    useAuthorScope ? navNeighbor({ author: artwork.author }, 'next') : Promise.resolve(null),
    ...navCollections.flatMap(colSlug => [
      navNeighbor({ collections: colSlug }, 'prev'),
      navNeighbor({ collections: colSlug }, 'next'),
    ]),
  ]);

  const navByCollection: Record<string, { prev: { slug: string; title: string } | null; next: { slug: string; title: string } | null }> = {};
  navCollections.forEach((colSlug, i) => {
    navByCollection[colSlug] = { prev: collectionPairs[i * 2], next: collectionPairs[i * 2 + 1] };
  });

  // Default pair when no ?from= context: first collection, else same-artist.
  const defaultNav = navCollections.length > 0 ? navByCollection[navCollections[0]] : { prev: authorPrev, next: authorNext };

  return {
    artwork: JSON.parse(JSON.stringify(artwork)) as Book,
    collections: collections as { slug: string; name: string; subtitle?: string; color?: string }[],
    prevWork: defaultNav.prev,
    nextWork: defaultNav.next,
    navByCollection,
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  // No try/catch: letting a fetch failure throw here keeps ISR serving the
  // last good page instead of permanently caching noindex fallback metadata.
  const data = await getArtwork(slug);
  if (!data) return { title: 'Not Found', robots: { index: false, follow: true } };
  const { artwork } = data;
  return {
    title: `${artwork.display_title || artwork.title} — ${artwork.author} — Source Library`,
    description: (artwork as any).commons_description?.slice(0, 200) || `${artwork.title} by ${artwork.author}`,
    // ?from=<collection> nav-context URLs must not index as duplicates
    alternates: { canonical: `/artwork/${artwork.slug || slug}` },
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
      <ArtworkInfo book={data.artwork} collections={data.collections} prevWork={data.prevWork} nextWork={data.nextWork} navByCollection={data.navByCollection} />
    </div>
  );
}

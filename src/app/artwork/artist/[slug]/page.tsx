import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/mongodb';
import SiteHeader from '@/components/layout/SiteHeader';
import { sanitizeThumbnail } from '@/lib/collections-utils';

export const revalidate = 3600;
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function getArtist(slug: string) {
  const db = await getDb();

  // slug is URL-encoded artist name
  const artistName = decodeURIComponent(slug);

  const artworks = await db.collection('books')
    .find(
      { author: artistName, resource_type: { $exists: true } },
      { projection: {
        slug: 1, title: 1, display_title: 1, author: 1, published: 1,
        resource_type: 1, medium: 1, thumbnail: 1, thumbnail_blob: 1,
        commons_width: 1, commons_height: 1,
      }},
    )
    .sort({ published: 1 })
    .toArray();

  if (artworks.length === 0) return null;

  return {
    name: artistName,
    artworks: JSON.parse(JSON.stringify(artworks)),
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await getArtist(slug);
  if (!data) return { title: 'Not Found' };
  return {
    title: `${data.name} — Source Library Visual Art`,
    description: `${data.artworks.length} works by ${data.name} in Source Library.`,
  };
}

export default async function ArtistPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await getArtist(slug);
  if (!data) notFound();

  const { name, artworks } = data;

  // Count by type
  const typeCounts: Record<string, number> = {};
  for (const a of artworks) {
    const t = a.resource_type || 'unknown';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <SiteHeader variant="dark" />

      {/* Hero */}
      <div className="relative bg-stone-900 text-white overflow-hidden">
        {artworks[0]?.thumbnail_blob && sanitizeThumbnail(artworks[0].thumbnail_blob) && (
          <div className="absolute inset-0 opacity-[0.08]">
            <Image src={sanitizeThumbnail(artworks[0].thumbnail_blob) as string} alt="" fill className="object-cover" />
          </div>
        )}
        <div className="relative max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-14 sm:py-20">
          <nav className="flex items-center gap-2 text-xs text-stone-500 mb-8">
            <Link href="/artwork" className="hover:text-stone-300 transition-colors">Visual Art</Link>
            <span>/</span>
            <span className="text-stone-400">{name}</span>
          </nav>

          <h1 className="font-display text-4xl sm:text-5xl font-bold">{name}</h1>
          <div className="flex items-center gap-4 mt-3 text-sm text-stone-400">
            <span>{artworks.length} works</span>
            {Object.entries(typeCounts).map(([type, count]) => (
              <span key={type} className="flex items-center gap-1">
                <span className="w-px h-4 bg-stone-700" />
                {count} {type === 'painting' ? 'paintings' : type === 'print' ? 'prints' : type === 'drawing' ? 'drawings' : type === 'object' ? 'sculptures' : type}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="h-px bg-stone-200" />

      {/* Works grid */}
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-12">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-8">
          {artworks.map((a: any) => {
            const isPortrait = (a.commons_width || 1) < (a.commons_height || 1);
            const thumb = sanitizeThumbnail(a.thumbnail || a.thumbnail_blob || '');
            return (
              <Link key={a.slug} href={`/artwork/${a.slug}`} className="group block">
                <div className={`relative overflow-hidden rounded-sm bg-stone-100 ${isPortrait ? 'aspect-[3/4]' : 'aspect-[4/3]'}`}>
                  {thumb && (
                    <Image
                      src={thumb}
                      alt={a.display_title || a.title}
                      fill
                      className="object-cover group-hover:scale-[1.03] transition-transform duration-700 ease-out"
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    />
                  )}
                </div>
                <div className="mt-2">
                  <h3 className="text-sm font-medium leading-tight line-clamp-2 group-hover:text-accent-rust transition-colors" style={{ color: 'var(--text-primary)' }}>
                    {a.display_title || a.title}
                  </h3>
                  {a.published && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{a.published}</p>}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

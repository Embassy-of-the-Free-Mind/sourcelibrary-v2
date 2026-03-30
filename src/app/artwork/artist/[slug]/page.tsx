import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/lib/mongodb';
import { isAdmin } from '@/lib/auth-helpers';
import SiteHeader from '@/components/layout/SiteHeader';
import { sanitizeThumbnail } from '@/lib/collections-utils';

export const revalidate = 600;
export const dynamicParams = true;

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function getArtist(slug: string) {
  const db = await getDb();

  // Slug can be "Leonardo-da-Vinci" (dashes) or "Leonardo%20da%20Vinci" (encoded)
  const artistName = decodeURIComponent(slug).replace(/-/g, ' ');
  const escaped = artistName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const authorRegex = { $regex: `^${escaped}$`, $options: 'i' };

  // Fetch artworks and books by this author in parallel
  const [artworks, books] = await Promise.all([
    db.collection('books')
      .find(
        { author: authorRegex, resource_type: { $exists: true } },
        { projection: {
          slug: 1, title: 1, display_title: 1, author: 1, published: 1,
          resource_type: 1, medium: 1, thumbnail: 1, thumbnail_blob: 1,
          commons_width: 1, commons_height: 1,
        }},
      )
      .sort({ published: 1 })
      .toArray(),
    db.collection('books')
      .find(
        { author: authorRegex, resource_type: { $exists: false }, visible: true },
        { projection: {
          slug: 1, title: 1, display_title: 1, author: 1, published: 1,
          language: 1, thumbnail: 1, thumbnail_blob: 1, pages_translated: 1,
        }},
      )
      .sort({ published: 1 })
      .toArray(),
  ]);

  // Also check reversed name format for books (e.g. "Dürer, Albrecht")
  let allBooks = books;
  if (books.length === 0 && !artistName.includes(',')) {
    const parts = artistName.split(' ');
    if (parts.length >= 2) {
      const reversed = `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
      const reversedEscaped = reversed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      allBooks = await db.collection('books')
        .find(
          { author: { $regex: `^${reversedEscaped}$`, $options: 'i' }, resource_type: { $exists: false }, visible: true },
          { projection: {
            slug: 1, title: 1, display_title: 1, author: 1, published: 1,
            language: 1, thumbnail: 1, thumbnail_blob: 1, pages_translated: 1,
          }},
        )
        .sort({ published: 1 })
        .toArray();
    }
  }

  if (artworks.length === 0 && allBooks.length === 0) return null;

  return {
    name: artistName,
    artworks: JSON.parse(JSON.stringify(artworks)),
    books: JSON.parse(JSON.stringify(allBooks)),
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  let data: Awaited<ReturnType<typeof getArtist>>;
  try {
    data = await getArtist(slug);
  } catch {
    return { title: 'Source Library', robots: { index: false, follow: false } };
  }
  if (!data) return { title: 'Not Found', robots: { index: false, follow: true } };
  return {
    title: `${data.name} — Source Library Visual Art`,
    description: `${data.artworks.length} works by ${data.name} in Source Library.`,
    // Artist pages are admin-only (non-admin gets redirected) — don't index
    robots: { index: false, follow: true },
  };
}

export default async function ArtistPage({ params }: PageProps) {
  const admin = await isAdmin();
  if (!admin) redirect('/');

  const { slug } = await params;
  const data = await getArtist(slug);
  if (!data) notFound();

  const { name, artworks, books } = data;

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
            <span>{artworks.length} artworks</span>
            {books.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-px h-4 bg-stone-700" />
                {books.length} {books.length === 1 ? 'book' : 'books'}
              </span>
            )}
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

      {/* Books by this author */}
      {books.length > 0 && (
        <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 pt-10 pb-2">
          <h2 className="text-xl font-display font-bold mb-6" style={{ color: 'var(--text-primary)' }}>
            Books by {name}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {books.map((b: any) => {
              const thumb = sanitizeThumbnail(b.thumbnail_blob || b.thumbnail || '');
              return (
                <Link
                  key={b.slug}
                  href={`/book/${b.slug}`}
                  className="flex items-start gap-4 p-4 rounded-lg border hover:border-stone-300 transition-colors group"
                  style={{ background: 'var(--bg-warm)', borderColor: 'var(--border-light)' }}
                >
                  {thumb ? (
                    <div className="relative w-14 h-[72px] flex-shrink-0 rounded-sm overflow-hidden bg-stone-100">
                      <Image src={thumb} alt="" fill className="object-cover" sizes="56px" />
                    </div>
                  ) : (
                    <div className="w-14 h-[72px] flex-shrink-0 rounded-sm bg-stone-100" />
                  )}
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium leading-tight line-clamp-2 group-hover:text-accent-rust transition-colors" style={{ color: 'var(--text-primary)' }}>
                      {b.display_title || b.title}
                    </h3>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      {[b.published, b.language].filter(Boolean).join(' · ')}
                      {b.pages_translated ? ` · ${b.pages_translated} pp translated` : ''}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Artworks grid */}
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-12">
        {books.length > 0 && (
          <h2 className="text-xl font-display font-bold mb-6" style={{ color: 'var(--text-primary)' }}>
            Artworks
          </h2>
        )}
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

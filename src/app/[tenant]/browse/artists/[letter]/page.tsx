import { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import { authorSlug } from '@/lib/slugify';
import { headers } from 'next/headers';
import { browseArtists } from '@/lib/books-catalog';
import { tenantBrowseArtists } from '@/lib/tenant-browse';
import { notFound } from 'next/navigation';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export const revalidate = 86400;
export const maxDuration = 60;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

interface PageProps {
  params: Promise<{ letter: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { letter } = await params;
  const l = letter.toUpperCase();
  return {
    title: `Artists starting with ${l} - Source Library`,
    description: `Browse visual artists in Source Library whose names begin with the letter ${l}.`,
    alternates: { canonical: `/browse/artists/${l}` },
  };
}

export default async function BrowseArtistsPage({ params }: PageProps) {
  const { letter } = await params;
  const l = letter.toUpperCase();
  if (l.length !== 1 || !/[A-Z]/.test(l)) notFound();

  const h = await headers();
  const tenantId = h.get('x-tenant-id');
  const tenantSlug = h.get('x-tenant-slug');
  const base = tenantSlug ? `/${tenantSlug}/browse` : '/browse';

  let artists: { name: string; count: number }[] = [];
  try {
    artists = tenantId
      ? await tenantBrowseArtists(tenantId, l)
      : await browseArtists(l);
  } catch {
    // Supabase error — render empty page
  }

  return (
    <>
      <SiteHeader variant="light" breadcrumbs={[{ label: 'Browse', href: base }]} />
      <div className="max-w-4xl mx-auto px-6 md:px-12 py-12 md:py-20">
        <h1 className="text-3xl md:text-4xl font-display mb-2" style={{ color: 'var(--text-primary)' }}>
          Artists: {l}
        </h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
          {artists.length.toLocaleString('en-US')} {artists.length === 1 ? 'artist' : 'artists'}
        </p>

        {/* Letter nav */}
        <div className="flex flex-wrap gap-1.5 mb-10">
          {LETTERS.map(lt => (
            <Link
              key={lt}
              href={`${base}/artists/${lt}`}
              className={`w-8 h-8 flex items-center justify-center rounded text-xs font-medium transition-colors ${lt === l ? 'text-white' : 'hover:opacity-70'
                }`}
              style={lt === l
                ? { background: 'var(--text-primary)', color: '#fff' }
                : { color: 'var(--text-muted)' }
              }
            >
              {lt}
            </Link>
          ))}
        </div>

        {/* Artist list */}
        <div className="divide-y" style={{ borderColor: 'var(--border-light)' }}>
          {artists.map(artist => (
            <Link
              key={artist.name}
              href={`/artist/${authorSlug(artist.name)}`}
              className="flex items-baseline justify-between py-3 hover:opacity-70 transition-opacity"
            >
              <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                {artist.name}
              </p>
              <p className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {artist.count} {artist.count === 1 ? 'work' : 'works'}
              </p>
            </Link>
          ))}
        </div>

        {artists.length === 0 && (
          <p className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
            No artists found starting with {l}.
          </p>
        )}
      </div>
    </>
  );
}

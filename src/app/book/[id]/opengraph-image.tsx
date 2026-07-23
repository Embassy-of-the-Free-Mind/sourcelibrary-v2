import { ImageResponse } from 'next/og';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { getTenantContext } from '@/lib/tenant-context';
import { Book } from '@/lib/types';

export const alt = 'Book from Source Library';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const JUNK = ['blank', 'digitizer-insert', 'archived-spread', 'scanner_metadata', 'scanner-metadata', 'color-card', 'colorcard', 'color_card', 'target', 'cover', 'spine', 'frontcover', 'backcover'];
// Satori decodes JPEG/PNG/WebP — not AVIF/jp2/tiff — so only tile those.
const OG_SAFE = /^https:\/\/[^?]+\.(jpe?g|png|webp)(\?|$)/i;
const NONINFO_DATE = /^\s*(unknown|undated|n\.?\s?d\.?|\?+|[-—]+)?\s*$/i;

const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

async function getData(id: string, tenantId?: string) {
  try {
    const db = await getReadDb();
    const result = await findBookByIdOrSlug(db, id, {
      _id: 0, id: 1, title: 1, display_title: 1, author: 1, published: 1,
      language: 1, pages_count: 1, thumbnail: 1, image_display: 1,
      source_work_dates: 1, slug: 1,
    }, tenantId);
    if (!result) return null;
    const book = result.book as unknown as Book & { pages_count?: number; id: string };
    // A handful of page-scan thumbnails to tile behind the hero.
    const pages = await db.collection('pages').find(
      { book_id: book.id, page_type: { $nin: JUNK } },
      { projection: { _id: 0, image_thumb: 1, display_photo: 1 }, sort: { page_number: 1 }, limit: 120, maxTimeMS: 4000 },
    ).toArray().catch(() => []);
    const urls = Array.from(new Set(
      pages.map((p) => (p.image_thumb || p.display_photo) as string | undefined)
        .filter((u): u is string => !!u && OG_SAFE.test(u)),
    ));
    // Sample ~18 evenly across the book.
    const N = 18;
    const tiles: string[] = urls.length <= N ? urls : Array.from({ length: N }, (_, i) => urls[Math.floor((i * urls.length) / N)]);
    return { book, tiles };
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getTenantContext();
  const data = await getData(id, ctx?.id ?? undefined);
  const book = data?.book;
  const tiles = data?.tiles ?? [];

  const title = clamp(book?.display_title || book?.title || 'Untitled', 90);
  const author = book?.author ? clamp(String(book.author), 46) : '';
  const cover = book?.thumbnail || (book as { image_display?: string } | undefined)?.image_display;

  // Original title (when the display title is a translation) — one clamped line.
  const original = book?.display_title && book.title && book.display_title !== book.title ? clamp(book.title, 70) : '';

  // Date chip: the print year when informative, else the composition ("written") date.
  const comp = (book?.source_work_dates || []).find((l) => l.type === 'composition')?.date_display?.trim();
  const pub = book?.published ? String(book.published).trim() : '';
  const dateChip = pub && !NONINFO_DATE.test(pub) ? `Published ${pub}` : comp ? `Written ${comp}` : '';
  const chips = [book?.language, book?.pages_count ? `${book.pages_count} scans` : '', dateChip].filter(Boolean) as string[];

  return new ImageResponse(
    (
      <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', background: '#14100c', fontFamily: 'Georgia, serif' }}>
        {/* Tiled page-scan grid */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexWrap: 'wrap' }}>
          {tiles.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt="" width={200} height={210} style={{ objectFit: 'cover' }} />
          ))}
        </div>
        {/* Scrim + left wash + reddish glow — matches the hero */}
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(16,12,8,0.74)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(14,10,7,0.62) 0%, rgba(14,10,7,0.15) 60%, rgba(14,10,7,0) 100%)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 80% 20%, rgba(165,80,61,0.28) 0%, rgba(165,80,61,0) 55%)' }} />

        {/* Content */}
        <div style={{ position: 'relative', display: 'flex', width: '100%', height: '100%', alignItems: 'center', gap: 52, padding: '56px 64px' }}>
          {/* Cover — capped at 50% of the container width */}
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" style={{ maxWidth: '50%', maxHeight: 500, objectFit: 'contain', filter: 'drop-shadow(0 24px 40px rgba(0,0,0,0.6))' }} />
          ) : null}

          {/* Meta — no action buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, color: '#f7f2ea' }}>
            {author ? (
              <div style={{ fontSize: 24, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#d98a72', marginBottom: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{author}</div>
            ) : null}
            <div style={{ fontSize: title.length > 40 ? 54 : 64, fontWeight: 500, lineHeight: 1.08, letterSpacing: '-0.01em', color: '#f7f2ea', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' }}>
              {title}
            </div>
            {original ? (
              <div style={{ fontSize: 26, fontStyle: 'italic', color: 'rgba(248,244,238,0.82)', marginTop: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{original}</div>
            ) : null}
            {chips.length > 0 ? (
              <div style={{ display: 'flex', fontSize: 23, color: 'rgba(245,240,232,0.86)', marginTop: 22, gap: 14, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                {chips.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 14 }}>
                    {i > 0 ? <span style={{ opacity: 0.5 }}>·</span> : null}
                    <span>{c}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* Wordmark */}
        <div style={{ position: 'absolute', bottom: 34, right: 48, display: 'flex', alignItems: 'center', gap: 10, fontSize: 20, color: 'rgba(245,240,232,0.62)' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="rgba(245,240,232,0.5)" strokeWidth="1.4" />
            <circle cx="12" cy="12" r="6" stroke="rgba(245,240,232,0.5)" strokeWidth="1.4" />
            <circle cx="12" cy="12" r="2" fill="rgba(245,240,232,0.5)" />
          </svg>
          <span>Source Library</span>
        </div>
      </div>
    ),
    { ...size },
  );
}

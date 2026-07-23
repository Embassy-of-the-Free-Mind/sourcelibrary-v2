import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { getTenantContext } from '@/lib/tenant-context';
import { Book } from '@/lib/types';

export const alt = 'Book from Source Library';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const NONINFO_DATE = /^\s*(unknown|undated|n\.?\s?d\.?|\?+|[-—]+)?\s*$/i;
const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

async function getData(id: string, tenantId?: string) {
  try {
    const db = await getReadDb();
    const result = await findBookByIdOrSlug(db, id, {
      _id: 0, id: 1, title: 1, display_title: 1, author: 1, published: 1,
      language: 1, pages_count: 1, thumbnail: 1, image_display: 1,
      source_work_dates: 1, hero_mosaic_url: 1, slug: 1,
    }, tenantId);
    if (!result) return null;
    const book = result.book as unknown as Book & { pages_count?: number; hero_mosaic_url?: string; id: string };

    // Reuse the composited hero mosaic — but convert its AVIF (which the OG
    // renderer can't decode) to a PNG data URI so it can be used as the bg.
    let bg: string | null = null;
    if (book.hero_mosaic_url) {
      try {
        const res = await fetch(book.hero_mosaic_url, { signal: AbortSignal.timeout(6000) });
        if (res.ok) {
          const png = await sharp(Buffer.from(await res.arrayBuffer()))
            .resize({ width: 1200, height: 630, fit: 'cover', position: 'top' })
            .png()
            .toBuffer();
          bg = `data:image/png;base64,${png.toString('base64')}`;
        }
      } catch { /* fall back to the plain dark panel */ }
    }
    return { book, bg };
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getTenantContext();
  const data = await getData(id, ctx?.id ?? undefined);
  const book = data?.book;
  const bg = data?.bg;

  const title = clamp(book?.display_title || book?.title || 'Untitled', 78);
  const author = book?.author ? clamp(String(book.author), 46) : '';
  const cover = book?.thumbnail || (book as { image_display?: string } | undefined)?.image_display;
  const original = book?.display_title && book.title && book.display_title !== book.title ? clamp(book.title, 64) : '';

  const comp = (book?.source_work_dates || []).find((l) => l.type === 'composition')?.date_display?.trim();
  const pub = book?.published ? String(book.published).trim() : '';
  const dateChip = pub && !NONINFO_DATE.test(pub) ? `Published ${pub}` : comp ? `Written ${comp}` : '';
  const chips = [book?.language, book?.pages_count ? `${book.pages_count} scans` : '', dateChip].filter(Boolean) as string[];

  // Title fits ~2 lines: scale the font by length, and hard-cap the height.
  const titleFont = title.length > 58 ? 42 : title.length > 36 ? 50 : 60;

  return new ImageResponse(
    (
      <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', background: '#14100c', fontFamily: 'Georgia, serif' }}>
        {/* Page-scan mosaic (same as the hero) */}
        {bg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bg} alt="" width={1200} height={630} style={{ position: 'absolute', inset: 0, objectFit: 'cover' }} />
        ) : null}
        {/* Scrim + left wash + reddish glow — matches the hero */}
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(16,12,8,0.72)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(14,10,7,0.6) 0%, rgba(14,10,7,0.14) 58%, rgba(14,10,7,0) 100%)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 80% 20%, rgba(165,80,61,0.26) 0%, rgba(165,80,61,0) 55%)' }} />

        {/* Content */}
        <div style={{ position: 'relative', display: 'flex', width: '100%', height: '100%', alignItems: 'center', gap: 52, padding: '54px 64px' }}>
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" style={{ maxWidth: '50%', maxHeight: 500, objectFit: 'contain', filter: 'drop-shadow(0 24px 44px rgba(0,0,0,0.62))' }} />
          ) : null}

          {/* Meta — no action buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, color: '#f7f2ea' }}>
            {author ? (
              <div style={{ fontSize: 24, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#d98a72', marginBottom: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{author}</div>
            ) : null}
            <div style={{ fontSize: titleFont, fontWeight: 500, lineHeight: 1.1, letterSpacing: '-0.01em', color: '#f7f2ea', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden', maxHeight: titleFont * 1.1 * 2 }}>
              {title}
            </div>
            {original ? (
              <div style={{ fontSize: 25, fontStyle: 'italic', color: 'rgba(248,244,238,0.82)', marginTop: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{original}</div>
            ) : null}
            {chips.length > 0 ? (
              <div style={{ display: 'flex', fontSize: 22, color: 'rgba(245,240,232,0.86)', marginTop: 22, gap: 14, whiteSpace: 'nowrap', overflow: 'hidden' }}>
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

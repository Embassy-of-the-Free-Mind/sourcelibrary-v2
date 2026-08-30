import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { getTenantContext } from '@/lib/tenant-context';
import { Book } from '@/lib/types';
import type { Locale } from '@/lib/locale-path';
import { BOOK_STRINGS, languageName } from '@/lib/book-i18n';
import { localizedTitle, originalTitleIfDifferent, type LocalizedBookMap } from '@/lib/localized';

/**
 * The book share card, in the reader's language.
 *
 * One renderer for `/book/[id]` and `/es/book/[id]`: the Spanish reader page is
 * a re-export of the English one, and its CARD has to follow the same rule, or
 * a link shared from `/es/book/...` previews an English title with English
 * chips — or, before this existed at all, the generic English site card, since
 * a file-based `opengraph-image` only covers its own route segment (#4162).
 *
 * `lang` decides three things and nothing else: which title is shown
 * (`books.localized.es.title`, else the ORIGINAL — never the English gloss),
 * the chip labels, and the language name. Nothing is machine-translated here.
 */

export const BOOK_OG_SIZE = { width: 1200, height: 630 };
export const BOOK_OG_CONTENT_TYPE = 'image/png';

export const BOOK_OG_ALT: Record<Locale, string> = {
  en: 'Book from Source Library',
  es: 'Libro de Source Library',
};

const NONINFO_DATE = /^\s*(unknown|undated|n\.?\s?d\.?|\?+|[-—]+)?\s*$/i;
const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

type OgBook = Book & {
  pages_count?: number;
  hero_mosaic_url?: string;
  localized?: LocalizedBookMap;
  id: string;
};

async function getData(id: string, tenantId?: string) {
  try {
    const db = await getReadDb();
    const result = await findBookByIdOrSlug(db, id, {
      _id: 0, id: 1, title: 1, display_title: 1, author: 1, published: 1,
      language: 1, pages_count: 1, thumbnail: 1, image_display: 1,
      source_work_dates: 1, hero_mosaic_url: 1, slug: 1, localized: 1,
    }, tenantId);
    if (!result) return null;
    const book = result.book as unknown as OgBook;

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

export async function renderBookOgImage(id: string, lang: Locale = 'en') {
  const t = BOOK_STRINGS[lang];
  const ctx = await getTenantContext();
  const data = await getData(id, ctx?.id ?? undefined);
  const book = data?.book;
  const bg = data?.bg;

  const shown = book ? localizedTitle(book, lang) : '';
  const title = clamp(shown || (lang === 'es' ? 'Sin título' : 'Untitled'), 56);
  const author = book?.author ? clamp(String(book.author), 46) : '';
  const cover = book?.thumbnail || (book as { image_display?: string } | undefined)?.image_display;
  const originalTitle = book ? originalTitleIfDifferent(book, lang) : null;
  const original = originalTitle ? clamp(originalTitle, 64) : '';

  const comp = (book?.source_work_dates || []).find((l) => l.type === 'composition')?.date_display?.trim();
  const pub = book?.published ? String(book.published).trim() : '';
  const dateChip = pub && !NONINFO_DATE.test(pub) ? `${t.published} ${pub}` : comp ? `${t.written} ${comp}` : '';
  const chips = [
    languageName(book?.language, lang),
    book?.pages_count ? t.scans(book.pages_count) : '',
    dateChip,
  ].filter(Boolean) as string[];

  // Title fits ~2 lines: scale the font by length, and hard-cap the height.
  const titleFont = title.length > 48 ? 32 : title.length > 30 ? 38 : title.length > 18 ? 44 : 54;

  return new ImageResponse(
    (
      <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', background: '#14100c', fontFamily: 'Georgia, serif' }}>
        {/* Page-scan mosaic (same as the hero) */}
        {bg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bg} alt="" width={1200} height={630} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : null}
        {/* Scrim + left wash + reddish glow — matches the hero */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(16,12,8,0.72)' }} />
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'linear-gradient(90deg, rgba(14,10,7,0.6) 0%, rgba(14,10,7,0.14) 58%, rgba(14,10,7,0) 100%)' }} />
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'radial-gradient(circle at 80% 20%, rgba(165,80,61,0.26) 0%, rgba(165,80,61,0) 55%)' }} />

        {/* Content */}
        <div style={{ position: 'relative', display: 'flex', width: '100%', height: '100%', alignItems: 'center', gap: 52, padding: '54px 64px' }}>
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" style={{ maxWidth: '42%', maxHeight: 480, objectFit: 'contain', filter: 'drop-shadow(0 24px 44px rgba(0,0,0,0.62))' }} />
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
    { ...BOOK_OG_SIZE },
  );
}

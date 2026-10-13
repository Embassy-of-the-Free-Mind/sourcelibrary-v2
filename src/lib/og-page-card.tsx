import { ImageResponse } from 'next/og';
import { getReadDb } from '@/lib/mongodb';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { findBookForTenant } from '@/lib/tenant-catalog-books';
import { getTenantContext } from '@/lib/tenant-context';
import { Book, Page } from '@/lib/types';
import { readsOriginal, type Locale } from '@/lib/locale-path';
import { localizedTitle } from '@/lib/localized';
import type { LocalizedBookMap } from '@/lib/localized';
import { languageName } from '@/lib/book-i18n';
import { getTranslation } from '@/lib/page-translations';
import { stripMarkupTags } from '@/lib/strip-markup-tags';

/**
 * The reader-page share card, in the reader's language.
 *
 * One renderer for `/book/[id]/page/[pageId]` and its `/es` twin: a file-based
 * opengraph-image covers only its own route segment, so before this the Spanish
 * reader shared under the generic English site card (#4162).
 *
 * `lang` picks the title gloss, the chrome words, and WHICH translation is
 * excerpted — the Spanish one where the page has it. A page with no Spanish
 * text keeps its English excerpt and says so in the label, which is the standing
 * i18n rule (nothing is machine-translated at render time; .claude/docs/i18n.md).
 */

export const PAGE_OG_SIZE = { width: 1200, height: 630 };
export const PAGE_OG_CONTENT_TYPE = 'image/png';

/**
 * Width over height at which a scan is a wide leaf (palm-leaf, pothi, pecha)
 * and the card, like the desktop reader, lays the leaf across the top with the
 * words beneath it instead of standing it in a portrait slot. Same number as
 * WIDE_LEAF_RATIO in Reader2C.tsx — the two surfaces should agree on what is
 * wide (#5352).
 */
const WIDE_LEAF_RATIO = 1.7;

/**
 * Width and height from an image's own header: JPEG (walk the segment markers
 * to the SOF frame) or PNG (the IHDR chunk). Null for anything else or
 * anything malformed. PRIOR ART: scripts/lib/archive-coverage.mjs
 * `probeStoredDimensions` — the same SOF walk, but it fetches the bytes itself
 * over a ranged GET and is a script-side .mjs; here the bytes are already in
 * hand for the renderer. Not sharp: this render function is its own bundle,
 * and importing sharp there returned 500 on every card (preview of #5404).
 */
function imageDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    // SOF0..SOF15 carry the frame dimensions; DHT/JPG/DAC share the range.
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/**
 * The scan, fetched once: its bytes as a data URL for the renderer (which
 * would otherwise fetch the same file again) and its shape, which decides the
 * card's layout. Null on any failure, and the caller falls back to handing the
 * renderer the URL, so a slow or missing image costs the layout choice and
 * nothing else.
 */
async function loadScan(url: string): Promise<{ src: string; ratio: number | null } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    const dims = imageDimensions(bytes);
    const ratio = dims && dims.width && dims.height ? dims.width / dims.height : null;
    const type = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    return { src: `data:${type};base64,${bytes.toString('base64')}`, ratio };
  } catch {
    return null;
  }
}

export const PAGE_OG_ALT: Record<Locale, string> = {
  en: 'Page from Source Library',
  es: 'Página de Source Library',
  la: 'Pagina ex Source Library',
  nl: 'Pagina uit Source Library',
  zh: 'Source Library 书页',
};

/** Card chrome, per locale. Excerpt labels name the language of the TEXT. */
const CARD_STRINGS: Record<Locale, {
  page: (n: string | number) => string;
  unknownTitle: string;
  unknownAuthor: string;
  englishExcerpt: string;
  ownExcerpt: string;
}> = {
  en: {
    page: (n) => `Page ${n}`,
    unknownTitle: 'Unknown Title',
    unknownAuthor: 'Unknown Author',
    englishExcerpt: 'English Translation',
    ownExcerpt: 'English Translation',
  },
  es: {
    page: (n) => `Página ${n}`,
    unknownTitle: 'Título desconocido',
    unknownAuthor: 'Autor desconocido',
    englishExcerpt: 'Traducción al inglés',
    ownExcerpt: 'Traducción al español',
  },
  la: {
    page: (n) => `Pagina ${n}`,
    unknownTitle: 'Titulus ignotus',
    unknownAuthor: 'Auctor ignotus',
    englishExcerpt: 'Conversio Anglica',
    ownExcerpt: 'Textus Latinus',
  },
  nl: {
    page: (n) => `Pagina ${n}`,
    unknownTitle: 'Onbekende titel',
    unknownAuthor: 'Onbekende auteur',
    englishExcerpt: 'Engelse vertaling',
    ownExcerpt: 'Nederlandse tekst',
  },
  zh: {
    page: (n) => `第 ${n} 页`,
    unknownTitle: '书名不详',
    unknownAuthor: '作者不详',
    englishExcerpt: '英文译文',
    ownExcerpt: '中文原文',
  },
};

const OG_BOOK_PROJECTION = {
  _id: 0, id: 1, title: 1, display_title: 1, author: 1, published: 1, language: 1, localized: 1,
};
const OG_PAGE_PROJECTION = {
  _id: 0, id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1,
  display_photo: 1,
  cropped_photo: 1, crop: 1, 'translation.data': 1, 'ocr.data': 1,
  // The language-keyed map (and its legacy Spanish field) so the Spanish card
  // can excerpt the Spanish text rather than the English pivot.
  translations: 1, translation_es: 1,
};

async function getPageData(bookId: string, pageId: string, tenant: { id?: string | null; slug?: string | null } | null): Promise<{ book: Book | null; page: Page | null }> {
  try {
    const db = await getReadDb();

    const [bookResult, page] = await Promise.all([
      findBookForTenant(db, bookId, OG_BOOK_PROJECTION, tenant),
      db.collection('pages').findOne({ id: pageId }, { projection: OG_PAGE_PROJECTION }),
    ]);

    const book = bookResult ? (bookResult.book as unknown as Book) : null;
    if (book && page) {
      const scopedBookId = (book.id || (book as any)._id?.toString()) as string;
      if ((page as any).book_id && (page as any).book_id !== scopedBookId) {
        return { book: null, page: null };
      }
    }

    return {
      book,
      page: page as unknown as Page | null,
    };
  } catch {
    return { book: null, page: null };
  }
}

export async function renderPageOgImage(id: string, pageId: string, lang: Locale = 'en') {
  const t = CARD_STRINGS[lang];
  const ctx = await getTenantContext();
  const { book, page } = await getPageData(id, pageId, ctx);

  const title = (book ? localizedTitle(book as Book & { localized?: LocalizedBookMap }, lang) : '') || t.unknownTitle;
  const author = book?.author || t.unknownAuthor;
  const pageNum = page?.page_number || '?';
  // Prefer the provenance-marked display variant (#2651/#4406): an OG card is
  // scraped and re-hosted by every platform that renders a link preview, so it
  // is one of the most-copied images we emit and should carry its mark.
  // enhanced_photo stays ahead of it — it is a deliberate cover-selection
  // preference and is currently ~0% populated.
  const imageUrl: string | undefined = (page as any)?.enhanced_photo || page?.compressed_photo
    || (page as any)?.display_photo || page?.archived_photo || page?.photo;
  const imageSrc = imageUrl?.replace('/full/full/', '/full/,500/');
  const scan = imageSrc ? await loadScan(imageSrc) : null;
  const wideLeaf = (scan?.ratio ?? 0) >= WIDE_LEAF_RATIO;

  // Truncate title if too long
  const displayTitle = title.length > 50 ? title.substring(0, 47) + '...' : title;

  // Excerpt this locale's own text where the page has it; otherwise the English
  // pivot, labelled as English so the card never passes one off as the other.
  // Latin is never a translation here: a `/la` page exists only for a book
  // WRITTEN in Latin, so its own text is the transcription (#6254).
  const localizedText = lang === 'en' || !page ? null
    : readsOriginal(lang) ? ((page as any)?.ocr?.data as string | undefined) || null
    : getTranslation(page, lang)?.data || null;
  const excerptLabel = localizedText ? t.ownExcerpt : t.englishExcerpt;
  const rawTranslation = localizedText || (page as any)?.translation?.data || '';
  // stripEditorialWrappers first: it removes the page-DESCRIBING blocks
  // (<warning>, <script>, <meta>, …) content and all. A bare tag strip kept
  // their prose, and a card opened with "handwritten Handwritten Jaina
  // Devanagari script. Significant flaking…" instead of the page's words —
  // the mistake that helper's header describes. This is a snippet surface,
  // which is what it was written for.
  const cleanTranslation = rawTranslation
    ? stripMarkupTags(stripEditorialWrappers(rawTranslation), '') // strip inline glosses' tags (keeps text after ->centred<- lines, #5564)
      .replace(/\*\*([^*]+)\*\*/g, '$1') // strip markdown bold
      .replace(/^#{1,6}\s+/gm, '')       // strip markdown headings (they ran into the prose as a literal "#")
      .replace(/\s+/g, ' ')              // collapse whitespace
      .trim()
    : '';
  const translationExcerpt = cleanTranslation
    ? cleanTranslation.slice(0, 220).replace(/\s\S*$/, '') // break at last full word
      + (cleanTranslation.length > 220 ? '...' : '')
    : '';

  // The scan. Standing in the left slot for a page; lying across the top for a
  // wide leaf, as tall as its shape asks up to a cap that leaves room for the
  // words. The card's inner width is 1200 less the 32px padding each side and
  // the 24px the slot adds.
  const leafHeight = wideLeaf && scan?.ratio ? Math.min(300, Math.round((1200 - 64 - 48) / scan.ratio)) : undefined;
  const scanImage = imageSrc ? (
    <img
      src={scan?.src ?? imageSrc}
      alt={`Page ${pageNum}`}
      style={{
        maxWidth: '100%',
        maxHeight: '100%',
        ...(leafHeight ? { height: leafHeight } : {}),
        objectFit: 'contain',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}
    />
  ) : (
    <div
      style={{
        width: wideLeaf ? '60%' : '80%',
        height: '90%',
        background: 'rgba(255,255,255,0.1)',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg
        width="80"
        height="80"
        viewBox="0 0 24 24"
        fill="none"
        stroke="rgba(201, 168, 108, 0.5)"
        strokeWidth="1"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    </div>
  );

  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #1a1612 0%, #2d2520 50%, #1a1612 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: wideLeaf ? 'column' : 'row',
          fontFamily: 'Georgia, serif',
          position: 'relative',
          padding: '32px',
        }}
      >
        {/* Decorative border */}
        <div
          style={{
            position: 'absolute',
            top: 20,
            left: 20,
            right: 20,
            bottom: 20,
            border: '2px solid rgba(201, 168, 108, 0.3)',
            borderRadius: 16,
          }}
        />

        {/* The scan: the left slot for a page, the top band for a wide leaf */}
        <div
          style={{
            width: wideLeaf ? '100%' : '45%',
            height: wideLeaf ? (leafHeight ?? 300) + 48 : '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          {scanImage}
        </div>

        {/* Metadata + translation: beside the page, or beneath the leaf */}
        <div
          style={{
            width: wideLeaf ? '100%' : '55%',
            height: wideLeaf ? undefined : '100%',
            flex: wideLeaf ? 1 : undefined,
            display: 'flex',
            // Beneath a leaf there is a strip 200px tall to work with: the
            // title stands on the left and the words run beside it.
            flexDirection: wideLeaf ? 'row' : 'column',
            alignItems: wideLeaf ? 'center' : undefined,
            justifyContent: 'center',
            // Extra room at the foot so the excerpt box clears the branding
            // line, which sits absolutely at the bottom right.
            padding: wideLeaf ? '0 24px 44px 24px' : '24px 32px 24px 16px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: wideLeaf ? '42%' : '100%',
              paddingRight: wideLeaf ? 24 : 0,
            }}
          >
          {/* Page number badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                background: 'rgba(201, 168, 108, 0.2)',
                border: '1px solid rgba(201, 168, 108, 0.4)',
                borderRadius: 8,
                padding: '6px 14px',
                fontSize: 20,
                color: '#c9a86c',
                display: 'flex',
              }}
            >
              {t.page(pageNum)}
            </div>
          </div>

          {/* Book title */}
          <div
            style={{
              fontSize: translationExcerpt ? (title.length > 35 ? 28 : 32) : (title.length > 35 ? 36 : 44),
              fontWeight: 400,
              color: '#fdfcf9',
              letterSpacing: '-0.02em',
              marginBottom: 8,
              display: 'flex',
              lineHeight: 1.2,
            }}
          >
            {displayTitle}
          </div>

          {/* Author + Year */}
          <div
            style={{
              fontSize: translationExcerpt ? 18 : 28,
              color: '#c9a86c',
              marginBottom: translationExcerpt ? 4 : 8,
              display: 'flex',
              gap: 8,
            }}
          >
            <span>{author}</span>
            {book?.published && <span style={{ color: 'rgba(253, 252, 249, 0.5)' }}>({book.published})</span>}
          </div>

          {/* Decorative line (only when no translation) */}
          {!translationExcerpt && (
            <>
              {(book?.language) && (
                <div
                  style={{
                    fontSize: 20,
                    color: 'rgba(253, 252, 249, 0.6)',
                    display: 'flex',
                    marginTop: 4,
                  }}
                >
                  {languageName(book.language, lang)}
                </div>
              )}
              <div
                style={{
                  width: 80,
                  height: 2,
                  background: 'linear-gradient(90deg, #c9a86c, transparent)',
                  marginTop: 24,
                }}
              />
            </>
          )}
          </div>

          {/* Translation excerpt — the hook that makes people click */}
          {translationExcerpt && (
            <div
              style={{
                marginTop: wideLeaf ? 0 : 16,
                width: wideLeaf ? '58%' : undefined,
                padding: '14px 18px',
                background: 'rgba(253, 252, 249, 0.06)',
                borderLeft: '3px solid rgba(201, 168, 108, 0.5)',
                borderRadius: '0 8px 8px 0',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.1em',
                  color: 'rgba(201, 168, 108, 0.7)',
                  marginBottom: 8,
                  display: 'flex',
                }}
              >
                {excerptLabel}
              </div>
              <div
                style={{
                  fontSize: 17,
                  lineHeight: 1.5,
                  color: 'rgba(253, 252, 249, 0.85)',
                  fontStyle: 'italic',
                  display: 'flex',
                }}
              >
                {translationExcerpt}
              </div>
            </div>
          )}
        </div>

        {/* Source Library branding */}
        <div
          style={{
            position: 'absolute',
            bottom: 36,
            right: 48,
            fontSize: 18,
            color: 'rgba(253, 252, 249, 0.5)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>Source Library</span>
        </div>
      </div>
    ),
    { ...PAGE_OG_SIZE },
  );
}

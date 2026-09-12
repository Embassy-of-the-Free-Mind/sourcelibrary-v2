import { ImageResponse } from 'next/og';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { getTenantContext } from '@/lib/tenant-context';
import { Book, Page } from '@/lib/types';
import type { Locale } from '@/lib/locale-path';
import { localizedTitle } from '@/lib/localized';
import type { LocalizedBookMap } from '@/lib/localized';
import { languageName } from '@/lib/book-i18n';
import { getTranslation } from '@/lib/page-translations';

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

export const PAGE_OG_ALT: Record<Locale, string> = {
  en: 'Page from Source Library',
  es: 'Página de Source Library',
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

async function getPageData(bookId: string, pageId: string, tenantId?: string): Promise<{ book: Book | null; page: Page | null }> {
  try {
    const db = await getReadDb();

    const [bookResult, page] = await Promise.all([
      findBookByIdOrSlug(db, bookId, OG_BOOK_PROJECTION, tenantId),
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
  const { book, page } = await getPageData(id, pageId, ctx?.id ?? undefined);

  const title = (book ? localizedTitle(book as Book & { localized?: LocalizedBookMap }, lang) : '') || t.unknownTitle;
  const author = book?.author || t.unknownAuthor;
  const pageNum = page?.page_number || '?';
  // Prefer the provenance-marked display variant (#2651/#4406): an OG card is
  // scraped and re-hosted by every platform that renders a link preview, so it
  // is one of the most-copied images we emit and should carry its mark.
  // enhanced_photo stays ahead of it — it is a deliberate cover-selection
  // preference and is currently ~0% populated.
  const imageUrl = (page as any)?.enhanced_photo || page?.compressed_photo
    || (page as any)?.display_photo || page?.archived_photo || page?.photo;

  // Truncate title if too long
  const displayTitle = title.length > 50 ? title.substring(0, 47) + '...' : title;

  // Excerpt this locale's own text where the page has it; otherwise the English
  // pivot, labelled as English so the card never passes one off as the other.
  const localizedText = lang === 'en' || !page ? null : getTranslation(page, lang)?.data || null;
  const excerptLabel = localizedText ? t.ownExcerpt : t.englishExcerpt;
  const rawTranslation = localizedText || (page as any)?.translation?.data || '';
  const translationExcerpt = rawTranslation
    ? rawTranslation
      .replace(/<[^>]+>/g, '')           // strip XML/HTML tags
      .replace(/\*\*([^*]+)\*\*/g, '$1') // strip markdown bold
      .replace(/^#{1,6}\s+/gm, '')       // strip markdown headings (they ran into the prose as a literal "#")
      .replace(/\s+/g, ' ')              // collapse whitespace
      .trim()
      .slice(0, 220)
      .replace(/\s\S*$/, '')            // break at last full word
    + (rawTranslation.length > 220 ? '...' : '')
    : '';

  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #1a1612 0%, #2d2520 50%, #1a1612 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
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

        {/* Left side - Page image or placeholder */}
        <div
          style={{
            width: '45%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          {imageUrl ? (
            <img
              src={imageUrl.replace('/full/full/', '/full/,500/')}
              alt={`Page ${pageNum}`}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                borderRadius: 8,
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              }}
            />
          ) : (
            <div
              style={{
                width: '80%',
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
          )}
        </div>

        {/* Right side - Metadata + Translation */}
        <div
          style={{
            width: '55%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '24px 32px 24px 16px',
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

          {/* Translation excerpt — the hook that makes people click */}
          {translationExcerpt && (
            <div
              style={{
                marginTop: 16,
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

import { ImageResponse } from 'next/og';
import { getDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { Book, Page } from '@/lib/types';

export const alt = 'Page from Source Library';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

const OG_BOOK_PROJECTION = {
  _id: 0, id: 1, title: 1, display_title: 1, author: 1, published: 1, language: 1,
};
const OG_PAGE_PROJECTION = {
  _id: 0, id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1,
  cropped_photo: 1, crop: 1, 'translation.data': 1, 'ocr.data': 1,
};

async function getPageData(bookId: string, pageId: string): Promise<{ book: Book | null; page: Page | null }> {
  try {
    const db = await getDb();

    const [bookResult, page] = await Promise.all([
      findBookByIdOrSlug(db, bookId, OG_BOOK_PROJECTION),
      db.collection('pages').findOne({ id: pageId }, { projection: OG_PAGE_PROJECTION }),
    ]);

    return {
      book: bookResult ? (bookResult.book as unknown as Book) : null,
      page: page as unknown as Page | null,
    };
  } catch {
    return { book: null, page: null };
  }
}

export default async function Image({ params }: { params: Promise<{ id: string; pageId: string }> }) {
  const { id, pageId } = await params;
  const { book, page } = await getPageData(id, pageId);

  const title = book?.display_title || book?.title || 'Unknown Title';
  const author = book?.author || 'Unknown Author';
  const pageNum = page?.page_number || '?';
  const imageUrl = page?.compressed_photo || page?.archived_photo || page?.photo;

  // Truncate title if too long
  const displayTitle = title.length > 50 ? title.substring(0, 47) + '...' : title;

  // Extract a clean translation excerpt for the OG image
  const rawTranslation = (page as any)?.translation?.data || '';
  const translationExcerpt = rawTranslation
    ? rawTranslation
        .replace(/<[^>]+>/g, '')          // strip XML/HTML tags
        .replace(/\*\*([^*]+)\*\*/g, '$1') // strip markdown bold
        .replace(/\s+/g, ' ')             // collapse whitespace
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
              Page {pageNum}
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
                English Translation
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
                  {book.language}
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
    {
      ...size,
    }
  );
}

import { ImageResponse } from 'next/og';
import { getDb } from '@/lib/mongodb';
import { Book, Page } from '@/lib/types';

export const alt = 'Page from Source Library';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

async function getPageData(bookId: string, pageId: string): Promise<{ book: Book | null; page: Page | null }> {
  try {
    const db = await getDb();

    let book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      const { ObjectId } = await import('mongodb');
      if (ObjectId.isValid(bookId)) {
        book = await db.collection('books').findOne({ _id: new ObjectId(bookId) });
      }
    }

    if (!book) return { book: null, page: null };

    const page = await db.collection('pages').findOne({ id: pageId });

    return {
      book: book as unknown as Book,
      page: page as unknown as Page | null
    };
  } catch {
    return { book: null, page: null };
  }
}

export default async function Image({ params }: { params: { id: string; pageId: string } }) {
  const { book, page } = await getPageData(params.id, params.pageId);

  const title = book?.display_title || book?.title || 'Unknown Title';
  const author = book?.author || 'Unknown Author';
  const pageNum = page?.page_number || '?';
  const imageUrl = page?.compressed_photo || page?.archived_photo || page?.photo;

  // Truncate title if too long
  const displayTitle = title.length > 50 ? title.substring(0, 47) + '...' : title;

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

        {/* Right side - Metadata */}
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
              marginBottom: 16,
            }}
          >
            <div
              style={{
                background: 'rgba(201, 168, 108, 0.2)',
                border: '1px solid rgba(201, 168, 108, 0.4)',
                borderRadius: 8,
                padding: '8px 16px',
                fontSize: 24,
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
              fontSize: title.length > 35 ? 36 : 44,
              fontWeight: 400,
              color: '#fdfcf9',
              letterSpacing: '-0.02em',
              marginBottom: 12,
              display: 'flex',
              lineHeight: 1.2,
            }}
          >
            {displayTitle}
          </div>

          {/* Author */}
          <div
            style={{
              fontSize: 28,
              color: '#c9a86c',
              marginBottom: 8,
              display: 'flex',
            }}
          >
            {author}
          </div>

          {/* Year and language */}
          {(book?.published || book?.language) && (
            <div
              style={{
                fontSize: 20,
                color: 'rgba(253, 252, 249, 0.6)',
                display: 'flex',
                gap: 12,
              }}
            >
              {book?.published && <span>{book.published}</span>}
              {book?.published && book?.language && <span>•</span>}
              {book?.language && <span>{book.language}</span>}
            </div>
          )}

          {/* Decorative line */}
          <div
            style={{
              width: 80,
              height: 2,
              background: 'linear-gradient(90deg, #c9a86c, transparent)',
              marginTop: 24,
            }}
          />
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

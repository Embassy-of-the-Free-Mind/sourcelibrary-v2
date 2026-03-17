import { ImageResponse } from 'next/og';
import { getDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { Book } from '@/lib/types';

export const alt = 'Book from Source Library';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

async function getBookForOG(id: string): Promise<Book | null> {
  try {
    const db = await getDb();
    const result = await findBookByIdOrSlug(db, id, {
      _id: 0, id: 1, title: 1, display_title: 1, author: 1,
      published: 1, language: 1, thumbnail: 1, slug: 1,
    });
    return result ? (result.book as unknown as Book) : null;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const book = await getBookForOG(id);

  const title = book?.display_title || book?.title || 'Unknown Title';
  const author = book?.author || 'Unknown Author';
  const thumbnail = book?.thumbnail;

  // Truncate title if too long
  const displayTitle = title.length > 60 ? title.substring(0, 57) + '...' : title;

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

        {/* Left side - Cover image or placeholder */}
        <div
          style={{
            width: '40%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          {thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnail}
              alt={title}
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
                background: 'rgba(255,255,255,0.08)',
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
            width: '60%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '24px 32px 24px 16px',
          }}
        >
          {/* Book title */}
          <div
            style={{
              fontSize: title.length > 40 ? 36 : 44,
              fontWeight: 400,
              color: '#fdfcf9',
              letterSpacing: '-0.02em',
              marginBottom: 16,
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
              marginBottom: 12,
              display: 'flex',
            }}
          >
            {author}
          </div>

          {/* Year and language */}
          {(book?.published || book?.language) && (
            <div
              style={{
                fontSize: 22,
                color: 'rgba(253, 252, 249, 0.6)',
                display: 'flex',
                gap: 12,
              }}
            >
              {book?.published && <span>{book.published}</span>}
              {book?.published && book?.language && <span>·</span>}
              {book?.language && <span>{book.language}</span>}
            </div>
          )}

          {/* Decorative line */}
          <div
            style={{
              width: 80,
              height: 2,
              background: 'linear-gradient(90deg, #c9a86c, transparent)',
              marginTop: 28,
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
            gap: 10,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="rgba(253,252,249,0.4)" strokeWidth="1" />
            <circle cx="12" cy="12" r="7" stroke="rgba(253,252,249,0.4)" strokeWidth="1" />
            <circle cx="12" cy="12" r="4" stroke="rgba(253,252,249,0.4)" strokeWidth="1" />
          </svg>
          <span>Source Library</span>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}

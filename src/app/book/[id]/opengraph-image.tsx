import { ImageResponse } from 'next/og';
import { getDb } from '@/lib/mongodb';
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
    const book = await db.collection('books').findOne({ id });
    return book as unknown as Book | null;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: { id: string } }) {
  const book = await getBookForOG(params.id);

  const title = book?.display_title || book?.title || 'Unknown Title';
  const author = book?.author || 'Unknown Author';
  const year = book?.published || '';
  const language = book?.language || '';

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
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Georgia, serif',
          position: 'relative',
          padding: '48px',
        }}
      >
        {/* Decorative border */}
        <div
          style={{
            position: 'absolute',
            top: 24,
            left: 24,
            right: 24,
            bottom: 24,
            border: '2px solid rgba(201, 168, 108, 0.3)',
            borderRadius: 16,
          }}
        />

        {/* Inner decorative border */}
        <div
          style={{
            position: 'absolute',
            top: 32,
            left: 32,
            right: 32,
            bottom: 32,
            border: '1px solid rgba(201, 168, 108, 0.15)',
            borderRadius: 12,
          }}
        />

        {/* Book icon */}
        <div
          style={{
            display: 'flex',
            marginBottom: 20,
          }}
        >
          <svg
            width="56"
            height="56"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#c9a86c"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            <path d="M8 7h8" />
            <path d="M8 11h6" />
          </svg>
        </div>

        {/* Book title */}
        <div
          style={{
            fontSize: title.length > 40 ? 48 : 56,
            fontWeight: 400,
            color: '#fdfcf9',
            letterSpacing: '-0.02em',
            marginBottom: 16,
            display: 'flex',
            textAlign: 'center',
            maxWidth: '90%',
            lineHeight: 1.2,
          }}
        >
          {displayTitle}
        </div>

        {/* Author */}
        <div
          style={{
            fontSize: 32,
            color: '#c9a86c',
            marginBottom: 8,
            display: 'flex',
          }}
        >
          {author}
        </div>

        {/* Year and language */}
        {(year || language) && (
          <div
            style={{
              fontSize: 24,
              color: 'rgba(253, 252, 249, 0.6)',
              display: 'flex',
              gap: 16,
            }}
          >
            {year && <span>{year}</span>}
            {year && language && <span>•</span>}
            {language && <span>{language}</span>}
          </div>
        )}

        {/* Decorative line */}
        <div
          style={{
            width: 120,
            height: 2,
            background: 'linear-gradient(90deg, transparent, #c9a86c, transparent)',
            marginTop: 32,
          }}
        />

        {/* Source Library branding */}
        <div
          style={{
            position: 'absolute',
            bottom: 48,
            fontSize: 20,
            color: 'rgba(253, 252, 249, 0.5)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>Source Library</span>
          <span style={{ color: '#c9a86c' }}>•</span>
          <span>Rare Texts Digitized</span>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}

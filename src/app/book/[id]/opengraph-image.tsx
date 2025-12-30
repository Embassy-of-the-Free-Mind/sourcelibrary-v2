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
    let book = await db.collection('books').findOne({ id });
    if (!book) {
      const { ObjectId } = await import('mongodb');
      if (ObjectId.isValid(id)) {
        book = await db.collection('books').findOne({ _id: new ObjectId(id) });
      }
    }
    return book as unknown as Book | null;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: { id: string } }) {
  const book = await getBookForOG(params.id);
  const thumbnail = book?.thumbnail;

  // If book has a thumbnail, show it
  if (thumbnail) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#000000',
          }}
        >
          <img
            src={thumbnail}
            alt={book?.title || 'Book'}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
            }}
          />
        </div>
      ),
      {
        ...size,
      }
    );
  }

  // Fallback: concentric circles logo on white
  return new ImageResponse(
    (
      <div
        style={{
          background: '#ffffff',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="300"
          height="300"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="12" r="10" fill="none" stroke="#000000" strokeWidth="0.8" />
          <circle cx="12" cy="12" r="7" fill="none" stroke="#000000" strokeWidth="0.8" />
          <circle cx="12" cy="12" r="4" fill="none" stroke="#000000" strokeWidth="0.8" />
        </svg>
      </div>
    ),
    {
      ...size,
    }
  );
}

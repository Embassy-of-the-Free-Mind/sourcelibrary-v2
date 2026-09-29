import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';
import { RoomHeader, RoomFooter } from '@/components/rooms/RoomChrome';
import { getCachedRoom } from '@/components/rooms/room-loader';
import { getReadDb } from '@/lib/mongodb';
import { getRoomBooks } from '@/lib/reading-rooms';
import { ROOMS_ROOT } from '@/lib/reading-rooms-paths';

/**
 * The shelf: every book in the room, as the site-wide book card, each linking
 * INTO the room (`/rooms/<slug>/book/<book>`), never to the global /book URL.
 * The href is passed explicitly rather than left to useEmbedHref so the shelf
 * is correct even if the hook's room detection ever regresses.
 */

export const revalidate = 3600;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const room = await getCachedRoom(slug);
  if (!room) return {};
  const description = room.tagline || `${room.name}: a reading room of primary sources, readable in the original and in translation.`;
  return {
    title: room.name,
    description,
    openGraph: { title: room.name, description, type: 'website' },
  };
}

export default async function RoomShelfPage({ params }: Props) {
  const { slug } = await params;
  const room = await getCachedRoom(slug);
  if (!room) notFound();

  const db = await getReadDb();
  const books = await getRoomBooks(db, room);
  const roomPrefix = `${ROOMS_ROOT}/${room.slug}`;

  return (
    <>
      <RoomHeader room={room} showTagline />
      <main className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-10">
        {books.length === 0 ? (
          <p className="font-body text-base py-16 text-center" style={{ color: 'var(--text-muted)' }}>
            No books on this shelf yet.
          </p>
        ) : (
          <>
            <p className="text-xs uppercase tracking-wide mb-4" style={{ color: 'var(--text-muted)' }}>
              {books.length === 1 ? '1 book' : `${books.length} books`}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-5">
              {books.map((b, i) => {
                const bookSlug = (b.slug || b.id) as string;
                return (
                  <CollectionBookCard
                    key={b.id as string}
                    book={b as unknown as CollectionBook}
                    href={`${roomPrefix}/book/${encodeURIComponent(bookSlug)}`}
                    priority={i < 6}
                  />
                );
              })}
            </div>
          </>
        )}
      </main>
      <RoomFooter />
    </>
  );
}

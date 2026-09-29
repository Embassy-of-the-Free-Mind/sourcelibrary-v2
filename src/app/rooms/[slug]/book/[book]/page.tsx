import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import BookDetailPage, { generateMetadata as parentGenerateMetadata } from '@/app/book/[id]/page';
import { RoomHeader } from '@/components/rooms/RoomChrome';
import { getCachedRoom } from '@/components/rooms/room-loader';
import { getReadDb } from '@/lib/mongodb';
import { findBookInRoom } from '@/lib/reading-rooms';
import { ROOMS_ROOT } from '@/lib/reading-rooms-paths';

/**
 * A book inside a reading room: the global book page in embedded mode, the
 * same way /embed/[tenant]/book/[slug] renders it for partner rooms. The
 * embedded policy hides every cross-library rail (related books, other
 * editions, author cross-references), and useEmbedHref keeps the page grid's
 * links under /rooms/<slug>.
 *
 * Admission first, before anything streams: a book that is not on this shelf
 * sends the visitor back to the shelf (307), and so does a book that does not
 * exist — a room never confirms what it does not hold.
 */

export const revalidate = 3600;
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

interface Props {
  params: Promise<{ slug: string; book: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, book } = await params;
  const room = await getCachedRoom(slug);
  if (!room) return {};
  const parent = await parentGenerateMetadata({ params: Promise.resolve({ id: book }) });
  return { ...parent, robots: { index: false, follow: true } };
}

export default async function RoomBookPage({ params }: Props) {
  const { slug, book } = await params;
  const room = await getCachedRoom(slug);
  if (!room) notFound();

  const db = await getReadDb();
  const admitted = await findBookInRoom(db, room, book, { id: 1, slug: 1 });
  if (!admitted) redirect(`${ROOMS_ROOT}/${room.slug}`);

  return (
    <>
      <RoomHeader room={room} />
      <BookDetailPage
        params={Promise.resolve({ id: book })}
        tenantContext={{ id: null, slug: null, isEmbedded: true, source: 'embed-path' }}
      />
    </>
  );
}

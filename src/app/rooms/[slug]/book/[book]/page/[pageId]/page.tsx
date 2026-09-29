import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import PageEditorPage from '@/app/book/[id]/page/[pageId]/(reader)/page';
import { getCachedRoom } from '@/components/rooms/room-loader';
import { getReadDb } from '@/lib/mongodb';
import { findBookInRoom } from '@/lib/reading-rooms';
import { ROOMS_ROOT } from '@/lib/reading-rooms-paths';

/**
 * The reader inside a reading room. Mirrors
 * /embed/[tenant]/book/[slug]/page/[pageId]: the global reader, which reads
 * `isEmbedded` from the pathname on the client (no Source Library logo, no
 * site menu) and routes every page turn through useEmbedHref, so the visitor
 * stays under /rooms/<slug>. The room header is deliberately NOT rendered
 * here: the reader owns the full viewport and has its own back-to-the-book
 * control in its top bar.
 */

export const revalidate = 3600;

export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

interface Props {
  params: Promise<{ slug: string; book: string; pageId: string }>;
}

export default async function RoomReaderPage({ params }: Props) {
  const { slug, book, pageId } = await params;
  const room = await getCachedRoom(slug);
  if (!room) notFound();

  const db = await getReadDb();
  const admitted = await findBookInRoom(db, room, book, { id: 1, slug: 1 });
  if (!admitted) redirect(`${ROOMS_ROOT}/${room.slug}`);

  return <PageEditorPage params={Promise.resolve({ id: book, pageId })} hrefPrefix={`${ROOMS_ROOT}/${room.slug}`} />;
}

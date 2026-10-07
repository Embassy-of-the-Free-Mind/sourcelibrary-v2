/** /local/<book> → the first page of that book that has any text on it. */
import { notFound, redirect } from 'next/navigation';
import { isLocalMode } from '@/lib/local-mode/config';
import { firstLocalPage } from '@/lib/local-mode/loader';

export const dynamic = 'force-dynamic';

export default async function LocalBookPage({ params }: { params: Promise<{ book: string }> }) {
  if (!isLocalMode()) notFound();
  const { book } = await params;
  const first = firstLocalPage(book);
  if (first === null) notFound();
  redirect(`/local/${encodeURIComponent(book)}/${first}`);
}

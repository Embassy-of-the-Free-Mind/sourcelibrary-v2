/**
 * The desk reader: one page of one book, read offline as a facing-page edition.
 *
 * Exists only when the server was started with SL_LOCAL=1 (`npm run local`);
 * everywhere else, sourcelibrary.org included, it is a 404. Every byte it shows
 * comes off this laptop's disk — see src/lib/local-mode/.
 *
 * URL: /local/<book id or slug>/<page number>. A page NUMBER, because with no
 * scan mirrored there is no Mongo page id on the machine (loader.ts explains);
 * a Mongo page id still resolves when a scan manifest is present.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocalMode } from '@/lib/local-mode/config';
import { loadLocalReaderPage } from '@/lib/local-mode/loader';
import { parsePageText, DESCRIPTION_PAGE_TYPES } from '@/lib/local-mode/page-text';
import { aldineAetnaLocal, setsInAldineOffline, fountProvenance } from '@/lib/local-mode/fount';
import DeskReader, { type DeskReaderProps } from '@/components/local-reader/DeskReader';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ book: string; page: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  if (!isLocalMode()) return {};
  const { book, page } = await params;
  const data = loadLocalReaderPage(book, page);
  if (!data) return { title: 'Not on this disk' };
  const title = data.book.display_title || data.book.title || data.book.id;
  return { title: `${title} · p. ${data.page.page_number}`, robots: { index: false, follow: false } };
}

export default async function LocalReaderPage({ params }: Params) {
  if (!isLocalMode()) notFound();
  const { book: bookRef, page: pageRef } = await params;

  const data = loadLocalReaderPage(bookRef, pageRef);
  if (!data) notFound();

  const { book, page } = data;
  const original = parsePageText(page.ocr);
  const translation = parsePageText(page.tr);

  // The page type the OCR declared wins over the mirror's coarse `type`.
  const pageType = (original.pageType || page.type || 'text').toLowerCase();
  const translationIsDescription = DESCRIPTION_PAGE_TYPES.has(pageType);

  const props: DeskReaderProps = {
    book: {
      id: book.id,
      slug: book.slug || book.id,
      title: book.display_title || book.title || book.id,
      originalTitle: book.display_title && book.title && book.display_title !== book.title ? book.title : undefined,
      author: book.author?.trim() || undefined,
      published: book.published || undefined,
      language: original.language && original.language !== 'None' ? original.language : book.language || undefined,
      pagesCount: book.pages_count || undefined,
    },
    pageNumber: page.page_number,
    pageNumbers: data.pageNumbers,
    prev: data.prev,
    next: data.next,
    position: data.position,
    pageType,
    original,
    translation,
    translationIsDescription,
    scan: data.scan,
    chapters: data.chapters,
    fount: {
      available: setsInAldineOffline(book.id, page.ocr),
      provenance: fountProvenance(book.id),
    },
  };

  return (
    <div className={aldineAetnaLocal.variable}>
      <DeskReader {...props} />
    </div>
  );
}

import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { getTenantContext } from '@/lib/tenant-context';
import { isHiddenBook } from '@/lib/book-access';
import { Book, Page } from '@/lib/types';

export const preferredRegion = 'fra1';

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string; pageId: string }>;
}

// Only fetch the fields needed for metadata — skip index, reading_summary, etc.
const BOOK_META_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, published: 1, language: 1,
  visible: 1, hidden: 1,
};
const PAGE_META_PROJECTION = {
  _id: 0, id: 1, book_id: 1, page_number: 1, photo: 1,
  'translation.data': 1, 'ocr.data': 1, seo_indexable: 1,
};

// Returns {null,null} ONLY for a genuine miss (no such page, or wrong tenant).
// A DB/connection error propagates (after one retry) so the caller can tell a
// transient blip apart from a real 404 — without this distinction an Atlas
// hiccup during ISR rebuild would 404 a page that actually exists.
async function getPageData(bookId: string, pageId: string, tenantId?: string): Promise<{ book: Book | null; page: Page | null }> {
  const run = async () => {
    const db = await getReadDb();
    const [bookResult, page] = await Promise.all([
      findBookByIdOrSlug(db, bookId, BOOK_META_PROJECTION, tenantId),
      db.collection('pages').findOne({ id: pageId }, { projection: PAGE_META_PROJECTION }),
    ]);

    const book = (bookResult?.book ?? null) as unknown as Book | null;
    if (book && page) {
      const scopedBookId = (book.id || (book as any)._id?.toString()) as string;
      if ((page as any).book_id && (page as any).book_id !== scopedBookId) {
        return { book: null, page: null };
      }
    }

    return { book, page: page as unknown as Page | null };
  };
  try {
    return await run();
  } catch {
    // Transient error — retry once; a second failure propagates to the caller.
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
    return await run();
  }
}

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { id, pageId } = await params;
  const ctx = await getTenantContext();

  let book: Book | null;
  let page: Page | null;
  try {
    ({ book, page } = await getPageData(id, pageId, ctx?.id ?? undefined));
  } catch {
    // Persistent DB error — emit generic noindex metadata, NEVER a false 404.
    return {
      title: 'Source Library',
      robots: { index: false, follow: true },
      alternates: { canonical: `/book/${id}/page/${pageId}` },
    };
  }

  if (!book || !page) {
    // Genuine miss (bad page id, or page belongs to another tenant) → hard 404.
    // notFound() runs here in generateMetadata, awaited before the loading.tsx
    // shell streams, so it sets a real 404 status. The page body's notFound()
    // comes too late (200 already flushed) and only soft-404s. (Was a 200
    // soft-404 — GSC's "Soft 404" bucket.)
    notFound();
  }

  // Hidden (visible:false) book → hard 404, matching the page body's gate.
  if (isHiddenBook(book as any)) {
    notFound();
  }

  const bookTitle = book.display_title || book.title;
  const pageNum = page.page_number;
  const ogBookTitle = book.published ? `${bookTitle} (${book.published})` : bookTitle;
  const title = `${ogBookTitle} - Page ${pageNum}`;

  // Use translation excerpt if available, otherwise OCR excerpt
  const textContent = page.translation?.data || page.ocr?.data || '';
  const excerpt = textContent.length > 200
    ? textContent.substring(0, 197) + '...'
    : textContent;

  const description = excerpt
    ? `Page ${pageNum} of "${bookTitle}" by ${book.author}. ${excerpt}`
    : `Page ${pageNum} of "${bookTitle}" by ${book.author}${book.published ? ` (${book.published})` : ''}. Digitized from the original ${book.language || 'manuscript'}.`;

  // Always use slug for canonical URL, even if accessed via hex ObjectId
  const bookPath = (book as unknown as { slug?: string }).slug || id;
  const pageUrl = `/book/${bookPath}/page/${pageId}`;

  // Reader pages are noindex by default (they outnumber book URLs ~100:1 and
  // are thin on their own). Demand-proven pages — read >=5 in the rolling 90d
  // window, or translated first-translations — are opened to indexing by
  // scripts/seo/flag-indexable-pages.mjs (issue #2688), which sets
  // `seo_indexable` on the page doc. Canonical is already self-referential, so
  // an opened page indexes on its own URL. See robots.ts (crawling stays open
  // for all; this gate controls *indexing*).
  const indexable = (page as unknown as { seo_indexable?: boolean }).seo_indexable === true;

  return {
    title: `${title} - Source Library`,
    description,
    robots: { index: indexable, follow: true },
    alternates: {
      canonical: pageUrl,
    },
    openGraph: {
      title,
      description,
      type: 'article',
      siteName: 'Source Library',
      locale: 'en_US',
      url: pageUrl,
      // OG image generated by opengraph-image.tsx (branded 1200x630 card)
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      // Twitter image generated by opengraph-image.tsx
    },
  };
}

export default async function PageLayout({ children }: LayoutProps) {
  return children;
}

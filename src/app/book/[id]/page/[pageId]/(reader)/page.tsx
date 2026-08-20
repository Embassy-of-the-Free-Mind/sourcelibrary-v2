import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { getTenantContext } from '@/lib/tenant-context';
import type { Book, Page } from '@/lib/types';
import PageEditorClient from '@/components/book/PageEditorClient';
import EmbedNavigationReporter from '@/components/embed/EmbedNavigationReporter';
import HymnPlayer from '@/components/book/HymnPlayer';
import { isHiddenBook } from '@/lib/book-access';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { getTranscriptionsForPage } from '@/lib/music-transcriptions';
import { jsonLdHtml } from '@/lib/json-ld';
import { markPageForReader } from '@/lib/provenance';
import { localePath, type Locale } from '@/lib/locale-path';
import { READER_STRINGS } from '@/lib/book-i18n';
import { localizedTitle } from '@/lib/localized';

// Schema.org structured data for a translated page, so it surfaces as a
// citable scholarly work in web search (#2822). Only emitted for indexable
// pages (same seo_indexable gate as robots, #2688) — structured data on a
// noindex page is wasted. The excerpt is wrapper-stripped (the #2232 invariant:
// never expose editorial <meta>/<summary>/… blocks as page text).
function buildPageJsonLd(book: Book, page: Page, pageUrl: string): Record<string, unknown> | null {
  if ((page as unknown as { seo_indexable?: boolean }).seo_indexable !== true) return null;
  const bookTitle = book.display_title || book.title;
  const raw = page.translation?.data || page.ocr?.data || '';
  const clean = stripEditorialWrappers(raw).trim();
  const excerpt = clean.length > 500 ? clean.slice(0, 497) + '…' : clean;
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: `${bookTitle} — Page ${page.page_number}`,
    url: pageUrl,
    inLanguage: book.language || undefined,
    datePublished: book.published || undefined,
    author: book.author ? { '@type': 'Person', name: book.author } : undefined,
    translator: { '@type': 'Organization', name: 'Source Library' },
    isPartOf: {
      '@type': 'Book',
      name: bookTitle,
      ...(book.author ? { author: { '@type': 'Person', name: book.author } } : {}),
      ...(book.doi ? { sameAs: `https://doi.org/${book.doi}` } : {}),
    },
    license: 'https://creativecommons.org/licenses/by-sa/4.0/',
    isAccessibleForFree: true,
    ...(excerpt ? { text: excerpt } : {}),
  };
}

// ISR: 24h background revalidation. Pipeline also calls /api/admin/revalidate-book for immediate updates.
export const revalidate = 86400;

// robots (index/noindex) is decided per-page in this route's layout.tsx
// generateMetadata, gated on the page's `seo_indexable` flag (issue #2688).
// Per-page URLs outnumber book URLs ~100:1, so they stay noindex by default;
// only demand-proven pages (read >=5, or translated first-translations) open
// to indexing. They remain crawlable + follow links regardless.

interface PageProps {
  params: Promise<{ id: string; pageId: string }>;
}

// Book projection: only fields needed by the reader
const BOOK_NAV_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1,
  // The one language-keyed map: the reader header shows `localized.<lang>.title`
  // and the chapter dropdown `localized.<lang>.chapters`. Leaving it out of this
  // projection is why the Spanish reader showed a German title over Spanish text.
  localized: 1,
  // Gates whether this book may have a localized reader URL at all — see the
  // redirect below. Always read from Atlas here, so it can never be absent.
  pages_translated_es: 1,
  author: 1, published: 1, language: 1, doi: 1, chapters: 1,
  cdli_witnesses: 1, etcsl_id: 1, visible: 1,
};

export default async function PageEditorPage({ params, allowHidden = false, lang = 'en' }: PageProps & { allowHidden?: boolean; lang?: Locale }) {
  const { id, pageId } = await params;
  const ctx = await getTenantContext();
  const db = await getReadDb();

  // Step 1: Get current page (fast indexed lookup by id, gives us book_id for nav)
  const currentPage = await db.collection('pages').findOne(
    { id: pageId },
    { projection: { detected_images: 0 } }
  );

  if (!currentPage) {
    notFound();
  }

  // Step 2: Book lookup + nav pages + music transcriptions in parallel
  const [bookResult, navPages, musicTranscriptions] = await Promise.all([
    findBookByIdOrSlug(db, id, BOOK_NAV_PROJECTION, ctx?.id ?? undefined),
    db.collection('pages')
      .find({ book_id: currentPage.book_id as string, page_number: { $gte: 0 } })
      .project({ _id: 0, id: 1, page_number: 1, split_from: 1, page_type: 1 })
      .sort({ page_number: 1 })
      .maxTimeMS(15000)
      .toArray()
      .then(pages => pages.filter(p => p.page_type !== 'digitizer-insert' && p.page_type !== 'archived-spread' && (p.page_number == null || p.page_number >= 0)))
      .catch((err) => {
        console.error(`[page-nav] Failed to load page list for book ${currentPage.book_id}:`, err.message);
        return [{ id: pageId, page_number: currentPage.page_number }];
      }),
    getTranscriptionsForPage(db, pageId),
  ]);

  if (!bookResult) {
    notFound();
  }

  const book = bookResult.book as unknown as Book;

  // Hidden (visible:false) books are not public. This per-page route is ISR
  // (highest-volume URL set — must stay statically cacheable), so it gates
  // uniformly: hidden → 404 for everyone. Editors read hidden books in-browser
  // via the dynamic /book/[id]/page/[pageId]/preview route (allowHidden).
  if (isHiddenBook(book as any) && !allowHidden) {
    notFound();
  }

  const scopedBookId = (book.id || (book as any)._id?.toString()) as string;
  if ((currentPage.book_id as string) !== scopedBookId) {
    notFound();
  }

  // Serialize MongoDB objects (ObjectId, Date) to plain JS for client components
  const serializedPage = JSON.parse(JSON.stringify(currentPage)) as Page;
  const serializedNavPages = JSON.parse(JSON.stringify(navPages)) as Page[];

  const bookPath = book.slug || scopedBookId;
  // JSON-LD is built from the UNMARKED page: the SEO excerpt stays free of
  // zero-width characters so search snippet matching is untouched.
  const jsonLd = buildPageJsonLd(book, serializedPage, `https://sourcelibrary.org/book/${bookPath}/page/${pageId}`);

  // The flight payload the reader (and anything scraping this URL) receives
  // carries the invisible provenance imprimatur in the translation. It is
  // deterministic — content-keyed, no per-request input — so this page stays
  // safely ISR/CDN-cacheable. The editor save path strips it before storing.
  const markedPage = markPageForReader(serializedPage, scopedBookId);

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }}
        />
      )}
      <EmbedNavigationReporter book={book.slug || book.id} page={pageId} />
      <PageEditorClient
        initialBook={book}
        initialPage={markedPage}
        initialPageList={serializedNavPages}
      />
      {musicTranscriptions.length > 0 && (
        <HymnPlayer transcriptions={musicTranscriptions} />
      )}
      {/* Server-rendered nav links so crawlers can walk book → pages even
          when client-component SSR changes (#2266). Sits below the h-screen
          reader; the in-reader controls remain the primary navigation. */}
      {!(ctx?.isEmbedded) && (() => {
        const rs = READER_STRINGS[lang];
        const idx = serializedNavPages.findIndex(p => p.id === pageId);
        const prev = idx > 0 ? serializedNavPages[idx - 1] : null;
        const next = idx >= 0 && idx < serializedNavPages.length - 1 ? serializedNavPages[idx + 1] : null;
        return (
          <nav aria-label={rs.pageNavigation} className="max-w-[1500px] mx-auto px-4 sm:px-6 py-4 text-sm text-stone-500 flex flex-wrap items-center gap-x-5 gap-y-1">
            {prev && <a href={localePath(`/book/${bookPath}/page/${prev.id}`, lang)} className="hover:text-stone-700">{rs.prevPageLink(prev.page_number)}</a>}
            <a href={localePath(`/book/${bookPath}`, lang)} className="hover:text-stone-700">{localizedTitle(book, lang)}</a>
            <a href={`/book/${bookPath}/overview`} className="hover:text-stone-700">{rs.allPagesLink(serializedNavPages.length)}</a>
            {next && <a href={localePath(`/book/${bookPath}/page/${next.id}`, lang)} className="hover:text-stone-700">{rs.nextPageLink(next.page_number)}</a>}
          </nav>
        );
      })()}
    </>
  );
}

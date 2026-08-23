import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { getTenantContext } from '@/lib/tenant-context';
import type { Book, Page } from '@/lib/types';
import Reader2C from '@/components/reader-v2/Reader2C';
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
import { aldineVariables } from '@/lib/fonts/aldine';
import { isAldineFount } from '@/lib/fonts/aldine-fount';

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
      // Image fields are part of the nav list because the reader's filmstrip
      // draws a thumbnail per page. Without them getPageThumbUrl has nothing
      // to resolve and every slot renders empty — books with no pre-sized
      // image_thumb (only an archived original) fail hardest, since their
      // thumb has to be derived from the source.
      .project({
        _id: 0, id: 1, page_number: 1, split_from: 1, page_type: 1,
        image_thumb: 1, thumbnail_blob: 1, display_photo: 1, archived_photo: 1, photo: 1,
      })
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
  const jsonLd = buildPageJsonLd(book, serializedPage, `https://sourcelibrary.org${localePath(`/book/${bookPath}/page/${pageId}`, lang)}`);

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
      {/* The redesign ships on sourcelibrary.org. Partner reading rooms —
          BPH, EFM, every /embed/** iframe and tenant subdomain — stay on the
          old reader until BPH have seen it and approved it. Not caution for
          its own sake: the new reader's Cite and Share build absolute URLs
          against sourcelibrary.org rather than the host page, so a scholar
          citing a page inside a partner's site would be handed a URL pointing
          away from it.
          
          Books we hold a facsimile fount for are read in their own type
          (#4083); `display: contents` so this wrapper carries the font
          variables without adding a box to either reader's flex layout. Both
          readers get it — the fount is a reading feature, not a chrome one. */}
      <div
        className={isAldineFount(book.id) ? `aldine-fount ${aldineVariables}` : undefined}
        style={isAldineFount(book.id) ? { display: 'contents' } : undefined}
      >
        {ctx?.isEmbedded ? (
          <PageEditorClient
            initialBook={book}
            initialPage={markedPage}
            initialPageList={serializedNavPages}
          />
        ) : (
          <Reader2C
            initialBook={book}
            initialPage={markedPage}
            initialPageList={serializedNavPages}
          />
        )}
      </div>
      {musicTranscriptions.length > 0 && (
        <HymnPlayer transcriptions={musicTranscriptions} />
      )}
      {/* Server-rendered nav links so crawlers can walk book → pages even
          when client-component SSR changes (#2266).
          
          Screen-reader-only, NOT merely below the fold. The reader owns one
          viewport, so on a phone this block appeared under it as a stray row
          of links — a stale page number and an "All N pages" beside the real
          pager, shoving the toolbar up the screen. It stays in the DOM and in
          the accessibility tree, which is all #2266 needed; sighted readers
          have the pager, the filmstrip and Contents for the same job. */}
      {!(ctx?.isEmbedded) && (() => {
        const rs = READER_STRINGS[lang];
        const idx = serializedNavPages.findIndex(p => p.id === pageId);
        const prev = idx > 0 ? serializedNavPages[idx - 1] : null;
        const next = idx >= 0 && idx < serializedNavPages.length - 1 ? serializedNavPages[idx + 1] : null;
        // Screen-reader-only, NOT merely below the fold. The redesigned reader
        // owns one viewport, so on a phone this block appeared under it as a
        // stray row of links — a stale page number and an "All N pages" beside
        // the real pager, shoving the toolbar up the screen. It stays in the
        // DOM and in the accessibility tree, which is all #2266 needed; sighted
        // readers have the pager, the filmstrip and Contents for the same job.
        return (
          <nav aria-label={rs.pageNavigation} className="sr-only">
            {prev && <a href={localePath(`/book/${bookPath}/page/${prev.id}`, lang)}>{rs.prevPageLink(prev.page_number)}</a>}
            <a href={localePath(`/book/${bookPath}`, lang)}>{localizedTitle(book, lang)}</a>
            <a href={`/book/${bookPath}/overview`}>{rs.allPagesLink(serializedNavPages.length)}</a>
            {next && <a href={localePath(`/book/${bookPath}/page/${next.id}`, lang)}>{rs.nextPageLink(next.page_number)}</a>}
          </nav>
        );
      })()}
    </>
  );
}

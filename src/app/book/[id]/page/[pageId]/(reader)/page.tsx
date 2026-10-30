import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import { findBookForTenant } from '@/lib/tenant-catalog-books';
import { getTenantContext } from '@/lib/tenant-context';
import type { Book, Page } from '@/lib/types';
import Reader2C from '@/components/reader-v2/Reader2C';
import EmbedNavigationReporter from '@/components/embed/EmbedNavigationReporter';
import HymnPlayer from '@/components/book/HymnPlayer';
import { isHiddenBook } from '@/lib/book-access';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { getTranscriptionsForPage } from '@/lib/music-transcriptions';
import { jsonLdHtml } from '@/lib/json-ld';
import { markPageForReader } from '@/lib/provenance';
import { serveEnglishOriginalPage, isEnglishOriginalBook } from '@/lib/english-original-text';
import { meteredReaderEnabled, isPageFree, stripGatedPage } from '@/lib/free-preview';
import { localePath, type Locale } from '@/lib/locale-path';
import { READER_STRINGS } from '@/lib/book-i18n';
import { localizedTitle } from '@/lib/localized';
import { aldineVariables } from '@/lib/fonts/aldine';
import { isAldineFount } from '@/lib/fonts/aldine-fount';
import { READER_PAGE_PROJECTION, withoutTextLayer } from '@/lib/reader-page-projection';
import { getQualityWarnings } from '@/lib/book-warnings';
import { getScanGaps } from '@/lib/scan-gaps';
import { ocrMeasure } from '@/lib/ocr-measure';
import { getRepeatKeeperId, getSplitLeafId, isArchivedSplit } from '../page-data';
import { readerPageListFilter, isReaderListedPage } from '@/lib/reader-pages';

// Schema.org structured data for a translated page, so it surfaces as a
// citable scholarly work in web search (#2822). Only emitted for indexable
// pages (same seo_indexable gate as robots, #2688) — structured data on a
// noindex page is wasted. The excerpt is wrapper-stripped (the #2232 invariant:
// never expose editorial <meta>/<summary>/… blocks as page text).
// isPartOf carries the book's URL and a BreadcrumbList names it, so a search
// engine that indexes a page is pointed at the book's front page (contents and
// summary) as the parent: the page is the way in, the book is the place.
function buildPageJsonLd(book: Book, page: Page, pageUrl: string, bookUrl: string): Record<string, unknown> | null {
  if ((page as unknown as { seo_indexable?: boolean }).seo_indexable !== true) return null;
  const bookTitle = book.display_title || book.title;
  const raw = page.translation?.data || page.ocr?.data || '';
  const clean = stripEditorialWrappers(raw).trim();
  const excerpt = clean.length > 500 ? clean.slice(0, 497) + '…' : clean;
  const work = {
    '@type': 'CreativeWork',
    name: `${bookTitle}, Page ${page.page_number}`,
    url: pageUrl,
    inLanguage: book.language || undefined,
    datePublished: book.published || undefined,
    author: book.author ? { '@type': 'Person', name: book.author } : undefined,
    ...(isEnglishOriginalBook(book) ? {} : { translator: { '@type': 'Organization', name: 'Source Library' } }),
    isPartOf: {
      '@type': 'Book',
      '@id': bookUrl,
      url: bookUrl,
      name: bookTitle,
      ...(book.author ? { author: { '@type': 'Person', name: book.author } } : {}),
      ...(book.doi ? { sameAs: `https://doi.org/${book.doi}` } : {}),
    },
    license: 'https://creativecommons.org/licenses/by-sa/4.0/',
    isAccessibleForFree: true,
    ...(excerpt ? { text: excerpt } : {}),
  };
  const breadcrumb = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Source Library', item: 'https://sourcelibrary.org' },
      { '@type': 'ListItem', position: 2, name: bookTitle, item: bookUrl },
      { '@type': 'ListItem', position: 3, name: `Page ${page.page_number}`, item: pageUrl },
    ],
  };
  return { '@context': 'https://schema.org', '@graph': [work, breadcrumb] };
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
  // English edition? Then an English leaf serves its transcription, not the
  // stored English-to-English rewording (#7100).
  'translation_state.english_original': 1,
  cdli_witnesses: 1, etcsl_id: 1, visible: 1,
  // The copy clause of the citation panel (#4360): which library's physical
  // copy the scan shows, and its shelfmark there. Sub-paths only — the full
  // image_source carries license/attribution baggage the reader doesn't use.
  // The top-level twins are legacy sprawl 3,860 live books still rely on
  // (consolidation: #4361); resolveHoldingCopy reads both.
  'image_source.contributing_library': 1, 'image_source.shelfmark': 1,
  contributing_library: 1, shelfmark: 1,
  // Metered reader (#4357): isPageFree() needs the book's page total.
  pages_count: 1,
};

/**
 * `hrefPrefix`: the namespace an embedded reader lives under (`/embed/<tenant>`
 * or `/rooms/<slug>`). The client reader routes its own links through
 * useEmbedHref, but the server-rendered screen-reader nav below cannot, and
 * bare `/book/…` links there walked assistive-tech users out of the room
 * (found by the #5266 leak check). Empty on the global route.
 */
export default async function PageEditorPage({ params, allowHidden = false, lang = 'en', hrefPrefix = '' }: PageProps & { allowHidden?: boolean; lang?: Locale; hrefPrefix?: string }) {
  const { id, pageId } = await params;
  const ctx = await getTenantContext();
  const db = await getReadDb();

  // Step 1: Get current page (fast indexed lookup by id, gives us book_id for nav).
  // Inclusion list, not `{ detected_images: 0 }` — see reader-page-projection.ts.
  const currentPage = withoutTextLayer(await db.collection('pages').findOne(
    { id: pageId },
    { projection: READER_PAGE_PROJECTION }
  )); // #5942: the stored text layer never reaches the payload

  if (!currentPage) {
    notFound();
  }

  // Step 2: Book lookup + nav pages + music transcriptions in parallel
  const [bookResult, navPages, musicTranscriptions] = await Promise.all([
    findBookForTenant(db, id, BOOK_NAV_PROJECTION, ctx),
    db.collection('pages')
      .find(readerPageListFilter(currentPage.book_id as string))
      // Image fields are part of the nav list because the reader's filmstrip
      // draws a thumbnail per page. Without them getPageThumbUrl has nothing
      // to resolve and every slot renders empty — books with no pre-sized
      // image_thumb (only an archived original) fail hardest, since their
      // thumb has to be derived from the source.
      .project({
        _id: 0, id: 1, page_number: 1, split_from: 1, page_type: 1,
        image_thumb: 1, thumbnail_blob: 1, display_photo: 1, archived_photo: 1, photo: 1,
        // Strip thumbnails are shown cropped to the page (#6010).
        page_frame: 1,
      })
      .sort({ page_number: 1 })
      .maxTimeMS(15000)
      .toArray()
      .then(pages => pages.filter(isReaderListedPage))
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

  // An archived split parent goes to its first leaf (#5842). The public route
  // already 308'd in (reader)/layout.tsx; this catches the embed and room
  // wrappers, which render this component with no layout or loading.tsx
  // above it, so the redirect is still a real one there. /preview (allowHidden)
  // stays put: an editor asked for that page.
  if (!allowHidden && isArchivedSplit(currentPage)) {
    const leafId = await getSplitLeafId(scopedBookId, currentPage.split_into[0]);
    if (leafId) permanentRedirect(hrefPrefix + localePath(`/book/${book.slug || scopedBookId}/page/${leafId}`, lang));
  }

  // A hidden repeat capture goes to its kept capture (#5056), for the same
  // embed/room reason. 307: the hide is reversible. /preview stays put.
  if (!allowHidden && typeof currentPage.repeat_of === 'string') {
    const keptId = await getRepeatKeeperId(scopedBookId, currentPage.repeat_of);
    if (keptId) redirect(hrefPrefix + localePath(`/book/${book.slug || scopedBookId}/page/${keptId}`, lang));
  }

  // Warnings from stored quality checks (#6199): one indexed read of book_checks, for the whole book, so a client
  // page turn needs no second request. Never throws; most books have no rows. Partner rooms get them too: the
  // embed reads the same reader, warnings included (2026-10-29).
  // Printed pages missing between two scans (#6675): one indexed read of scan_gaps, same shape and reason.
  const [qualityWarnings, scanGaps] = await Promise.all([getQualityWarnings(db, [scopedBookId]), getScanGaps(db, scopedBookId)]);

  // Serialize MongoDB objects (ObjectId, Date) to plain JS for client components
  // On an English edition the leaf's own words are the text: a stored
  // "translation" of an English leaf is withheld here, once, so the reader,
  // the JSON-LD excerpt and the flight payload all carry the transcription
  // (#7100). A light spelling edit rides along as `modernized_spelling`.
  const serializedPage = serveEnglishOriginalPage(JSON.parse(JSON.stringify(currentPage)) as Page, book);
  const serializedNavPages = JSON.parse(JSON.stringify(navPages)) as Page[];

  const bookPath = book.slug || scopedBookId;
  // JSON-LD is built from the UNMARKED page: the SEO excerpt stays free of
  // zero-width characters so search snippet matching is untouched.
  const jsonLd = buildPageJsonLd(
    book,
    serializedPage,
    `https://sourcelibrary.org${localePath(`/book/${bookPath}/page/${pageId}`, lang)}`,
    `https://sourcelibrary.org${localePath(`/book/${bookPath}`, lang)}`,
  );

  // Metered reader (#4357): beyond the free sample, the ISR HTML carries the
  // page WITHOUT its text — for everyone, which is what keeps it statically
  // cacheable (an ISR render can't see who's asking). Signed-in readers get
  // the full text refetched client-side (useReaderV2's gated-page effect);
  // anonymous readers see the scan with a sign-in pane. seo_indexable pages
  // are always free, so every Google-indexed reader URL keeps its full text
  // and its `isAccessibleForFree: true` JSON-LD stays honest. Editor preview
  // (allowHidden) and tenant/embed reading rooms are exempt. No-op unless
  // METERED_READER=1.
  const metered = meteredReaderEnabled()
    && !allowHidden
    && !(ctx?.id || ctx?.isEmbedded)
    && !isPageFree(serializedPage as unknown as { page_number?: number | null; seo_indexable?: boolean }, (book as unknown as { pages_count?: number }).pages_count);
  const servedPage = metered
    ? (stripGatedPage(serializedPage as unknown as Record<string, unknown>, (book as unknown as { pages_count?: number }).pages_count || 0) as unknown as Page)
    : serializedPage;

  // The flight payload the reader (and anything scraping this URL) receives
  // carries the invisible provenance imprimatur in the translation. It is
  // deterministic — content-keyed, no per-request input — so this page stays
  // safely ISR/CDN-cacheable. The editor save path strips it before storing.
  const markedPage = markPageForReader(servedPage, scopedBookId);

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }}
        />
      )}
      <EmbedNavigationReporter book={book.slug || book.id} page={pageId} />
      {/* One reader everywhere. Partner reading rooms (BPH, EFM, every
          /embed/** iframe and tenant subdomain) stayed on the old reader
          (PageEditorClient) until BPH had seen the redesign, because its Cite
          and Share build URLs against sourcelibrary.org rather than the host
          page. BPH/EFM approved the switch on 2026-10-29, via Derek: the
          sourcelibrary.org permalink is the citation (persistent, DOI-backed,
          the same everywhere), and the reader inside the Embassy frame should
          be the one sourcelibrary.org shows. Reader2C hides the site menu and
          WebMCP when embedded and routes its links through useEmbedHref.
          
          Books we hold a facsimile fount for are read in their own type
          (#4083); `display: contents` so this wrapper carries the font
          variables without adding a box to either reader's flex layout. Both
          readers get it — the fount is a reading feature, not a chrome one. */}
      <div
        className={isAldineFount(book.id) ? `aldine-fount ${aldineVariables}` : undefined}
        style={isAldineFount(book.id) ? { display: 'contents' } : undefined}
      >
        <Reader2C
          initialBook={book}
          initialPage={markedPage}
          initialPageList={serializedNavPages}
          qualityWarnings={qualityWarnings}
          scanGaps={scanGaps}
          ocrMeasure={lang === 'la' && book.language === 'Latin' ? ocrMeasure('latin') : null}
        />
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
            {prev && <a href={hrefPrefix + localePath(`/book/${bookPath}/page/${prev.id}`, lang)}>{rs.prevPageLink(prev.page_number)}</a>}
            <a href={hrefPrefix + localePath(`/book/${bookPath}`, lang)}>{localizedTitle(book, lang)}</a>
            {/* No /overview twin exists under an embed or room prefix (embedPolicy.showBookOverviewLink). */}
            {!hrefPrefix && <a href={`/book/${bookPath}/overview`}>{rs.allPagesLink(serializedNavPages.length)}</a>}
            {next && <a href={hrefPrefix + localePath(`/book/${bookPath}/page/${next.id}`, lang)}>{rs.nextPageLink(next.page_number)}</a>}
          </nav>
        );
      })()}
    </>
  );
}

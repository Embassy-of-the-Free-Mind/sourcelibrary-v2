import { Suspense, cache } from 'react';
import { Metadata } from 'next';
import { ObjectId } from 'mongodb';
import { getReadDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Book, Page, TranslationEdition } from '@/lib/types';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { displayPublished, citationYear } from '@/lib/publication-date';
import { isHiddenBook } from '@/lib/book-access';
import { deduplicateByDHash } from '@/lib/dhash';
import { getBookDetail, browseBooks, getLanguageCounts, type CatalogBook } from '@/lib/books-catalog';
import { Calendar, Globe, FileText, BookMarked, Images, BookOpen } from 'lucide-react';
import ArtworkInfo from '@/components/artwork/ArtworkInfo';
import TextReader from '@/components/text/TextReader';
import SearchPanel from '@/components/search/SearchPanel';
import BookPagesSection from '@/components/book/BookPagesSection';
import EarlyAccessGate from '@/components/book/EarlyAccessGate';
import BookDedication from '@/components/book/BookDedication';
import BookHistory from '@/components/book/BookHistory';
import BookTimeline, { type TimelineEvent } from '@/components/book/BookTimeline';
import PublicBookHistory from '@/components/book/PublicBookHistory';
import BookIndex from '@/components/book/BookIndex';
import ChaptersDropdown from '@/components/book/ChaptersDropdown';
import BookAnalytics from '@/components/book/BookAnalytics';
import CoverImagePicker from '@/components/book/CoverImagePicker';
import EnsureCover from '@/components/book/EnsureCover';
import { isJunkRepresentativePage, isRenderableCoverUrl, selectScoredCoverPage } from '@/lib/cover-fields';
import DownloadButton from '@/components/ui/DownloadButton';
import BibliographicInfo from '@/components/book/BibliographicInfo';
import BphCatalogueRecord from '@/components/book/BphCatalogueRecord';
import OriginalEditionNotice from '@/components/book/OriginalEditionNotice';
import TranslatedSiblingNotice from '@/components/book/TranslatedSiblingNotice';
import RelatedEditions from '@/components/book/RelatedEditions';
import IndexCatalogChip from '@/components/book/IndexCatalogChip';
import RelatedBooks from '@/components/book/RelatedBooks';
import AuthorCrossReference from '@/components/book/AuthorCrossReference';
import PublishEditionButton from '@/components/editions/PublishEditionButton';
import EditionsPanel from '@/components/editions/EditionsPanel';
import SchemaOrgMetadata from '@/components/seo/SchemaOrgMetadata';
import DublinCoreMeta from '@/components/seo/DublinCoreMeta';
import FeedbackWidget from '@/components/feedback/FeedbackWidget';
import ExpandableGuide from '@/components/book/ExpandableGuide';
import { AISection } from '@/components/embed/AISection';
import AuthorAuthority from '@/components/book/AuthorAuthority';
import { linkEntities, buildEntityList } from '@/lib/link-entities';
import LikeButton from '@/components/ui/LikeButton';
import CiteButton from '@/components/ui/CiteButton';
import { BookShare } from '@/components/ui/ShareButton';
import { AuthCheck } from '@/components/auth/AuthCheck';
import EmbedNavigationReporter from '@/components/embed/EmbedNavigationReporter';
import SignUpCTA from '@/components/auth/SignUpCTA';
import { authorUrl } from '@/lib/slugify';
import FirstTranslationEvidence from '@/components/book/FirstTranslationEvidence';
import TranslationCardPanel from '@/components/book/TranslationCardPanel';
import { cardLabel, loadCard, type TranslationCard } from '@/lib/first-translation/card';
import {
  classifyFirstTranslationClaim,
  type ScreenedBook,
} from '@/lib/first-translation/candidate';
import { firstTranslationClause } from '@/lib/first-translation-labels';
import GalleryMasonry, { type Plate } from '@/components/GalleryMasonry';
import HeroVariants from '@/components/book/HeroVariants';
import { HERO_MOSAIC_VERSION } from '@/lib/hero-mosaic-version';
import AboutVariants from '@/components/book/AboutVariants';
import BookBiblioPanel from '@/components/book/BookBiblioPanel';
import PlusToggle from '@/components/book/PlusToggle';
import BookLibrarySection, { type LibrarySectionData } from '@/components/book/BookLibrarySection';
import { getPartnerByProvider } from '@/lib/library-partners';
import { getRelatedBooks } from '@/lib/related-books';
import BookSlider, { type MiniBook } from '@/components/BookSlider';
import { formatAuthor, getBookThumbnailUrl } from '@/lib/utils';
import { buildSeoTitle, buildSeoDescription } from '@/lib/book-seo';
import { getPageImageUrl } from '@/lib/page-image-url';
import { cleanOriginalTitle, isNonLatinScript } from '@/lib/original-title';
import { hasPublishablePriorTranslation, priorTranslationSentence, priorLinkLabel } from '@/lib/prior-translation';
import type { PriorTranslationCredit, TranslationVerification } from '@/lib/types/book';
import { getEffectiveByline } from '@/lib/byline';
import AuthorName from '@/components/AuthorName';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import CatalogueBreadcrumb from '@/components/book/CatalogueBreadcrumb';
import type { TenantContext } from '@/lib/tenant-context';
import { getEmbedUiPolicy, type EmbedUiPolicy } from '@/lib/embed-ui-policy';
import { markPageForReader } from '@/lib/provenance';

// ISR: serve cached HTML, revalidate in background every 24h.
// Pipeline also calls /api/admin/revalidate-book for immediate updates after OCR/translation/enrichment.
// Using 86400 instead of false so pages self-heal after deploys (which purge the cache).
export const revalidate = 86400;

// Run SSR near the database to cut cross-region latency (~200ms RTT savings)
export const preferredRegion = 'fra1';

// Allow any [id] — paths not pre-generated will use ISR on first request
export const dynamicParams = true;
export async function generateStaticParams() {
  return []; // All paths generated on demand via ISR
}

interface PageProps {
  params: Promise<{ id: string }>;
  tenantContext?: TenantContext | null;
  // Review preview: when true, render the staged summary_candidate instead of
  // the live summary. Set only by the dynamic /book/[id]/preview route — NOT
  // read from searchParams here, because this page is ISR/static (revalidate)
  // and reading request-time query params would force a render error.
  previewProposed?: boolean;
  // Allow rendering a hidden (visible:false) book. Set ONLY by the dynamic,
  // editor-gated /book/[id]/preview route. The public ISR route leaves this
  // false so hidden books 404 uniformly (cache-safe — no per-user branch).
  allowHidden?: boolean;
}

// Cached book lookup — deduplicates between generateMetadata and BookInfo
// within a single server render.
//
// Tries Supabase first (<50ms) for the book shell, then falls back to Atlas.
// When Supabase succeeds, getBook() can start ALL Atlas queries in parallel
// (pages, gallery, collections, full book refetch) instead of waiting for the
// book lookup before starting page queries.
const getCachedBookLookup = cache(async (id: string): Promise<{
  book: Record<string, unknown>;
  matchedBySlug: boolean;
  fromCatalog: boolean;
} | null> => {
  // Try Supabase first — instant lookup from the books_catalog mirror
  try {
    const catalogResult = await getBookDetail(id);
    // A catalog row with visible:false is NOT authoritative for the reader.
    // The catalog's `visible` is the LISTING predicate (mirrored as
    // `book.visible === true`, so Mongo's unset-visible legacy books collapse
    // to false), while the reader gate (book-access.ts isHiddenBook) hides
    // only an explicit Mongo `visible === false`. Trusting the catalog here
    // 404'd ~3k readable books (issue #2959). Fall through to Atlas and let
    // the Mongo doc decide — truly hidden books still 404 via isHiddenBook.
    if (catalogResult && (catalogResult.book as { visible?: boolean | null }).visible !== false) {
      return {
        book: catalogResult.book as unknown as Record<string, unknown>,
        matchedBySlug: catalogResult.matchedBySlug,
        fromCatalog: true,
      };
    }
  } catch {
    // Supabase down — fall through to Atlas
  }

  // Fall back to Atlas (slower but has everything)
  const db = await Promise.race([
    getReadDb(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 15000)),
  ]);
  const result = await findBookByIdOrSlug(db, id, {
    reading_sections: 0,
    pipeline: 0,
    pipeline_auto: 0,
    split_check: 0,
    'index.sectionSummaries': 0,
    'index.people': 0,
    'index.places': 0,
    'index.concepts': 0,
    'index.keyTerms': 0,
  });
  if (!result) return null;
  return { book: result.book as Record<string, unknown>, matchedBySlug: result.matchedBySlug, fromCatalog: false };
});

// Lightweight book fetch for metadata — reuses cached lookup
async function getBookForMetadata(id: string, tenantId?: string | null, tenantSlug?: string): Promise<Book | null> {
  // Resilient lookup: retry once on transient Atlas errors. Without this,
  // a single network blip during the lookup turns into a hard notFound()
  // at the caller (because the .catch(() => null) there can't tell "book
  // doesn't exist" from "fetch failed"). 222 of 320 not_found_reports in
  // the 48h window of 2026-05-26→28 fired during a 12-13h UTC cluster
  // that correlated with deploy/revalidate events — exactly the
  // "ISR-rebuild meets Atlas hiccup" pattern. Retries here eat the blip.
  async function lookup(): Promise<typeof result | null> {
    const result = await getCachedBookLookup(id);
    return result;
  }
  let result;
  try {
    result = await lookup();
  } catch (err) {
    await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
    result = await lookup();
  }
  if (!result) return null;
  if (!tenantId) return result.book as unknown as Book;

  const db = await getReadDb();
  const scoped = await findBookByIdOrSlug(db, id, {
    reading_sections: 0,
    pipeline: 0,
    pipeline_auto: 0,
    split_check: 0,
    'index.sectionSummaries': 0,
    'index.people': 0,
    'index.places': 0,
    'index.concepts': 0,
    'index.keyTerms': 0,
  }, tenantId);
  if (scoped) return scoped.book as unknown as Book;

  // Default tenant is the global namespace. Legacy + corpus-source books
  // (ETCSL, CDLI, etc.) have no `tenantId`/`tenant_id` field at all; the
  // strict scoped lookup excludes them, which caused generateMetadata() to
  // emit "Book Not Found" + noindex even though the page body renders fine
  // via the unscoped fetch. 1.52K books were being silently delisted in GSC.
  //
  // Tenant subdomains (bph/, etc.) keep the strict filter so the lockdown
  // invariant (CLAUDE.md "Tenant Subdomain Lockdown") still holds: only
  // books explicitly assigned to that tenant are visible there.
  if (tenantSlug === 'default') {
    const book = result.book as Record<string, unknown>;
    if (!book.tenantId && !book.tenant_id) {
      return book as unknown as Book;
    }
  }
  return null;
}



export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  let book: Book | null;
  try {
    // Metadata stays global/ISR-safe; tenant-scoped denial is enforced in proxy.
    book = await getBookForMetadata(id);
  } catch {
    return { title: 'Source Library', robots: { index: false, follow: false } };
  }

  if (!book) {
    // Self-referential canonical (not the inherited root '/') so Google doesn't
    // see this as a duplicate of the homepage while it's still 200/noindex.
    return {
      title: 'Book Not Found - Source Library',
      robots: { index: false, follow: false },
      alternates: { canonical: `/book/${id}` },
    };
  }

  // Hidden books (visible:false) are not public. Emit not-found/noindex metadata
  // on the public ISR route — matches the notFound() the page body returns.
  // Editors reach hidden books via /book/[id]/preview (dynamic, auth-gated).
  if (isHiddenBook(book)) {
    return {
      title: 'Book Not Found - Source Library',
      robots: { index: false, follow: false },
      alternates: { canonical: `/book/${id}` },
    };
  }

  // Byline for citations / meta tags. Falls back to editor for edited volumes,
  // magazines and anthologies where the catalogue has no single author. Keep
  // formatAuthor() in the chain to strip bibliographic brackets etc.
  const byline = getEffectiveByline(book);
  const bylineName = byline.displayName
    ? formatAuthor(byline.displayName).name || byline.displayName
    : formatAuthor(book.author).name || book.author;
  const bylineLabel = byline.isEditor ? `${bylineName} (ed.)` : bylineName;
  // `published` is FREE TEXT and ~23% of it is not a year — QuickStatements
  // tails, "Unknown", century labels. buildSeoTitle/buildSeoDescription
  // interpolate `year` raw, so sanitize before it reaches them (#3307).
  const displayYear = displayPublished(book.published);

  // SEO/AI-O title + description rules — see src/lib/book-seo.ts.
  // Lead with the original-language title (book.title, the catalogue/citation
  // standard); byline is already life-date-stripped by formatAuthor.
  const seoTitle = buildSeoTitle({ originalTitle: book.title, authorLabel: bylineLabel, year: displayYear });
  const ogTitle = seoTitle;
  // Unique description from the real per-book summary, with an HONEST translation
  // claim (never the old blanket "English translation" that mislabelled originals).
  // The cached lookup (esp. the Supabase catalog fast-path) doesn't carry the
  // summary, so the description would fall back to a template. Read the summary
  // fields directly from Atlas when they're absent so descriptions are unique.
  const bookRec = book as unknown as { id?: string; index?: { bookSummary?: { brief?: string } }; reading_summary?: { overview?: string }; summary?: { data?: string } | string };
  let summaryText: string | null = bookRec.index?.bookSummary?.brief
    || bookRec.reading_summary?.overview
    || (typeof bookRec.summary === 'string' ? bookRec.summary : bookRec.summary?.data)
    || null;
  if (!summaryText && bookRec.id) {
    try {
      const sdb = await getReadDb();
      const s = await sdb.collection('books').findOne(
        { id: bookRec.id },
        { projection: { _id: 0, 'index.bookSummary.brief': 1, 'reading_summary.overview': 1, 'summary.data': 1 } },
      ) as { index?: { bookSummary?: { brief?: string } }; reading_summary?: { overview?: string }; summary?: { data?: string } } | null;
      summaryText = s?.index?.bookSummary?.brief || s?.reading_summary?.overview || s?.summary?.data || null;
    } catch { /* keep null → factual template fallback */ }
  }
  // The claim's register for the meta description (#3459).
  //
  // ⚠️ `getCachedBookLookup` serves the Supabase `books_catalog` row in the
  // common case (it is ~50ms against Atlas's 1-5s), and that row carries
  // `is_first_translation` and `ft_disposition` but NOT
  // `first_translation.evidence_strength` or the screens. Classifying the thin
  // payload directly returns `candidate` for EVERY book — including the 627 that
  // earned the assertion — because "the field is absent" is indistinguishable
  // from "the evidence is weak". That is the invariant this area keeps breaking:
  // "we could not ask" must stay separate from "we asked and found nothing".
  //
  // So when the payload cannot answer, ASK — one projected lookup, and only for
  // the ~17% of visible books that carry the flag at all. A failure falls back
  // to `candidate`, which drops the "First" prefix rather than asserting it.
  let ftClaimForSeo = classifyFirstTranslationClaim(book as unknown as ScreenedBook).claim;
  const seoPayloadCanAnswer = (book as { first_translation?: unknown }).first_translation !== undefined;
  if (!seoPayloadCanAnswer && book.is_first_translation && bookRec.id) {
    try {
      const sdb = await getReadDb();
      const ev = await sdb.collection('books').findOne(
        { id: bookRec.id },
        {
          projection: {
            _id: 0, visible: 1, language: 1, pages_translated: 1,
            first_translation: 1, translation_verification: 1,
            source_language_screen: 1, translator_author_screen: 1,
          },
          maxTimeMS: 3000,
        },
      );
      if (ev) ftClaimForSeo = classifyFirstTranslationClaim(ev as unknown as ScreenedBook).claim;
    } catch { /* keep `candidate` — understate, never overstate */ }
  }

  const description = buildSeoDescription({
    originalTitle: book.title,
    authorLabel: bylineLabel,
    year: displayYear,
    language: book.language,
    summary: summaryText,
    firstTranslationClaim: ftClaimForSeo,
    pagesTranslated: book.pages_translated,
  });
  const bookUrl = `/book/${book.slug || book.id}`;

  // Get publication date for OG tags
  const currentEdition = (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'published') || (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'draft');
  const publishedDate = currentEdition?.published_at
    ? new Date(currentEdition.published_at).toISOString()
    : book.created_at
      ? new Date(book.created_at).toISOString()
      : undefined;
  const modifiedDate = book.updated_at
    ? new Date(book.updated_at).toISOString()
    : undefined;

  // Google Scholar meta tags for academic discoverability
  // https://scholar.google.com/intl/en/scholar/inclusion.html#indexing
  //
  // citation_author covers both authors and editors for compilations — Google
  // Scholar doesn't have a separate citation_editor tag, but the `(ed.)`
  // suffix is the standard convention and is preserved through search results.
  const scholarMeta: Record<string, string | string[]> = {
    'citation_title': book.title,
    'citation_author': bylineLabel,
    'citation_fulltext_html_url': `https://sourcelibrary.org${bookUrl}`,
  };
  // Only a bare year may be asserted here. A century or range is real knowledge
  // but not a publication date, and this field cannot express the hedge —
  // emitting nothing beats fabricating a precision the source never had.
  const citeYear = citationYear(book.published);
  if (citeYear) scholarMeta['citation_publication_date'] = citeYear;
  if (book.language) scholarMeta['citation_language'] = book.language;
  if (book.publisher) scholarMeta['citation_publisher'] = book.publisher;
  if (book.doi) scholarMeta['citation_doi'] = book.doi;

  // Don't index books with no meaningful content for search engines:
  // - 0 OCR pages, or
  // - Very thin (1-3 OCR pages) with no translation
  //
  // Default to indexable when pages_ocr is null/undefined: the Supabase
  // catalog mirror doesn't have OCR counts for some external-source imports
  // (ETCSL, CDLI, etc.), and `null ?? 0` falsely flagged them as 0-page
  // shells. Only noindex when we *know* the book is thin.
  const pagesOcr = book.pages_ocr;
  const pagesTranslated = book.pages_translated;
  const shouldIndex = pagesOcr == null
    || pagesOcr > 3
    || (pagesOcr > 0 && (pagesTranslated ?? 0) > 0);

  return {
    title: seoTitle,
    description,
    ...(!shouldIndex && { robots: { index: false, follow: true } }),
    alternates: {
      canonical: bookUrl,
      types: {
        'application/ld+json': `https://sourcelibrary.org/api/dts/collection?id=${book.id}`,
      },
    },
    other: scholarMeta,
    openGraph: {
      title: ogTitle,
      description,
      type: 'article',
      siteName: 'Source Library',
      locale: 'en_US',
      url: bookUrl,
      // OG image generated by opengraph-image.tsx (branded 1200x630 card)
      ...(publishedDate && { publishedTime: publishedDate }),
      ...(modifiedDate && { modifiedTime: modifiedDate }),
      authors: [bylineLabel],
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description,
      // Twitter image generated by opengraph-image.tsx
    },
  };
}

interface GalleryImagePreview { id: string; extracted_url?: string; thumbnail_url?: string; image_url?: string; description?: string; type?: string; page_number?: number; gallery_quality?: number; dhash?: string; book_id?: string }
interface BookCollectionPreview { slug: string; name: string; subtitle?: string; color?: string; book_count?: number; featured_images?: Array<{ extracted_url?: string; thumbnail_url?: string; image_url?: string }> }

interface AuthorEntityPreview {
  name?: string;
  canonical_name?: string;
  aliases?: string[];
  viaf_id?: string;
  wikidata_id?: string;
  lcnaf_id?: string;
  gnd_id?: string;
  wikipedia_url?: string;
  wikidata_birth_date?: string;
  wikidata_death_date?: string;
}

async function getBook(id: string, tenantId?: string, tenantSlug?: string): Promise<{ book: Book; pages: Page[]; totalBooks: number; galleryImages: GalleryImagePreview[]; galleryImageCount: number; bookCollections: BookCollectionPreview[]; matchedBySlug: boolean; authorEntity: AuthorEntityPreview | null; translationCard: TranslationCard | null } | null> {
  // Reuse the cached book lookup (shared with generateMetadata — saves a full DB round trip)
  // When Supabase serves the lookup (<50ms), we get the bookId instantly and can start
  // ALL Atlas queries in parallel — including a full book refetch for fields not in the catalog.
  const [result, db] = await Promise.all([
    getCachedBookLookup(id),
    getReadDb(),
  ]);

  if (!result) return null;
  let effectiveResult = result;
  if (tenantId) {
    const scoped = await findBookByIdOrSlug(db, id, {
      reading_sections: 0,
      pipeline: 0,
      pipeline_auto: 0,
      split_check: 0,
      'index.sectionSummaries': 0,
      'index.people': 0,
      'index.places': 0,
      'index.concepts': 0,
      'index.keyTerms': 0,
    }, tenantId);
    if (!scoped) return null;
    effectiveResult = {
      book: scoped.book as Record<string, unknown>,
      matchedBySlug: scoped.matchedBySlug,
      fromCatalog: false,
    };
  }

  const { book: quickBook, matchedBySlug, fromCatalog } = effectiveResult;

  // Use the book's id field, or fall back to _id string
  const bookId = (quickBook.id || quickBook._id?.toString()) as string;

  // When the lookup came from Supabase catalog, we need to fetch the full book from Atlas
  // for fields not in the catalog (editions, translation_verification, index, etc.).
  // This runs in parallel with pages/gallery/collections — no sequential bottleneck.
  const fullBookPromise = fromCatalog
    ? findBookByIdOrSlug(db, bookId, {
      reading_sections: 0,
      pipeline: 0,
      pipeline_auto: 0,
      split_check: 0,
      'index.sectionSummaries': 0,
      'index.people': 0,
      'index.places': 0,
      'index.concepts': 0,
      'index.keyTerms': 0,
    }, tenantId).catch(() => null)
    : Promise.resolve(null); // Already have full book from Atlas

  // The work's Translation Card, if one exists (#3881). Best-effort: a miss
  // or an error renders the legacy panel, never an error state.
  const cardPromise = loadCard(db, (quickBook as { work_id?: string }).work_id).catch(() => null);

  // All queries have maxTimeMS to fail fast during DB degradation
  const [fullBookResult, pagesRaw, totalBooks, galleryImagesRaw, galleryImageCount, bookCollectionsRaw, translationCard] = await Promise.all([
    fullBookPromise,
    // Use page_number >= 0 to skip archived-spread pages (negative numbers).
    // This uses the {book_id, page_number} compound index efficiently.
    // Digitizer-inserts are still filtered in JS (rare, no index benefit).
    db.collection('pages')
      .find({ book_id: bookId, page_number: { $gte: 0 } }, {
        projection: {
          _id: 0,
          id: 1,
          page_number: 1,
          photo: 1,
          photo_original: 1,
          archived_photo: 1,
          cropped_photo: 1,
          thumbnail: 1,
          thumbnail_blob: 1,
          image_display: 1,
          image_thumb: 1,
          crop: 1,
          'ocr.updated_at': 1,
          'translation.updated_at': 1,
          'summary.updated_at': 1,
          display_brightness: 1,
          page_type: 1,
          split_from_spread: 1,
          // First 1200 chars of the OCR — the metadata envelope plus the model's
          // page description. Enough to recognise digitiser boilerplate and
          // library/owner stamps that `page_type` misses (see
          // `isJunkRepresentativePage`), without pulling whole pages of text.
          // 1200 is the cover scorer's window (`scorePageForCover`) — keep in
          // step with ensure-cover's projection.
          ocr_head: { $substrCP: [{ $ifNull: ['$ocr.data', ''] }, 0, 1200] },
        },
        maxTimeMS: 5000,
      })
      .sort({ page_number: 1 })
      .limit(110) // slight over-fetch to account for digitizer-inserts filtered below
      .toArray()
      .then(docs => docs.filter(d => d.page_type !== 'digitizer-insert' && d.page_type !== 'archived-spread' && (d.page_number == null || d.page_number >= 0)).slice(0, 100)),
    db.collection('books').estimatedDocumentCount().catch(() => 1200),
    // Top 8 gallery images for preview row
    db.collection('gallery_images')
      .find(
        { book_id: bookId, gallery_quality: { $gte: 0.7 }, book_visible: true, extracted_url: { $ne: null }, image_url: { $ne: null } },
        { projection: { _id: 0, id: 1, extracted_url: 1, thumbnail_url: 1, image_url: 1, description: 1, type: 1, page_number: 1, gallery_quality: 1, dhash: 1, book_id: 1 }, maxTimeMS: 5000 },
      )
      .sort({ gallery_quality: -1 })
      .limit(30) // over-fetch to allow dhash dedup to filter duplicates
      .toArray()
      .catch(() => []),
    // Separate count query for accurate image count display
    db.collection('gallery_images')
      .countDocuments(
        { book_id: bookId, gallery_quality: { $gte: 0.7 }, book_visible: true, extracted_url: { $ne: null }, image_url: { $ne: null } },
        { maxTimeMS: 5000 },
      )
      .catch(() => 0),
    // Collections this book belongs to
    (quickBook.collections as string[] | undefined)?.length
      ? db.collection('collections')
        .find(
          { slug: { $in: quickBook.collections as string[] }, visible: true },
          { projection: { _id: 0, slug: 1, name: 1, subtitle: 1, color: 1, book_count: 1, featured_images: 1 }, maxTimeMS: 5000 },
        )
        .sort({ order: 1 })
        .toArray()
        .catch(() => [])
      : Promise.resolve([]),
    cardPromise,
  ]);

  // Use the full Atlas book when available (has editions, translation_verification, etc.)
  // Fall back to the catalog book (Supabase) if Atlas fetch failed
  const book = fullBookResult?.book ?? quickBook;

  // Author authority record (variants / VIAF / Wikidata) — only when the
  // book has been linked to an entity. Loaded in parallel with the index
  // doc; failures are non-fatal (the AuthorAuthority component just doesn't
  // render). See scripts/enrichment/viaf-author-linking.mjs for how the
  // link gets set.
  const authorEntityIdRaw = (book as { author_entity_id?: string }).author_entity_id;
  const authorEntityId = typeof authorEntityIdRaw === 'string' && ObjectId.isValid(authorEntityIdRaw)
    ? authorEntityIdRaw
    : null;

  const [bookIndexDoc, authorEntity] = await Promise.all([
    db.collection('book_indexes').findOne(
      { book_id: bookId },
      { projection: { _id: 0, book_id: 0 }, maxTimeMS: 5000 }
    ).catch(() => null),
    authorEntityId
      ? db.collection('entities').findOne(
        { _id: new ObjectId(authorEntityId) },
        {
          projection: {
            _id: 0,
            name: 1, canonical_name: 1, aliases: 1,
            viaf_id: 1, wikidata_id: 1, lcnaf_id: 1, gnd_id: 1,
            wikipedia_url: 1,
            wikidata_birth_date: 1, wikidata_death_date: 1,
          },
          maxTimeMS: 3000,
        }
      ).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Merge index data back onto book for rendering (if found in dedicated collection)
  if (bookIndexDoc) {
    (book as any).index = { ...(book as any).index, ...bookIndexDoc };
  }

  // Serialize MongoDB objects to plain JavaScript objects
  const serializedBook = JSON.parse(JSON.stringify(book));
  const serializedPages = JSON.parse(JSON.stringify(pagesRaw)) as Page[];

  // Infer crop data for uncropped pages in spread books.
  // The crop pipeline skips covers/blanks, leaving them as full spreads.
  // Detect the book's parity convention from existing crops, then fill gaps.
  // Guards: need 6+ cropped pages AND a decisive parity majority (>75%)
  // to avoid misfiring on books with sparse or inconsistent crop data.
  const pagesWithCrop = serializedPages.filter(p => p.crop?.xStart !== undefined);
  if (pagesWithCrop.length >= 6) {
    let oddLeft = 0, oddRight = 0;
    for (const p of pagesWithCrop) {
      if (p.page_number % 2 === 1) {
        (p.crop!.xStart as number) > 400 ? oddRight++ : oddLeft++;
      }
    }
    const oddVotes = oddLeft + oddRight;
    const majorityPct = oddVotes > 0 ? Math.max(oddLeft, oddRight) / oddVotes : 0;

    if (oddVotes >= 3 && majorityPct >= 0.75) {
      const oddIsLeft = oddLeft > oddRight;
      for (const p of serializedPages) {
        if (p.crop || p.split_from_spread) continue;
        const isOdd = p.page_number % 2 === 1;
        const useLeft = oddIsLeft ? isOdd : !isOdd;
        (p as any).crop = useLeft
          ? { xStart: 0, xEnd: 510 }
          : { xStart: 490, xEnd: 1000 };
      }
    }
  }

  const galleryImagesParsed = JSON.parse(JSON.stringify(galleryImagesRaw)) as (GalleryImagePreview & { gallery_quality: number; book_id: string })[];
  const galleryImages = deduplicateByDHash(galleryImagesParsed).slice(0, 8) as GalleryImagePreview[];
  const bookCollections = JSON.parse(JSON.stringify(bookCollectionsRaw)) as BookCollectionPreview[];

  const serializedEntity = authorEntity ? JSON.parse(JSON.stringify(authorEntity)) : null;

  return { book: serializedBook as Book, pages: serializedPages as Page[], totalBooks, galleryImages, galleryImageCount, bookCollections, matchedBySlug, authorEntity: serializedEntity, translationCard: translationCard ? JSON.parse(JSON.stringify(translationCard)) : null };
}

// Skeleton for book info while loading
function BookInfoSkeleton() {
  return (
    <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="flex flex-col sm:flex-row gap-6 sm:gap-8">
          <div className="flex-shrink-0 flex justify-center sm:justify-start">
            <div className="w-32 sm:w-48 aspect-[3/4] rounded-lg overflow-hidden bg-stone-700">
              <div className="w-full h-full bg-gradient-to-r from-stone-700 via-stone-600 to-stone-700 bg-[length:200%_100%] animate-shimmer" />
            </div>
          </div>
          <div className="flex-1 text-center sm:text-left">
            <div className="h-8 w-64 bg-stone-700 rounded mb-2" />
            <div className="h-6 w-40 bg-stone-700 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Skeleton for pages grid
function PagesGridSkeleton() {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-3 sm:gap-4">
      {Array.from({ length: 20 }).map((_, i) => (
        <div key={i}>
          <div className="aspect-[3/4] bg-white border border-stone-200 rounded-lg overflow-hidden">
            <div className="w-full h-full bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] animate-shimmer" />
          </div>
          <div className="h-3 w-6 bg-stone-100 rounded mx-auto mt-1" />
        </div>
      ))}
    </div>
  );
}

// Book info component (streams in via Suspense)
async function BookInfo({ id, tenantId, tenantSlug, embedPolicy, isEmbedded = false, previewProposed = false, allowHidden = false }: { id: string; tenantId?: string; tenantSlug: string; embedPolicy: EmbedUiPolicy; isEmbedded?: boolean; previewProposed?: boolean; allowHidden?: boolean }) {
  let data;
  try {
    data = await getBook(id, tenantId, tenantSlug);
  } catch (err) {
    console.error('[Book page] getBook failed:', err instanceof Error ? err.message : err);
    // Return a friendly message instead of crashing the Suspense boundary
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center max-w-md px-6">
          <h2 className="text-2xl font-display text-primary mb-3">Temporarily Unavailable</h2>
          <p className="text-secondary mb-6">This book is taking longer than expected to load. Please try again in a moment.</p>
          <Link href={`/${tenantSlug || ''}`} className="text-accent-rust hover:underline">Return to Library</Link>
        </div>
      </div>
    );
  }

  if (!data) {
    notFound();
  }

  const { book, pages, totalBooks, galleryImages, galleryImageCount, bookCollections, authorEntity, translationCard } = data;

  // What we can honestly SAY about this book's first-translation status (#3459).
  // The flag decides whether a claim appears at all; this decides its register —
  // `confirmed` asserts, anything weaker reports the search we ran instead.
  // Computed once so the publication timeline, the stat line and the evidence
  // panel cannot drift apart.
  const ftClaim = classifyFirstTranslationClaim(book as unknown as ScreenedBook).claim;
  const ftClause = firstTranslationClause(ftClaim);

  // Hidden books (visible:false) are not public — defense in depth alongside
  // the early gate in BookDetailPage. allowHidden is set only by the dynamic,
  // editor-gated /book/[id]/preview route.
  if (isHiddenBook(book as any) && !allowHidden) {
    notFound();
  }

  // Enforce tenant isolation: book must belong to the tenant in the URL.
  // Books are stored with EITHER `tenantId` (UUID) or `tenant_id` (slug) — sometimes both.
  // Match against whichever form is present so legacy artwork docs (slug-only) don't 404.
  // After the Phase 3 globalization, /book/[id] is reachable without a tenant
  // context (sourcelibrary.org/book/X). Only enforce isolation when this
  // request actually carries a tenant (subdomain or path-resolved); otherwise
  // every book stays visible globally — that's the whole point of the
  // tenant-as-filter overlay model.
  const bookTenantUuid = (book as any).tenantId as string | undefined;
  const bookTenantSlug = (book as any).tenant_id as string | undefined;
  const hasTenantField = !!(bookTenantUuid || bookTenantSlug);
  const hasTenantContext = !!(tenantId || tenantSlug);
  const matchesTenant =
    (bookTenantUuid && tenantId && bookTenantUuid === tenantId) ||
    (bookTenantSlug && tenantSlug && bookTenantSlug === tenantSlug);
  if (hasTenantContext && hasTenantField && !matchesTenant) {
    notFound();
  }

  // Text-only works (e.g. romanized Javanese from Wikisource): no page scans,
  // so render a dedicated text layout instead of the image+OCR reader. Must come
  // before isVisualArt (a 'text' resource_type would otherwise route to artwork).
  if ((book as { content_type?: string }).content_type === 'text') {
    const textDb = await getReadDb();
    const textPages = await textDb.collection('pages')
      .find({ book_id: book.id, page_number: { $gte: 0 } }, {
        projection: { _id: 0, page_number: 1, part_title: 1, 'transliteration.data': 1, 'translation.data': 1, 'ocr.data': 1 },
        maxTimeMS: 5000,
      })
      .sort({ page_number: 1 }).limit(1000).toArray();
    // Text-only works serve their whole translation in one server render, so
    // each page carries the reader-path provenance mark (deterministic,
    // ISR-safe; runs once per revalidation, not per request).
    const markedTextPages = (JSON.parse(JSON.stringify(textPages)) as Record<string, unknown>[])
      .map((p) => markPageForReader(p, book.id));
    return <TextReader book={book as any} pages={markedTextPages as any} collections={bookCollections} />;
  }

  // Empty shell books (0 pages from failed imports) should 404
  // But visual art (paintings, prints, etc.) legitimately has no page documents
  const isVisualArt = book.resource_type && book.resource_type !== 'printed_book' && book.resource_type !== 'manuscript';
  if (!isVisualArt && (!book.pages_count || book.pages_count === 0)) {
    notFound();
  }

  // Visual art gets a dedicated layout — no OCR, no pages grid, no translation stats
  if (isVisualArt) {
    // Find related books by this artist (when source_book isn't already set)
    let relatedBooksByAuthor: Array<{ id: string; slug: string; title: string; thumbnail?: string; thumbnail_blob?: string }> = [];
    const hasSourceBook = !!(book as any).source_book;
    const authorName = book.author?.trim();
    const isKnownAuthor = authorName && !/^unknown/i.test(authorName) && !/^unidentified/i.test(authorName) && !/^anonymous/i.test(authorName);
    if (!hasSourceBook && isKnownAuthor) {
      const artDb = await getReadDb();
      relatedBooksByAuthor = await artDb.collection('books')
        .find(
          { author: authorName, content_type: { $ne: 'artwork' }, pages_count: { $gt: 0 } },
          { projection: { id: 1, slug: 1, title: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1 }, maxTimeMS: 3000 },
        )
        .limit(6)
        .toArray()
        .then(docs => JSON.parse(JSON.stringify(docs)))
        .catch(() => []);
    }

    return (
      <ArtworkInfo
        book={book}
        collections={bookCollections}
        relatedBooks={relatedBooksByAuthor}
        isEmbedded={!embedPolicy.showAuthorCrossReference}
      />
    );
  }

  // Content gating handled client-side by useBetaGate hook in BookPagesSection
  // Featured books bypass the gate; others show email modal on page click

  // Note: ObjectId→slug redirect is handled by proxy.ts → /api/redirect/book-slug

  // Use book-level cached counts (not page array, which is truncated to first 100 pages)
  const ocrCount = book.pages_ocr ?? pages.filter(p => p.ocr).length;
  const translatedCount = book.pages_translated ?? pages.filter(p => p.translation).length;
  const totalPages = book.pages_count || pages.length;
  const pagesBlank = (book as unknown as { pages_blank?: number }).pages_blank ?? 0;
  const ocrPct = totalPages > 0 ? Math.min(100, Math.round((ocrCount / totalPages) * 100)) : 0;
  const readablePages = Math.max(1, ocrCount - pagesBlank);
  const translatedPct = Math.min(100, Math.round((translatedCount / readablePages) * 100));
  const imageCount = galleryImageCount || galleryImages.length;
  const currentEdition = (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'published') || (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'draft');

  // Progression: OCR → Translation → Summary → Ask AI / Publish
  const hasOcr = ocrCount > 0;
  const hasTranslations = translatedCount > totalPages / 2; // >50% translated
  // Image-download access classification (mirrors classifyImageAccess in lib/purchases.ts):
  //  - 'open': PD / CC-BY / BPH / pre-1930 → flows through the normal member/pay gate
  //  - 'nc-free': NC-licensed → free for any signed-in user, never charged
  //  - 'blocked': modern + unknown license + non-BPH → withheld entirely
  const imgLicense = (book as any).image_source?.license || 'unknown';
  const imgProvider = (book as any).image_source?.provider;
  const yearPublished = (book as unknown as { year_published?: number }).year_published;
  const isNcLicense = typeof imgLicense === 'string' && /\bnc\b/i.test(imgLicense);
  const imageAccess: 'open' | 'nc-free' | 'blocked' =
    imgProvider === 'bph' || (typeof yearPublished === 'number' && yearPublished < 1930)
      ? 'open'
      : isNcLicense
        ? 'nc-free'
        : (!imgLicense || imgLicense === 'unknown')
          ? 'blocked'
          : 'open';
  const imageRestricted = imageAccess === 'blocked';
  const candidate = (book as unknown as { summary_candidate?: { brief?: string; abstract?: string; detailed?: string } }).summary_candidate;
  const bookSummaryObj = previewProposed && candidate?.brief
    ? { brief: candidate.brief, abstract: candidate.abstract, detailed: candidate.detailed }
    : (book as unknown as { index?: { bookSummary?: { brief?: string; detailed?: string; abstract?: string } } }).index?.bookSummary;
  const indexBrief = bookSummaryObj?.brief;
  const readingSummary = previewProposed && candidate?.abstract
    ? candidate.abstract
    : (book as unknown as { reading_summary?: { overview?: string } }).reading_summary?.overview;
  const rawSummaryText = indexBrief || readingSummary || (typeof book.summary === 'string' ? book.summary : book.summary?.data);
  // The generated summary usually opens by restating the book's title
  // ("<Title> is a scholarly commentary by …"). Drop that leading restatement
  // so the About text starts with the actual description. Only triggers when
  // the text genuinely starts with the book's title, and never over-strips.
  const summaryText = (() => {
    const text = rawSummaryText;
    if (!text) return text;
    const titles = [book.title, book.display_title].filter((t): t is string => !!t && t.length >= 8);
    const startsWithTitle = titles.some(t => text.toLowerCase().startsWith(t.toLowerCase().slice(0, Math.min(t.length, 40))));
    if (!startsWithTitle) return text;
    const m = text.slice(0, 320).match(/\b(?:is|was|are|were|remains|represents|provides|serves|contains|documents|comprises|constitutes)\b\s+/i);
    if (!m || m.index === undefined) return text;
    const rest = text.slice(m.index + m[0].length).replace(/^["'“(\s]+/, '');
    if (rest.length < 24) return text;
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  })();
  const hasSummary = !!summaryText;
  const showProposedBanner = previewProposed && !!candidate?.brief;
  const isComplete = ocrCount >= totalPages && translatedCount >= totalPages && hasSummary;
  const summaryEntities = buildEntityList((book as unknown as { index?: { people?: Array<{ term: string }>; places?: Array<{ term: string }>; concepts?: Array<{ term: string }> } }).index);

  // ============================================================================
  // Book page v2 layout (non-embed only). Tenant/embed reading rooms keep the
  // proven layout below to preserve the Tenant Subdomain Lockdown invariants.
  // ============================================================================
  if (!isEmbedded) {
    const heroByline = getEffectiveByline(book);
    const bookSlug = book.slug || book.id;
    // Hero cover: prefer the stored cover only when it's on a host the CSP allows
    // (rehosted R2 / blob / Wikimedia). Freshly-imported books keep a raw
    // source URL (archive.org, …) that the browser blocks — in that case fall
    // back to the first non-blank page scan (the title page), which is rehosted
    // and shows the actual scan at its true dimensions.
    const storedCover = getBookThumbnailUrl(book as Parameters<typeof getBookThumbnailUrl>[0], 'display') ?? undefined;
    const coverRenderable = isRenderableCoverUrl(storedCover);
    // Best cover-scan candidate: OCR-scored (same scorer as pipeline Phase
    // 8.9 — decorated title pages and frontispieces win, blanks / stamps /
    // scanner's-hand shots are rejected), falling back to the type-priority
    // rule when nothing scores confidently. `selectScoredCoverPage` is shared
    // with /api/books/[id]/ensure-cover so the page we SHOW here is the page
    // that gets SAVED as the cover.
    const coverPage = selectScoredCoverPage(pages, book.title)?.page;
    const coverDisplay = coverRenderable ? storedCover : (coverPage ? (getPageImageUrl(coverPage as Parameters<typeof getPageImageUrl>[0], 'display') ?? undefined) : undefined) || storedCover;
    // Printed table-of-contents page (design's "Original printed contents" card).
    const tocPage = pages.find(p => p.page_type === 'toc');
    // Page types we never want to surface as a "representative" page: blanks,
    // digitizer inserts, and — importantly — the scanner calibration / colour-
    // card / cradle shots that cluster in the front matter of many scans.
    const KNOWN_JUNK_PAGE_TYPES = new Set(['blank', 'digitizer-insert', 'archived-spread', 'scanner_metadata', 'scanner-metadata', 'color-card', 'colorcard', 'color_card', 'target', 'endpaper', 'cover', 'spine', 'frontcover', 'backcover']);
    const ptype = (p: { page_type?: string }) => (p.page_type || '').toLowerCase();
    // Pick a representative *interior content* page, robust to books whose pages
    // aren't type-classified. Order: deep body text → a classified illustration
    // → a position-based mid-book page (skips the front-matter/calibration
    // cluster). Never the cover, never a known-junk type.
    // `isJunkRepresentativePage` additionally reads the page's own OCR, so a
    // digitiser plate mistyped as `frontispiece` (the Internet Archive "funding
    // from Microsoft" leaf) is excluded here rather than being promoted by the
    // illustration branch below.
    //
    // If that leaves NOTHING, fall back to the type-filtered list rather than
    // rendering no image: a single-leaf broadside whose one page carries a
    // marginal shelfmark is still the work itself, and an empty column is worse
    // than an imperfect page. (Measured: 1 book in 800 takes this branch.)
    const interiorCandidatesByType = pages.filter(p => p.id !== coverPage?.id && !KNOWN_JUNK_PAGE_TYPES.has(ptype(p)));
    const interiorCandidatesClean = interiorCandidatesByType.filter(
      p => !isJunkRepresentativePage(p as { page_type?: string | null; ocr_head?: string | null }),
    );
    const interiorCandidates = interiorCandidatesClean.length ? interiorCandidatesClean : interiorCandidatesByType;
    const midOf = <T,>(arr: T[]): T | undefined => (arr.length ? arr[Math.floor(arr.length / 2)] : undefined);
    // The text fallback must show a page of the WORK, not its apparatus. Blanks
    // are already gone with KNOWN_JUNK_PAGE_TYPES; these are the front-matter
    // types that survive it and read as "this book has nothing to show".
    const APPARATUS_PAGE_TYPES = new Set(['title-page', 'toc', 'contents', 'table-of-contents']);
    const textCandidates = interiorCandidates.filter(p => !APPARATUS_PAGE_TYPES.has(ptype(p)));
    const interiorTextPage = (() => {
      const deep = textCandidates.filter(p => ptype(p) === 'text' && (p.page_number ?? 0) >= 10);
      if (deep.length) return midOf(deep);
      const anyText = textCandidates.filter(p => ptype(p) === 'text');
      if (anyText.length) return midOf(anyText);
      // No usable classification — take a page from the middle of the book,
      // skipping the first several scans where calibration/blank pages live.
      const start = Math.min(8, Math.floor(textCandidates.length / 4));
      const pool = textCandidates.slice(start);
      return midOf(pool.length ? pool : textCandidates);
    })();
    const interiorIllusPage = interiorCandidates.find(p => ['frontispiece', 'plate', 'illustration'].includes(ptype(p)));
    // Single page scans used as the hero background fallback when the tiled
    // mosaic can't be built. 'display' (not 'thumb') so a single page blown up
    // full-bleed stays crisp.
    const heroPageThumbs = pages
      .filter(p => p.page_type !== 'blank')
      .slice(0, 40)
      .map(p => getPageImageUrl(p as Parameters<typeof getPageImageUrl>[0], 'display'))
      .filter((u): u is string => !!u);
    const galleryPlates: Plate[] = galleryImages.map((img): Plate | null => {
      const src = img.thumbnail_url || img.extracted_url || img.image_url;
      if (!src) return null;
      const pageId = img.id.match(/^(.+)[:\-]\d+$/)?.[1];
      const href = pageId ? `/book/${bookSlug}/page/${pageId}` : `/gallery/image/${img.id}`;
      return { src, fallback: img.extracted_url || img.image_url, href, label: img.description };
    }).filter((p): p is Plate => p !== null);
    const readHref = (() => {
      if (pages.length === 0) return null;
      const firstChapterPageNumber = book.chapters?.length
        ? (book.chapters as { pageNumber?: number }[])[0]?.pageNumber
        : null;
      if (typeof firstChapterPageNumber === 'number') return `/book/${bookSlug}/page-number/${firstChapterPageNumber}`;
      const skipTo = totalPages >= 20 ? 4 : totalPages >= 10 ? 2 : 0;
      const readPage = pages[skipTo] || pages[0];
      return readPage ? `/book/${bookSlug}/page/${readPage.id}` : null;
    })();
    const hasContents = !!(book.chapters?.length || (book as unknown as { index?: { entries?: unknown[] } }).index?.entries?.length || hasSummary);
    // The related rail only shows books with a CSP-renderable cover (rehosted to
    // R2 / blob / Wikimedia); archive.org covers are blocked and render broken.
    const renderableCover = (u?: string | null) => /(images\.sourcelibrary\.org|public\.blob\.vercel-storage\.com|upload\.wikimedia\.org)/.test(String(u || ''));
    // Related books: a weighted, multi-signal recommender — author + subject +
    // location × time-period lead, a shared collection is only a minor nudge
    // (it used to dominate). See src/lib/related-books.ts.
    const relatedYear = Number(String(book.published ?? '').match(/\d{3,4}/)?.[0])
      || (book as unknown as { year_published?: number }).year_published
      || null;
    const tagRelated: CatalogBook[] = embedPolicy.showBookRelatedBooks
      ? await getRelatedBooks({
          id: book.id,
          author: book.author,
          categories: book.categories,
          collections: (book as unknown as { collections?: string[] }).collections,
          language: book.language,
          year: relatedYear,
          place: book.place_published,
        }, renderableCover, 12).catch(() => [] as CatalogBook[])
      : [] as CatalogBook[];
    const hasRelated = tagRelated.length > 0;

    // "Part of the collection" section — the contributing digital library/source
    // this book came from (Biblioteca Philosophica Hermetica, Internet Archive,
    // …), with its own stats. Resolved from image_source.provider via the static
    // LIBRARY_PARTNERS registry; skipped in embed/tenant views.
    const librarySection: LibrarySectionData | null = await (async () => {
      const provider = (book as unknown as { image_source?: { provider?: string } }).image_source?.provider;
      const partner = provider ? getPartnerByProvider(provider) : undefined;
      if (!partner || !embedPolicy.showBookRelatedBooks) return null;
      // Each query is timeout-guarded and independently caught so a slow/failing
      // one (e.g. an exact count over a huge provider like Internet Archive)
      // never nulls the whole section — we degrade a stat, not the feature.
      const guard = <T,>(p: Promise<T>, fallback: T): Promise<T> =>
        Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), 3500))]).catch(() => fallback);
      // Sample (fast, estimated) gates the section and gives cover art. Exact
      // counts are fetched separately and fall back to the estimate if slow — so
      // the numbers are real (not the planner's round "1,001" estimate) without
      // ever hiding the section on a big provider.
      const all = await guard(browseBooks({ provider: partner.providerKey, sort: 'popular', limit: 24 }), { books: [] as CatalogBook[], total: 0 });
      if (all.total < 2) return null; // not worth a "collection" callout for a lone book
      const [exactBooks, translated, languages] = await Promise.all([
        guard(browseBooks({ provider: partner.providerKey, limit: 1, exactCount: true } as Parameters<typeof browseBooks>[0]), { total: all.total, books: [] as CatalogBook[] }),
        guard(browseBooks({ provider: partner.providerKey, hasTranslation: true, limit: 1, exactCount: true } as Parameters<typeof browseBooks>[0]), { total: 0, books: [] as CatalogBook[] }),
        guard(getLanguageCounts({ provider: partner.providerKey }), [] as Array<{ lang: string; count: number }>),
      ]);
      const covers = all.books
        .filter(bk => bk.id !== book.id && renderableCover(bk.thumbnail))
        .slice(0, 14)
        .map(bk => ({ slug: (bk.slug || bk.id) as string, title: bk.display_title || bk.title, thumbnail: bk.thumbnail || bk.thumbnail_blob || undefined }));
      const image = partner.heroImageOverride || covers.find(c => c.thumbnail)?.thumbnail;
      return {
        slug: partner.slug,
        name: partner.name,
        shortName: partner.shortName,
        url: partner.url,
        description: partner.description,
        color: partner.color,
        image,
        logo: partner.logo,
        stats: { books: exactBooks.total || all.total, languages: languages.length, translated: translated.total },
        covers,
      };
    })();

    // Publisher / place only — the DATE is surfaced separately as a labelled
    // chip (heroDate) so it's clear, not buried at the end of the impressum.
    const impressum = (() => {
      const place = book.place_published?.trim();
      const publisher = book.publisher?.trim();
      return [place, publisher].filter(Boolean).join(': ');
    })();
    // Book author as a plain string (for de-duping the composition line below).
    const bookAuthorName = (() => {
      const a = book.author as unknown;
      if (typeof a === 'string') return a.trim();
      if (a && typeof a === 'object' && 'name' in a) return String((a as { name?: string }).name || '').trim();
      return '';
    })();
    // The clearest single date for the hero, shown as its own labelled chip:
    // the print/publication year when we have a real one, otherwise the
    // composition ("written") date. Non-informative values ("Unknown", n.d.)
    // are dropped rather than shown.
    const compDateDisplay = book.source_work_dates?.find(l => l.type === 'composition')?.date_display?.trim();
    const NONINFO_DATE = /^\s*(unknown|undated|n\.?\s?d\.?|\?+|[-—]+)?\s*$/i;
    const heroDate = (() => {
      const pub = book.published ? String(book.published).trim() : '';
      if (pub && !NONINFO_DATE.test(pub)) return { label: 'Published', value: pub };
      if (compDateDisplay) return { label: 'Written', value: compDateDisplay };
      return null;
    })();
    // Meta line: publisher/place, plus the source-work line ONLY when its author
    // differs from the byline (e.g. a translation crediting the original author
    // + date). For same-author originals the date already lives in the chip.
    const heroMetaLine = (() => {
      const parts: string[] = [];
      if (impressum) parts.push(impressum);
      const comp = book.source_work_dates?.find(l => l.type === 'composition');
      const trans = book.source_work_dates?.find(l => l.type === 'translation');
      if (comp) {
        const sameAuthor = !!comp.author && !!bookAuthorName && comp.author.trim() === bookAuthorName;
        if (!sameAuthor) parts.push(`${comp.author || ''} ${comp.date_display}`.trim());
      } else if (trans) {
        parts.push(`${trans.author || ''} trans. ${trans.date_display}`.trim());
      }
      return parts.filter(Boolean).join(' · ');
    })();
    // Subject tags — moved out of the hero, shown below the About text.
    const subjectTags = (book as unknown as { subject_keywords?: string[] }).subject_keywords?.filter(Boolean) ?? [];
    // A single *representative* visual for the About section. We want an image
    // that speaks to the BOOK's content — a plate, diagram, or frontispiece —
    // not provenance marks (a previous owner's bookplate / ex-libris), library
    // stamps, blanks, or scanner calibration targets. Selection order:
    //   1. Best curated gallery plate (quality ≥0.7) that isn't a provenance
    //      mark — gallery images are already sorted best-first.
    //   2. A classified illustration page from the book interior.
    //   3. A mid-book content page (skips front-matter calibration/blanks).
    // The cover is always excluded (handled by interiorCandidates / coverPage).
    const PROVENANCE_RE = /\b(book\s?plate|ex[\s-]?libris|from the library of|library of|armorial|ownership|owner'?s|stamp|inscription|donor|gift of|presented by|bequest|shelf\s?mark|call\s?number|barcode|catalog(?:ue)? card|colou?r\s?(?:card|chart|target|checker)|calibration)\b/i;
    // Decorative page ornaments — a tailpiece / headpiece / vignette / printer's
    // device is never a good "About" feature (it's a page-edge ornament, not a
    // content illustration). Excluding them also dodges a known pre-#2707
    // hallucination class: the captioner reading organic shapes (e.g. a
    // Sphaerocarpos liverwort plate) as an "allegorical tailpiece with putti".
    const DECORATIVE_RE = /\b(tail-?piece|head-?piece|vignette|cul-de-lampe|scrollwork|acanthus scroll|grotesque mask|printer'?s (?:device|mark|ornament)|decorative (?:border|initial|element|motif|device|ornament)|ornamental (?:border|initial|device)|fleuron|colophon device)\b/i;
    const isRepresentativePlate = (desc?: string) => !desc || (!PROVENANCE_RE.test(desc) && !DECORATIVE_RE.test(desc));
    // The side plate must never be the same image as the hero cover.
    const coverSrcKey = (coverDisplay || '').split('?')[0];
    const notCover = (src?: string | null) => !!src && src.split('?')[0] !== coverSrcKey;
    // An editor-chosen About visual (BookAboutPicker) overrides the auto-pick.
    const aboutOverride = (book as unknown as { about_visual?: { src?: string; href?: string; caption?: string } | null }).about_visual;
    const sideVisual = (aboutOverride && aboutOverride.src)
      ? { src: aboutOverride.src, href: aboutOverride.href || `/book/${bookSlug}`, caption: aboutOverride.caption }
      : (() => {
      // Only use a gallery plate if a non-provenance one exists; otherwise fall
      // through to a real interior page rather than showing a bookplate.
      const plate = galleryImages.find(g => isRepresentativePlate(g.description) && notCover(g.thumbnail_url || g.extracted_url || g.image_url));
      if (plate) {
        // Hi-res first: the extracted crop / full image, not the small thumbnail.
        const src = plate.extracted_url || plate.image_url || plate.thumbnail_url;
        if (src) {
          const pageId = plate.id.match(/^(.+)[:\-]\d+$/)?.[1];
          return { src, href: pageId ? `/book/${bookSlug}/page/${pageId}` : `/gallery/image/${plate.id}`, caption: plate.description };
        }
      }
      // Show a picture if the book has one WORTH showing, else a page of the
      // text. An illustration only reaches this point after clearing
      // `isJunkRepresentativePage`, which reads the page's own OCR and removes
      // the class that made illustrations untrustworthy here: digitiser plates
      // (the Internet Archive "funding from Microsoft" leaf, classified
      // `frontispiece`), library bookplates, and photographs of the binding.
      // With those gone a real frontispiece or plate is the better visual, and
      // it is the only visual available to the ~6.2K books stalled in the
      // paused pipeline, which have no extracted gallery images at all.
      for (const pg of [interiorIllusPage, interiorTextPage]) {
        if (!pg) continue;
        const src = getPageImageUrl(pg as Parameters<typeof getPageImageUrl>[0], 'display');
        if (src && notCover(src)) return { src, href: `/book/${bookSlug}/page/${pg.id}`, caption: pg.page_number ? `p. ${pg.page_number}` : undefined };
      }
      return null;
    })();

    // Reading guide / Contents / Bibliographic info / Book history dropdowns —
    // rendered below the About text (inside the About left column) so they sit
    // right under the text + tags, not in a separate row.
    const readingGuideText = bookSummaryObj?.detailed || readingSummary || '';
    const hasReadingGuide = !!readingGuideText.trim();

    // ---- Book history timeline: the meaningful dates we actually hold. ----
    const fmtMonthYear = (d: string | Date) => {
      const dt = new Date(d);
      return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    };
    const rawTimeline: Array<TimelineEvent & { ts: number }> = [];
    // Original (historical) publication / composition — always first. Prefer the
    // composition date_display (e.g. "c. 6th century CE") over the printed
    // `published` field, and skip non-informative values ("Unknown", n.d., …).
    const compDate = book.source_work_dates?.find((l) => l.type === 'composition')?.date_display;
    const histDate = (compDate || (book.published ? String(book.published) : '')).trim();
    const histInformative = histDate && !/^(unknown|undated|n\.?\s?d\.?|\?+|[-—]+)$/i.test(histDate);
    if (histInformative) {
      // Publisher/place only make sense for a printed impressum, not an ancient
      // composition date.
      const detail = compDate ? undefined : ([book.place_published, book.publisher].filter(Boolean).join(' · ') || undefined);
      rawTimeline.push({ ts: Number.NEGATIVE_INFINITY, key: 'published', dateText: histDate, label: 'Published', detail });
    }
    // An earlier English translation published elsewhere (credit the scholar).
    // A verified `prior_translation` credit carries the richest info; otherwise
    // fall back to the best piece of translation-verification evidence so the
    // entry still gets a year + translator when we have them.
    const yearTs = (y?: string | number | null) => {
      const s = String(y ?? '').trim();
      const m = s.match(/(\d{3,4})/);
      return m ? Date.UTC(Number(m[1]), 0, 1) : -0.5;
    };
    const timelinePrior = hasPublishablePriorTranslation(book as unknown as { prior_translation?: PriorTranslationCredit })
      ? (book as unknown as { prior_translation: PriorTranslationCredit }).prior_translation
      : null;
    const timelineVerification = (book as unknown as { translation_verification?: TranslationVerification }).translation_verification;
    const timelineExistingEvidence = !timelinePrior && timelineVerification?.disposition === 'translation_found'
      ? (timelineVerification.validated_translations?.[0] || timelineVerification.translations_found?.[0] || timelineVerification.translations?.[0])
      : undefined;
    if (timelinePrior) {
      rawTimeline.push({
        ts: yearTs(timelinePrior.year),
        key: 'prior-translation',
        dateText: timelinePrior.year ? String(timelinePrior.year) : 'Earlier',
        label: 'Earlier English translation',
        detail: (
          <>
            {priorTranslationSentence(timelinePrior)}
            {embedPolicy.showExternalLinks && (
              <>{' '}<a href={timelinePrior.url} target="_blank" rel="noopener noreferrer" className="hover:underline whitespace-nowrap" style={{ color: '#a5503d' }}>{priorLinkLabel(timelinePrior)} →</a></>
            )}
          </>
        ),
      });
    } else if (timelineExistingEvidence) {
      const ev = timelineExistingEvidence;
      const bits = [ev.translator ? `trans. ${ev.translator}` : null, ev.publisher || null].filter(Boolean).join(', ');
      const summary = ev.english_title
        ? `${ev.english_title}${bits ? ` — ${bits}` : ''}`
        : (bits || 'An earlier English translation of this work has been published.');
      rawTimeline.push({
        ts: yearTs(ev.pub_year),
        key: 'existing-translation',
        dateText: ev.pub_year ? String(ev.pub_year) : 'Earlier',
        label: 'Earlier English translation',
        detail: (
          <>
            {summary}
            {ev.url && embedPolicy.showExternalLinks && (
              <>{' '}<a href={ev.url} target="_blank" rel="noopener noreferrer" className="hover:underline whitespace-nowrap" style={{ color: '#a5503d' }}>View →</a></>
            )}
          </>
        ),
      });
    }
    // English editions / translations published on Source Library.
    const publishedEditions = ((book.editions as TranslationEdition[] | undefined) || [])
      .filter((e) => e.status === 'published' && e.published_at)
      .sort((a, b) => +new Date(a.published_at!) - +new Date(b.published_at!));
    publishedEditions.forEach((e, i) => {
      const my = fmtMonthYear(e.published_at!);
      if (!my) return;
      const doiHref = e.doi ? (e.doi_url || `https://doi.org/${e.doi}`) : null;
      rawTimeline.push({
        ts: +new Date(e.published_at!),
        key: `edition-${i}`,
        dateText: my,
        label: i === 0
          ? (ftClaim === 'confirmed'
            ? 'First English translation published'
            : 'English edition published')
          : 'New edition published',
        detail: (
          <>
            An AI-assisted English translation of the original, produced and published by{' '}
            <span style={{ color: '#2b2620', fontWeight: 500 }}>Source Library</span>.
            {(e.version || doiHref) && (
              <span className="block mt-1" style={{ color: '#948d80' }}>
                {e.version ? `Version ${e.version}` : null}
                {doiHref ? (
                  <>{e.version ? ' · ' : ''}<a href={doiHref} target="_blank" rel="noopener noreferrer" className="hover:underline whitespace-nowrap" style={{ color: '#a5503d' }}>DOI ↗</a></>
                ) : null}
              </span>
            )}
          </>
        ),
      });
    });
    // Digitized by the source library (Internet Archive, a partner, …) — its own
    // entry with the original scan/publication date when we captured it. This
    // predates our own "Added to Source Library" moment.
    const digitizer = book.image_source?.digitized_by || book.image_source?.contributing_library || book.image_source?.provider_name;
    const catalogMeta = (book as unknown as { catalog_metadata?: { scan_date?: string; public_date?: string } }).catalog_metadata;
    const digitizedRaw = catalogMeta?.scan_date || catalogMeta?.public_date;
    if (digitizedRaw) {
      const dd = new Date(digitizedRaw);
      const my = isNaN(dd.getTime()) ? '' : fmtMonthYear(dd);
      if (my) {
        rawTimeline.push({
          ts: +dd,
          key: 'digitized',
          dateText: my,
          label: digitizer ? `Digitized by ${digitizer}` : 'Digitized',
        });
      }
    }
    // Joined Source Library. The trimmed public processing log sits here for
    // everyone; the full cost/model-bearing log + editions tooling stay nested
    // and staff-only.
    if (book.created_at) {
      const my = fmtMonthYear(book.created_at);
      if (my) rawTimeline.push({
        ts: +new Date(book.created_at),
        key: 'added',
        dateText: my,
        label: 'Added to Source Library',
        // No digitizer sub-line here — without a digitization DATE it reads as if
        // the item was digitized on the "added" date, which is wrong. The
        // digitizer is credited in the Bibliographic panel + Pages subtitle.
        detail: undefined,
        extra: (
          <div className="space-y-3">
            <PublicBookHistory bookId={book.id} />
            <AuthCheck role="inner_circle">
              <div className="space-y-3">
                {!!book.editions?.length && <EditionsPanel bookId={book.id} editions={book.editions as TranslationEdition[]} />}
                <BookHistory bookId={book.id} />
              </div>
            </AuthCheck>
          </div>
        ),
      });
    }
    const timelineEvents: TimelineEvent[] = rawTimeline
      .sort((a, b) => a.ts - b.ts)
      .map(({ ts: _ts, ...e }) => e);

    const readingDropdowns = (
      <>
        {hasReadingGuide && (
          <AISection kind="reading-guide" className="card reveal-in">
            <details className="group sl-collapse">
              <summary className="p-4 md:p-6 cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-3 md:gap-4">
                <h3 className="font-display font-medium text-[17px] md:text-[22px]" style={{ color: '#2b2620' }}>Reading guide</h3>
                <PlusToggle />
              </summary>
              <div className="px-4 pb-4 md:px-6 md:pb-6">
                <ExpandableGuide bookId={book.id} detailedSummary={readingGuideText} defaultExpanded hideIllustrations />
              </div>
            </details>
          </AISection>
        )}
        {/* Book's own contents — only when there's a TOC scan or chapters */}
        {(!!book.chapters?.length || !!tocPage) && (
        <details id="contents" className="card group scroll-mt-24 sl-collapse reveal-in">
          <summary className="p-4 md:p-6 cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-3 md:gap-4">
            <h3 className="font-display font-medium text-[17px] md:text-[22px]" style={{ color: '#2b2620' }}>Contents</h3>
            <PlusToggle />
          </summary>
          <div className="px-4 pb-4 md:px-6 md:pb-6">
            {/* Contents — as printed (top of the section) */}
            {tocPage && (() => {
              const tocThumb = getPageImageUrl(tocPage as Parameters<typeof getPageImageUrl>[0], 'thumb');
              return (
                <Link href={`/book/${bookSlug}/page/${tocPage.id}`} className="flex items-center gap-4 border px-4 py-3 mb-5 transition-colors" style={{ borderColor: '#e6e0d3', background: '#fdfbf6' }}>
                  <div className="w-[38px] h-[48px] flex-shrink-0 overflow-hidden border" style={{ borderColor: '#d8d0bf', background: '#fff' }}>
                    {tocThumb && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={tocThumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold" style={{ color: '#2b2620' }}>Contents — as printed</div>
                    <div className="text-[12.5px]" style={{ color: '#948d80' }}>p. {tocPage.page_number}</div>
                  </div>
                  <span className="text-[13px] font-medium whitespace-nowrap" style={{ color: '#a5503d' }}>View scan →</span>
                </Link>
              );
            })()}

            {book.chapters?.length ? (
              <div className="border-t" style={{ borderColor: '#e6e0d3' }}>
                {(book.chapters as Array<{ title: string; titleEn?: string; pageNumber?: number; level?: number }>).map((ch, i) => (
                  <Link
                    key={i}
                    href={typeof ch.pageNumber === 'number' ? `/book/${bookSlug}/page-number/${ch.pageNumber}` : `/book/${bookSlug}`}
                    className="flex items-baseline justify-between gap-4 py-2 border-b transition-colors hover:bg-[#f4efe6]"
                    style={{ borderColor: '#ece6da', paddingLeft: `${(ch.level || 0) * 14}px` }}
                  >
                    <span className="font-display text-[14.5px] leading-snug" style={{ color: '#4a443b' }}>{ch.titleEn || ch.title}</span>
                    {typeof ch.pageNumber === 'number' ? <span className="font-mono text-[12px] whitespace-nowrap" style={{ color: '#a09884' }}>p. {ch.pageNumber}</span> : null}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </details>
        )}

        {/* Index — below Contents, same dropdown treatment as the others */}
        {(() => {
          const allEntries = (book as unknown as { index?: { entries?: Array<{ term: string; pages: number[]; type: 'vocab' | 'term' | 'keyword' }> } }).index?.entries;
          if (!allEntries || allEntries.length === 0) return null;
          const entries = allEntries.filter(e => e.pages.length >= 2);
          if (entries.length === 0) return null;
          return <BookIndex entries={entries} bookSlug={bookSlug} totalPages={totalPages} isEmbedded={!embedPolicy.enableBookIndexNavigation} />;
        })()}

        {/* Bibliographic information — the source's own record only. */}
        <details className="card group sl-collapse reveal-in">
          <summary className="p-4 md:p-6 cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-3 md:gap-4">
            <h3 className="font-display font-medium text-[17px] md:text-[22px]" style={{ color: '#2b2620' }}>Bibliographic information</h3>
            <PlusToggle />
          </summary>
          <div className="px-4 pb-4 md:px-6 md:pb-6">
            <BookBiblioPanel book={book} pagesCount={totalPages} showExternalLinks={embedPolicy.showExternalLinks} />
            {embedPolicy.showRelatedEditions && (book as unknown as { work_id?: string }).work_id && (
              <Suspense fallback={null}><RelatedEditions
                bookId={book.id}
                workId={(book as unknown as { work_id?: string }).work_id!}
                language={(book as unknown as { language?: string }).language}
                editionKey={(book as unknown as { edition_key?: string }).edition_key}
                editionKeyQuality={(book as unknown as { edition_key_quality?: string }).edition_key_quality}
              /></Suspense>
            )}
            {embedPolicy.showIndexCatalogStatus && (
              <Suspense fallback={null}><IndexCatalogChip bookIds={[(book as unknown as { _id?: string })._id, book.id]} authorEntityId={(book as unknown as { author_entity_id?: string }).author_entity_id ?? null} /></Suspense>
            )}
          </div>
        </details>

        {/* Book history — a single public timeline of the book's meaningful
            dates. It now subsumes the old "Editions & translations" block
            (editions + prior translations appear as timeline entries) and nests
            the staff processing log + editions tooling under "Added to Source
            Library". */}
        <div className="reveal-in"><BookTimeline events={timelineEvents} /></div>

        {/* Search this book — styled like a dropdown card but always open; the
            card grows to show results (max-height + scroll) as you type. */}
        <div className="card p-4 md:p-6 reveal-in">
          <h3 className="font-display font-medium text-[17px] md:text-[22px] mb-4" style={{ color: '#2b2620' }}>Search this book</h3>
          <SearchPanel bookId={book.id} inline theme="light" placeholder="Find a word, name, or phrase…" />
        </div>
      </>
    );

    return (
      <>
        <EmbedNavigationReporter book={book.slug || book.id} />
        <SchemaOrgMetadata book={book} pageCount={totalPages} translatedCount={translatedCount} currentEdition={currentEdition} />
        <DublinCoreMeta
          title={book.title}
          displayTitle={book.display_title}
          author={book.author}
          language={book.language}
          year={(book as unknown as { year_published?: number }).year_published}
          description={book.ai_metadata?.description as string | undefined}
          categories={book.categories}
          keywords={(book as unknown as { subject_keywords?: string[] }).subject_keywords}
          publisher={book.dublin_core?.dc_publisher || book.image_source?.provider_name}
          rights={book.dublin_core?.dc_rights}
          identifier={`https://sourcelibrary.org/book/${book.slug || book.id}`}
          source={book.image_source?.source_url}
          pageCount={totalPages}
          doi={book.doi}
          ustcSn={(book as unknown as { ustc_sn?: string }).ustc_sn}
        />

        {/* This book is showing a page-scan in place of a stored cover. Persist
            that pick once, so the catalogue / sliders / search stop rendering a
            blank placeholder for it. The route re-derives and verifies the URL
            server-side, so it is safe to fire whenever we fell back. */}
        {!coverRenderable && coverPage && <EnsureCover bookId={book.id} />}

        {/* ===================== HERO ===================== */}
        <HeroVariants
          pageThumbs={heroPageThumbs}
          /* Warmed books point straight at the cached R2 URL (fast CDN hit).
             Only un-warmed books go through the API route, which lazily
             composites + caches on first view. This skips a Vercel-function +
             Mongo + 302 hop on every load of a popular book. */
          mosaicUrl={
            (book as unknown as { hero_mosaic_url?: string; hero_mosaic_version?: number }).hero_mosaic_url &&
            (book as unknown as { hero_mosaic_version?: number }).hero_mosaic_version === HERO_MOSAIC_VERSION
              ? (book as unknown as { hero_mosaic_url?: string }).hero_mosaic_url
              : `/api/books/${book.id}/hero-mosaic`
          }
          actions={(
            /* Mobile-only: pinned to the foot of the hero (desktop keeps these
               inline in the meta below). Read sits under the text; the icon bar
               is pushed into the last 1/3 so it lines up under the cover. */
            <div className="flex items-center">
              {embedPolicy.showBookReadCta && readHref && (
                <Link href={readHref} className="inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:brightness-110" style={{ background: '#a5503d' }}>
                  <BookOpen className="w-4 h-4" />Read this book
                </Link>
              )}
              <div className="w-1/3 flex-shrink-0 ml-auto grid grid-cols-3 rounded overflow-hidden divide-x [&_svg]:!w-[15px] [&_svg]:!h-[15px] [&_button]:!p-0 [&_button]:!w-full [&_button]:!h-full [&_button]:!justify-center [&_button]:!rounded-none" style={{ border: '1px solid rgba(245,240,232,0.2)', borderColor: 'rgba(245,240,232,0.2)' }}>
                {[
                  <CiteButton key="cite" bookId={book.slug || book.id} title={book.title} displayTitle={book.display_title} author={book.author} year={book.published} publisher={book.publisher} placePublished={book.place_published} format={book.format} ustcId={book.ustc_id} language={book.language} doi={book.doi} editionVersion={currentEdition?.version} tenantSlug={tenantSlug || undefined} className="!text-stone-100" iconOnly />,
                  <DownloadButton key="dl" bookId={book.id} bookTitle={book.display_title || book.title} hasTranslations={hasTranslations} hasOcr={hasOcr} hasImages={pages.length > 0} imageRestricted={imageRestricted} imageAccess={imageAccess} variant="header" iconOnly />,
                  <LikeButton key="like" targetType="book" targetId={book.id} size="sm" showCount={false} className="!text-stone-100" />,
                ].map((el, i) => (
                  <div key={i} className="h-10 flex items-center justify-center" style={{ background: 'rgba(12,9,6,0.55)', borderColor: 'rgba(245,240,232,0.2)' }}>{el}</div>
                ))}
              </div>
            </div>
          )}
          cover={(
            /* Editors (inner_circle) get a "Change cover" affordance over the
               hero cover — opens the page picker + writes via buildCoverUpdate.
               Everyone else just sees the cover. */
            <CoverImagePicker
              bookId={book.id}
              currentThumbnail={getBookThumbnailUrl(book as Parameters<typeof getBookThumbnailUrl>[0], 'display') ?? undefined}
              currentThumbnailBlob={getBookThumbnailUrl(book as Parameters<typeof getBookThumbnailUrl>[0], 'thumb') ?? undefined}
              bookTitle={book.display_title || book.title}
              bookAuthor={book.author}
              bookYear={book.published}
              pages={pages}
              trigger={
                <div className="flex flex-col items-center md:items-start">
                  {coverDisplay ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={coverDisplay}
                      alt={book.display_title || book.title}
                      className="block w-full h-auto max-h-[420px] md:w-auto md:h-[500px] md:max-h-none md:max-w-[min(46vw,560px)] object-contain object-left"
                      style={{ filter: 'drop-shadow(0 34px 48px rgba(0,0,0,0.62))' }}
                    />
                  ) : (
                    <div className="w-full md:w-[300px] aspect-[3/4] flex items-center justify-center text-center text-sm px-4" style={{ background: '#f6f3ea', border: '1px solid #d3ccbc', color: '#7a7365' }}>
                      {book.display_title || book.title}
                    </div>
                  )}
                </div>
              }
            />
          )}
          meta={(
            <div className="min-w-0" style={{ color: '#f7f2ea' }}>
              {(heroByline.role === 'author' || heroByline.role === 'editor') && (
                <div className="uppercase text-[10.5px] md:text-[13px] tracking-[0.1em] font-medium mb-1.5 md:mb-2" style={{ color: '#d98a72' }}>
                  {embedPolicy.enableBookCollectionNavigation && authorUrl(book.author) ? (
                    <Link href={authorUrl(book.author)!} className="hover:opacity-80 transition-opacity">
                      {heroByline.role === 'editor' ? <>edited by <AuthorName author={heroByline.editor} /></> : <AuthorName author={book.author} />}
                    </Link>
                  ) : (heroByline.role === 'editor' ? <>edited by <AuthorName author={heroByline.editor} /></> : <AuthorName author={book.author} />)}
                </div>
              )}
              <h1 className="font-display font-medium text-lg sm:text-2xl md:text-[52px] leading-[1.14] md:leading-[1.04] tracking-[-0.01em] mb-3 md:mb-4 break-words" style={{ color: '#f7f2ea' }}>
                {book.display_title || book.title}
              </h1>
              {book.display_title && book.title !== book.display_title && (() => {
                const original = cleanOriginalTitle(book.title);
                if (!original) return null;
                const latin = !isNonLatinScript(original);
                return (
                  <div className={`text-[12px] md:text-[15px] mb-1 md:mb-1 leading-snug ${latin ? 'italic' : ''}`} style={{ color: 'rgba(248,244,238,0.85)' }}>{original}</div>
                );
              })()}
              {heroMetaLine && <div className="text-[11.5px] md:text-[15px]" style={{ color: 'rgba(245,240,232,0.82)' }}>{heroMetaLine}</div>}

              {/* Chips — borderless / padless inline items */}
              {(() => {
                const chip = "inline-flex items-center gap-1.5 text-[10.5px] md:text-[13.5px]";
                const chipIcon = "inline-block w-3.5 h-3.5 md:w-4 md:h-4 opacity-70";
                return (
                  <div className="flex flex-wrap gap-x-3 md:gap-x-4 gap-y-1 md:gap-y-1.5 mt-3 md:mt-4">
                    {heroDate && (
                      <span className={chip} style={{ color: 'rgba(245,240,232,0.92)' }} title={`${heroDate.label} ${heroDate.value}`}>
                        <Calendar className={chipIcon} /><span style={{ opacity: 0.72 }}>{heroDate.label}</span>&nbsp;{heroDate.value}
                      </span>
                    )}
                    {book.language && (
                      <span className={chip} style={{ color: 'rgba(245,240,232,0.88)' }}>
                        <Globe className={chipIcon} />{book.language}
                      </span>
                    )}
                    <span className={chip} style={{ color: 'rgba(245,240,232,0.88)' }} title="Scanned images, including covers and blanks.">
                      <FileText className={chipIcon} />{totalPages} scans
                    </span>
                    {imageCount > 0 && (
                      <Link href={`/gallery?bookId=${book.id}`} className={`${chip} transition-colors hover:opacity-80`} style={{ color: 'rgba(245,240,232,0.88)' }}>
                        <Images className={chipIcon} />{imageCount} image{imageCount === 1 ? '' : 's'}
                      </Link>
                    )}
                  </div>
                );
              })()}
              {/* OCR / Translated status — coloured, with the tick/percentage to
                  the left of the label. "First translation" reads as plain text
                  to the right of Translated (full history lives in Editions &
                  translations). */}
              {/* Untranscribed books say so. This row used to render only when
                  ocrPct > 0, so the 704 visible books with NO OCR showed no
                  status at all — and a missing badge reads as "nothing wrong",
                  not "no text here". The reader then clicked "Read this book"
                  into a pane that had nothing to show. */}
              {ocrPct === 0 && (
                <div className="flex flex-wrap items-center gap-x-3 md:gap-x-4 gap-y-1 mt-3 md:mt-4 text-[10.5px] md:text-[13.5px] font-medium">
                  <span title={`${totalPages} scans available; no pages transcribed yet`} style={{ color: 'rgba(245,240,232,0.55)' }}>
                    Scans only — not transcribed yet
                  </span>
                </div>
              )}
              {ocrPct > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 md:gap-x-4 gap-y-1 mt-3 md:mt-4 text-[10.5px] md:text-[13.5px] font-medium">
                  <span title={`${ocrCount} of ${totalPages} pages transcribed`} style={{ color: '#8fbfe6' }}>
                    {ocrPct >= 100 ? '✓' : `${ocrPct}%`} OCR
                  </span>
                  {translatedPct > 0 && (
                    <span title={`${translatedCount} pages translated to English`} style={{ color: '#86c98f' }}>
                      {translatedPct >= 100 ? '✓' : `${translatedPct}%`} Translated
                    </span>
                  )}
                  {!!book.is_first_translation && translatedCount > 0 && ftClause && (
                    <span
                      title={
                        ftClaim === 'confirmed'
                          ? 'First translation into English'
                          : 'We searched the catalogues and found no earlier English translation — a record of the search, not proof none exists'
                      }
                      style={{ color: ftClaim === 'confirmed' ? '#e0b46a' : '#948d80' }}
                    >
                      {ftClaim === 'confirmed' ? 'First translation' : 'No prior translation found'}
                    </span>
                  )}
                </div>
              )}

              {/* Actions — desktop only (mobile shows them pinned to the hero
                  foot via the `actions` prop). */}
              <div className="hidden md:flex flex-wrap items-center gap-2.5 mt-6">
                {embedPolicy.showBookReadCta && readHref && (
                  <Link href={readHref} className="inline-flex items-center gap-2.5 px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:brightness-110" style={{ background: '#a5503d' }}>
                    <BookOpen className="w-[18px] h-[18px]" />Read this book
                  </Link>
                )}
                <div className="hidden md:flex flex-wrap items-center gap-1 px-1.5 py-1" style={{ background: 'rgba(12,9,6,0.82)', border: '1px solid rgba(245,240,232,0.16)' }}>
                  <AuthCheck role="admin">
                    {isComplete ? (
                      <PublishEditionButton bookId={book.id} bookTitle={book.display_title || book.title} translatedCount={translatedCount} totalPages={pages.length} currentEdition={currentEdition} />
                    ) : (
                      <span className="flex items-center gap-1.5 px-3 py-1.5 cursor-not-allowed text-[13px]" style={{ color: 'rgba(245,240,232,0.4)' }} title="Complete OCR, translation & summary first"><BookMarked className="w-4 h-4" />Publish</span>
                    )}
                  </AuthCheck>
                  <CiteButton bookId={book.slug || book.id} title={book.title} displayTitle={book.display_title} author={book.author} year={book.published} publisher={book.publisher} placePublished={book.place_published} format={book.format} ustcId={book.ustc_id} language={book.language} doi={book.doi} editionVersion={currentEdition?.version} tenantSlug={tenantSlug || undefined} className="!text-stone-100 hover:!text-white hover:!bg-white/15" />
                  <DownloadButton bookId={book.id} bookTitle={book.display_title || book.title} hasTranslations={hasTranslations} hasOcr={hasOcr} hasImages={pages.length > 0} imageRestricted={imageRestricted} imageAccess={imageAccess} variant="header" />
                  <BookShare bookId={book.slug || book.id} title={book.display_title || book.title} author={book.author || ''} year={book.published} doi={book.doi} tenantSlug={tenantSlug || undefined} className="!text-stone-100 hover:!text-white hover:!bg-white/15" />
                  <span className="w-px h-5 mx-1" style={{ background: 'rgba(245,240,232,0.18)' }} />
                  <div className="flex items-center gap-2.5 px-2 py-1.5">
                    <BookAnalytics bookId={book.id} className="!text-stone-200" />
                    <LikeButton targetType="book" targetId={book.id} size="sm" showCount={true} className="!text-stone-200" />
                  </div>
                </div>
              </div>

              {/* NOTE: the old staff-only "✎ Edit" link here pointed at
                  /book/[id]/edit, which doesn't exist (dead 404), and popping in
                  after the auth check re-centered the vertically-centred hero —
                  the cover/title "jump". Removed. Editing is via the "Edit"
                  button in the Bibliographic information panel (BookEditModal). */}
            </div>
          )}
        />

        {/* ===================== ABOUT · READING GUIDE · CONTENTS ===================== */}
        {/* Always render the two-column About section: prose (when present) + the
            dropdowns on the left, an interesting non-cover plate on the right. */}
        <div className="reveal-in">
          <AboutVariants
            content={hasSummary ? linkEntities(summaryText!, summaryEntities) : null}
            visual={sideVisual}
            tags={hasSummary ? subjectTags : []}
            belowContent={readingDropdowns}
            bookId={book.id}
            bookSlug={bookSlug}
            pages={pages}
            plates={galleryImages.map(p => ({ id: p.id, thumbnail_url: p.thumbnail_url, extracted_url: p.extracted_url, image_url: p.image_url, description: p.description }))}
          />
        </div>

        {/* ===================== PAGES ===================== */}
        <section id="pages" style={{ background: 'linear-gradient(180deg, #fdfcf9 0%, #f8f2ea 100%)' }} className="pt-14 pb-16 scroll-mt-4">
          <main className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12 reveal-in">
            {(() => {
              const digitizer = book.image_source?.digitized_by || book.image_source?.contributing_library || book.image_source?.provider_name;
              const pagesSubtitle = digitizer
                ? `Every page scanned from the original, digitized by ${digitizer}.`
                : 'Every page of the original scan, in reading order.';
              const pagesEl = <BookPagesSection bookId={book.id} bookTitle={book.display_title || book.title} pages={pages} totalPageCount={totalPages} displayBrightness={(book as unknown as { display_brightness?: number }).display_brightness} overviewHref={embedPolicy.showBookOverviewLink ? `/book/${bookSlug}/overview` : undefined} subtitle={pagesSubtitle} />;
              const membersOnlyUntil = (book as unknown as { members_only_until?: string }).members_only_until;
              if (membersOnlyUntil && new Date(membersOnlyUntil) > new Date()) {
                return <EarlyAccessGate membersOnlyUntil={membersOnlyUntil}>{pagesEl}</EarlyAccessGate>;
              }
              return pagesEl;
            })()}
          </main>
        </section>

        {/* ===================== ILLUSTRATIONS (masonry) ===================== */}
        {galleryPlates.length > 0 && (
          <section id="illustrations" style={{ background: 'linear-gradient(180deg, #fdfcf9 0%, #f8f2ea 100%)' }} className="border-t border-[#e6e0d3] py-14 scroll-mt-4">
            <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12 reveal-in">
              <h2 className="font-display font-medium text-2xl md:text-[28px] mb-1" style={{ color: '#2b2620' }}>Illustrations</h2>
              <p className="text-sm md:text-[15px] mb-6" style={{ color: '#8a8170' }}>Plates, diagrams, and figures detected in the scanned pages.</p>
              <GalleryMasonry plates={galleryPlates} />
              {imageCount > galleryPlates.length && (
                <div className="mt-8 text-center">
                  <Link href={`/gallery?bookId=${book.id}`} className="inline-flex items-center gap-2 px-6 py-2.5 bg-stone-900 text-white rounded-lg hover:bg-stone-800 transition-colors text-sm font-medium">
                    <Images className="w-4 h-4" />
                    View all {imageCount} illustrations
                  </Link>
                </div>
              )}
            </div>
          </section>
        )}


        {/* ===================== PART OF THE COLLECTION (library/source) ===================== */}
        {librarySection && <div className="reveal-in"><BookLibrarySection data={librarySection} /></div>}

        {/* ===================== RELATED BOOKS ===================== */}
        {hasRelated && (
          <section id="related" style={{ background: 'linear-gradient(180deg, #fdfcf9 0%, #f8f2ea 100%)' }} className="py-14 border-t border-[#e6e0d3] scroll-mt-4">
            <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12 reveal-in">
              <h2 className="font-display font-medium text-2xl md:text-[28px] mb-1" style={{ color: '#2b2620' }}>Related books</h2>
              <p className="text-sm md:text-[15px] mb-5" style={{ color: '#8a8170' }}>Other volumes close to this one by author, subject, place, and period.</p>
              <BookSlider books={tagRelated as unknown as MiniBook[]} />
            </div>
          </section>
        )}
      </>
    );
  }

  return (
    <>
      <EmbedNavigationReporter book={book.slug || book.id} />
      {/* Schema.org JSON-LD for Google Scholar */}
      <SchemaOrgMetadata
        book={book}
        pageCount={totalPages}
        translatedCount={translatedCount}
        currentEdition={currentEdition}
      />
      {/* Dublin Core meta tags for library crawlers */}
      <DublinCoreMeta
        title={book.title}
        displayTitle={book.display_title}
        author={book.author}
        language={book.language}
        year={(book as unknown as { year_published?: number }).year_published}
        description={book.ai_metadata?.description as string | undefined}
        categories={book.categories}
        keywords={(book as unknown as { subject_keywords?: string[] }).subject_keywords}
        publisher={book.dublin_core?.dc_publisher || book.image_source?.provider_name}
        rights={book.dublin_core?.dc_rights}
        identifier={`https://sourcelibrary.org/book/${book.slug || book.id}`}
        source={book.image_source?.source_url}
        pageCount={totalPages}
        doi={book.doi}
        ustcSn={(book as unknown as { ustc_sn?: string }).ustc_sn}
      />

      {/* Cross-book citation_reference meta tags + related books stream in separately */}

      {/* Book Info */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <div className="flex flex-col sm:flex-row sm:items-start gap-6 sm:gap-8">
            {/* Thumbnail - clickable to change */}
            <div className="flex-shrink-0 flex justify-center sm:justify-start">
              <CoverImagePicker
                bookId={book.id}
                currentThumbnail={getBookThumbnailUrl(book as Parameters<typeof getBookThumbnailUrl>[0], 'display') ?? undefined}
                currentThumbnailBlob={getBookThumbnailUrl(book as Parameters<typeof getBookThumbnailUrl>[0], 'thumb') ?? undefined}
                bookTitle={book.display_title || book.title}
                bookAuthor={book.author}
                bookYear={book.published}
                pages={pages}
              />
            </div>

            {/* Details */}
            <div className="flex-1 text-center sm:text-left">
              {/* Bibliographic citation order (Paul Dijstelberge, BPH feedback):
                  author leads, then title, then impressum. The h1 stays on
                  title for SEO and visual hierarchy; author renders as the
                  eyebrow above it. See src/lib/byline.ts for "Unknown" rules. */}
              {(() => {
                const heroByline = getEffectiveByline(book);
                return (
                  <p className="text-base sm:text-lg text-stone-300 mb-1">
                    {heroByline.role === 'author' ? (
                      embedPolicy.enableBookCollectionNavigation && authorUrl(book.author) ? (
                        <Link href={authorUrl(book.author)!} className="hover:text-white transition-colors">
                          <AuthorName author={book.author} />
                        </Link>
                      ) : <AuthorName author={book.author} />
                    ) : heroByline.role === 'editor' ? (
                      <span>edited by <AuthorName author={heroByline.editor} /></span>
                    ) : <AuthorName author={book.author} />}
                    {heroByline.role === 'author' && heroByline.editor && (
                      <span className="text-stone-400 text-sm"> · edited by <AuthorName author={heroByline.editor} /></span>
                    )}
                  </p>
                );
              })()}
              {authorEntity && (
                <AuthorAuthority entity={authorEntity} />
              )}
              <h1 className="text-2xl sm:text-3xl font-serif font-bold break-words">{book.display_title || book.title}</h1>
              {book.display_title && book.title !== book.display_title && (
                <p className="text-stone-400 mt-1 italic text-sm sm:text-base">{book.title}</p>
              )}
              {/* Impressum: "Place: Publisher, Year" — same library-card
                  format as BphCatalogBrowser.formatImpressum so the book page
                  and catalogue rows line up. */}
              {(() => {
                const place = book.place_published?.trim();
                const publisher = book.publisher?.trim();
                const year = book.published ? String(book.published).trim() : '';
                const placePub = [place, publisher].filter(Boolean).join(': ');
                const impressum = [placePub, year].filter(Boolean).join(', ');
                if (!impressum) return null;
                return (
                  <p className="text-stone-300 mt-2 text-sm sm:text-base">{impressum}</p>
                );
              })()}

              {/* DOI badge */}
              {book.doi && (
                <a
                  href={`https://doi.org/${book.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 bg-white/10 hover:bg-white/20 text-stone-200 rounded-full text-xs font-mono transition-colors"
                >
                  DOI: {book.doi}
                </a>
              )}

              {/* Book metadata */}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 sm:gap-6 mt-4 sm:mt-6 text-sm text-stone-400">
                {book.language && (
                  <div className="flex items-center gap-2" data-testid="language-metadata">
                    <Globe className="w-4 h-4" />
                    {book.language}
                  </div>
                )}
                {(book as unknown as { subject_keywords?: string[] }).subject_keywords && (book as unknown as { subject_keywords?: string[] }).subject_keywords!.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(book as unknown as { subject_keywords?: string[] }).subject_keywords!.slice(0, 5).map((tag: string) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 text-xs bg-stone-700/50 text-stone-300 rounded-full"
                        title={tag}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {/* Calendar chip carries composition / translation dates that
                    enrich the plain print year shown in the impressum line above.
                    Skip the chip when there's no source_work_dates to add — the
                    print year alone is already in the impressum. */}
                {book.source_work_dates?.length ? (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    <span>
                      {book.source_work_dates.find(l => l.type === 'composition')
                        ? `${book.source_work_dates.find(l => l.type === 'composition')!.author || ''} ${book.source_work_dates.find(l => l.type === 'composition')!.date_display}`.trim()
                        : ''}
                      {book.source_work_dates.find(l => l.type === 'composition') && book.published
                        ? <span className="text-stone-500"> · published {book.published}</span>
                        : ''}
                      {!book.source_work_dates.find(l => l.type === 'composition') && book.source_work_dates.find(l => l.type === 'translation')
                        ? `${book.source_work_dates.find(l => l.type === 'translation')!.author || ''} trans. ${book.source_work_dates.find(l => l.type === 'translation')!.date_display}`.trim()
                        : ''}
                    </span>
                  </div>
                ) : null}
                {/* "scans" rather than "pages": the count is of scanned
                    images (IIIF canvases — covers, blanks, endpapers
                    included). Bibliographic pagination ("[8] 240 [12] pp.")
                    will live in a separate field once curators capture it
                    per book. Paul Dijstelberge (BPH) flagged this — none
                    of the displayed page counts matched the real book. */}
                <div
                  className="flex items-center gap-2"
                  title="Scanned images, including covers and blanks. Bibliographic pagination may differ."
                >
                  <FileText className="w-4 h-4" />
                  {totalPages} scans
                </div>
                {imageCount > 0 && (
                  <Link
                    href={`/gallery?bookId=${book.id}`}
                    className="flex items-center gap-2 text-accent-gold hover:text-accent-gold transition-colors"
                    title="View identified images in gallery"
                  >
                    <Images className="w-4 h-4" />
                    {imageCount} images
                  </Link>
                )}
              </div>

              {/* The Translation Card (#3881): when this book's work has a
                  clean, reviewed card, the card IS the first-translation
                  surface — one sentence + cited entries. One decision point:
                  card renders → legacy panel does not (no side-by-side
                  contradiction). No card / unclean card → exactly the legacy
                  render this page had before. */}
              {translationCard && cardLabel(translationCard, book as { pages_translated?: number | null }) ? (
                <TranslationCardPanel
                  card={translationCard}
                  book={book as { pages_translated?: number | null }}
                  showExternalLinks={embedPolicy.showExternalLinks}
                />
              ) : (
                /* #2564/#2639: graded verdict + grounded evidence, with legacy fallback.
                    Renders the "First Translation" or "Existing translations" badge,
                    or null when neither applies. */
                <FirstTranslationEvidence
                  book={book as never}
                  showExternalLinks={embedPolicy.showExternalLinks}
                />
              )}

              {/* Dedication */}
              <div className="mt-3">
                <BookDedication bookId={book.id} dedication={(book as any).dedication || null} />
              </div>

              {/* Historical-translation notice — never let an old English
                  translation silently present as the source (#2395). Cross-link
                  to the held original is tenant-gated like RelatedEditions. */}
              {['modern-translation', 'period-translation'].includes((book as any).text_role) && (
                <Suspense fallback={null}>
                  <OriginalEditionNotice
                    textRole={(book as any).text_role}
                    originalEditionId={(book as any).original_edition_id ?? null}
                    originalInScan={(book as any).original_in_scan ?? false}
                    originalLanguage={(book as any).original_language ?? null}
                    year={Number((book as any).year || book.published) || null}
                    showCrossLink={embedPolicy.showRelatedEditions}
                  />
                </Suspense>
              )}

              {/* Sibling-edition routing (#3033) — an effectively-untranslated
                  edition of a work we hold translated should point the reader
                  at the translated sibling, not read as a dead end. Skipped for
                  books that are themselves English translations (they're
                  already readable). Tenant-gated like RelatedEditions. */}
              {embedPolicy.showRelatedEditions &&
                (book as any).work_id &&
                totalPages > 0 &&
                translatedCount / totalPages < 0.05 &&
                !['modern-translation', 'period-translation'].includes((book as any).text_role) && (
                  <Suspense fallback={null}>
                    <TranslatedSiblingNotice
                      bookId={book.id}
                      workId={(book as any).work_id}
                      showCrossLink={embedPolicy.showRelatedEditions}
                    />
                  </Suspense>
                )}

              {/* Read This Book — first chapter > endpaper-skip fallback */}
              {embedPolicy.showBookReadCta && (() => {
                if (pages.length === 0) return null;
                const bookSlug = book.slug || book.id;
                // Prefer the first chapter's starting page. Route through the
                // resilient page-number redirect (/page-number/<n>) rather than a
                // stored pageId: ~716 books have a stale chapters[0].pageId (pages
                // were re-imported/re-IDed) and a stale pageId 404s. The
                // page-number route resolves to the nearest current page
                // (see src/lib/page-number-resolve.ts), so the CTA always lands.
                const firstChapterPageNumber = book.chapters?.length
                  ? (book.chapters as { pageNumber?: number }[])[0]?.pageNumber
                  : null;
                if (typeof firstChapterPageNumber === 'number') {
                  return (
                    <div className="mt-5">
                      <Link
                        href={`/book/${bookSlug}/page-number/${firstChapterPageNumber}`}
                        className="inline-flex items-center gap-2.5 px-6 py-3 bg-accent-rust hover:bg-accent-rust/90 text-white font-medium rounded-lg transition-colors text-base"
                      >
                        <BookOpen className="w-5 h-5" />
                        Read this book
                      </Link>
                    </div>
                  );
                }
                // No chapters: skip endpapers (2-4 blank pages before title page).
                const skipTo = totalPages >= 20 ? 4 : totalPages >= 10 ? 2 : 0;
                const readPage = pages[skipTo] || pages[0];
                return (
                  <div className="mt-5">
                    <Link
                      href={`/book/${bookSlug}/page/${readPage.id}`}
                      className="inline-flex items-center gap-2.5 px-6 py-3 bg-accent-rust hover:bg-accent-rust/90 text-white font-medium rounded-lg transition-colors text-base"
                    >
                      <BookOpen className="w-5 h-5" />
                      Read this book
                    </Link>
                  </div>
                );
              })()}

              {/* Actions */}
              <div className="flex flex-col items-center sm:items-start gap-3 mt-5 text-sm">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                  {/* Publish — admin only */}
                  <AuthCheck role="admin">
                    {isComplete ? (
                      <PublishEditionButton
                        bookId={book.id}
                        bookTitle={book.display_title || book.title}
                        translatedCount={translatedCount}
                        totalPages={pages.length}
                        currentEdition={currentEdition}
                      />
                    ) : (
                      <span className="flex items-center gap-1.5 px-3 py-1.5 text-stone-500 cursor-not-allowed" title="Complete OCR, translation & summary first">
                        <BookMarked className="w-4 h-4" />
                        <span className="opacity-60">Publish</span>
                      </span>
                    )}
                  </AuthCheck>

                  {/* Utility actions */}
                  <div className="flex items-center gap-1 rounded-lg bg-white/5 px-1 py-0.5">
                    <CiteButton
                      bookId={book.slug || book.id}
                      title={book.title}
                      displayTitle={book.display_title}
                      author={book.author}
                      year={book.published}
                      publisher={book.publisher}
                      placePublished={book.place_published}
                      format={book.format}
                      ustcId={book.ustc_id}
                      language={book.language}
                      doi={book.doi}
                      editionVersion={currentEdition?.version}
                      tenantSlug={tenantSlug || undefined}
                      className="text-stone-300 hover:text-white hover:bg-white/10"
                    />
                    <DownloadButton
                      bookId={book.id}
                      bookTitle={book.display_title || book.title}
                      hasTranslations={hasTranslations}
                      hasOcr={hasOcr}
                      hasImages={pages.length > 0}
                      imageRestricted={imageRestricted}
                      imageAccess={imageAccess}
                      variant="header"
                    />
                    <BookShare
                      bookId={book.slug || book.id}
                      title={book.display_title || book.title}
                      author={book.author || ''}
                      year={book.published}
                      doi={book.doi}
                      tenantSlug={tenantSlug || undefined}
                      className="text-stone-300 hover:text-white hover:bg-white/10"
                    />
                    <span className="hidden sm:block w-px h-5 bg-white/10 mx-1" />
                    <div className="flex items-center gap-2.5 px-2 py-1.5">
                      <BookAnalytics bookId={book.id} className="text-stone-300" />
                      <LikeButton
                        targetType="book"
                        targetId={book.id}
                        size="sm"
                        showCount={true}
                        className="text-stone-300"
                      />
                    </div>
                  </div>
                </div>

                {/* Search — separate line */}
                <SearchPanel bookId={book.id} />
              </div>

              {/* Bibliographic Info (includes related editions, attribution) */}
              <BibliographicInfo
                book={book}
                pagesCount={totalPages}
                hasTranslations={translatedCount > 0}
                showTranslationMethodologyLink={embedPolicy.showTranslationMethodologyLink}
                showExternalLinks={embedPolicy.showExternalLinks}
              >
                {embedPolicy.showRelatedEditions && (book as unknown as { work_id?: string }).work_id && (
                  <Suspense fallback={null}>
                    <RelatedEditions
                      bookId={book.id}
                      workId={(book as unknown as { work_id?: string }).work_id!}
                      language={(book as unknown as { language?: string }).language}
                      editionKey={(book as unknown as { edition_key?: string }).edition_key}
                      editionKeyQuality={(book as unknown as { edition_key_quality?: string }).edition_key_quality}
                    />
                  </Suspense>
                )}
                {embedPolicy.showIndexCatalogStatus && (
                  <Suspense fallback={null}>
                    <IndexCatalogChip
                      bookIds={[(book as unknown as { _id?: string })._id, book.id]}
                      authorEntityId={(book as unknown as { author_entity_id?: string }).author_entity_id ?? null}
                    />
                  </Suspense>
                )}
              </BibliographicInfo>

              {/* BPH catalogue record — side-loaded from Supabase bph_works when
                  this book has a catalogue key. Two key formats:
                  - Printed books: numeric UBN in dublin_core.dc_identifier
                  - Allard Pierson IIIF manuscripts: PH-shelfmark in
                    image_source.shelfmark (e.g. "PH441") — backfilled into
                    bph_works.ubn by scripts/backfill-bph-allard-pierson.mjs */}
              {(() => {
                const dc = (book as { dublin_core?: { dc_identifier?: unknown } }).dublin_core?.dc_identifier;
                const numericUbn = typeof dc === 'string' && /^\d+$/.test(dc)
                  ? dc
                  : Array.isArray(dc) ? dc.find((v): v is string => typeof v === 'string' && /^\d+$/.test(v)) : null;
                const apShelfmark = (book as { image_source?: { shelfmark?: unknown } }).image_source?.shelfmark;
                const apKey = typeof apShelfmark === 'string' && /^PH/.test(apShelfmark.trim()) ? apShelfmark.trim() : null;
                const ubn = numericUbn || apKey;
                if (!ubn) return null;
                return (
                  <Suspense fallback={null}>
                    <BphCatalogueRecord ubn={ubn} />
                  </Suspense>
                );
              })()}

              {/* Cross-reference: artworks by this author (pre-computed).
                  Hidden in embed mode — the pre-computed data is not tenant-filtered,
                  so it can include artworks/books from other tenants. */}
              {embedPolicy.showAuthorCrossReference && (book as any).author_cross_ref && (
                <AuthorCrossReference
                  author={book.author}
                  crossRef={(book as any).author_cross_ref}
                  context="book"
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Clean break between dark header and light content */}
      <div className="h-px bg-stone-200" />

      {/* Book Summary */}
      {(() => {
        return (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {/* The whole "About This Book" card is hidden when the visitor
                has scholar mode on (see EmbedUserMenu). Categories are
                AI-assigned, the prose is generated, and the empty states
                are meta-commentary about the AI pipeline — none of it
                belongs on a stripped-down bibliographic page. */}
            <AISection className="card p-6">
              <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>About This Book</h2>
              {showProposedBanner && (
                <div className="mb-4 text-xs font-medium rounded px-3 py-2" style={{ background: 'rgba(63,185,80,0.12)', color: '#3fb950', border: '1px solid rgba(63,185,80,0.35)' }}>
                  Previewing the proposed summary (not yet live). Remove <code>?summary=proposed</code> from the URL to see the current version.
                </div>
              )}

              {hasSummary ? (
                <>
                  <div className="prose-content max-w-none">
                    {summaryText!.split('\n\n').map((paragraph: string, i: number) => (
                      <p key={i} className="mb-4 last:mb-0">
                        {linkEntities(paragraph, summaryEntities)}
                      </p>
                    ))}
                  </div>
                  {hasTranslations && (
                    <AISection kind="reading-guide">
                      <ExpandableGuide bookId={book.id} detailedSummary={bookSummaryObj?.detailed || bookSummaryObj?.abstract} />
                    </AISection>
                  )}
                </>
              ) : hasTranslations ? (
                <p className="text-stone-500 text-sm">
                  No summary yet.{' '}
                  <FeedbackWidget
                    className="text-accent-rust hover:text-accent-gold-dark transition-colors underline underline-offset-2"
                    label="Request one"
                    initialMessage={`I'd like a summary generated for: ${book.display_title || book.title}`}
                  />
                </p>
              ) : (
                <p className="text-stone-500 text-sm">
                  No translation yet.{' '}
                  <FeedbackWidget
                    className="text-accent-rust hover:text-accent-gold-dark transition-colors underline underline-offset-2"
                    label="Request one"
                    initialMessage={`I'd like this book translated: ${book.display_title || book.title}`}
                  />
                </p>
              )}
            </AISection>

            {/* Chapters & Sections */}
            {book.chapters?.length ? (
              <ChaptersDropdown
                chapters={book.chapters as { title: string; titleEn?: string; pageNumber: number; level: number }[]}
                bookSlug={book.slug || book.id}
              />
            ) : null}

            {/* Editions Panel */}
            {book.editions?.length ? (
              <EditionsPanel
                bookId={book.id}
                editions={book.editions as TranslationEdition[]}
              />
            ) : null}

            {/* Index — tiered with filter */}
            {(() => {
              const allEntries = (book as unknown as { index?: { entries?: Array<{ term: string; pages: number[]; type: 'vocab' | 'term' | 'keyword' }> } }).index?.entries;
              if (!allEntries || allEntries.length === 0) return null;

              // Drop hapax (single-mention) entries server-side to keep serialization small
              const entries = allEntries.filter(e => e.pages.length >= 2);
              if (entries.length === 0) return null;

              return (
                <BookIndex
                  entries={entries}
                  bookSlug={book.slug || book.id}
                  totalPages={pages.length}
                  isEmbedded={!embedPolicy.enableBookIndexNavigation}
                />
              );
            })()}

            {/* Gallery Images Preview — per-book strip is safe in embed mode
                (every row is filtered by book_id, so tenant books only surface
                their own images). The cross-book tenant-home gallery on
                SharedLibraryView still respects showGalleryImages. */}
            {galleryImages.length > 0 && (
              <div className="card p-6 mt-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Illustrations
                    <span className="text-sm font-normal text-stone-400 ml-2">{imageCount}</span>
                  </h2>
                  <Link
                    href={`/gallery?bookId=${book.id}`}
                    className="text-sm text-accent-rust hover:text-accent-gold-dark transition-colors"
                  >
                    View All &rarr;
                  </Link>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
                  {galleryImages.map((img) => {
                    const src = img.extracted_url || img.thumbnail_url || img.image_url;
                    if (!src) return null;
                    const pageId = img.id.match(/^(.+)[:\-]\d+$/)?.[1];
                    const href = pageId
                      ? `/book/${book.slug || book.id}/page/${pageId}`
                      : `/gallery/image/${img.id}`;
                    return (
                      <Link
                        key={img.id}
                        href={href}
                        className="flex-shrink-0 group"
                      >
                        <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-lg overflow-hidden bg-stone-100 border border-stone-200 group-hover:border-accent-rust/40 transition-colors">
                          <img
                            src={src}
                            alt={img.description || 'Illustration'}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                        </div>
                        {img.type && (
                          <p className="text-[10px] text-stone-400 mt-1 text-center truncate w-28 sm:w-36">{img.type}</p>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Collections — removed pending redesign; see #1910 */}

            {/* Related Books — pre-computed, zero extra queries */}
            {embedPolicy.showBookRelatedBooks && book.related_books && (book.related_books.direct?.length > 0 || book.related_books.shared?.length > 0) && (
              <RelatedBooks relatedBooks={book.related_books} />
            )}
          </div>
        );
      })()}

      {/* Stats + Pages Grid */}
      <main className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-6">
        {/* Overview link — Pages heading is rendered by PagesGrid.
            Hidden in embed mode: it points at the tenant-agnostic
            /book/<slug>/overview route, which has no /embed/<tenant>/...
            counterpart. Following it from a partner iframe would navigate
            the frame to the global site and hit X-Frame-Options: DENY. */}
        {pages.length > 0 && embedPolicy.showBookOverviewLink && (
          <div className="flex items-center justify-end">
            <Link
              href={`/book/${book.slug || book.id}/overview`}
              className="text-sm text-stone-400 hover:text-accent-gold transition-colors flex items-center gap-1.5"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="opacity-70">
                <rect x="1" y="1" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
                <rect x="8" y="1" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
                <rect x="1" y="8" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
                <rect x="8" y="8" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              Overview
            </Link>
          </div>
        )}
        {(() => {
          const membersOnlyUntil = (book as unknown as { members_only_until?: string }).members_only_until;
          if (membersOnlyUntil && new Date(membersOnlyUntil) > new Date()) {
            return (
              <EarlyAccessGate membersOnlyUntil={membersOnlyUntil}>
                <BookPagesSection bookId={book.id} bookPath={book.slug || book.id} bookTitle={book.display_title || book.title} pages={pages} totalPageCount={book.pages_count || pages.length} displayBrightness={(book as unknown as { display_brightness?: number }).display_brightness} />
              </EarlyAccessGate>
            );
          }
          return <BookPagesSection bookId={book.id} bookPath={book.slug || book.id} bookTitle={book.display_title || book.title} pages={pages} totalPageCount={book.pages_count || pages.length} displayBrightness={(book as unknown as { display_brightness?: number }).display_brightness} />;
        })()}
        <AuthCheck role="inner_circle">
          <BookHistory bookId={book.id} />
        </AuthCheck>
      </main>
    </>
  );
}

export default async function BookDetailPage({ params, tenantContext, previewProposed = false, allowHidden = false }: PageProps) {
  const { id } = await params;
  const ctx = tenantContext ?? null;
  const embedPolicy = getEmbedUiPolicy(ctx);
  const isEmbedded = ctx?.isEmbedded ?? false;
  const tenantId = ctx?.id ?? undefined;
  const tenantSlug = ctx?.slug ?? '';

  // Existence + tenant-match check BEFORE streaming. notFound() called from
  // inside the Suspense boundary below renders the not-found UI but leaves the
  // response status at 200 because headers were already flushed. Doing the
  // check up here lets Next.js return a real 404 status. Both calls go through
  // getCachedBookLookup so this is "free" — the streaming child reuses the
  // cached result.
  //
  // Distinguish "book doesn't exist" (null → notFound()) from "fetch failed"
  // (throw → bubble to error.tsx, status 500, friendly retry UI). The earlier
  // .catch(() => null) lumped both into 404, which logged transient Atlas
  // blips as permanent not_found_reports. getBookForMetadata already retries
  // once internally on transient errors.
  const earlyBook = await getBookForMetadata(id, tenantId, tenantSlug);
  if (!earlyBook) {
    notFound();
  }

  // Hidden books (visible:false) 404 on the public route. allowHidden is set
  // only by the dynamic, editor-gated /book/[id]/preview route. Gating here
  // (not on a session check) keeps the public route statically cacheable.
  if (isHiddenBook(earlyBook) && !allowHidden) {
    notFound();
  }

  return (
    <div className={isEmbedded ? "" : "min-h-screen bg-cream"}>
      {!isEmbedded && <ConditionalSiteHeader variant="dark" />}

      {/* Tenant reading rooms (EFM/BPH iframe + subdomains) get a breadcrumb
          back to the full catalogue. Rendered outside the Suspense boundary so
          it appears immediately and on every book layout — printed, artwork,
          and text reader alike. */}
      {isEmbedded && <CatalogueBreadcrumb />}

      {/* Book content streams in */}
      <Suspense fallback={
        <>
          <BookInfoSkeleton />
          <main className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <h2 className="text-xl font-semibold text-stone-900 mb-6">Pages</h2>
            <PagesGridSkeleton />
          </main>
        </>
      }>
        <BookInfo id={id} tenantId={tenantId} tenantSlug={tenantSlug} embedPolicy={embedPolicy} isEmbedded={isEmbedded} previewProposed={previewProposed} allowHidden={allowHidden} />
      </Suspense>
      {!isEmbedded && (
        <SignUpCTA
          bgImageUrl="https://images.sourcelibrary.org/artwork/woman-of-the-apocalypse-hortus-deliciarum.jpg"
          bgAttribution={{ text: 'Woman of the Apocalypse, Hortus Deliciarum (12th c.)', href: '/collections/visions-ecstasies' }}
        />
      )}
    </div>
  );
}

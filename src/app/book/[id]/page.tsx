import { Suspense, cache } from 'react';
import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Book, Page, TranslationEdition } from '@/lib/types';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { Calendar, Globe, FileText, BookText, BookMarked, User, MapPin, Lightbulb, Images, Search } from 'lucide-react';
import SearchPanel from '@/components/search/SearchPanel';
import BookPagesSection from '@/components/book/BookPagesSection';
import BookHistory from '@/components/book/BookHistory';
import BookAnalytics from '@/components/book/BookAnalytics';
import CoverImagePicker from '@/components/book/CoverImagePicker';
import DownloadButton from '@/components/ui/DownloadButton';
import BibliographicInfo from '@/components/book/BibliographicInfo';
import PublishEditionButton from '@/components/editions/PublishEditionButton';
import EditionsPanel from '@/components/editions/EditionsPanel';
import SchemaOrgMetadata from '@/components/seo/SchemaOrgMetadata';
import CategoryPicker from '@/components/ui/CategoryPicker';
import { linkEntities, buildEntityList } from '@/lib/link-entities';
import { BookShare } from '@/components/ui/ShareButton';
import LikeButton from '@/components/ui/LikeButton';
import CiteButton from '@/components/ui/CiteButton';
import { AuthCheck } from '@/components/auth/AuthCheck';
// RegistrationWall removed — gating handled client-side by BetaGateModal in BookPagesSection
// auth import removed — gating handled client-side by useBetaGate

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

// Lightweight book fetch for metadata (no pages)
async function getBookForMetadata(id: string): Promise<Book | null> {
  const db = await getDb();
  const result = await findBookByIdOrSlug(db, id);
  return result ? (result.book as unknown as Book) : null;
}

// Cross-book citation graph
// "direct" = this book mentions a person who authored another book in our library (real citation)
// "shared" = books that share many of the same entity mentions (intellectual context)
interface CitedBook {
  id: string;
  title: string;
  author: string;
  published?: string;
  year?: number;
  type: 'direct' | 'shared';
  cited_as?: string;        // entity name that triggered the direct citation
  shared_entities?: number;  // count for shared type
}

const getRelatedBooks = cache(async (bookId: string): Promise<CitedBook[]> => {
  try {
    const db = await getDb();

    // Step 1: Find person entities mentioned in THIS book
    // Use aggregation to project only the book fields we need (book_id, book_author)
    // — avoids pulling full books arrays (can be 1+ MB for well-connected entities)
    const personEntities = await db.collection('entities').aggregate([
      { $match: { type: 'person', 'books.book_id': bookId } },
      { $project: {
        name: 1,
        aliases: 1,
        books: { $map: {
          input: '$books',
          as: 'b',
          in: { book_id: '$$b.book_id', book_author: '$$b.book_author' },
        }},
      }},
    ]).toArray();

    // Step 2: For each person, check if they authored OTHER books in our library
    // Match entity name/aliases against book_author fields in the entity's books array
    // Use word-boundary matching to avoid "Jacob" matching "Böhme, Jacob"
    const directCitationBookIds = new Map<string, string>(); // bookId -> cited_as
    for (const entity of personEntities) {
      const names = [entity.name, ...(entity.aliases || [])].filter(
        (n: string) => n && n.length >= 4,
      );
      for (const bookEntry of entity.books || []) {
        if (bookEntry.book_id === bookId) continue;
        const authorStr = (bookEntry.book_author || '');
        if (!authorStr || authorStr.toLowerCase() === 'unknown') continue;
        for (const name of names) {
          // Require word-boundary match: the name must appear as a leading/standalone
          // part of the author string, not as a middle name or substring.
          // "Plato" matches "Plato; Ficino (trans.)" but "Jacob" won't match "Böhme, Jacob"
          const nameLower = name.toLowerCase();
          const authorLower = authorStr.toLowerCase();
          const idx = authorLower.indexOf(nameLower);
          if (idx === -1) continue;
          // Must start at word boundary (start of string or after non-letter)
          const charBefore = idx > 0 ? authorLower[idx - 1] : ' ';
          const isWordStart = !/[a-z]/.test(charBefore);
          // Must end at word boundary
          const afterIdx = idx + nameLower.length;
          const charAfter = afterIdx < authorLower.length ? authorLower[afterIdx] : ' ';
          const isWordEnd = !/[a-z]/.test(charAfter);
          // For short names (single word, <8 chars), require it appears BEFORE any comma
          // to match surname position: "Plato" ok, but "Jacob" in "Böhme, Jacob" is after comma
          const isSingleWord = !name.includes(' ');
          const commaIdx = authorLower.indexOf(',');
          const isBeforeComma = commaIdx === -1 || idx < commaIdx;
          if (isWordStart && isWordEnd && (!isSingleWord || name.length >= 8 || isBeforeComma)) {
            directCitationBookIds.set(bookEntry.book_id, entity.name);
            break;
          }
        }
      }
    }

    // Step 3: Enrich direct citations with book metadata
    const directBooks: CitedBook[] = [];
    if (directCitationBookIds.size > 0) {
      const bookDocs = await db.collection('books').find(
        { id: { $in: [...directCitationBookIds.keys()] }, hidden: { $ne: true } },
        { projection: { id: 1, display_title: 1, title: 1, author: 1, published: 1, year: 1 } },
      ).toArray();
      for (const doc of bookDocs) {
        directBooks.push({
          id: doc.id as string,
          title: (doc.display_title || doc.title) as string,
          author: (doc.author || 'Unknown') as string,
          published: doc.published as string | undefined,
          year: doc.year as number | undefined,
          type: 'direct',
          cited_as: directCitationBookIds.get(doc.id as string),
        });
      }
    }

    // Step 4: Fill remaining slots with entity-overlap books (shared context)
    // Skip if direct citations already fill 10+ slots
    const sharedSlots = Math.max(0, 10 - directBooks.length);
    let sharedBooks: CitedBook[] = [];
    if (sharedSlots > 0) {
      const directIds = new Set(directBooks.map(b => b.id));
      const sharedResults = await db.collection('entities').aggregate([
        { $match: { 'books.book_id': bookId } },
        { $unwind: '$books' },
        { $match: { 'books.book_id': { $ne: bookId, $nin: [...directIds] } } },
        { $group: {
          _id: '$books.book_id',
          title: { $first: '$books.book_title' },
          author: { $first: '$books.book_author' },
          shared_entities: { $sum: 1 },
        }},
        { $match: { shared_entities: { $gte: 3 } } },
        { $sort: { shared_entities: -1 as const } },
        { $limit: sharedSlots },
        { $lookup: {
          from: 'books',
          localField: '_id',
          foreignField: 'id',
          pipeline: [{ $project: { published: 1, year: 1, display_title: 1, hidden: 1 } }],
          as: 'book_doc',
        }},
        { $unwind: { path: '$book_doc', preserveNullAndEmptyArrays: true } },
        { $match: { 'book_doc.hidden': { $ne: true } } },
      ]).toArray();

      sharedBooks = sharedResults.map(r => ({
        id: r._id as string,
        title: (r.book_doc?.display_title || r.title) as string,
        author: (r.author || 'Unknown') as string,
        published: r.book_doc?.published as string | undefined,
        year: r.book_doc?.year as number | undefined,
        type: 'shared' as const,
        shared_entities: r.shared_entities as number,
      }));
    }

    return [...directBooks, ...sharedBooks];
  } catch (err) {
    console.error('[getRelatedBooks] Error:', err);
    return [];
  }
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const book = await getBookForMetadata(id);

  if (!book) {
    notFound();
  }

  const title = book.display_title || book.title;
  const ogTitle = book.published ? `${title} (${book.published})` : title;
  const description = `Read the English translation of "${title}" by ${book.author}${book.published ? ` (${book.published})` : ''}. Digitized and translated with AI from the original ${book.language || 'manuscript'}.`;
  const bookUrl = `/book/${book.slug || book.id}`;

  // Get publication date for OG tags
  const currentEdition = (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'published');
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
  const scholarMeta: Record<string, string | string[]> = {
    'citation_title': book.title,
    'citation_author': book.author,
    'citation_fulltext_html_url': `https://sourcelibrary.org${bookUrl}`,
  };
  if (book.published) scholarMeta['citation_publication_date'] = book.published;
  if (book.language) scholarMeta['citation_language'] = book.language;
  if (book.publisher) scholarMeta['citation_publisher'] = book.publisher;
  if (book.doi) scholarMeta['citation_doi'] = book.doi;

  // Cross-book citation_reference tags are rendered inline by BookInfo (inside Suspense)
  // to avoid blocking generateMetadata with a 3-4s entity query

  return {
    title: `${title} - Source Library`,
    description,
    alternates: {
      canonical: bookUrl,
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
      authors: [book.author],
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description,
      // Twitter image generated by opengraph-image.tsx
    },
  };
}

async function getBook(id: string): Promise<{ book: Book; pages: Page[]; totalBooks: number; matchedBySlug: boolean } | null> {
  const db = await getDb();

  // Exclude heavy fields not used on the book detail page
  const bookProjection = {
    chapters: 0,
    reading_sections: 0,
    pipeline: 0,
    split_check: 0,
    'index.sectionSummaries': 0,
    pages_ocr: 0,
    translation_percent: 0,
  };
  const result = await findBookByIdOrSlug(db, id, bookProjection);

  if (!result) return null;
  const { book, matchedBySlug } = result;

  // Use the book's id field, or fall back to _id string
  const bookId = book.id || book._id?.toString();

  // Inclusion projection — only fetch fields the book detail UI actually uses
  // Status dots need .updated_at; image count needs array length via .type
  const pages = await db.collection('pages')
    .find({ book_id: bookId }, {
      projection: {
        _id: 0,
        id: 1,
        page_number: 1,
        photo: 1,
        photo_original: 1,
        archived_photo: 1,
        thumbnail: 1,
        thumbnail_blob: 1,
        crop: 1,
        'ocr.updated_at': 1,
        'translation.updated_at': 1,
        'summary.updated_at': 1,
        'detected_images.type': 1,
        display_brightness: 1,
      }
    })
    .sort({ page_number: 1 })
    .toArray();

  // Serialize MongoDB objects to plain JavaScript objects
  const serializedBook = JSON.parse(JSON.stringify(book));
  const serializedPages = JSON.parse(JSON.stringify(pages));

  const totalBooks = await db.collection('books').estimatedDocumentCount();

  return { book: serializedBook as Book, pages: serializedPages as Page[], totalBooks, matchedBySlug };
}

// Skeleton for book info while loading
function BookInfoSkeleton() {
  return (
    <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
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

// Book info component (streams in)
async function BookInfo({ id }: { id: string }) {
  const data = await getBook(id);

  if (!data) {
    notFound();
  }

  const { book, pages, totalBooks } = data;

  // Content gating handled client-side by useBetaGate hook in BookPagesSection
  // Featured books bypass the gate; others show email modal on page click

  // Note: ObjectId→custom-id redirect is handled in BookDetailPage above,
  // before the Suspense boundary, so Google gets a proper 301.

  // Related books: author count + work siblings (parallel, non-blocking)
  const db = await getDb();
  const workId = (book as unknown as { work_id?: string }).work_id;
  const [authorCount, workSiblings, entityRelatedBooks] = await Promise.all([
    book.author && book.author !== 'Unknown'
      ? db.collection('books').countDocuments({ author: book.author, id: { $ne: book.id } })
      : Promise.resolve(0),
    workId
      ? db.collection('books').find(
        { work_id: workId, id: { $ne: book.id } },
        { projection: { id: 1, title: 1, display_title: 1, language: 1, published: 1 } }
      ).sort({ published: 1 }).limit(20).toArray()
      : Promise.resolve([]),
    getRelatedBooks(book.id),
  ]);

  // Note: projection excludes .data fields, so check for object existence instead
  const ocrCount = pages.filter(p => p.ocr).length;
  const translatedCount = pages.filter(p => p.translation).length;
  const imageCount = pages.reduce((sum, p) => sum + ((p.detected_images as any[])?.length || 0), 0);
  const currentEdition = (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'published');

  // Progression: OCR → Translation → Summary → Ask AI / Publish
  const hasOcr = ocrCount > 0;
  const hasTranslations = translatedCount > pages.length / 2; // >50% translated
  const indexBrief = (book as unknown as { index?: { bookSummary?: { brief?: string } } }).index?.bookSummary?.brief;
  const readingSummary = (book as unknown as { reading_summary?: { overview?: string } }).reading_summary?.overview;
  const summaryText = indexBrief || readingSummary || (typeof book.summary === 'string' ? book.summary : book.summary?.data);
  const hasSummary = !!summaryText;
  const isComplete = ocrCount === pages.length && translatedCount === pages.length && hasSummary;
  const summaryEntities = buildEntityList((book as unknown as { index?: { people?: Array<{ term: string }>; places?: Array<{ term: string }>; concepts?: Array<{ term: string }> } }).index);

  return (
    <>
      {/* Schema.org JSON-LD for Google Scholar */}
      <SchemaOrgMetadata
        book={book}
        pageCount={pages.length}
        translatedCount={translatedCount}
        currentEdition={currentEdition}
      />

      {/* Cross-book citation_reference meta tags for Google Scholar */}
      {/* Rendered here (inside Suspense via BookInfo) instead of generateMetadata */}
      {/* to avoid blocking initial page load with a 3-4s entity query */}
      {entityRelatedBooks.filter(rb => rb.type === 'direct').map((rb) => (
        <meta
          key={`cite-ref-${rb.id}`}
          name="citation_reference"
          content={`citation_title=${rb.title}${rb.author && rb.author !== 'Unknown' ? `; citation_author=${rb.author}` : ''}${rb.published ? `; citation_publication_date=${rb.published}` : ''}`}
        />
      ))}

      {/* Book Info */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <div className="flex flex-col sm:flex-row gap-6 sm:gap-8">
            {/* Thumbnail - clickable to change */}
            <div className="flex-shrink-0 flex justify-center sm:justify-start">
              <CoverImagePicker
                bookId={book.id}
                currentThumbnail={book.thumbnail}
                currentThumbnailBlob={book.thumbnail_blob}
                bookTitle={book.title}
                pages={pages}
              />
            </div>

            {/* Details */}
            <div className="flex-1 text-center sm:text-left">
              <h1 className="text-2xl sm:text-3xl font-serif font-bold break-words">{book.display_title || book.title}</h1>
              {book.display_title && book.title !== book.display_title && (
                <p className="text-stone-400 mt-1 italic text-sm sm:text-base">{book.title}</p>
              )}
              <p className="text-lg sm:text-xl text-stone-300 mt-2">{book.author}</p>

              {/* Book metadata */}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 sm:gap-6 mt-4 sm:mt-6 text-sm text-stone-400">
                {book.language && (
                  <div className="flex items-center gap-2" data-testid="language-metadata">
                    <Globe className="w-4 h-4" />
                    {book.language}
                  </div>
                )}
                {(book.published || book.source_work_dates?.length) && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {book.source_work_dates?.length ? (
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
                        {!book.source_work_dates.find(l => l.type === 'composition') && !book.source_work_dates.find(l => l.type === 'translation') && book.published
                          ? book.published
                          : ''}
                      </span>
                    ) : book.published}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  {pages.length} pages
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

              {book.is_first_translation && (
                <div className="mt-3">
                  <span className="px-2.5 py-1 bg-accent-gold/20 text-accent-gold text-xs font-medium rounded-full border border-accent-gold/30">
                    First English Translation
                  </span>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col items-center sm:items-start gap-3 mt-5 text-sm">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                  {/* Publish — admin only */}
                  <AuthCheck>
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
                      bookId={book.id}
                      title={book.title}
                      displayTitle={book.display_title}
                      author={book.author}
                      year={book.published}
                      publisher={book.publisher}
                      placePublished={book.place_published}
                      language={book.language}
                      doi={book.doi}
                      className="text-stone-300 hover:text-white hover:bg-white/10"
                    />
                    <DownloadButton
                      bookId={book.id}
                      hasTranslations={hasTranslations}
                      hasOcr={hasOcr}
                      hasImages={pages.length > 0}
                      variant="header"
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
                    <span className="hidden sm:block w-px h-5 bg-white/10 mx-1" />
                    <BookShare
                      title={book.display_title || book.title}
                      author={book.author}
                      year={book.published}
                      bookId={book.id}
                      doi={book.doi}
                      label="Share"
                      className="text-stone-300 hover:text-white hover:bg-white/10"
                    />
                  </div>
                </div>

                {/* Search — separate line */}
                <SearchPanel bookId={book.id} />
              </div>

              {/* Bibliographic Info */}
              <BibliographicInfo book={book} pagesCount={pages.length} />
            </div>
          </div>
        </div>
      </div>

      {/* Gradient bridge from dark header to light content */}
      <div className="h-6 bg-gradient-to-b from-stone-900 to-transparent" />

      {/* Book Summary */}
      {(() => {
        return (
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>About This Book</h2>
                {hasTranslations ? (
                  <Link
                    href={`/book/${book.id}/guide`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-accent-rust hover:text-accent-gold-dark hover:bg-accent-gold/8 rounded-lg transition-colors"
                  >
                    <BookText className="w-4 h-4" />
                    {hasSummary ? 'Full Summary & Index' : 'Generate Summary'}
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-stone-400 cursor-not-allowed" title="Translate pages first">
                    <BookText className="w-4 h-4" />
                    <span className="opacity-60">Generate Summary</span>
                  </span>
                )}
              </div>

              {/* Categories */}
              <div className="mb-4 pb-4 border-b border-stone-100">
                <CategoryPicker
                  bookId={book.id}
                  currentCategories={book.categories || []}
                />
              </div>
              {hasSummary ? (
                <div className="prose-content max-w-none">
                  {summaryText!.split('\n\n').map((paragraph: string, i: number) => (
                    <p key={i} className="mb-4 last:mb-0">
                      {linkEntities(paragraph, summaryEntities)}
                    </p>
                  ))}
                </div>
              ) : hasTranslations ? (
                <p className="text-stone-500 text-sm">
                  No summary yet. Generate a summary to unlock the full book index.
                </p>
              ) : (
                <p className="text-stone-500 text-sm">
                  Translate pages to unlock summary generation.
                </p>
              )}
            </div>

            {/* Editions Panel */}
            {book.editions?.length ? (
              <EditionsPanel
                bookId={book.id}
                editions={book.editions as TranslationEdition[]}
              />
            ) : null}

            {/* Index — collapsed by default */}
            {(() => {
              const index = (book as unknown as { index?: { people?: Array<{ term: string; pages: number[] }>; places?: Array<{ term: string; pages: number[] }>; concepts?: Array<{ term: string; pages: number[] }> } }).index;
              const people = index?.people || [];
              const places = index?.places || [];
              const concepts = index?.concepts || [];
              const hasEntities = people.length > 0 || places.length > 0 || concepts.length > 0;

              if (!hasEntities) return null;

              const counts = [
                people.length > 0 ? `${people.length} people` : '',
                places.length > 0 ? `${places.length} places` : '',
                concepts.length > 0 ? `${concepts.length} concepts` : '',
              ].filter(Boolean).join(', ');

              return (
                <details className="card mt-6">
                  <summary className="flex items-center justify-between p-6 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <div className="flex items-center gap-3">
                      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Index</h2>
                      <span className="text-xs text-stone-400">{counts}</span>
                    </div>
                    <Link
                      href="/encyclopedia"
                      className="text-sm text-accent-rust hover:text-accent-gold-dark"
                    >
                      Browse All &rarr;
                    </Link>
                  </summary>
                  <div className="px-6 pb-6 space-y-4">
                    {/* People */}
                    {people.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium text-stone-700 mb-2">
                          <User className="w-4 h-4 text-accent-rust" />
                          People ({people.length})
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {people.slice(0, 15).map((p) => (
                            <Link
                              key={p.term}
                              href={`/encyclopedia/${encodeURIComponent(p.term)}`}
                              className="px-2 py-1 text-xs bg-accent-rust/8 text-accent-rust rounded hover:bg-accent-rust/15 transition-colors"
                            >
                              {p.term}
                            </Link>
                          ))}
                          {people.length > 15 && (
                            <span className="px-2 py-1 text-xs text-stone-400">
                              +{people.length - 15} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Places */}
                    {places.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium text-stone-700 mb-2">
                          <MapPin className="w-4 h-4 text-accent-sage" />
                          Places ({places.length})
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {places.slice(0, 15).map((p) => (
                            <Link
                              key={p.term}
                              href={`/encyclopedia/${encodeURIComponent(p.term)}`}
                              className="px-2 py-1 text-xs bg-accent-sage/12 text-accent-sage-dark rounded hover:bg-accent-sage/20 transition-colors"
                            >
                              {p.term}
                            </Link>
                          ))}
                          {places.length > 15 && (
                            <span className="px-2 py-1 text-xs text-stone-400">
                              +{places.length - 15} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Concepts */}
                    {concepts.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium text-stone-700 mb-2">
                          <Lightbulb className="w-4 h-4 text-accent-violet" />
                          Concepts ({concepts.length})
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {concepts.slice(0, 15).map((c) => (
                            <Link
                              key={c.term}
                              href={`/encyclopedia/${encodeURIComponent(c.term)}`}
                              className="px-2 py-1 text-xs bg-accent-violet/8 text-accent-violet rounded hover:bg-accent-violet/15 transition-colors"
                            >
                              {c.term}
                            </Link>
                          ))}
                          {concepts.length > 15 && (
                            <span className="px-2 py-1 text-xs text-stone-400">
                              +{concepts.length - 15} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              );
            })()}

            {/* Related Books — collapsed by default, matching Index card pattern */}
            {(() => {
              const index = (book as unknown as { index?: { people?: Array<{ term: string; pages: number[] }>; concepts?: Array<{ term: string; pages: number[] }> } }).index;
              const topPeople = (index?.people || []).slice(0, 3);
              const topConcepts = (index?.concepts || []).slice(0, 3);
              const directCitations = entityRelatedBooks.filter(rb => rb.type === 'direct');
              const sharedCitations = entityRelatedBooks.filter(rb => rb.type === 'shared');
              const hasLinks = authorCount > 0 || workSiblings.length > 0 || entityRelatedBooks.length > 0 || book.language || topPeople.length > 0 || topConcepts.length > 0;

              if (!hasLinks) return null;

              const counts = [
                workSiblings.length > 0 ? `${workSiblings.length + 1} editions` : '',
                directCitations.length > 0 ? `${directCitations.length} cited` : '',
                sharedCitations.length > 0 ? `${sharedCitations.length} related` : '',
              ].filter(Boolean).join(', ');

              return (
                <details className="card mt-6">
                  <summary className="flex items-center justify-between p-6 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <div className="flex items-center gap-3">
                      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Related Books</h2>
                      {counts && <span className="text-xs text-stone-400">{counts}</span>}
                    </div>
                    <span className="text-sm text-accent-rust hover:text-accent-gold-dark">
                      See All &rarr;
                    </span>
                  </summary>
                  <div className="px-6 pb-6">
                  {/* Work siblings — other editions of the same text */}
                  {workSiblings.length > 0 && (
                    <div className="mb-4 pb-4 border-b border-stone-100">
                      <p className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-2">
                        {workSiblings.length + 1} editions of this text
                      </p>
                      <div className="space-y-1.5">
                        {workSiblings.map((sibling: { id?: string; _id?: { toString(): string }; display_title?: string; title?: string; language?: string; published?: string }) => (
                          <Link
                            key={sibling.id || sibling._id?.toString()}
                            href={`/book/${sibling.id || sibling._id?.toString()}`}
                            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-stone-50 transition-colors group"
                          >
                            <span className="text-stone-800 group-hover:text-accent-gold-dark transition-colors">
                              {sibling.display_title || sibling.title}
                            </span>
                            {sibling.language && (
                              <span className="text-xs text-stone-400">{sibling.language}</span>
                            )}
                            {sibling.published && (
                              <span className="text-xs text-stone-400">{sibling.published}</span>
                            )}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Direct citations — this book mentions authors of these works */}
                  {directCitations.length > 0 && (
                    <div className="mb-4 pb-4 border-b border-stone-100">
                      <p className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-2">
                        Cited authors in our library ({directCitations.length})
                      </p>
                      <div className="space-y-1.5">
                        {directCitations.map((rb) => (
                          <Link
                            key={rb.id}
                            href={`/book/${rb.id}`}
                            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-stone-50 transition-colors group"
                          >
                            <span className="text-stone-800 group-hover:text-accent-gold-dark transition-colors flex-1 min-w-0 truncate">
                              {rb.title}
                            </span>
                            {rb.cited_as && (
                              <span className="text-xs text-accent-rust shrink-0">via {rb.cited_as}</span>
                            )}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Shared entity context — books discussing the same people/places/concepts */}
                  {sharedCitations.length > 0 && (
                    <div className="mb-4 pb-4 border-b border-stone-100">
                      <p className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-2">
                        Related works ({sharedCitations.length})
                      </p>
                      <div className="space-y-1.5">
                        {sharedCitations.map((rb) => (
                          <Link
                            key={rb.id}
                            href={`/book/${rb.id}`}
                            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-stone-50 transition-colors group"
                          >
                            <span className="text-stone-800 group-hover:text-accent-gold-dark transition-colors flex-1 min-w-0 truncate">
                              {rb.title}
                            </span>
                            {rb.author && rb.author !== 'Unknown' && (
                              <span className="text-xs text-stone-400 shrink-0 truncate max-w-[120px]">{rb.author}</span>
                            )}
                            <span className="text-xs text-accent-sage shrink-0">{rb.shared_entities} shared</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Search pills */}
                  <div className="flex flex-wrap gap-2">
                    {authorCount > 0 && (
                      <Link
                        href={`/search?q=${encodeURIComponent('"' + book.author + '"')}`}
                        className="px-3 py-1.5 text-sm bg-stone-100 text-stone-700 rounded-full hover:bg-stone-200 transition-colors"
                      >
                        More by {book.author} ({authorCount})
                      </Link>
                    )}
                    {book.language && book.language !== 'Unknown' && (
                      <Link
                        href={`/search?language=${encodeURIComponent(book.language)}`}
                        className="px-3 py-1.5 text-sm bg-stone-100 text-stone-700 rounded-full hover:bg-stone-200 transition-colors"
                      >
                        {book.language} texts
                      </Link>
                    )}
                    {topPeople.map((p) => (
                      <Link
                        key={p.term}
                        href={`/search?q=${encodeURIComponent(p.term)}`}
                        className="px-3 py-1.5 text-sm bg-accent-rust/8 text-accent-rust rounded-full hover:bg-accent-rust/15 transition-colors"
                      >
                        {p.term}
                      </Link>
                    ))}
                    {topConcepts.map((c) => (
                      <Link
                        key={c.term}
                        href={`/search?q=${encodeURIComponent(c.term)}`}
                        className="px-3 py-1.5 text-sm bg-accent-violet/8 text-accent-violet rounded-full hover:bg-accent-violet/15 transition-colors"
                      >
                        {c.term}
                      </Link>
                    ))}
                  </div>
                  </div>
                </details>
              );
            })()}
          </div>
        );
      })()}

      {/* Stats + Pages Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-6">
        <BookPagesSection bookId={book.id} bookTitle={book.display_title || book.title} pages={pages} displayBrightness={(book as unknown as { display_brightness?: number }).display_brightness} bookFeatured={!!book.featured} totalBooks={totalBooks} />
        <AuthCheck>
          <BookHistory bookId={book.id} />
        </AuthCheck>
      </main>
    </>
  );
}

export default async function BookDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;

  // Redirect non-slug URLs (ObjectId or id) to canonical slug URL.
  // Done before Suspense so Google gets a proper 301.
  const db = await getDb();
  const lookupResult = await findBookByIdOrSlug(db, id, { slug: 1, id: 1 });
  if (lookupResult && !lookupResult.matchedBySlug && lookupResult.book.slug) {
    const slug = lookupResult.book.slug as string;
    // Preserve ?page=N if present
    const pageNum = typeof query.page === 'string' ? parseInt(query.page, 10) : NaN;
    redirect(!isNaN(pageNum) && pageNum > 0 ? `/book/${slug}?page=${pageNum}` : `/book/${slug}`);
  }

  // Redirect ?page=N to the reader
  const pageNum = typeof query.page === 'string' ? parseInt(query.page, 10) : NaN;
  if (!isNaN(pageNum) && pageNum > 0) {
    const bookId = lookupResult?.book.id || id;
    const targetPage = await db.collection('pages').findOne(
      { book_id: bookId, page_number: pageNum },
      { projection: { id: 1 } }
    );
    if (targetPage) {
      const pageId = targetPage.id || targetPage._id?.toString();
      redirect(`/book/${id}/page/${pageId}`);
    }
  }

  return (
    <div className="min-h-screen bg-cream">
      {/* Header - renders immediately */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-stone-700 hover:text-stone-900 transition-colors" aria-label="Back to library">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1" />
            </svg>
          </Link>
        </div>
      </header>

      {/* Book content streams in */}
      <Suspense fallback={
        <>
          <BookInfoSkeleton />
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <h2 className="text-xl font-semibold text-stone-900 mb-6">Pages</h2>
            <PagesGridSkeleton />
          </main>
        </>
      }>
        <BookInfo id={id} />
      </Suspense>
    </div>
  );
}

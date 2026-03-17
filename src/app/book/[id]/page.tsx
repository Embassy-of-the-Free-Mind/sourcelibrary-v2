import { Suspense, cache } from 'react';
import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Book, Page, TranslationEdition } from '@/lib/types';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { Calendar, Globe, FileText, BookText, BookMarked, Images } from 'lucide-react';
import SearchPanel from '@/components/search/SearchPanel';
import BookPagesSection from '@/components/book/BookPagesSection';
import EarlyAccessGate from '@/components/book/EarlyAccessGate';
import BookDedication from '@/components/book/BookDedication';
import BookHistory from '@/components/book/BookHistory';
import BookIndex from '@/components/book/BookIndex';
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
import SignUpCTA from '@/components/auth/SignUpCTA';
import { authorUrl } from '@/lib/slugify';
import UserMenu from '@/components/layout/UserMenu';

// ISR: rebuild at most every 2 minutes (requires no searchParams/headers() usage)
export const revalidate = 3600;

// Allow any [id] — paths not pre-generated will use ISR on first request
export const dynamicParams = true;
export async function generateStaticParams() {
  return []; // All paths generated on demand via ISR
}

interface PageProps {
  params: Promise<{ id: string }>;
}

// Lightweight book fetch for metadata (no pages, no heavy index)
async function getBookForMetadata(id: string): Promise<Book | null> {
  const db = await Promise.race([
    getDb(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 8000)),
  ]);
  const result = await findBookByIdOrSlug(db, id, {
    index: 0,
    reading_summary: 0,
    chapters: 0,
    reading_sections: 0,
    pipeline: 0,
    pipeline_auto: 0,
  });
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
  shared_names?: string[];   // top entity names for shared type
}

// Entities too common to be meaningful shared-context signals
const UBIQUITOUS_ENTITIES = new Set([
  'Jesus Christ', 'God', 'The Devil', 'Satan', 'Lucifer',
  'Moses', 'Abraham', 'Adam', 'Eve', 'Noah', 'David',
  'Hermes Trismegistus', 'Hermes', 'Mercury',
  'Aristotle', 'Plato', 'Socrates',
  'The Holy Spirit', 'The Son of God', 'The Apostles',
  'The Patriarchs', 'The Prophets',
]);

const getRelatedBooks = cache(async (bookId: string, bookAuthor?: string): Promise<CitedBook[]> => {
  try {
    const db = await Promise.race([
      getDb(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 8000)),
    ]);

    // Step 1: Find person entities mentioned in THIS book.
    // Only fetch name/aliases — we'll match against author fields in a separate query.
    // Avoids the slow $map over large books arrays (was 3s for well-connected books).
    const personEntities = await db.collection('entities').find(
      { type: 'person', 'books.book_id': bookId },
      { projection: { name: 1, aliases: 1 } },
    ).toArray();

    // Step 2: For each person entity, check if they authored OTHER books in our library.
    // Query the books collection directly instead of pulling entity.books arrays
    // (which can be megabytes for well-connected entities like Plato/Hermes — was 3s).
    const directCitationBookIds = new Map<string, string>(); // bookId -> cited_as
    const entityNames: Array<{ names: string[]; entityName: string }> = [];
    for (const entity of personEntities) {
      // Only use multi-word names (e.g. "Jacob Boehme") or long single-word
      // names (e.g. "Paracelsus"). Short first names like "John", "Isaac",
      // "Michael" match hundreds of unrelated authors.
      const names = [entity.name, ...(entity.aliases || [])].filter(
        (n: string) => n && (n.includes(' ') ? n.length >= 4 : n.length >= 10),
      );
      if (names.length > 0) {
        entityNames.push({ names, entityName: entity.name });
      }
    }
    // Build a single regex from all entity names and query MongoDB directly
    // instead of fetching all ~5,000 books and looping in JS.
    if (entityNames.length > 0) {
      const allNames: Array<{ pattern: string; entityName: string }> = [];
      for (const { names, entityName } of entityNames) {
        for (const name of names) {
          // Escape regex special chars, use word boundaries
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          allNames.push({ pattern: escaped, entityName });
        }
      }
      // Combined regex: match any entity name with word boundaries
      const combinedPattern = allNames.map(n => n.pattern).join('|');
      const authorFilter: Record<string, unknown> = {
        id: { $ne: bookId },
        hidden: { $ne: true },
        author: { $regex: combinedPattern, $options: 'i' },
      };
      const candidateBooks = await db.collection('books').find(
        authorFilter,
        { projection: { id: 1, author: 1 } },
      ).toArray();
      // Verify word-boundary matches and map to entity names
      for (const doc of candidateBooks) {
        const authorLower = (doc.author as string).toLowerCase();
        for (const { pattern, entityName } of allNames) {
          const re = new RegExp(`(?<![a-z])${pattern}(?![a-z])`, 'i');
          if (re.test(authorLower)) {
            directCitationBookIds.set(doc.id as string, entityName);
            break;
          }
        }
      }
    }

    // Step 3: Enrich direct citations with book metadata
    let directBooks: CitedBook[] = [];
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

    // Exclude same-author books (already covered by "More by Author" pill).
    // Check both the matched book's author AND the cited entity name, since
    // diacritics differ between author fields ("Jakob Böhme" vs "Boehme, Jacob")
    // but entity names are standardized ("Jacob Boehme").
    if (bookAuthor && bookAuthor !== 'Unknown') {
      const surname = bookAuthor.split(/[,;]/)[0].trim().toLowerCase();
      if (surname.length >= 4) {
        directBooks = directBooks.filter(b =>
          !b.author.toLowerCase().includes(surname) &&
          !(b.cited_as || '').toLowerCase().includes(surname)
        );
      }
    }

    // Deduplicate: max 1 book per cited entity for variety
    const seenEntities = new Set<string>();
    directBooks = directBooks.filter(b => {
      const key = b.cited_as || b.id;
      if (seenEntities.has(key)) return false;
      seenEntities.add(key);
      return true;
    });
    // Cap direct citations to keep the section focused
    if (directBooks.length > 6) directBooks.length = 6;

    // Step 4: Fill remaining slots with entity-overlap books (shared context)
    const sharedSlots = Math.max(0, 8 - directBooks.length);
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
          shared_names: { $push: '$name' },
        }},
        { $match: { shared_entities: { $gte: 5 } } },
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
        shared_names: (r.shared_names as string[])
          ?.filter(n => !UBIQUITOUS_ENTITIES.has(n))
          .slice(0, 3),
      }));
    }

    return [...directBooks, ...sharedBooks];
  } catch (err) {
    console.error('[getRelatedBooks] Error:', err);
    return [];
  }
});

// Deferred related books section — runs expensive entity queries independently
// so the main book content streams to the user immediately
async function RelatedBooksSection({ bookId, bookAuthor, bookLanguage, workId, bookIndex }: {
  bookId: string;
  bookAuthor: string;
  bookLanguage?: string;
  workId?: string;
  bookIndex?: { people?: Array<{ term: string; pages: number[] }>; concepts?: Array<{ term: string; pages: number[] }> };
}) {
  const db = await getDb();

  const [authorCount, workSiblings, entityRelatedBooks] = await Promise.all([
    bookAuthor && bookAuthor !== 'Unknown'
      ? db.collection('books').countDocuments({ author: bookAuthor, id: { $ne: bookId } })
      : Promise.resolve(0),
    workId
      ? db.collection('books').find(
        { work_id: workId, id: { $ne: bookId } },
        { projection: { id: 1, title: 1, display_title: 1, language: 1, published: 1 } }
      ).sort({ published: 1 }).limit(20).toArray()
      : Promise.resolve([]),
    getRelatedBooks(bookId, bookAuthor),
  ]);

  const topPeople = (bookIndex?.people || []).slice(0, 3);
  const topConcepts = (bookIndex?.concepts || []).slice(0, 3);
  const directCitations = entityRelatedBooks.filter((rb: CitedBook) => rb.type === 'direct');
  const sharedCitations = entityRelatedBooks.filter((rb: CitedBook) => rb.type === 'shared');
  const hasLinks = authorCount > 0 || workSiblings.length > 0 || entityRelatedBooks.length > 0 || bookLanguage || topPeople.length > 0 || topConcepts.length > 0;

  if (!hasLinks) return null;

  const counts = [
    workSiblings.length > 0 ? `${workSiblings.length + 1} editions` : '',
    directCitations.length > 0 ? `${directCitations.length} cited` : '',
    sharedCitations.length > 0 ? `${sharedCitations.length} related` : '',
  ].filter(Boolean).join(', ');

  return (
    <>
      {/* Citation meta tags for Google Scholar */}
      {directCitations.map((rb: CitedBook) => (
        <meta
          key={`cite-ref-${rb.id}`}
          name="citation_reference"
          content={`citation_title=${rb.title}${rb.author && rb.author !== 'Unknown' ? `; citation_author=${rb.author}` : ''}${rb.published ? `; citation_publication_date=${rb.published}` : ''}`}
        />
      ))}

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
                {directCitations.map((rb: CitedBook) => (
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
                {sharedCitations.map((rb: CitedBook) => (
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
                    <span className="text-xs text-accent-sage shrink-0">
                      {rb.shared_names?.length ? rb.shared_names.join(', ') : `${rb.shared_entities} shared`}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Search pills */}
          <div className="flex flex-wrap gap-2">
            {authorCount > 0 && authorUrl(bookAuthor) && (
              <Link
                href={authorUrl(bookAuthor)!}
                className="px-3 py-1.5 text-sm bg-stone-100 text-stone-700 rounded-full hover:bg-stone-200 transition-colors"
              >
                More by {bookAuthor} ({authorCount})
              </Link>
            )}
            {bookLanguage && bookLanguage !== 'Unknown' && (
              <Link
                href={`/search?language=${encodeURIComponent(bookLanguage)}`}
                className="px-3 py-1.5 text-sm bg-stone-100 text-stone-700 rounded-full hover:bg-stone-200 transition-colors"
              >
                {bookLanguage} texts
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
    </>
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const book = await getBookForMetadata(id);

  if (!book) {
    return { title: 'Book Not Found - Source Library', robots: { index: false, follow: false } };
  }

  const title = book.display_title || book.title;
  const ogTitle = book.published ? `${title} (${book.published})` : title;
  const description = `Read the English translation of "${title}" by ${book.author}${book.published ? ` (${book.published})` : ''}. Digitized and translated with AI from the original ${book.language || 'manuscript'}.`;
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

  // Don't index books with no OCR content — nothing meaningful for search engines
  const shouldIndex = (book.pages_ocr ?? 0) > 0;

  return {
    title: `${title} - Source Library`,
    description,
    ...(!shouldIndex && { robots: { index: false, follow: true } }),
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

async function getBook(id: string): Promise<{ book: Book; pages: Page[]; totalBooks: number; galleryImageCount: number; matchedBySlug: boolean } | null> {
  // Timeout on getDb() — when MongoDB Atlas is overloaded, the connection
  // itself can hang for 60+ seconds. Better to fail fast.
  const dbPromise = getDb();
  const db = await Promise.race([
    dbPromise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB connection timeout (10s)')), 10000)),
  ]);

  // Exclude heavy fields not used on the book detail page.
  const bookProjection = {
    chapters: 0,
    reading_sections: 0,
    pipeline: 0,
    pipeline_auto: 0,
    split_check: 0,
    'index.sectionSummaries': 0,
    // Legacy flat lists — no longer displayed
    'index.people': 0,
    'index.places': 0,
    'index.concepts': 0,
    'index.keyTerms': 0,
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
  // All queries have maxTimeMS to fail fast during DB degradation
  const [pagesRaw, totalBooks, galleryImageCount] = await Promise.all([
    db.collection('pages')
      .find({ book_id: bookId, page_type: { $ne: 'digitizer-insert' } }, {
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
          crop: 1,
          'ocr.updated_at': 1,
          'translation.updated_at': 1,
          'summary.updated_at': 1,
          display_brightness: 1,
        },
        maxTimeMS: 8000,
      })
      .sort({ page_number: 1 })
      .toArray(),
    db.collection('books').estimatedDocumentCount().catch(() => 1200),
    db.collection('gallery_images').countDocuments(
      { book_id: bookId, gallery_quality: { $gte: 0.7 }, book_hidden: { $ne: true } },
    ).catch(() => 0),
  ]);

  // Serialize MongoDB objects to plain JavaScript objects
  const serializedBook = JSON.parse(JSON.stringify(book));
  const serializedPages = JSON.parse(JSON.stringify(pagesRaw));

  return { book: serializedBook as Book, pages: serializedPages as Page[], totalBooks, galleryImageCount, matchedBySlug };
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

// Book info component (streams in via Suspense)
async function BookInfo({ id }: { id: string }) {
  let data;
  try {
    data = await getBook(id);
  } catch (err) {
    console.error('[Book page] getBook failed:', err instanceof Error ? err.message : err);
    // Return a friendly message instead of crashing the Suspense boundary
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center max-w-md px-6">
          <h2 className="text-2xl font-display text-primary mb-3">Temporarily Unavailable</h2>
          <p className="text-secondary mb-6">This book is taking longer than expected to load. Please try again in a moment.</p>
          <Link href="/" className="text-accent-rust hover:underline">Return to Library</Link>
        </div>
      </div>
    );
  }

  if (!data) {
    notFound();
  }

  const { book, pages, totalBooks, galleryImageCount } = data;

  // Empty shell books (0 pages from failed imports) should 404
  if (!book.pages_count || book.pages_count === 0) {
    notFound();
  }

  // Content gating handled client-side by useBetaGate hook in BookPagesSection
  // Featured books bypass the gate; others show email modal on page click

  // Note: ObjectId→slug redirect is handled by proxy.ts → /api/redirect/book-slug

  const workId = (book as unknown as { work_id?: string }).work_id;

  // Note: projection excludes .data fields, so check for object existence instead
  const ocrCount = pages.filter(p => p.ocr).length;
  const translatedCount = pages.filter(p => p.translation).length;
  const imageCount = galleryImageCount;
  const currentEdition = (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'published') || (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'draft');

  // Progression: OCR → Translation → Summary → Ask AI / Publish
  const hasOcr = ocrCount > 0;
  const hasTranslations = translatedCount > pages.length / 2; // >50% translated
  // Image downloads restricted for non-commercial licensed sources (BSB, Bodleian, Vatican, etc.)
  const imgLicense = (book as any).image_source?.license || 'unknown';
  const imageRestricted = imgLicense === 'unknown' || /\bnc\b/i.test(imgLicense);
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

      {/* Cross-book citation_reference meta tags + related books stream in separately */}

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
              <p className="text-lg sm:text-xl text-stone-300 mt-2">
                {authorUrl(book.author) ? (
                  <Link href={authorUrl(book.author)!} className="hover:text-white transition-colors">
                    {book.author}
                  </Link>
                ) : book.author}
              </p>

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
                  <Link
                    href="/blog/first-translation-methodology"
                    className="px-2.5 py-1 bg-accent-gold/20 text-accent-gold hover:bg-accent-gold/30 text-xs font-medium rounded-full border border-accent-gold/30 transition-colors"
                  >
                    First English Translation
                  </Link>
                </div>
              )}

              {/* Source attribution — always visible */}
              {(book.image_source?.provider_name || book.image_source?.contributing_library) && (
                <p className="text-xs text-stone-500 mt-3">
                  Images:{' '}
                  {book.image_source.source_url ? (
                    <a href={book.image_source.source_url} target="_blank" rel="noopener noreferrer" className="hover:text-stone-300 transition-colors">
                      {book.image_source.attribution || book.image_source.contributing_library || book.image_source.provider_name}
                    </a>
                  ) : (
                    <span>{book.image_source.attribution || book.image_source.contributing_library || book.image_source.provider_name}</span>
                  )}
                </p>
              )}

              {/* Dedication */}
              <div className="mt-3">
                <BookDedication bookId={book.id} dedication={(book as any).dedication || null} />
              </div>

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
                      editionVersion={currentEdition?.version}
                      className="text-stone-300 hover:text-white hover:bg-white/10"
                    />
                    <DownloadButton
                      bookId={book.id}
                      bookTitle={book.display_title || book.title}
                      hasTranslations={hasTranslations}
                      hasOcr={hasOcr}
                      hasImages={pages.length > 0}
                      imageRestricted={imageRestricted}
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
                />
              );
            })()}

            {/* Related Books — deferred into its own Suspense to avoid blocking page render */}
            <Suspense fallback={null}>
              <RelatedBooksSection
                bookId={book.id}
                bookAuthor={book.author}
                bookLanguage={book.language}
                workId={workId}
                bookIndex={(book as unknown as { index?: { people?: Array<{ term: string; pages: number[] }>; concepts?: Array<{ term: string; pages: number[] }> } }).index}
              />
            </Suspense>
          </div>
        );
      })()}

      {/* Stats + Pages Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-6">
        {(() => {
          const membersOnlyUntil = (book as unknown as { members_only_until?: string }).members_only_until;
          if (membersOnlyUntil && new Date(membersOnlyUntil) > new Date()) {
            return (
              <EarlyAccessGate membersOnlyUntil={membersOnlyUntil}>
                <BookPagesSection bookId={book.id} bookTitle={book.display_title || book.title} pages={pages} displayBrightness={(book as unknown as { display_brightness?: number }).display_brightness} />
              </EarlyAccessGate>
            );
          }
          return <BookPagesSection bookId={book.id} bookTitle={book.display_title || book.title} pages={pages} displayBrightness={(book as unknown as { display_brightness?: number }).display_brightness} />;
        })()}
        <AuthCheck>
          <BookHistory bookId={book.id} />
        </AuthCheck>
      </main>
    </>
  );
}

export default async function BookDetailPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <div className="min-h-screen bg-cream">
      {/* Header - renders immediately */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-stone-700 hover:text-stone-900 transition-colors" aria-label="Source Library home">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1" />
            </svg>
            <span className="text-lg uppercase tracking-wider">
              <span className="font-semibold">Source</span>
              <span className="font-light">Library</span>
            </span>
          </Link>
          <UserMenu />
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
      <SignUpCTA />
    </div>
  );
}

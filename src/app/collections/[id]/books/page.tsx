import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import SiteHeader from '@/components/layout/SiteHeader';
import { getReadDb } from '@/lib/mongodb';
import { withTimeout, sanitizeThumbnail } from '@/lib/collections-utils';
import BookCardMini, { MiniBook } from '../../mycology/_components/BookCardMini';

export const revalidate = 86400;

const PAGE_SIZE = 48;
const RELATED_LIMIT = 18;

const BOOK_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1,
  language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
  thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1,
  is_first_translation: 1, ft_disposition: 1, 'translation_verification.disposition': 1,
} as const;

function toMini(b: Record<string, unknown>): MiniBook {
  return {
    ...(b as unknown as MiniBook),
    thumbnail: sanitizeThumbnail(b.thumbnail_blob as string) || sanitizeThumbnail(b.thumbnail as string),
    ft_disposition: (b.ft_disposition as string | undefined)
      || ((b.translation_verification as Record<string, unknown> | undefined)?.disposition as string | undefined),
  };
}

type SP = { page?: string; sort?: string; debug?: string };

async function getCollection(slug: string) {
  const db = await withTimeout(getReadDb(), 10000, null as unknown as Awaited<ReturnType<typeof getReadDb>>);
  if (!db) return { db: null, collection: null };
  const collection = await withTimeout(db.collection('collections').findOne({ slug }), 8000, null);
  return { db, collection };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { collection } = await getCollection(id);
  const name = (collection?.name as string) || id;
  return {
    title: `All books — ${name} — Source Library`,
    description: `Every book in the ${name} collection on Source Library.`,
    alternates: { canonical: `/collections/${id}/books` },
  };
}

// Tier 2: books elsewhere in the library that share the collection's index themes
// (NOT collection members). Best-effort + fully bounded; returns [] on any failure.
interface RelatedResult { books: MiniBook[]; terms: string[]; debug: Record<string, unknown> }

async function getRelatedBooks(
  db: Awaited<ReturnType<typeof getReadDb>>, slug: string,
): Promise<RelatedResult> {
  const debug: Record<string, unknown> = {};
  try {
    const books = db.collection('books');
    const memberDocs = await withTimeout(
      books.find({ collections: slug, visible: true }, { projection: { id: 1 }, maxTimeMS: 5000 }).limit(1000).toArray() as Promise<Record<string, unknown>[]>,
      5000, [],
    );
    const memberIds = memberDocs.map((d) => d.id as string);
    debug.members = memberIds.length;
    if (!memberIds.length) return { books: [], terms: [], debug };

    debug.indexedMembers = await withTimeout(db.collection('book_indexes').countDocuments({ book_id: { $in: memberIds } }, { maxTimeMS: 5000 }), 5000, -1);

    // Top index terms among the members → the collection's "theme".
    const termAgg = await withTimeout(
      db.collection('book_indexes').aggregate([
        { $match: { book_id: { $in: memberIds } } },
        { $project: { terms: { $concatArrays: [{ $ifNull: ['$keywords', []] }, { $ifNull: ['$concepts', []] }] } } },
        { $unwind: '$terms' },
        { $group: { _id: { $toLower: '$terms.term' }, n: { $sum: 1 } } },
        { $match: { _id: { $type: 'string' } } },
        { $sort: { n: -1 } },
        { $limit: 16 },
      ], { maxTimeMS: 6000 }).toArray() as Promise<Record<string, unknown>[]>,
      6000, [],
    );
    const themeTerms = termAgg.map((t) => t._id as string).filter((t) => t && t.length > 2);
    debug.themeTerms = termAgg.map((t) => `${t._id}(${t.n})`);
    if (themeTerms.length < 2) return { books: [], terms: themeTerms, debug };

    // Non-member books sharing ≥2 theme terms, ranked by overlap.
    const candAgg = await withTimeout(
      db.collection('book_indexes').aggregate([
        { $match: { book_id: { $nin: memberIds }, $or: [{ 'keywords.term': { $in: themeTerms } }, { 'concepts.term': { $in: themeTerms } }] } },
        { $project: { book_id: 1, all: { $map: { input: { $concatArrays: [{ $ifNull: ['$keywords', []] }, { $ifNull: ['$concepts', []] }] }, as: 't', in: { $toLower: '$$t.term' } } } } },
        { $project: { book_id: 1, score: { $size: { $setIntersection: ['$all', themeTerms] } } } },
        { $match: { score: { $gte: 2 } } },
        { $sort: { score: -1 } },
        { $limit: 60 },
      ], { maxTimeMS: 7000 }).toArray() as Promise<Record<string, unknown>[]>,
      7000, [],
    );
    const scoreMap = new Map(candAgg.map((c) => [c.book_id as string, c.score as number]));
    const candIds = [...scoreMap.keys()];
    debug.candidates = candIds.length;
    if (!candIds.length) return { books: [], terms: themeTerms, debug };

    const docs = await withTimeout(
      books.find({ id: { $in: candIds }, visible: true, pages_count: { $gt: 0 } }, { projection: BOOK_PROJECTION, maxTimeMS: 6000 }).toArray() as Promise<Record<string, unknown>[]>,
      6000, [],
    );
    debug.visibleCandidates = docs.length;
    const out = docs.map(toMini).sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0)).slice(0, RELATED_LIMIT);
    return { books: out, terms: themeTerms.slice(0, 6), debug };
  } catch (e) {
    debug.error = e instanceof Error ? e.message : 'failed';
    return { books: [], terms: [], debug };
  }
}

export default async function CollectionBooksPage(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> },
) {
  const { id } = await params;
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1);
  const sortKey = sp.sort === 'title' ? 'title' : 'year';

  const { db, collection } = await getCollection(id);
  if (!db) throw new Error('DB connection timeout');
  if (!collection) notFound();
  const name = (collection.name as string) || id;

  const books = db.collection('books');
  const memberFilter = { collections: id, visible: true, pages_count: { $gt: 0 } };
  const sort: Record<string, 1 | -1> = sortKey === 'title' ? { title: 1 } : { year: 1, title: 1 };

  const [memberRaw, total, related] = await Promise.all([
    withTimeout(books.find(memberFilter, { projection: BOOK_PROJECTION, maxTimeMS: 8000 }).sort(sort).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray() as Promise<Record<string, unknown>[]>, 8000, []),
    withTimeout(Promise.resolve(collection.book_count as number | undefined).then((c) => c ?? books.countDocuments(memberFilter, { maxTimeMS: 8000 })), 8000, 0),
    page === 1 ? getRelatedBooks(db, id) : Promise.resolve({ books: [] as MiniBook[], terms: [] as string[], debug: {} as Record<string, unknown> }),
  ]);
  const members = memberRaw.map(toMini);
  const totalPages = Math.max(1, Math.ceil((total || members.length) / PAGE_SIZE));
  const sortHref = (s: string) => `/collections/${id}/books?sort=${s}`;
  const pageHref = (p: number) => `/collections/${id}/books?sort=${sortKey}&page=${p}`;

  return (
    <>
      <SiteHeader variant="light" />
      <main className="bg-cream min-h-screen">
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-10 md:py-16">
          <Link href={`/collections/${id}`} className="inline-flex items-center gap-1 text-sm text-accent-rust hover:opacity-70 transition-opacity mb-4">
            <ArrowLeft className="w-4 h-4" /> Back to {name}
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-4 mb-2">
            <h1 className="text-3xl sm:text-4xl text-primary font-display">All books in {name}</h1>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted">Sort</span>
              <Link href={sortHref('year')} className={sortKey === 'year' ? 'text-primary font-medium' : 'text-muted hover:text-primary'}>Year</Link>
              <span className="text-border-medium">·</span>
              <Link href={sortHref('title')} className={sortKey === 'title' ? 'text-primary font-medium' : 'text-muted hover:text-primary'}>Title</Link>
            </div>
          </div>
          <p className="text-sm text-muted mb-8">{total.toLocaleString('en-US')} works in this collection</p>

          {members.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {members.map((b) => <BookCardMini key={b.id} book={b} />)}
            </div>
          ) : (
            <p className="text-sm text-muted">No books to show.</p>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-10 flex items-center justify-center gap-4">
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className="inline-flex items-center gap-1 text-sm text-primary hover:text-accent-rust transition-colors"><ChevronLeft className="w-4 h-4" /> Previous</Link>
              ) : <span className="inline-flex items-center gap-1 text-sm text-muted/40"><ChevronLeft className="w-4 h-4" /> Previous</span>}
              <span className="text-sm text-muted tabular-nums">Page {page} of {totalPages}</span>
              {page < totalPages ? (
                <Link href={pageHref(page + 1)} className="inline-flex items-center gap-1 text-sm text-primary hover:text-accent-rust transition-colors">Next <ChevronRight className="w-4 h-4" /></Link>
              ) : <span className="inline-flex items-center gap-1 text-sm text-muted/40">Next <ChevronRight className="w-4 h-4" /></span>}
            </div>
          )}

          {sp.debug === '1' && (
            <pre className="mt-12 p-4 bg-warm border border-border-light text-xs overflow-auto text-secondary">related debug: {JSON.stringify(related.debug, null, 2)}</pre>
          )}

          {/* Tier 2 — discovered, not curated. Clearly separated + labeled. */}
          {related.books.length > 0 && (
            <section className="mt-16 pt-10 border-t border-border-light">
              <h2 className="text-2xl text-primary font-display mb-1">Also across the library</h2>
              <p className="text-sm text-muted mb-1 max-w-2xl leading-relaxed">
                Books not in this collection that share its subjects — surfaced from each book&apos;s index, not hand-picked.
              </p>
              {related.terms.length > 0 && (
                <p className="text-xs text-muted mb-6">Matched on: {related.terms.join(' · ')}</p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {related.books.map((b) => <BookCardMini key={b.id} book={b} />)}
              </div>
              <p className="mt-6">
                <Link href="/librarian" className="inline-flex items-center gap-1 text-sm text-accent-rust hover:opacity-70 transition-opacity">
                  Search the whole library <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </p>
            </section>
          )}
        </div>
      </main>
    </>
  );
}

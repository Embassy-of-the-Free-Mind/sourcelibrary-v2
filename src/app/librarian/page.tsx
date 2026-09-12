import { connectToDatabase } from '@/lib/mongodb';
import LibrarianClient from './LibrarianClient';
import type { Locale } from '@/lib/locale-path';

export const revalidate = 86400; // 24h ISR

async function getHeroImages(): Promise<{ url: string; key: string }[]> {
  try {
    const { db } = await connectToDatabase();

    const images = await db.collection('gallery_images').aggregate([
      // Sample first so MongoDB uses its fast random-cursor optimization,
      // then filter — avoids a full scan of all matching documents.
      { $sample: { size: 200 } },
      {
        $match: {
          gallery_quality: { $gte: 0.8 },
          type: { $in: ['engraving', 'woodcut', 'diagram', 'illustration', 'painting'] },
          thumbnail_url: { $exists: true, $ne: '' },
        },
      },
      { $limit: 12 },
      {
        $project: {
          thumbnail_url: 1,
          _id: 1,
        },
      },
    ], { maxTimeMS: 8000 }).toArray();

    return images.map((img) => ({
      url: img.thumbnail_url as string,
      key: img._id.toString(),
    }));
  } catch (err) {
    console.error('[librarian] Failed to load hero images:', err);
    return [];
  }
}

async function getFeaturedPassage() {
  try {
    const { db } = await connectToDatabase();

    // First try: pick from research notebook findings (real, curated quotes from conversations)
    const notebooks = await db.collection('research_notebooks').aggregate([
      { $match: { 'findings.0': { $exists: true } } },
      { $unwind: '$findings' },
      { $match: { 'findings.quote': { $exists: true } } },
      { $sample: { size: 1 } },
      { $project: { finding: '$findings' } },
    ], { maxTimeMS: 3000 }).toArray();

    if (notebooks.length > 0) {
      const f = notebooks[0].finding;
      let text = (f.quote || '').trim().replace(/<[^>]+>/g, '').trim();
      if (text.length > 280) {
        const truncated = text.slice(0, 300);
        const cut = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('?'), truncated.lastIndexOf('!'));
        text = cut > 80 ? truncated.slice(0, cut + 1) : truncated.slice(0, 280) + '...';
      }
      if (text.length >= 60) {
        // Resolve page _id for deep linking (notebook stores slug, pages use book.id)
        const notebookSlug = f.source.bookSlug || f.source.bookId;
        const bookDoc = await db.collection('books').findOne(
          { $or: [{ slug: notebookSlug }, { id: notebookSlug }] },
          { projection: { id: 1, slug: 1 }, maxTimeMS: 3000 }
        );
        // The whole passage is a LINK. A notebook slug that resolves to no book
        // used to be returned anyway — the lookup's only job was the pageId and
        // its failure was ignored — so the "Librarian is reading" card pointed
        // at a 404. Measured 2026-08-21: 28 of 1,041 quotable findings (2.7%)
        // name a book that no longer exists under that slug (renames, deletions,
        // and a few malformed slugs with a `/page-number/N` tail baked in), and
        // the passage is picked at random, so ~1 in 37 librarian page loads —
        // English and Spanish alike — offered a dead link. If it does not
        // resolve, fall through to the random-passage path below rather than
        // render an unfollowable quote.
        if (bookDoc) {
          const pageDoc = await db.collection('pages').findOne(
            { book_id: bookDoc.id, page_number: f.source.pageNumber },
            { projection: { _id: 1 }, maxTimeMS: 3000 }
          );
          return {
            text,
            bookTitle: f.source.bookTitle,
            bookAuthor: f.source.bookAuthor,
            bookYear: null,
            // The book's OWN slug, not the notebook's copy of it: a book that
            // has been re-slugged still resolves by `id` above, and echoing the
            // stale slug back into the href would 404 just as surely.
            bookSlug: (bookDoc.slug as string) || (bookDoc.id as string),
            pageNumber: f.source.pageNumber,
            pageId: pageDoc?._id?.toString(),
          };
        }
      }
    }

    // Fallback: random translated page from a well-translated book
    const books = await db.collection('books').aggregate([
      { $match: { pages_translated: { $gt: 20 } } },
      { $sample: { size: 1 } },
      { $project: { title: 1, display_title: 1, author: 1, year: 1, slug: 1, id: 1 } },
    ], { maxTimeMS: 5000 }).toArray();

    if (!books.length) return null;
    const book = books[0];

    const results = await db.collection('pages').find(
      {
        book_id: book.id,
        'translation.data': { $exists: true, $ne: '' },
        page_number: { $gte: 3, $lte: 200 },
      },
      {
        projection: { book_id: 1, page_number: 1, 'translation.data': 1 },
        maxTimeMS: 5000,
      }
    ).toArray();

    results.sort(() => Math.random() - 0.5);

    let bestPage = null;
    for (const page of results) {
      const text = (page.translation?.data || '').trim();
      if (text.length < 80 || text.length > 600) continue;
      if (text.includes('<pb') || text.includes('<gap')) continue;
      if ((text.match(/</g) || []).length > 3) continue;
      if (/^\d/.test(text) || /^(chapter|section|part|index|table|page|finis)/i.test(text)) continue;
      if (/dedicated|preface|foreword|table of contents|bibliography/i.test(text.slice(0, 50))) continue;
      if (/^[A-Z]/.test(text)) { bestPage = page; break; }
      if (!bestPage) bestPage = page;
    }

    if (!bestPage) return null;

    let excerpt = (bestPage.translation?.data || '').trim().replace(/<[^>]+>/g, '').trim();
    if (excerpt.length > 280) {
      const truncated = excerpt.slice(0, 300);
      const cutPoint = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('?'), truncated.lastIndexOf('!'));
      excerpt = cutPoint > 80 ? truncated.slice(0, cutPoint + 1) : truncated.slice(0, 280) + '...';
    }

    return {
      text: excerpt,
      bookTitle: book.display_title || book.title,
      bookAuthor: book.author,
      bookYear: book.year,
      bookSlug: book.slug || book.id,
      pageNumber: bestPage.page_number,
      pageId: bestPage._id?.toString() || undefined,
    };
  } catch (err) {
    console.error('[librarian] Failed to load featured passage:', err);
    return null;
  }
}

/**
 * `lang` is set by the `/es/librarian` twin (src/app/es/librarian/page.tsx),
 * which re-exports this component — one page, two locales, no drift.
 */
export default async function LibrarianPage({ lang = 'en' }: { lang?: Locale } = {}) {
  const featuredPassage = await getFeaturedPassage();

  return (
    <LibrarianClient
      featuredPassage={featuredPassage}
      lang={lang}
    />
  );
}

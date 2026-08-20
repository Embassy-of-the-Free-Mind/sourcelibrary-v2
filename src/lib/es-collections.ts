import { getReadDb } from '@/lib/mongodb';
import { sortCollections, sanitizeThumbnail, coverOverride } from '@/lib/collections-utils';
import { toGalleryCardUrl } from '@/lib/utils';
import { ES_COLLECTION_NAMES } from '@/lib/home-i18n';
import { READING_LANGUAGE_PARAM } from '@/lib/reading-language';
import { localizedCollection, type LocalizedBookMap, type LocalizedCollectionMap } from '@/lib/localized';

/**
 * Data for the Spanish collection routes (`/es/collections`, `/es/collections/[id]`).
 *
 * These are deliberately thin twins of the English pages: the English
 * collection page is 1,700 lines of editorial apparatus (featured work, first-
 * translations slider, illustrations, quote band …) written in English. The
 * Spanish reader's need is narrower and sharper — *which books can I read, and
 * open them in Spanish* — so these pages show the collection's name, its intro,
 * and its books, with every card that has a Spanish edition linking STRAIGHT
 * into the reader in Spanish (`?lang=es`), Spanish editions first.
 *
 * Spanish text: `collections.localized.es` ({ name, subtitle, description } —
 * the one language-keyed map, see src/lib/localized.ts) wins; then the
 * homepage's ES_COLLECTION_NAMES for the name; then the stored English (shown
 * as-is and labelled, rather than machine-translated on the fly).
 */

export interface EsCollectionSummary {
  slug: string;
  name: string;
  subtitle?: string;
  bookCount: number;
  spanishBookCount: number;
  childrenCount: number;
  imageCandidates: string[];
}

export interface EsCollectionBook {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  editor?: string | null;
  year?: number;
  language?: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  pages_translated_es?: number;
  localized?: LocalizedBookMap;
  is_first_translation?: boolean;
  ft_disposition?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  image_display?: string;
  image_thumb?: string;
  /** Where the card goes: the Spanish reader for Spanish editions, else the book page. */
  href: string;
}

export interface EsCollectionDetail {
  slug: string;
  name: string;
  subtitle?: string;
  description?: string;
  /** True when the description shown is the stored English one. */
  descriptionIsEnglish: boolean;
  bookCount: number;
  spanishBookCount: number;
  books: EsCollectionBook[];
  /** Books beyond the cap shown here — the English page lists them all. */
  truncated: boolean;
  parent?: { slug: string; name: string } | null;
  heroCandidates: string[];
}

/** Books shown on a Spanish collection page; the English page lists the rest. */
export const ES_COLLECTION_BOOK_CAP = 120;

type FeaturedImage = { thumbnail_url?: string; extracted_url?: string; image_url?: string } | string;

function imageCandidates(images: FeaturedImage[] | undefined, slug: string, heroImage?: string): string[] {
  const urls: string[] = [];
  const add = (u: string | undefined | null) => {
    const s = sanitizeThumbnail(u);
    if (s && !urls.includes(s)) urls.push(s);
  };
  add(coverOverride(slug));
  add(heroImage);
  for (const img of images || []) {
    if (typeof img === 'string') { add(img); continue; }
    add(toGalleryCardUrl(img.thumbnail_url));
    add(img.thumbnail_url);
    add(img.extracted_url);
    add(img.image_url);
  }
  return urls;
}

// Mongo documents arrive untyped; localizedCollection() reads defensively, and
// the homepage's hand-written Spanish names fill in where no localized.es.name
// has been written yet.
function spanishCopy(doc: Record<string, unknown>) {
  const slug = typeof doc.slug === 'string' ? doc.slug : '';
  const l = localizedCollection(doc as Parameters<typeof localizedCollection>[0], 'es');
  const hasOwnName = !!(doc.localized as LocalizedCollectionMap | undefined)?.es?.name;
  if (!hasOwnName && ES_COLLECTION_NAMES[slug]) {
    return { ...l, name: ES_COLLECTION_NAMES[slug], subtitle: undefined };
  }
  return l;
}

/**
 * Where a card on a Spanish surface sends the reader: the Spanish book page,
 * which since #4082 phase 2 IS the English book page rendered with `lang='es'`.
 * Its "Leer en español" button opens the reader — and every link on it keeps
 * the `/es` prefix, so the locale never drops mid-visit.
 *
 * `pages_count` / `chapters` are accepted (and ignored) so existing callers
 * that pass a whole book document keep type-checking; where the reader LANDS is
 * decided by the book page itself.
 */
export function spanishReaderHref(book: { slug?: string; id: string; pages_count?: number; chapters?: { pageNumber?: number }[] }): string {
  return `/es/book/${encodeURIComponent(book.slug || book.id)}`;
}
// READING_LANGUAGE_PARAM stays exported for the legacy ?lang=es links still in the wild.
export { READING_LANGUAGE_PARAM };

const PUBLIC_COLLECTION = { visible: true, collection_type: { $ne: 'visual_art' } };

export async function getEsCollectionList(): Promise<EsCollectionSummary[]> {
  const db = await getReadDb();
  const [docs, childCounts, spanishCounts] = await Promise.all([
    db.collection('collections').find(
      { ...PUBLIC_COLLECTION, parent: { $exists: false }, type: { $ne: 'curated' } },
      { projection: { _id: 0, slug: 1, name: 1, subtitle: 1, localized: 1, book_count: 1, total_book_count: 1, featured_images: 1, hero_image: 1 }, maxTimeMS: 8000 },
    ).toArray(),
    db.collection('collections').aggregate<{ _id: string; count: number }>([
      { $match: { parent: { $exists: true }, visible: true } },
      { $unwind: '$parent' },
      { $group: { _id: '$parent', count: { $sum: 1 } } },
    ], { maxTimeMS: 8000 }).toArray(),
    // Which collections hold Spanish editions — indexed by the small set of
    // books that have them, never by scanning collections × books.
    db.collection('books').aggregate<{ _id: string; count: number }>([
      { $match: { pages_translated_es: { $gt: 0 }, visible: true } },
      { $unwind: '$collections' },
      { $group: { _id: '$collections', count: { $sum: 1 } } },
    ], { maxTimeMS: 8000 }).toArray(),
  ]);
  const children = new Map(childCounts.map((c) => [c._id, c.count]));
  const spanish = new Map(spanishCounts.map((c) => [c._id, c.count]));

  const list = docs.map((d) => ({
    slug: d.slug as string,
    name: spanishCopy(d).name,
    subtitle: spanishCopy(d).subtitle,
    bookCount: (d.total_book_count ?? d.book_count ?? 0) as number,
    spanishBookCount: spanish.get(d.slug) ?? 0,
    childrenCount: children.get(d.slug) ?? 0,
    imageCandidates: imageCandidates(d.featured_images, d.slug, d.hero_image),
    children_count: children.get(d.slug) ?? 0,
  }));
  // The Spanish-editions collection is what a Spanish reader came for: first.
  const sorted = sortCollections(list);
  sorted.sort((a, b) => Number(b.slug === 'en-espanol') - Number(a.slug === 'en-espanol'));
  return sorted.map(({ children_count: _c, ...rest }) => rest);
}

export async function getEsCollection(slug: string): Promise<EsCollectionDetail | null> {
  const db = await getReadDb();
  const doc = await db.collection('collections').findOne(
    { slug, ...PUBLIC_COLLECTION },
    { projection: { _id: 0, slug: 1, name: 1, subtitle: 1, description: 1, localized: 1, expanded_description: 1, book_count: 1, total_book_count: 1, parent: 1, featured_images: 1, hero_image: 1 }, maxTimeMS: 8000 },
  );
  if (!doc) return null;

  const [rawBooks, parentDoc] = await Promise.all([
    db.collection('books').find(
      { collections: slug, visible: true, pages_count: { $gt: 0 }, content_type: { $ne: 'artwork' }, resource_type: { $exists: false } },
      {
        projection: {
          _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, editor: 1, year: 1, language: 1,
          pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_translated_es: 1, localized: 1, is_first_translation: 1, ft_disposition: 1,
          thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1, read_count: 1, 'chapters.pageNumber': 1,
        },
        // Spanish editions first, then the most-read.
        sort: { pages_translated_es: -1, read_count: -1 },
        limit: ES_COLLECTION_BOOK_CAP + 1,
        maxTimeMS: 8000,
      },
    ).toArray(),
    typeof doc.parent === 'string'
      ? db.collection('collections').findOne({ slug: doc.parent, visible: true }, { projection: { _id: 0, slug: 1, name: 1, localized: 1 } })
      : Promise.resolve(null),
  ]);

  const truncated = rawBooks.length > ES_COLLECTION_BOOK_CAP;
  type RawBook = Omit<EsCollectionBook, 'href'> & { chapters?: { pageNumber?: number }[]; read_count?: number };
  const books: EsCollectionBook[] = (rawBooks as unknown as RawBook[]).slice(0, ES_COLLECTION_BOOK_CAP).map((b) => {
    const { chapters: _ch, read_count: _rc, ...rest } = b;
    return {
      ...rest,
      // An /es URL is a promise the page is in Spanish, so only a book with a
      // Spanish EDITION gets one; the rest link straight to their English page.
      // The route enforces the same rule with a 307, so a link that gets this
      // wrong is slow, not broken — but it should not be wrong.
      href: (b.pages_translated_es ?? 0) > 0
        ? spanishReaderHref(b)
        : `/book/${encodeURIComponent(b.slug || b.id)}`,
    };
  });

  const copy = spanishCopy(doc);
  const description = copy.description || (doc.expanded_description as string | undefined);
  return JSON.parse(JSON.stringify({
    slug,
    name: copy.name,
    subtitle: copy.subtitle,
    description,
    descriptionIsEnglish: copy.descriptionIsEnglish || (!copy.description && !!description),
    bookCount: (doc.total_book_count ?? doc.book_count ?? 0) as number,
    spanishBookCount: books.filter((b) => (b.pages_translated_es ?? 0) > 0).length,
    books,
    truncated,
    parent: parentDoc ? { slug: parentDoc.slug as string, name: spanishCopy(parentDoc).name } : null,
    heroCandidates: imageCandidates(doc.featured_images, slug, doc.hero_image),
  })) as EsCollectionDetail;
}

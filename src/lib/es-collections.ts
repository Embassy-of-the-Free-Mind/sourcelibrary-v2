import { getReadDb } from '@/lib/mongodb';
import { sortCollections, sanitizeThumbnail, coverOverride } from '@/lib/collections-utils';
import { toGalleryCardUrl } from '@/lib/utils';
import { ES_COLLECTION_NAMES } from '@/lib/home-i18n';
import { isNativeEdition, localizedCollection, localizedEditionFilter, type LocalizedBookMap, type LocalizedCollectionMap } from '@/lib/localized';

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
  /**
   * Sub-collections that hold Spanish books. The page linked only UP to its
   * parent, so a branch like americas → maya had no way down and the Maya
   * material was unreachable by clicking from anywhere on /es.
   */
  children: { slug: string; name: string; spanishBookCount: number; imageCandidates: string[] }[];
  heroCandidates: string[];
  /**
   * Language-NEUTRAL apparatus ported from the English page (#4152). The
   * Spanish twin was scoped to name + intro + books when /es held four books;
   * it now holds 170, and the gap had become "Spanish readers get a visibly
   * poorer page". What is portable is what carries no English prose: pictures,
   * counts and structure. The featured-work blurb, the quote band and the
   * curated "Essential Reading" tiers stay behind because they ARE English
   * editorial, and Spanish chrome around English copy is the half-measure
   * i18n.md rule 4 rejects.
   */
  galleryImages: EsGalleryImage[];
  /** Total illustrations available, so the strip can say what it is a sample of. */
  galleryTotal: number;
  /** Books in this collection flagged as a first translation, oldest first. */
  firstTranslations: EsCollectionBook[];
}

export interface EsGalleryImage {
  id?: string;
  url: string;
  description?: string;
  bookId?: string;
  bookTitle?: string;
}

/** Books shown on a Spanish collection page; the English page lists the rest. */
export const ES_COLLECTION_BOOK_CAP = 120;

/**
 * Is this book readable in Spanish — translated into it, or written in it?
 *
 * The JS twin of `localizedEditionFilter('es')`, which selects the same set in
 * Mongo. Both delegate to `NATIVE_EDITION_LANGUAGE` so the card, the count and
 * the query can never disagree about which books are Spanish; the route gate
 * (`hasLocalizedEdition`) is the third reader of that same rule.
 */
function hasEsEdition(b: { pages_translated_es?: number; language?: string }): boolean {
  return (b.pages_translated_es ?? 0) > 0 || isNativeEdition(b as unknown as Record<string, unknown>, 'es');
}

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

const PUBLIC_COLLECTION = { visible: true, collection_type: { $ne: 'visual_art' } };

/**
 * What leads the Spanish collections index, in order.
 *
 * Separate from `PINNED_COLLECTION_SLUGS` on purpose: that list is the English
 * homepage's curation, and a Spanish reader's front page is a different
 * editorial question. `en-espanol` is what they came for; the Mesoamerican
 * branch follows because it is the corpus we hold in their language — the
 * Ximénez Popol Vuh, Scherzer's editio princeps, Cogolludo, Landa, and the
 * Chilam Balam books — and because as leaf collections they would otherwise sit
 * in `sortCollections`' randomised tail forever.
 *
 * Anything not listed keeps its existing order behind these.
 *
 * `indigenous-sacred-narratives` is deliberately NOT here: it is `type:
 * 'curated'`, which the index query excludes, so pinning it would be a dead
 * entry. It reaches Spanish readers as a child of `americas` instead.
 */
const ES_PINNED = ['en-espanol', 'maya', 'mesoamerican', 'americas'];
const esPinRank = (slug: string) => {
  const i = ES_PINNED.indexOf(slug);
  return i === -1 ? ES_PINNED.length : i;
};

export async function getEsCollectionList(): Promise<EsCollectionSummary[]> {
  const db = await getReadDb();
  // Which collections hold Spanish editions, and how many — indexed by the small
  // set of books that have them, never by scanning collections × books. Fetched
  // FIRST because the collection query below selects on its keys; it was already
  // being computed here, so this is a reordering, not an extra round trip.
  const spanishCounts = await db.collection('books').aggregate<{ _id: string; count: number }>([
    { $match: { ...localizedEditionFilter('es'), visible: true } },
    { $unwind: '$collections' },
    { $group: { _id: '$collections', count: { $sum: 1 } } },
  ], { maxTimeMS: 8000 }).toArray();
  const spanishSlugs = spanishCounts.map((c) => c._id).filter((s): s is string => typeof s === 'string');

  const [docs, childCounts] = await Promise.all([
    db.collection('collections').find(
      // Top-level collections, PLUS any sub-collection that actually holds
      // Spanish books. The index used to be top-level-only, which made whole
      // branches unreachable: `maya` sits under `americas`, and `americas`
      // itself sits under `world-traditions`/`sacred-texts`, so neither
      // appeared — and the Spanish collection page links only UP to its parent,
      // never down to children. There was no path of clicks from /es to the
      // Maya material at all; /es/collections/maya returned 200 to anyone who
      // typed it and nothing linked there.
      {
        ...PUBLIC_COLLECTION,
        type: { $ne: 'curated' },
        $or: [{ parent: { $exists: false } }, { slug: { $in: spanishSlugs } }],
      },
      { projection: { _id: 0, slug: 1, name: 1, subtitle: 1, localized: 1, book_count: 1, total_book_count: 1, featured_images: 1, hero_image: 1 }, maxTimeMS: 8000 },
    ).toArray(),
    db.collection('collections').aggregate<{ _id: string; count: number }>([
      { $match: { parent: { $exists: true }, visible: true } },
      { $unwind: '$parent' },
      { $group: { _id: '$parent', count: { $sum: 1 } } },
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
  // Spanish-surface ordering. `sortCollections` pins the ENGLISH homepage's
  // curation (PINNED_COLLECTION_SLUGS) and shuffles the tail — good for the
  // English grid, wrong here, because a leaf like `maya` lands in the random
  // tail no matter how much Spanish it holds. ES_PINNED runs first and is
  // deliberately separate: editing it must not move the English grid.
  const sorted = sortCollections(list);
  sorted.sort((a, b) => esPinRank(a.slug) - esPinRank(b.slug));
  return sorted.map(({ children_count: _c, ...rest }) => rest);
}

export async function getEsCollection(slug: string): Promise<EsCollectionDetail | null> {
  const db = await getReadDb();
  const doc = await db.collection('collections').findOne(
    { slug, ...PUBLIC_COLLECTION },
    { projection: { _id: 0, slug: 1, name: 1, subtitle: 1, description: 1, localized: 1, expanded_description: 1, book_count: 1, total_book_count: 1, parent: 1, featured_images: 1, hero_image: 1 }, maxTimeMS: 8000 },
  );
  if (!doc) return null;

  const [rawBooks, parentDoc, childDocs, esCounts, gallery, rawFirstTranslations] = await Promise.all([
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
    // Sub-collections, so the branch can be walked DOWNWARD. `parent` is a
    // string on some docs and an array on others (americas has two parents), so
    // match both shapes — a plain equality check silently misses the arrays.
    db.collection('collections').find(
      { parent: slug, ...PUBLIC_COLLECTION },
      { projection: { _id: 0, slug: 1, name: 1, localized: 1, featured_images: 1, hero_image: 1 }, maxTimeMS: 8000 },
    ).toArray(),
    db.collection('books').aggregate<{ _id: string; count: number }>([
      { $match: { ...localizedEditionFilter('es'), visible: true } },
      { $unwind: '$collections' },
      { $group: { _id: '$collections', count: { $sum: 1 } } },
    ], { maxTimeMS: 8000 }).toArray(),
    // Illustrations — the same shape the English page uses, and gated the same
    // way (#4151): `luminance` keeps near-black and near-blank plates out, which
    // `gallery_quality` cannot do because a pristine scan of a dark mezzotint
    // scores 1.0. Images carry no language, so this is portable as-is.
    db.collection('books')
      .find({ collections: slug, visible: true }, { projection: { _id: 0, id: 1 }, maxTimeMS: 5000 })
      .toArray()
      .then(async (bs) => {
        const ids = bs.map((b) => b.id as string);
        if (!ids.length) return { images: [], total: 0 };
        const q = {
          book_id: { $in: ids.slice(0, 200) },
          book_visible: true,
          gallery_quality: { $gte: 0.85 },
          $or: [{ luminance: { $exists: false } }, { luminance: { $gte: 95, $lte: 240 } }],
          type: { $nin: ['decorative', 'symbol', 'musical_score', 'printer_device', 'printer_mark', 'ornament', 'border'] },
        };
        const [images, total] = await Promise.all([
          db.collection('gallery_images').find(q, {
            projection: { _id: 0, id: 1, thumbnail_url: 1, extracted_url: 1, image_url: 1, description: 1, book_id: 1, book_title: 1 },
            maxTimeMS: 3000,
          }).sort({ gallery_quality: -1 }).limit(60).toArray(),
          db.collection('gallery_images').countDocuments(q, { maxTimeMS: 3000 }),
        ]);
        return { images, total };
      })
      .catch(() => ({ images: [] as Record<string, unknown>[], total: 0 })),
    // First translations — chronological, like the English band.
    db.collection('books').find(
      { collections: slug, is_first_translation: true, pages_translated: { $gt: 0 }, visible: true },
      {
        projection: {
          _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, editor: 1, year: 1, language: 1,
          pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_translated_es: 1, localized: 1,
          is_first_translation: 1, ft_disposition: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1,
        },
        sort: { year: 1, title: 1 },
        limit: 12,
        maxTimeMS: 8000,
      },
    ).toArray().catch(() => []),
  ]);

  const esCountMap = new Map(esCounts.map((c) => [c._id, c.count]));
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
      //
      // "Edition" covers both ways a book can be in Spanish: TRANSLATED into it
      // (the counter) or WRITTEN in it (`language`). Cogolludo needs no pivot to
      // be Spanish, and testing the counter alone sent him to an English page.
      href: hasEsEdition(b) ? spanishReaderHref(b) : `/book/${encodeURIComponent(b.slug || b.id)}`,
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
    spanishBookCount: books.filter(hasEsEdition).length,
    books,
    truncated,
    parent: parentDoc ? { slug: parentDoc.slug as string, name: spanishCopy(parentDoc).name } : null,
    // Only children that actually hold Spanish books: an /es link into an empty
    // Spanish branch is the same broken promise the route gate exists to stop.
    children: childDocs
      .map((d) => ({
        slug: d.slug as string,
        name: spanishCopy(d).name,
        spanishBookCount: esCountMap.get(d.slug as string) ?? 0,
        imageCandidates: imageCandidates(d.featured_images as FeaturedImage[] | undefined, d.slug as string, d.hero_image as string | undefined),
      }))
      .filter((ch) => ch.spanishBookCount > 0)
      .sort((a, b) => b.spanishBookCount - a.spanishBookCount),
    galleryImages: (gallery.images as Record<string, unknown>[]).map((g) => ({
      id: g.id as string | undefined,
      url: sanitizeThumbnail((g.thumbnail_url || g.extracted_url || g.image_url) as string) || '',
      description: g.description as string | undefined,
      bookId: g.book_id as string | undefined,
      bookTitle: g.book_title as string | undefined,
    })).filter((g) => g.url),
    galleryTotal: gallery.total,
    firstTranslations: (rawFirstTranslations as unknown as RawBook[]).map((b) => ({
      ...b,
      href: hasEsEdition(b) ? spanishReaderHref(b) : `/book/${encodeURIComponent(b.slug || b.id)}`,
    })),
    heroCandidates: imageCandidates(doc.featured_images, slug, doc.hero_image),
  })) as EsCollectionDetail;
}

import { getReadDb } from '@/lib/mongodb';
import { imageCandidates, type FeaturedImage } from '@/lib/es-collections';
import { collectionName } from '@/lib/home-i18n';
import { localizedCollection, type LocalizedBookMap } from '@/lib/localized';
import type { StoredTranslationState } from '@/lib/translation-completeness';

/**
 * Data for /zh/collections and /zh/collections/<slug>.
 *
 * PRIOR ART: src/lib/es-collections.ts — its question is "which books can I read in Spanish?",
 * so it sorts by the Spanish counter and caps VOLUMES. Here the books are mostly already in the
 * reader's language and one work can be 700 volumes, so a card is a WORK.
 *
 * A collection appears on the index once it has `localized.zh.name`, so there is no audience
 * field to keep in step (#8035). A slug without one still renders, as a link from the showcase
 * or a parent can reach it: stored English name, English intro labelled.
 */

const PUBLIC = { visible: { $ne: false } };
const WORK_CAP = 200;

export interface ZhCollectionSummary {
  slug: string;
  name: string;
  bookCount: number;
  isExhibit: boolean;
  imageCandidates: string[];
}

export interface ZhWorkCard {
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
  translation_state?: StoredTranslationState | null;
  localized?: LocalizedBookMap;
  thumbnail?: string;
  thumbnail_blob?: string;
  image_display?: string;
  image_thumb?: string;
  /** Volumes of this work on this shelf. */
  vols: number;
}

export interface ZhCollectionDetail {
  slug: string;
  name: string;
  description?: string;
  descriptionIsEnglish: boolean;
  bookCount: number;
  works: ZhWorkCard[];
  truncated: boolean;
  parent: { slug: string; name: string } | null;
  children: { slug: string; name: string; bookCount: number; imageCandidates: string[] }[];
  heroCandidates: string[];
  heroImage?: string;
}

/** What leads the index: the exhibits a reader of Chinese came for, then the shelves. */
const ZH_PINNED = ['harmony-east-west', 'china-through-european-eyes', 'chinese-classics'];
const pinRank = (slug: string) => {
  const i = ZH_PINNED.indexOf(slug);
  return i === -1 ? ZH_PINNED.length : i;
};

type Doc = Record<string, unknown>;

function zhName(doc: Doc): string {
  const slug = String(doc.slug || '');
  const own = (doc.localized as { zh?: { name?: string } } | undefined)?.zh?.name;
  return own || collectionName('zh', slug, String(doc.name || ''));
}

const bookCount = (d: Doc) => Number(d.total_book_count ?? d.book_count ?? 0);

export async function getZhCollectionList(): Promise<ZhCollectionSummary[]> {
  const db = await getReadDb();
  const docs = await db.collection('collections').find(
    { ...PUBLIC, 'localized.zh.name': { $exists: true } },
    { projection: { _id: 0, slug: 1, name: 1, localized: 1, type: 1, kind: 1, book_count: 1, total_book_count: 1, featured_images: 1, hero_image: 1 }, maxTimeMS: 8000 },
  ).toArray();
  return docs
    .map((d) => ({
      slug: d.slug as string,
      name: zhName(d),
      bookCount: bookCount(d),
      isExhibit: d.kind === 'exhibit' || d.type === 'curated',
      imageCandidates: imageCandidates(d.featured_images as FeaturedImage[] | undefined, d.slug as string, d.hero_image as string | undefined),
    }))
    .sort((a, b) => pinRank(a.slug) - pinRank(b.slug) || b.bookCount - a.bookCount);
}

type RawVolume = Omit<ZhWorkCard, 'vols'> & { work_id?: string; read_count?: number };

// Numeric so "Vol. 5" comes before "Vol. 10" and the card opens the first volume. This is done
// here because a Mongo collation on the query would stop it using the `collections` index.
const byVolume = new Intl.Collator('zh', { numeric: true });

/** One entry per work, most-read first, each represented by its opening volume. */
export function groupByWork(rows: RawVolume[]): { doc: RawVolume; vols: number; reads: number }[] {
  const groups = new Map<string, { doc: RawVolume; vols: number; reads: number }>();
  for (const b of rows) {
    const key = b.work_id || b.id;
    const g = groups.get(key);
    if (!g) { groups.set(key, { doc: b, vols: 1, reads: b.read_count ?? 0 }); continue; }
    g.vols++;
    g.reads += b.read_count ?? 0;
    if (byVolume.compare(String(b.title), String(g.doc.title)) < 0) g.doc = b;
  }
  return [...groups.values()].sort((a, b) => b.reads - a.reads || byVolume.compare(String(a.doc.title), String(b.doc.title)));
}

export async function getZhCollection(slug: string): Promise<ZhCollectionDetail | null> {
  const db = await getReadDb();
  const doc = await db.collection('collections').findOne(
    { slug, ...PUBLIC },
    { projection: { _id: 0, slug: 1, name: 1, description: 1, expanded_description: 1, localized: 1, book_count: 1, total_book_count: 1, parent: 1, featured_images: 1, hero_image: 1 }, maxTimeMS: 8000 },
  );
  if (!doc) return null;

  // `parent` is a string on some docs and an array on others.
  const parentSlug = Array.isArray(doc.parent) ? (doc.parent[0] as string | undefined) : (doc.parent as string | undefined);
  const [groups, parentDoc, childDocs] = await Promise.all([
    db.collection('books').find(
      { collections: slug, visible: true, pages_count: { $gt: 0 }, content_type: { $ne: 'artwork' }, resource_type: { $exists: false } },
      {
        projection: {
          _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, editor: 1, year: 1, language: 1, work_id: 1, read_count: 1,
          pages_count: 1, pages_ocr: 1, pages_translated: 1, localized: 1,
          'translation_state.rung': 1, 'translation_state.english_original': 1,
          thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1,
        },
        maxTimeMS: 8000,
      },
    ).toArray().then((rows) => groupByWork(rows as unknown as RawVolume[])),
    parentSlug
      ? db.collection('collections').findOne({ slug: parentSlug, ...PUBLIC }, { projection: { _id: 0, slug: 1, name: 1, localized: 1 } })
      : Promise.resolve(null),
    db.collection('collections').find(
      { parent: slug, ...PUBLIC, 'localized.zh.name': { $exists: true } },
      { projection: { _id: 0, slug: 1, name: 1, localized: 1, book_count: 1, total_book_count: 1, featured_images: 1, hero_image: 1 }, maxTimeMS: 8000 },
    ).toArray(),
  ]);

  const copy = localizedCollection(doc as Parameters<typeof localizedCollection>[0], 'zh');
  const description = copy.description || (doc.expanded_description as string | undefined);
  const isChinese = (w: ZhWorkCard) => /chinese/i.test(String(w.language || ''));
  const works = groups
    .slice(0, WORK_CAP)
    .map((g) => {
      const { work_id: _w, read_count: _r, ...rest } = g.doc;
      return { ...rest, vols: g.vols };
    })
    // Stable: most-read order within each half.
    .sort((a, b) => Number(isChinese(b)) - Number(isChinese(a)));

  return JSON.parse(JSON.stringify({
    slug,
    name: zhName(doc),
    description,
    descriptionIsEnglish: copy.descriptionIsEnglish || (!copy.description && !!description),
    bookCount: bookCount(doc),
    works,
    truncated: groups.length > WORK_CAP,
    parent: parentDoc ? { slug: parentDoc.slug as string, name: zhName(parentDoc) } : null,
    children: childDocs
      .map((d) => ({
        slug: d.slug as string,
        name: zhName(d),
        bookCount: bookCount(d),
        imageCandidates: imageCandidates(d.featured_images as FeaturedImage[] | undefined, d.slug as string, d.hero_image as string | undefined),
      }))
      .sort((a, b) => b.bookCount - a.bookCount),
    heroCandidates: imageCandidates(doc.featured_images as FeaturedImage[] | undefined, slug, doc.hero_image as string | undefined),
    heroImage: doc.hero_image as string | undefined,
  })) as ZhCollectionDetail;
}

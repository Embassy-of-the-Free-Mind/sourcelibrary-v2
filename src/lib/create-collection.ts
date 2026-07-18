import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export interface CreateCollectionInput {
  slug: string;
  name: string;
  subtitle?: string;
  description?: string;
  color?: string;
  order?: number;
  /** ObjectId strings or string `id`s of books to tag into the collection. */
  bookIds?: string[];
  /**
   * When true, the collection is created as a hidden draft (`visible: false`)
   * with a `created_by` label. Used by the propose → approve flow so a curator
   * reviews the live page before flipping it public. Default: undefined (behaves
   * like the reader-facing create route, which sets no `visible` field).
   */
  draft?: boolean;
  createdBy?: string | null;
}

export interface CreateCollectionResult {
  collection: Record<string, unknown>;
  booksTagged: number;
  booksFound: { id: string; title: string }[];
}

/**
 * Shared collection-creation core used by both `POST /api/collections` (the
 * reader-facing create route) and the propose → approve flow
 * (`POST /api/collection-proposals/[id]/approve`).
 *
 * Resolves the given book ids (accepting either Mongo `_id` strings or the
 * string `id` field), tags each book with the collection slug via `$addToSet`,
 * computes the language breakdown + visible book count, and inserts the
 * `collections` doc. Throws `{ code: 'exists' }` if the slug is taken so callers
 * can return a 409.
 */
export async function createCollection(
  input: CreateCollectionInput,
): Promise<CreateCollectionResult> {
  const { slug, name, subtitle, description, color, order, bookIds, draft, createdBy } = input;

  if (!slug || !name) {
    throw Object.assign(new Error('slug and name are required'), { code: 'invalid' });
  }

  const db = await getDb();

  const existing = await db.collection('collections').findOne({ slug });
  if (existing) {
    throw Object.assign(new Error(`Collection "${slug}" already exists`), { code: 'exists' });
  }

  // Resolve books by ObjectId or string id.
  const ids = bookIds || [];
  const bookObjectIds = ids
    .map((id) => {
      try {
        return new ObjectId(id);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as ObjectId[];

  const books = await db
    .collection('books')
    .find(
      { $or: [{ _id: { $in: bookObjectIds } }, { id: { $in: ids } }] },
      { projection: { _id: 1, id: 1, title: 1, language: 1 } },
    )
    .toArray();

  const bookMongoIds = books.map((b) => b._id);
  if (bookMongoIds.length > 0) {
    await db
      .collection('books')
      .updateMany({ _id: { $in: bookMongoIds } }, { $addToSet: { collections: slug } });
  }

  // Language breakdown.
  const langCounts: Record<string, number> = {};
  for (const b of books) {
    const lang = (b.language as string) || 'Unknown';
    langCounts[lang] = (langCounts[lang] || 0) + 1;
  }
  const languages = Object.entries(langCounts)
    .map(([lang, count]) => ({ lang, count }))
    .sort((a, b) => b.count - a.count);

  // Visible book count — same filter as the collection detail page.
  const bookCount = await db.collection('books').countDocuments({
    collections: slug,
    visible: true,
    pages_count: { $gt: 0 },
  });

  const now = new Date();
  const collectionDoc: Record<string, unknown> = {
    slug,
    name,
    subtitle: subtitle || '',
    description: description || '',
    color: color || 'gold',
    order: order ?? 99,
    book_count: bookCount,
    languages,
    featured_images: [],
    created_at: now,
    updated_at: now,
  };
  if (draft) {
    collectionDoc.visible = false;
    collectionDoc.created_by = createdBy || null;
  }

  await db.collection('collections').insertOne(collectionDoc);

  return {
    collection: collectionDoc,
    booksTagged: books.length,
    booksFound: books.map((b) => ({ id: b.id as string, title: b.title as string })),
  };
}

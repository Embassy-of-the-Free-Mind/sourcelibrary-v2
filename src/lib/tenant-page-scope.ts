/**
 * Which untagged pages belong to a tenant, by way of their book.
 *
 * PRIOR ART: src/lib/tenant-library-loaders.ts — scopes BOOKS by tenantId, says nothing about pages;
 * the default-tenant `$in: [tenantId, null]` filter in /api/[tenant]/pages/* admits every untagged
 * page, which is right for the main library and would break partner lockdown here.
 *
 * Some tenant-owned books have page rows with no `tenantId` (Turris Babel, BPH). A page-read route
 * that filters on the page's own tag answers 404 for them, and the reader then moves the URL on a
 * turn while the page stays put. The book is what the tenant owns, so ask the book.
 *
 * Does not widen access: a page tagged for another tenant never matches, and an untagged page of a
 * global book or of another tenant's book is dropped.
 */
import { ObjectId, type Db, type Document, type WithId } from 'mongodb';

export async function findUntaggedPagesOfTenantBooks(
  db: Db,
  ids: string[],
  tenantId: string,
  projection?: Document,
): Promise<WithId<Document>[]> {
  if (ids.length === 0) return [];
  const oids = ids.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));
  // `tenantId: null` also matches a row with no such field. `_id` too: some pages have id != _id.
  const pages = await db.collection('pages').find(
    { $or: [{ id: { $in: ids } }, { _id: { $in: oids } }], tenantId: null },
    // book_id decides admission, so it is read even if the caller's projection leaves it out.
    projection ? { projection: withBookId(projection) } : undefined,
  ).toArray();
  if (pages.length === 0) return [];

  const bookIds = [...new Set(pages.map(p => String(p.book_id)))];
  const bookOids = bookIds.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));
  // A book is found by `id` OR `_id`: 16,343 books have a re-minted `_id`.
  const books = await db.collection('books').find(
    { $or: [{ id: { $in: bookIds } }, { _id: { $in: bookOids } }], tenantId },
    { projection: { id: 1 } },
  ).toArray();
  const owned = new Set(books.flatMap(b => [String(b._id), String(b.id)]));
  return pages.filter(p => owned.has(String(p.book_id)));
}

/** An exclusion projection already returns book_id; an inclusion one has to ask for it. */
function withBookId(projection: Document): Document {
  const inclusive = Object.entries(projection).some(([key, value]) => key !== '_id' && value === 1);
  return inclusive ? { ...projection, book_id: 1 } : projection;
}

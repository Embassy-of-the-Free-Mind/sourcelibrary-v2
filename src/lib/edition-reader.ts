import { getDb } from './mongodb';
import { Book, TranslationEdition } from './types';

/**
 * Resolve the translation text for a page as it was at the time an edition was published.
 *
 * Strategy:
 * 1. Find the edition by version string on the book
 * 2. Use edition.published_at as the reference timestamp
 * 3. Look in page_revisions for the first revision created AFTER published_at
 *    — that revision's `data` field contains the text that was live at publish time
 *    (because revisions save the OLD content before overwriting)
 * 4. If no such revision exists, the current page.translation.data hasn't changed since publish
 */

export interface VersionedPageContent {
  translation: string;
  isCurrentVersion: boolean; // true if the versioned text matches current page text
  edition: {
    version: string;
    versionLabel?: string;
    publishedAt: Date;
    doi?: string;
    doiUrl?: string;
  };
}

export async function getPageAtVersion(
  bookId: string,
  pageId: string,
  version: string
): Promise<VersionedPageContent | null> {
  const db = await getDb();

  // 1. Find the book and its edition
  const book = await db.collection('books').findOne(
    { $or: [{ id: bookId }, { slug: bookId }] },
    { projection: { editions: 1, id: 1 } }
  ) as unknown as Pick<Book, 'editions' | 'id'> | null;

  if (!book) return null;

  const editions = (book.editions || []) as TranslationEdition[];
  const edition = editions.find(e => e.version === version);
  if (!edition || !edition.published_at) return null;

  // Verify this page is in the edition
  if (!edition.page_ids.includes(pageId)) return null;

  const publishedAt = new Date(edition.published_at);

  // 2. Get the current page translation
  const page = await db.collection('pages').findOne(
    { id: pageId },
    { projection: { 'translation.data': 1, 'translation.content_hash': 1 } }
  );

  if (!page?.translation?.data) return null;

  // 3. Look for the first revision created AFTER published_at
  // This revision saved the old content (which was live at publish time) before overwriting
  const nextRevision = await db.collection('page_revisions').findOne(
    {
      page_id: pageId,
      field: 'translation',
      created_at: { $gt: publishedAt },
    },
    { sort: { created_at: 1 } }
  );

  // If a revision exists after publish, its data is what was live at publish time
  // If no revision exists, the current translation hasn't changed since publish
  const versionedText = nextRevision?.data ?? page.translation.data;
  const isCurrentVersion = versionedText === page.translation.data;

  return {
    translation: versionedText,
    isCurrentVersion,
    edition: {
      version: edition.version,
      versionLabel: edition.version_label,
      publishedAt,
      doi: edition.doi,
      doiUrl: edition.doi_url,
    },
  };
}

/**
 * Resolve versioned translation text for multiple pages at once (batch).
 * Used for prefetching adjacent pages in the reader.
 */
export async function getPagesAtVersion(
  bookId: string,
  pageIds: string[],
  version: string
): Promise<Map<string, VersionedPageContent>> {
  const db = await getDb();
  const results = new Map<string, VersionedPageContent>();

  // 1. Find the book and edition
  const book = await db.collection('books').findOne(
    { $or: [{ id: bookId }, { slug: bookId }] },
    { projection: { editions: 1, id: 1 } }
  ) as unknown as Pick<Book, 'editions' | 'id'> | null;

  if (!book) return results;

  const editions = (book.editions || []) as TranslationEdition[];
  const edition = editions.find(e => e.version === version);
  if (!edition || !edition.published_at) return results;

  const publishedAt = new Date(edition.published_at);
  const validPageIds = pageIds.filter(id => edition.page_ids.includes(id));
  if (validPageIds.length === 0) return results;

  // 2. Fetch current pages
  const pages = await db.collection('pages').find(
    { id: { $in: validPageIds } },
    { projection: { id: 1, 'translation.data': 1 } }
  ).toArray();

  const pageMap = new Map(pages.map(p => [p.id, p.translation?.data as string | undefined]));

  // 3. Fetch all relevant revisions in one query
  const revisions = await db.collection('page_revisions').aggregate([
    {
      $match: {
        page_id: { $in: validPageIds },
        field: 'translation',
        created_at: { $gt: publishedAt },
      },
    },
    { $sort: { created_at: 1 } },
    {
      $group: {
        _id: '$page_id',
        data: { $first: '$data' },
      },
    },
  ]).toArray();

  const revisionMap = new Map(revisions.map(r => [r._id as string, r.data as string]));

  // 4. Build results
  const editionMeta = {
    version: edition.version,
    versionLabel: edition.version_label,
    publishedAt,
    doi: edition.doi,
    doiUrl: edition.doi_url,
  };

  for (const pageId of validPageIds) {
    const currentText = pageMap.get(pageId);
    if (!currentText) continue;

    const versionedText = revisionMap.get(pageId) ?? currentText;
    results.set(pageId, {
      translation: versionedText,
      isCurrentVersion: versionedText === currentText,
      edition: editionMeta,
    });
  }

  return results;
}

/**
 * Keyword page search for the book-chat fallback (used when a book has no
 * chapter texts). Shared by the main and tenant chat routes.
 *
 * Scores EVERY matching page in the database and returns only the top
 * `limit`, so a relevant page late in a long book is never dropped. The
 * previous shape capped the candidate pool at `limit * 10` pages taken in
 * page order before scoring (#5187), which silently lost page 380 of a
 * 400-page book (#5220). Scoring server-side keeps the egress win of #5184:
 * only the `limit` winners' text leaves the database.
 *
 * Score = total case-insensitive occurrences of all keywords, same as the
 * old in-process scorer; ties go to the earlier page (the old sort was
 * stable over page order).
 *
 * PRIOR ART: src/app/api/books/[id]/chat/route.ts searchBookPages — the
 * in-route scorer this replaces; scripts/lib/page-terms-parse.mjs uses
 * $regexFindAll for term counting but is a script-side .mjs helper.
 */
import type { Db, Document, Filter } from 'mongodb';

export interface ChatPageHit {
  id?: string;
  book_id?: string;
  page_number: number;
  translation?: { data: string };
}

/**
 * @param scope   base filter, e.g. `{ book_id }` or `{ book_id, tenantId }`
 * @param keywords already extracted, lowercase `\w` tokens (regex-safe)
 */
export async function searchChatPages(
  db: Db,
  scope: Filter<Document>,
  keywords: string[],
  limit: number,
): Promise<ChatPageHit[]> {
  const base = { ...scope, 'translation.data': { $exists: true } };

  if (keywords.length === 0) {
    return await db.collection('pages')
      .find(base)
      .project({ _id: 0, id: 1, book_id: 1, page_number: 1, 'translation.data': 1 })
      .sort({ page_number: 1 })
      .limit(limit)
      .toArray() as unknown as ChatPageHit[];
  }

  // Guard $regexFindAll, which throws on a non-string input.
  const text = {
    $cond: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, '$translation.data', ''],
  };

  return await db.collection('pages').aggregate([
    {
      $match: {
        ...base,
        $or: keywords.map(k => ({ 'translation.data': new RegExp(k, 'i') })),
      },
    },
    {
      $project: {
        _id: 0, id: 1, book_id: 1, page_number: 1, 'translation.data': 1,
        _score: {
          $add: keywords.map(k => ({
            $size: { $regexFindAll: { input: text, regex: k, options: 'i' } },
          })),
        },
      },
    },
    { $sort: { _score: -1, page_number: 1 } },
    { $limit: limit },
    { $project: { _score: 0 } },
  ]).toArray() as unknown as ChatPageHit[];
}

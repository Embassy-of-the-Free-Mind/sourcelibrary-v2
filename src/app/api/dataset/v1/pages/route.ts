import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { validateApiKey, checkKeyRequestRate } from '@/lib/dataset/api-keys';
import { logAccess, getDailyPageCount } from '@/lib/dataset/access-logger';
import { DatasetPageRecord } from '@/lib/dataset/types';
import { markForExport } from '@/lib/provenance';
import { keyRef } from '@/lib/bot-attribution';

export const maxDuration = 30;

/**
 * Keyset cursor over the (book_id, page_number) sort key: "<book_id>:<page>".
 * Returns a Mongo clause selecting everything strictly after that point, or
 * null for an absent/malformed cursor (which falls back to `offset` rather
 * than erroring — a bad cursor should not lose a caller their whole walk).
 */
function parseCursor(after: string | null): Record<string, unknown> | null {
  if (!after) return null;
  const sep = after.lastIndexOf(':');
  if (sep <= 0) return null;
  const bookId = after.slice(0, sep);
  const pageNumber = parseInt(after.slice(sep + 1), 10);
  if (!bookId || !Number.isFinite(pageNumber)) return null;
  return {
    $or: [
      { book_id: { $gt: bookId } },
      { book_id: bookId, page_number: { $gt: pageNumber } },
    ],
  };
}

/**
 * GET /api/dataset/v1/pages
 *
 * Streaming JSONL endpoint for dataset pages.
 * Requires API key via Authorization: Bearer sl_data_...
 *
 * Query params:
 *   language  - filter by book language
 *   cluster   - filter by taxonomy cluster
 *   from_year - minimum publication year
 *   to_year   - maximum publication year
 *   content   - ocr, translation, or both (default: both)
 *   after     - keyset cursor "<book_id>:<page_number>"; USE THIS to walk the
 *               corpus. Echo the X-Next-Cursor response header back until it
 *               stops being returned. Constant-time; offset is not.
 *   offset    - pagination offset (default: 0). Fine for shallow reads; at
 *               deep offsets it walks every skipped document and will exceed
 *               maxDuration. Ignored when `after` is supplied.
 *   limit     - max records (default: 1000, max: 10000)
 */
export async function GET(request: NextRequest) {
  // Authenticate
  const apiKey = await validateApiKey(request.headers.get('authorization'));
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Invalid or missing API key. Get one at https://sourcelibrary.org/dataset' },
      { status: 401 }
    );
  }

  const rpm = checkKeyRequestRate(apiKey);
  if (!rpm.allowed) {
    return NextResponse.json(
      { error: 'Requests-per-minute limit reached for this key. Slow down and retry.' },
      { status: 429, headers: { 'Retry-After': String(rpm.retryAfter ?? 60) } }
    );
  }

  // Check daily page limit (explorer tier)
  if (apiKey.rate_limit.pages_per_day > 0) {
    const used = await getDailyPageCount(String(apiKey._id));
    if (used >= apiKey.rate_limit.pages_per_day) {
      return NextResponse.json(
        { error: `Daily page limit reached (${apiKey.rate_limit.pages_per_day}). Upgrade at https://sourcelibrary.org/dataset` },
        { status: 429, headers: { 'Retry-After': '86400' } }
      );
    }
  }

  const { searchParams } = new URL(request.url);
  const language = searchParams.get('language');
  const cluster = searchParams.get('cluster');
  const fromYear = searchParams.get('from_year');
  const toYear = searchParams.get('to_year');
  const content = searchParams.get('content') || 'both';
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0'));
  const limit = Math.min(10000, Math.max(1, parseInt(searchParams.get('limit') || '1000')));

  // Check permissions
  if (language && apiKey.permissions.languages !== '*') {
    if (!apiKey.permissions.languages.includes(language)) {
      return NextResponse.json(
        { error: `Your API key does not have access to "${language}". Upgrade your plan or contact sales.` },
        { status: 403 }
      );
    }
  }
  if (cluster && apiKey.permissions.clusters !== '*') {
    if (!apiKey.permissions.clusters.includes(cluster)) {
      return NextResponse.json(
        { error: `Your API key does not have access to cluster "${cluster}". Upgrade your plan or contact sales.` },
        { status: 403 }
      );
    }
  }

  const db = await getReadDb();

  // Build book filter
  const bookFilter: any = { visible: true };
  if (language) bookFilter.language = language;
  if (cluster) bookFilter['taxonomy.cluster'] = cluster;
  if (fromYear || toYear) {
    bookFilter.year = {};
    if (fromYear) bookFilter.year.$gte = parseInt(fromYear);
    if (toYear) bookFilter.year.$lte = parseInt(toYear);
  }

  // Require at least OCR or translation
  const pageFilter: any = {};
  if (content === 'ocr') {
    pageFilter['ocr.data'] = { $exists: true, $ne: '' };
  } else if (content === 'translation') {
    pageFilter['translation.data'] = { $exists: true, $ne: '' };
  } else {
    pageFilter.$or = [
      { 'ocr.data': { $exists: true, $ne: '' } },
      { 'translation.data': { $exists: true, $ne: '' } },
    ];
  }

  // Get matching book IDs with metadata.
  // pages.book_id holds the PUBLIC string id (books.id), never the ObjectId —
  // joining on _id matches nothing and this endpoint served 0 records for
  // every query until 2026-08-31 (books.id ≠ _id, see
  // book-deletion-and-identity.md). Positive control before shipping a change
  // here: one known-good language filter must return rows.
  const books = await db.collection('books')
    .find(bookFilter)
    .project({ _id: 1, id: 1, title: 1, author: 1, year: 1, language: 1, slug: 1, 'taxonomy.cluster': 1, 'taxonomy.subcluster': 1 })
    .toArray();

  const publicId = (b: { id?: string; _id?: unknown }) => b.id || String(b._id);
  const bookMap = new Map(books.map(b => [publicId(b), b]));
  const bookIds = books.map(publicId);

  if (bookIds.length === 0) {
    return new Response('', {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'X-Total-Records': '0',
      },
    });
  }

  // Query pages.
  // Two pagination modes. `after` is a keyset cursor on the sort key
  // (book_id, page_number) and is the one to use for walking the corpus:
  // measured on prod, offset=50000 costs 12.2s and grows linearly (it walks
  // every skipped doc), while the equivalent cursor read is 155ms and flat,
  // because {book_id:1, page_number:1} is indexed. At a few hundred thousand
  // rows in, offset alone exceeds this route's 30s maxDuration. `offset` is
  // kept for compatibility and for shallow reads.
  const cursorClause = parseCursor(searchParams.get('after'));
  const pageQuery = {
    $and: [
      { book_id: { $in: bookIds } },
      pageFilter,
      ...(cursorClause ? [cursorClause] : []),
    ],
  };

  const pages = await db.collection('pages')
    .find(pageQuery)
    .project({
      book_id: 1,
      page_number: 1,
      'ocr.data': 1,
      'translation.data': 1,
    })
    .sort({ book_id: 1, page_number: 1 })
    .skip(cursorClause ? 0 : offset)
    .limit(limit)
    .toArray();

  // Build JSONL. Every text field carries the invisible provenance imprimatur
  // with a key-derived ref (#4491): this is the KEYED bulk egress, and a key
  // is attribution by design — the mark names the consumer that pulled the
  // passage. Invisible, deliberately strippable (attribution, not DRM); a
  // negotiated bit-clean corpus is delivered offline, never through this
  // endpoint.
  const ref = keyRef(String(apiKey._id));
  const markText = (text: string | undefined, bookId: string) =>
    text ? markForExport(text, bookId, { ref }) : null;

  const bookIdsAccessed = new Set<string>();
  const lines: string[] = [];

  for (const page of pages) {
    const bookId = String(page.book_id);
    const book = bookMap.get(bookId);
    if (!book) continue;

    bookIdsAccessed.add(bookId);

    const record: DatasetPageRecord = {
      book_id: bookId,
      page_number: page.page_number,
      language: book.language || 'Unknown',
      original_text: markText(page.ocr?.data, bookId),
      english_translation: markText(page.translation?.data, bookId),
      book_title: book.title || '',
      author: book.author || '',
      year: book.year || null,
      cluster: book.taxonomy?.cluster || null,
      subcluster: book.taxonomy?.subcluster || null,
      source_url: `https://sourcelibrary.org/book/${book.slug || bookId}?page=${page.page_number}`,
    };

    lines.push(JSON.stringify(record));
  }

  // Log access (fire-and-forget)
  logAccess({
    api_key_id: apiKey._id,
    user_id: apiKey.user_id,
    timestamp: new Date(),
    endpoint: '/api/dataset/v1/pages',
    filters: { language, cluster, fromYear, toYear, content },
    records_returned: lines.length,
    book_ids: Array.from(bookIdsAccessed),
    format: 'jsonl',
    ip_address: request.headers.get('x-forwarded-for') || 'unknown',
  });

  // Keyset cursor for the next page. Derived from the last PAGE row, not the
  // last emitted line: a row whose book was filtered out still advances the
  // scan, and dropping it from the cursor would replay it forever.
  const lastPage = pages[pages.length - 1];
  const nextCursor = pages.length === limit && lastPage
    ? `${String(lastPage.book_id)}:${lastPage.page_number}`
    : null;

  return new Response(lines.join('\n') + (lines.length ? '\n' : ''), {
    status: 200,
    headers: {
      ...(nextCursor ? { 'X-Next-Cursor': nextCursor } : {}),
      'Content-Type': 'application/x-ndjson',
      'X-Total-Records': String(lines.length),
      'X-Offset': String(offset),
      'X-Limit': String(limit),
    },
  });
}

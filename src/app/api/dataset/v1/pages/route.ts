import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { validateApiKey } from '@/lib/dataset/api-keys';
import { logAccess, getDailyPageCount } from '@/lib/dataset/access-logger';
import { DatasetPageRecord } from '@/lib/dataset/types';

export const maxDuration = 30;

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
 *   offset    - pagination offset (default: 0)
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

  const db = await getDb();

  // Build book filter
  const bookFilter: any = { hidden: { $ne: true } };
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

  // Get matching book IDs with metadata
  const books = await db.collection('books')
    .find(bookFilter)
    .project({ _id: 1, title: 1, author: 1, year: 1, language: 1, slug: 1, 'taxonomy.cluster': 1, 'taxonomy.subcluster': 1 })
    .toArray();

  const bookMap = new Map(books.map(b => [String(b._id), b]));
  const bookIds = books.map(b => b._id);

  if (bookIds.length === 0) {
    return new Response('', {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'X-Total-Records': '0',
      },
    });
  }

  // Query pages
  const pages = await db.collection('pages')
    .find({
      book_id: { $in: bookIds },
      ...pageFilter,
    })
    .project({
      book_id: 1,
      page_number: 1,
      'ocr.data': 1,
      'translation.data': 1,
    })
    .sort({ book_id: 1, page_number: 1 })
    .skip(offset)
    .limit(limit)
    .toArray();

  // Build JSONL
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
      original_text: page.ocr?.data || null,
      english_translation: page.translation?.data || null,
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

  return new Response(lines.join('\n') + (lines.length ? '\n' : ''), {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'X-Total-Records': String(lines.length),
      'X-Offset': String(offset),
      'X-Limit': String(limit),
    },
  });
}

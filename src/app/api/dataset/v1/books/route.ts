import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { validateApiKey, checkKeyRequestRate } from '@/lib/dataset/api-keys';
import { logAccess } from '@/lib/dataset/access-logger';
import { getClientIp } from '@/lib/rate-limit';

export const maxDuration = 15;

/**
 * GET /api/dataset/v1/books
 *
 * Book-level metadata endpoint.
 * Requires API key via Authorization: Bearer sl_data_...
 *
 * Query params:
 *   language     - filter by book language
 *   cluster      - filter by taxonomy cluster
 *   from_year    - minimum publication year
 *   to_year      - maximum publication year
 *   has_translation - only books with translated pages
 *   offset       - pagination offset (default: 0)
 *   limit        - max records (default: 100, max: 1000)
 */
export async function GET(request: NextRequest) {
  const apiKey = await validateApiKey(request.headers.get('authorization'));
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Invalid or missing API key. Get one at https://sourcelibrary.org/dataset' },
      { status: 401 }
    );
  }

  // Same request-rate rule as every other keyed surface (#4366 parity).
  const rpm = checkKeyRequestRate(apiKey);
  if (!rpm.allowed) {
    return NextResponse.json(
      { error: 'Requests-per-minute limit reached for this key. Slow down and retry.' },
      { status: 429, headers: { 'Retry-After': String(rpm.retryAfter ?? 60) } }
    );
  }

  const { searchParams } = new URL(request.url);
  const language = searchParams.get('language');
  const cluster = searchParams.get('cluster');
  const fromYear = searchParams.get('from_year');
  const toYear = searchParams.get('to_year');
  const hasTranslation = searchParams.get('has_translation') === 'true';
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0'));
  const limit = Math.min(1000, Math.max(1, parseInt(searchParams.get('limit') || '100')));

  // Check permissions — languages AND clusters, exactly as the /pages twin
  // does. (This route silently skipped the cluster check; #4366 finding.)
  if (language && apiKey.permissions.languages !== '*' &&
      !apiKey.permissions.languages.includes(language)) {
    return NextResponse.json(
      { error: `Your API key does not have access to "${language}".` },
      { status: 403 }
    );
  }
  if (cluster && apiKey.permissions.clusters !== '*' &&
      !apiKey.permissions.clusters.includes(cluster)) {
    return NextResponse.json(
      { error: `Your API key does not have access to cluster "${cluster}".` },
      { status: 403 }
    );
  }

  const db = await getReadDb();
  const filter: any = { visible: true, pages_count: { $gt: 0 } };
  if (language) filter.language = language;
  if (cluster) filter['taxonomy.cluster'] = cluster;
  if (fromYear || toYear) {
    filter.year = {};
    if (fromYear) filter.year.$gte = parseInt(fromYear);
    if (toYear) filter.year.$lte = parseInt(toYear);
  }
  if (hasTranslation) filter.pages_translated = { $gt: 0 };

  const [books, total] = await Promise.all([
    db.collection('books')
      .find(filter)
      .project({
        _id: 1, id: 1, title: 1, author: 1, year: 1, language: 1, slug: 1,
        pages_count: 1, pages_ocr: 1, pages_translated: 1,
        'taxonomy.cluster': 1, 'taxonomy.subcluster': 1,
        categories: 1, ia_identifier: 1,
        // What the HOLDING LIBRARY stated about its page images. This endpoint
        // ships no images and no image URLs, so nothing here is licensed by it —
        // but a consumer who later wants the scans needs to know whose terms
        // apply, and `status` says whether we read that from the library's own
        // manifest or merely assumed it (#4939).
        'image_source.provider_name': 1, 'image_source.contributing_library': 1,
        'image_source.rights_normalized.class': 1,
        'image_source.rights_normalized.status': 1,
        'image_source.rights_normalized.statement_uri': 1,
        'image_source.rights_normalized.attribution_required': 1,
      })
      .sort({ language: 1, year: 1 })
      .skip(offset)
      .limit(limit)
      .toArray(),
    db.collection('books').countDocuments(filter),
  ]);

  // EU AI Act access log — the /pages twin has always done this; the omission
  // here made book-level harvesting invisible to the compliance log (#4366).
  logAccess({
    api_key_id: apiKey._id,
    user_id: apiKey.user_id,
    timestamp: new Date(),
    endpoint: 'books',
    filters: { language, cluster, from_year: fromYear, to_year: toYear, has_translation: hasTranslation, offset, limit },
    records_returned: books.length,
    book_ids: books.slice(0, 100).map(b => String(b._id)),
    format: 'json',
    ip_address: getClientIp(request),
  }, { countPages: false });

  return NextResponse.json({
    total,
    offset,
    limit,
    books: books.map(b => ({
      // The PUBLIC id — 16K+ re-created books re-minted their _id, and the id
      // returned here is what consumers feed to /pages and /api/books/:id.
      id: b.id || String(b._id),
      title: b.title,
      author: b.author,
      year: b.year,
      language: b.language,
      slug: b.slug,
      pages_count: b.pages_count || 0,
      pages_ocr: b.pages_ocr || 0,
      pages_translated: b.pages_translated || 0,
      cluster: b.taxonomy?.cluster || null,
      subcluster: b.taxonomy?.subcluster || null,
      categories: b.categories || [],
      url: `https://sourcelibrary.org/book/${b.slug || b._id}`,
      // Page images are NOT part of any dataset licence and are not served here;
      // they remain under the holding library's terms. Stated so a licensee can
      // filter rather than assume. `status: 'assumed-by-importer'` means we have
      // not verified it against the library's own record.
      image_rights: {
        holding_library: b.image_source?.contributing_library || b.image_source?.provider_name || null,
        class: b.image_source?.rights_normalized?.class || 'unknown',
        status: b.image_source?.rights_normalized?.status || 'unknown',
        statement_uri: b.image_source?.rights_normalized?.statement_uri || null,
        attribution_required: b.image_source?.rights_normalized?.attribution_required || null,
        note: 'Applies to the holding library\u2019s page images, which this dataset does not include.',
      },
    })),
  });
}

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 30;

/**
 * GET /api/admin/processing-csv
 * Downloads a CSV spreadsheet of all books with processing status.
 * Open directly in browser or import to Google Sheets.
 *
 * Query params:
 *   ?status=complete     — filter by pipeline_auto.status
 *   ?language=Latin       — filter by language
 *   ?sort=ocr_pct_asc    — sort order (default: title_asc)
 */
export const GET = withAuth(async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status') || '';
    const languageFilter = searchParams.get('language') || '';
    const sortParam = searchParams.get('sort') || 'title_asc';

    const db = await getDb();

    const query: Record<string, any> = {};
    if (statusFilter) {
      if (statusFilter === 'not_enrolled') {
        query['pipeline_auto.status'] = { $exists: false };
      } else {
        query['pipeline_auto.status'] = statusFilter;
      }
    }
    if (languageFilter) {
      query.language = { $regex: `^${languageFilter}$`, $options: 'i' };
    }

    // Run books query and batch_jobs aggregation in parallel
    const [books, ocrJobsByBook, transJobsByBook] = await Promise.all([
      db.collection('books')
        .find(query, {
          projection: {
            id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1,
            pages_count: 1, pages_ocr: 1, pages_translated: 1,
            'pipeline_auto.status': 1, 'pipeline_auto.queued_at': 1,
            'pipeline_auto.completed_at': 1, 'pipeline_auto.last_updated': 1,
            'pipeline_auto.error': 1,
            'image_source.provider': 1,
            created_at: 1, updated_at: 1,
            'reading_summary.overview': 1,
            'index.bookSummary': 1,
            chapters: 1,
          },
        })
        .sort({ created_at: -1 })
        .toArray(),

      // Latest OCR batch job per book (model, prompt, batch size)
      db.collection('batch_jobs').aggregate([
        { $match: { type: 'ocr' } },
        { $sort: { created_at: -1 } },
        { $group: {
          _id: '$book_id',
          model: { $first: '$model' },
          prompt_version: { $first: '$prompt_version' },
          page_count: { $first: '$page_count' },
          language: { $first: '$language' },
          status: { $first: '$status' },
          created_at: { $first: '$created_at' },
        }},
      ]).toArray(),

      // Latest translation batch job per book
      db.collection('batch_jobs').aggregate([
        { $match: { type: 'translation' } },
        { $sort: { created_at: -1 } },
        { $group: {
          _id: '$book_id',
          model: { $first: '$model' },
          prompt_version: { $first: '$prompt_version' },
          source_language: { $first: '$source_language' },
          target_language: { $first: '$target_language' },
          page_count: { $first: '$page_count' },
          status: { $first: '$status' },
          created_at: { $first: '$created_at' },
        }},
      ]).toArray(),
    ]);

    // Index batch job data by book_id for fast lookup
    const ocrJobs = new Map(ocrJobsByBook.map((j: any) => [j._id, j]));
    const transJobs = new Map(transJobsByBook.map((j: any) => [j._id, j]));

    // Build CSV
    const headers = [
      'book_id', 'title', 'author', 'year', 'language', 'source',
      'pages', 'ocr_pages', 'translated_pages', 'ocr_pct', 'translate_pct',
      'pipeline_status',
      'ocr_model', 'ocr_prompt', 'ocr_batch_size', 'ocr_batch_status', 'last_ocr_date',
      'trans_model', 'trans_prompt', 'trans_source_lang', 'trans_batch_size', 'trans_batch_status', 'last_trans_date',
      'has_summary', 'has_index', 'has_chapters',
      'pipeline_queued', 'pipeline_completed', 'pipeline_last_updated', 'pipeline_error',
      'imported_at', 'url',
    ];

    const rows = books.map((b: any) => {
      const id = b.id || b._id?.toString();
      const pages = b.pages_count || 0;
      const ocr = b.pages_ocr || 0;
      const translated = b.pages_translated || 0;
      const ocrPct = pages > 0 ? Math.round((ocr / pages) * 100) : 0;
      const transPct = pages > 0 ? Math.round((translated / pages) * 100) : 0;
      const pa = b.pipeline_auto || {};
      const oj = ocrJobs.get(id) || {};
      const tj = transJobs.get(id) || {};

      return [
        id,
        csvEscape(b.display_title || b.title || ''),
        csvEscape(b.author || ''),
        b.year || '',
        b.language || '',
        b.image_source?.provider || '',
        pages,
        ocr,
        translated,
        ocrPct,
        transPct,
        pa.status || 'not_enrolled',
        oj.model || '',
        oj.prompt_version || '',
        oj.page_count || '',
        oj.status || '',
        oj.created_at ? new Date(oj.created_at).toISOString() : '',
        tj.model || '',
        tj.prompt_version || '',
        tj.source_language || '',
        tj.page_count || '',
        tj.status || '',
        tj.created_at ? new Date(tj.created_at).toISOString() : '',
        b.reading_summary?.overview ? 'yes' : 'no',
        b.index?.bookSummary ? 'yes' : 'no',
        (b.chapters && b.chapters.length > 0) ? 'yes' : 'no',
        pa.queued_at ? new Date(pa.queued_at).toISOString() : '',
        pa.completed_at ? new Date(pa.completed_at).toISOString() : '',
        pa.last_updated ? new Date(pa.last_updated).toISOString() : '',
        csvEscape(pa.error || ''),
        b.created_at ? new Date(b.created_at).toISOString() : '',
        `https://sourcelibrary.org/book/${id}`,
      ].join(',');
    });

    // Sort
    const sortedRows = sortRows(rows, books, sortParam);

    const csv = [headers.join(','), ...sortedRows].join('\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sourcelibrary-processing-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Processing CSV error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
});

function csvEscape(val: string): string {
  if (!val) return '';
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function sortRows(rows: string[], books: any[], sort: string): string[] {
  // Create index array and sort based on original book data
  const indices = books.map((_, i) => i);

  switch (sort) {
    case 'ocr_pct_asc':
      indices.sort((a, b) => {
        const pa = books[a].pages_count || 0;
        const pb = books[b].pages_count || 0;
        const oa = pa > 0 ? (books[a].pages_ocr || 0) / pa : 0;
        const ob = pb > 0 ? (books[b].pages_ocr || 0) / pb : 0;
        return oa - ob;
      });
      break;
    case 'ocr_pct_desc':
      indices.sort((a, b) => {
        const pa = books[a].pages_count || 0;
        const pb = books[b].pages_count || 0;
        const oa = pa > 0 ? (books[a].pages_ocr || 0) / pa : 0;
        const ob = pb > 0 ? (books[b].pages_ocr || 0) / pb : 0;
        return ob - oa;
      });
      break;
    case 'pages_desc':
      indices.sort((a, b) => (books[b].pages_count || 0) - (books[a].pages_count || 0));
      break;
    case 'translate_pct_asc':
      indices.sort((a, b) => {
        const pa = books[a].pages_count || 0;
        const pb = books[b].pages_count || 0;
        const ta = pa > 0 ? (books[a].pages_translated || 0) / pa : 0;
        const tb = pb > 0 ? (books[b].pages_translated || 0) / pb : 0;
        return ta - tb;
      });
      break;
    case 'title_asc':
    default:
      indices.sort((a, b) =>
        ((books[a].display_title || books[a].title || '') as string)
          .localeCompare((books[b].display_title || books[b].title || '') as string)
      );
      break;
  }

  return indices.map(i => rows[i]);
}

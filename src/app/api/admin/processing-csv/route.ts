import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 30;

export interface ProcessingRow {
  book_id: string;
  title: string;
  author: string;
  year: number | string;
  language: string;
  source: string;
  pages: number;
  ocr_pages: number;
  translated_pages: number;
  ocr_pct: number;
  translate_pct: number;
  pipeline_status: string;
  ocr_model: string;
  ocr_prompt: string;
  ocr_batch_size: number | string;
  ocr_batch_status: string;
  last_ocr_date: string;
  trans_model: string;
  trans_prompt: string;
  trans_source_lang: string;
  trans_batch_size: number | string;
  trans_batch_status: string;
  last_trans_date: string;
  has_summary: boolean;
  has_index: boolean;
  has_chapters: boolean;
  pipeline_queued: string;
  pipeline_completed: string;
  pipeline_last_updated: string;
  pipeline_error: string;
  imported_at: string;
  url: string;
}

/**
 * GET /api/admin/processing-csv
 * Returns all books with processing status.
 *
 * Query params:
 *   ?format=json         — return JSON (default: csv)
 *   ?status=complete     — filter by pipeline_auto.status
 *   ?language=Latin       — filter by language
 *   ?sort=ocr_pct_asc    — sort order (default: title_asc)
 */
export const GET = withAdminAuth(async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'csv';
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

    const ocrJobs = new Map(ocrJobsByBook.map((j: any) => [j._id, j]));
    const transJobs = new Map(transJobsByBook.map((j: any) => [j._id, j]));

    // Build row data
    const rows: ProcessingRow[] = books.map((b: any) => {
      const id = b.id || b._id?.toString();
      const pages = b.pages_count || 0;
      const ocr = b.pages_ocr || 0;
      const translated = b.pages_translated || 0;
      const pa = b.pipeline_auto || {};
      const oj = ocrJobs.get(id) || {} as any;
      const tj = transJobs.get(id) || {} as any;

      return {
        book_id: id,
        title: b.display_title || b.title || '',
        author: b.author || '',
        year: b.year || '',
        language: b.language || '',
        source: b.image_source?.provider || '',
        pages,
        ocr_pages: ocr,
        translated_pages: translated,
        ocr_pct: pages > 0 ? Math.round((ocr / pages) * 100) : 0,
        translate_pct: pages > 0 ? Math.round((translated / pages) * 100) : 0,
        pipeline_status: pa.status || 'not_enrolled',
        ocr_model: oj.model || '',
        ocr_prompt: oj.prompt_version || '',
        ocr_batch_size: oj.page_count || '',
        ocr_batch_status: oj.status || '',
        last_ocr_date: oj.created_at ? new Date(oj.created_at).toISOString() : '',
        trans_model: tj.model || '',
        trans_prompt: tj.prompt_version || '',
        trans_source_lang: tj.source_language || '',
        trans_batch_size: tj.page_count || '',
        trans_batch_status: tj.status || '',
        last_trans_date: tj.created_at ? new Date(tj.created_at).toISOString() : '',
        has_summary: !!b.reading_summary?.overview,
        has_index: !!b.index?.bookSummary,
        has_chapters: !!(b.chapters && b.chapters.length > 0),
        pipeline_queued: pa.queued_at ? new Date(pa.queued_at).toISOString() : '',
        pipeline_completed: pa.completed_at ? new Date(pa.completed_at).toISOString() : '',
        pipeline_last_updated: pa.last_updated ? new Date(pa.last_updated).toISOString() : '',
        pipeline_error: pa.error || '',
        imported_at: b.created_at ? new Date(b.created_at).toISOString() : '',
        url: `https://sourcelibrary.org/book/${id}`,
      };
    });

    // Sort
    sortRows(rows, sortParam);

    if (format === 'json') {
      return NextResponse.json({ rows, total: rows.length });
    }

    // CSV output
    const csvHeaders = [
      'book_id', 'title', 'author', 'year', 'language', 'source',
      'pages', 'ocr_pages', 'translated_pages', 'ocr_pct', 'translate_pct',
      'pipeline_status',
      'ocr_model', 'ocr_prompt', 'ocr_batch_size', 'ocr_batch_status', 'last_ocr_date',
      'trans_model', 'trans_prompt', 'trans_source_lang', 'trans_batch_size', 'trans_batch_status', 'last_trans_date',
      'has_summary', 'has_index', 'has_chapters',
      'pipeline_queued', 'pipeline_completed', 'pipeline_last_updated', 'pipeline_error',
      'imported_at', 'url',
    ];

    const csvRows = rows.map(r =>
      csvHeaders.map(h => {
        const val = r[h as keyof ProcessingRow];
        if (typeof val === 'boolean') return val ? 'yes' : 'no';
        return csvEscape(String(val ?? ''));
      }).join(',')
    );

    const csv = [csvHeaders.join(','), ...csvRows].join('\n');

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

function sortRows(rows: ProcessingRow[], sort: string): void {
  switch (sort) {
    case 'ocr_pct_asc':
      rows.sort((a, b) => a.ocr_pct - b.ocr_pct);
      break;
    case 'ocr_pct_desc':
      rows.sort((a, b) => b.ocr_pct - a.ocr_pct);
      break;
    case 'pages_desc':
      rows.sort((a, b) => b.pages - a.pages);
      break;
    case 'translate_pct_asc':
      rows.sort((a, b) => a.translate_pct - b.translate_pct);
      break;
    case 'translate_pct_desc':
      rows.sort((a, b) => b.translate_pct - a.translate_pct);
      break;
    case 'title_asc':
    default:
      rows.sort((a, b) => a.title.localeCompare(b.title));
      break;
  }
}

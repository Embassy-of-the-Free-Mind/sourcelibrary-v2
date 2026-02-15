import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import type { ProcessingRow } from '@/lib/api-client/types/analytics';

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stepFilter = searchParams.get('step') || '';
    const sort = searchParams.get('sort') || 'date_desc';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');
    const search = searchParams.get('search') || '';

    const db = await getDb();

    const infraSteps = ['split', 'archive', 'thumbnail'];
    const isInfraFilter = infraSteps.includes(stepFilter);
    const isAiFilter = stepFilter && !isInfraFilter && stepFilter !== 'import';

    // Run all queries in parallel
    const [importRows, aiRows, infraRows] = await Promise.all([
      // Query A: Books (import rows)
      (!stepFilter || stepFilter === 'import') ? getImportRows(db, search) : [],
      // Query B: AI processing from gemini_usage
      (!stepFilter || isAiFilter) ? getAiRows(db, isAiFilter ? stepFilter : '', search) : [],
      // Query C: Infrastructure steps (split, archive, thumbnail) from pages collection
      (!stepFilter || isInfraFilter) ? getInfraRows(db, isInfraFilter ? stepFilter : '', search) : [],
    ]);

    // Merge all rows
    let allRows: ProcessingRow[] = [...importRows, ...aiRows, ...infraRows];

    // Sort
    if (sort === 'date_asc') {
      allRows.sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());
    } else if (sort === 'cost_desc') {
      allRows.sort((a, b) => b.cost_usd - a.cost_usd);
    } else if (sort === 'pages_desc') {
      allRows.sort((a, b) => b.pages - a.pages);
    } else {
      // date_desc (default)
      allRows.sort((a, b) => new Date(b.date_start).getTime() - new Date(a.date_start).getTime());
    }

    const total = allRows.length;

    // Compute summary before pagination
    const bookIds = new Set(allRows.map(r => r.book_id));
    const summary = {
      total_steps: total,
      total_cost: allRows.reduce((sum, r) => sum + r.cost_usd, 0),
      books_processed: bookIds.size,
      pages_processed: allRows.reduce((sum, r) => sum + r.pages, 0),
    };

    // Paginate
    const rows = allRows.slice(offset, offset + limit);

    return NextResponse.json({ rows, total, summary }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
    });
  } catch (error) {
    console.error('Processing overview error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

async function getImportRows(db: any, search: string): Promise<ProcessingRow[]> {
  const query: any = {};
  if (search) {
    query.title = { $regex: search, $options: 'i' };
  }

  const books = await db.collection('books')
    .find(query, {
      projection: {
        _id: 1,
        title: 1,
        display_title: 1,
        created_at: 1,
        pages_count: 1,
      },
    })
    .sort({ created_at: -1 })
    .toArray();

  return books.map((book: any) => ({
    book_id: book._id.toString(),
    book_title: book.display_title || book.title || 'Untitled',
    step: 'import' as const,
    date_start: book.created_at ? new Date(book.created_at).toISOString() : new Date().toISOString(),
    pages: book.pages_count || 0,
    cost_usd: 0,
    success_count: 1,
    failed_count: 0,
  }));
}

async function getAiRows(db: any, stepFilter: string, search: string): Promise<ProcessingRow[]> {
  const matchStage: any = {
    status: { $in: ['success', 'failed'] },
  };

  if (stepFilter) {
    matchStage.type = stepFilter;
  }

  // If searching, we need to get matching book IDs first
  // Note: gemini_usage.book_id stores the string `id` field, not the ObjectId `_id`
  if (search) {
    const matchingBooks = await db.collection('books')
      .find({ title: { $regex: search, $options: 'i' } }, { projection: { id: 1 } })
      .toArray();
    const bookIds = matchingBooks.map((b: any) => b.id);
    if (bookIds.length === 0) return [];
    matchStage.book_id = { $in: bookIds };
  }

  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: { book_id: '$book_id', type: '$type' },
        book_title: { $last: '$book_title' },
        model: { $last: '$model' },
        prompt_version: { $last: '$prompt_version' },
        mode: { $last: '$mode' },
        date_start: { $min: '$timestamp' },
        date_end: { $max: '$timestamp' },
        page_count: { $sum: 1 },
        cost_usd: { $sum: { $ifNull: ['$cost_usd', 0] } },
        success_count: {
          $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] },
        },
        failed_count: {
          $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
        },
      },
    },
    { $sort: { date_start: -1 as const } },
  ];

  const results = await db.collection('gemini_usage').aggregate(pipeline).toArray();

  // Collect book IDs with missing titles to look up from books collection
  // Note: gemini_usage.book_id stores the string `id` field, not the ObjectId `_id`
  const missingTitleIds = [...new Set(
    results
      .filter((r: any) => !r.book_title)
      .map((r: any) => r._id.book_id)
  )];

  let titleMap: Record<string, string> = {};
  if (missingTitleIds.length > 0) {
    const books = await db.collection('books')
      .find({ id: { $in: missingTitleIds } }, { projection: { id: 1, title: 1, display_title: 1 } })
      .toArray();
    for (const book of books) {
      titleMap[book.id] = book.display_title || book.title || 'Untitled';
    }
  }

  return results.map((r: any) => ({
    book_id: r._id.book_id,
    book_title: r.book_title || titleMap[r._id.book_id] || 'Unknown',
    step: r._id.type as ProcessingRow['step'],
    model: r.model,
    prompt_version: r.prompt_version,
    mode: r.mode,
    date_start: r.date_start ? new Date(r.date_start).toISOString() : new Date().toISOString(),
    date_end: r.date_end ? new Date(r.date_end).toISOString() : undefined,
    pages: r.page_count || 0,
    cost_usd: r.cost_usd || 0,
    success_count: r.success_count || 0,
    failed_count: r.failed_count || 0,
  }));
}

/**
 * Infrastructure steps (split detection, archiving, thumbnailing) — aggregated from pages collection.
 * Each row = one book that has pages with the given processing marker.
 */
async function getInfraRows(db: any, stepFilter: string, search: string): Promise<ProcessingRow[]> {
  // Get book IDs + titles if searching
  let bookFilter: any = {};
  let bookTitleMap: Record<string, string> = {};

  if (search) {
    const matchingBooks = await db.collection('books')
      .find({ title: { $regex: search, $options: 'i' } }, { projection: { id: 1, title: 1, display_title: 1 } })
      .toArray();
    if (matchingBooks.length === 0) return [];
    bookFilter.book_id = { $in: matchingBooks.map((b: any) => b.id) };
    for (const b of matchingBooks) {
      bookTitleMap[b.id] = b.display_title || b.title || 'Untitled';
    }
  }

  const rows: ProcessingRow[] = [];

  // Define the three infra steps and their page-level markers
  const stepDefs: { step: ProcessingRow['step']; match: any; dateField: string }[] = [
    {
      step: 'split',
      match: { 'split_detection': { $exists: true } },
      dateField: '$updated_at',
    },
    {
      step: 'archive',
      match: { 'archived_photo': { $exists: true, $ne: null } },
      dateField: '$archive_metadata.archived_at',
    },
    {
      step: 'thumbnail',
      match: { 'thumbnail_blob': { $exists: true, $ne: null } },
      dateField: '$updated_at',
    },
  ];

  const stepsToQuery = stepFilter ? stepDefs.filter(s => s.step === stepFilter) : stepDefs;

  // Run all step aggregations in parallel
  const allResults = await Promise.all(stepsToQuery.map(async ({ step, match, dateField }) => {
    const pipeline = [
      { $match: { ...match, ...bookFilter } },
      {
        $group: {
          _id: '$book_id',
          page_count: { $sum: 1 },
          date_start: { $min: { $ifNull: [dateField, '$updated_at'] } },
          date_end: { $max: { $ifNull: [dateField, '$updated_at'] } },
        },
      },
    ];

    const results = await db.collection('pages').aggregate(pipeline).toArray();
    return { step, results };
  }));

  // Collect all book IDs that need title lookups
  const needsTitleIds = new Set<string>();
  for (const { results } of allResults) {
    for (const r of results) {
      if (!bookTitleMap[r._id]) needsTitleIds.add(r._id);
    }
  }

  if (needsTitleIds.size > 0) {
    const books = await db.collection('books')
      .find({ id: { $in: [...needsTitleIds] } }, { projection: { id: 1, title: 1, display_title: 1 } })
      .toArray();
    for (const b of books) {
      bookTitleMap[b.id] = b.display_title || b.title || 'Untitled';
    }
  }

  for (const { step, results } of allResults) {
    for (const r of results) {
      rows.push({
        book_id: r._id,
        book_title: bookTitleMap[r._id] || 'Unknown',
        step,
        date_start: r.date_start ? new Date(r.date_start).toISOString() : new Date().toISOString(),
        date_end: r.date_end ? new Date(r.date_end).toISOString() : undefined,
        pages: r.page_count || 0,
        cost_usd: 0,
        success_count: r.page_count || 0,
        failed_count: 0,
      });
    }
  }

  return rows;
}

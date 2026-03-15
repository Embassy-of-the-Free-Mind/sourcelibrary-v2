import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import type { ProcessingRow } from '@/lib/api-client/types/analytics';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 60;

export const GET = withAdminAuth(async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const stepFilter = searchParams.get('step') || '';
    const sort = searchParams.get('sort') || 'date_desc';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');
    const search = searchParams.get('search') || '';

    const db = await getDb();

    // Resolve search → book IDs once, share across all queries
    let searchBookIds: string[] | null = null;
    if (search) {
      const matchingBooks = await db.collection('books')
        .find({
          $or: [
            { title: { $regex: search, $options: 'i' } },
            { display_title: { $regex: search, $options: 'i' } },
          ],
        }, { projection: { id: 1 } })
        .toArray();
      searchBookIds = matchingBooks.map((b: any) => b.id);
      if (searchBookIds.length === 0) {
        return NextResponse.json({ rows: [], total: 0, summary: { total_steps: 0, total_cost: 0, books_processed: 0, pages_processed: 0 } }, {
          headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
        });
      }
    }

    // Infrastructure steps scan the entire pages collection (~900k docs) —
    // only run when the user explicitly filters to that step.
    const infraSteps = ['split', 'archive', 'thumbnail'];
    const isInfraFilter = infraSteps.includes(stepFilter);
    const bookSteps = ['import', 'pipeline', 'edition'];
    const isBookFilter = bookSteps.includes(stepFilter);
    const isAiFilter = stepFilter && !isInfraFilter && !isBookFilter && stepFilter !== 'batch_job';

    // Run queries in parallel — only include what's needed
    const [bookRows, aiRows, infraRows, batchRows] = await Promise.all([
      (!stepFilter || isBookFilter) ? getBookRows(db, isBookFilter ? stepFilter : '', searchBookIds) : [],
      (!stepFilter || isAiFilter) ? getAiRows(db, isAiFilter ? stepFilter : '', searchBookIds) : [],
      isInfraFilter ? getInfraRows(db, stepFilter, searchBookIds) : [],
      (!stepFilter || stepFilter === 'batch_job') ? getBatchJobRows(db, searchBookIds) : [],
    ]);

    // Merge all rows
    let allRows: ProcessingRow[] = [...bookRows, ...aiRows, ...infraRows, ...batchRows];

    // Sort
    const sortFn = getSortFn(sort);
    allRows.sort(sortFn);

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
});

function getSortFn(sort: string): (a: ProcessingRow, b: ProcessingRow) => number {
  switch (sort) {
    case 'date_asc':
      return (a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime();
    case 'cost_desc':
      return (a, b) => b.cost_usd - a.cost_usd;
    case 'cost_asc':
      return (a, b) => a.cost_usd - b.cost_usd;
    case 'pages_desc':
      return (a, b) => b.pages - a.pages;
    case 'pages_asc':
      return (a, b) => a.pages - b.pages;
    case 'book_asc':
      return (a, b) => a.book_title.localeCompare(b.book_title);
    case 'book_desc':
      return (a, b) => b.book_title.localeCompare(a.book_title);
    case 'step_asc':
      return (a, b) => a.step.localeCompare(b.step);
    case 'step_desc':
      return (a, b) => b.step.localeCompare(a.step);
    case 'status_desc':
      return (a, b) => b.failed_count - a.failed_count;
    case 'status_asc':
      return (a, b) => a.failed_count - b.failed_count;
    default: // date_desc
      return (a, b) => new Date(b.date_start).getTime() - new Date(a.date_start).getTime();
  }
}

/**
 * Book-level rows: import, pipeline status, editions — all from the books collection.
 * Only projects the fields needed for the active stepFilter to reduce transfer.
 */
async function getBookRows(db: any, stepFilter: string, searchBookIds: string[] | null): Promise<ProcessingRow[]> {
  const query: any = {};
  if (searchBookIds) {
    query.id = { $in: searchBookIds };
  }

  // Only project what we need based on filter
  const projection: any = { id: 1, _id: 1, title: 1, display_title: 1, created_at: 1, pages_count: 1 };
  if (!stepFilter || stepFilter === 'pipeline') {
    projection['pipeline_auto.status'] = 1;
    projection['pipeline_auto.queued_at'] = 1;
    projection['pipeline_auto.completed_at'] = 1;
    projection['pipeline_auto.last_updated'] = 1;
  }
  if (!stepFilter || stepFilter === 'edition') {
    projection.editions = 1;
  }

  const books = await db.collection('books')
    .find(query, { projection })
    .sort({ created_at: -1 })
    .toArray();

  const rows: ProcessingRow[] = [];

  for (const book of books) {
    const bookId = book.id || book._id.toString();
    const title = book.display_title || book.title || 'Untitled';

    // Import row
    if (!stepFilter || stepFilter === 'import') {
      rows.push({
        book_id: bookId,
        book_title: title,
        step: 'import',
        date_start: book.created_at ? new Date(book.created_at).toISOString() : new Date().toISOString(),
        pages: book.pages_count || 0,
        cost_usd: 0,
        success_count: 1,
        failed_count: 0,
      });
    }

    // Pipeline status row
    if ((!stepFilter || stepFilter === 'pipeline') && book.pipeline_auto?.status) {
      const pa = book.pipeline_auto;
      const isFailed = pa.status === 'failed';
      rows.push({
        book_id: bookId,
        book_title: title,
        step: 'pipeline',
        mode: pa.status,
        date_start: pa.queued_at ? new Date(pa.queued_at).toISOString() : (book.created_at ? new Date(book.created_at).toISOString() : new Date().toISOString()),
        date_end: pa.completed_at ? new Date(pa.completed_at).toISOString() : (pa.last_updated ? new Date(pa.last_updated).toISOString() : undefined),
        pages: book.pages_count || 0,
        cost_usd: 0,
        success_count: isFailed ? 0 : 1,
        failed_count: isFailed ? 1 : 0,
      });
    }

    // Edition rows
    if ((!stepFilter || stepFilter === 'edition') && book.editions?.length) {
      for (const ed of book.editions) {
        if (ed.status === 'published' || ed.status === 'draft') {
          rows.push({
            book_id: bookId,
            book_title: title,
            step: 'edition',
            mode: ed.status,
            date_start: ed.published_at ? new Date(ed.published_at).toISOString() : (ed.created_at ? new Date(ed.created_at).toISOString() : new Date().toISOString()),
            pages: ed.page_count || 0,
            cost_usd: 0,
            success_count: ed.doi ? 1 : 0,
            failed_count: 0,
          });
        }
      }
    }
  }

  return rows;
}

async function getAiRows(db: any, stepFilter: string, searchBookIds: string[] | null): Promise<ProcessingRow[]> {
  const matchStage: any = {
    status: { $in: ['success', 'failed'] },
  };

  if (stepFilter) {
    matchStage.type = stepFilter;
  }

  if (searchBookIds) {
    matchStage.book_id = { $in: searchBookIds };
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
 * Only runs when user explicitly filters to one of these steps (too heavy for "All").
 */
async function getInfraRows(db: any, stepFilter: string, searchBookIds: string[] | null): Promise<ProcessingRow[]> {
  const bookFilter: any = {};
  if (searchBookIds) {
    bookFilter.book_id = { $in: searchBookIds };
  }

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

  const def = stepDefs.find(s => s.step === stepFilter);
  if (!def) return [];

  const pipeline = [
    { $match: { ...def.match, ...bookFilter } },
    {
      $group: {
        _id: '$book_id',
        page_count: { $sum: 1 },
        date_start: { $min: { $ifNull: [def.dateField, '$updated_at'] } },
        date_end: { $max: { $ifNull: [def.dateField, '$updated_at'] } },
      },
    },
  ];

  const results = await db.collection('pages').aggregate(pipeline).toArray();

  // Look up titles for all book IDs
  const allBookIds = results.map((r: any) => r._id);
  let bookTitleMap: Record<string, string> = {};
  if (allBookIds.length > 0) {
    const books = await db.collection('books')
      .find({ id: { $in: allBookIds } }, { projection: { id: 1, title: 1, display_title: 1 } })
      .toArray();
    for (const b of books) {
      bookTitleMap[b.id] = b.display_title || b.title || 'Untitled';
    }
  }

  return results.map((r: any) => ({
    book_id: r._id,
    book_title: bookTitleMap[r._id] || 'Unknown',
    step: def.step,
    date_start: r.date_start ? new Date(r.date_start).toISOString() : new Date().toISOString(),
    date_end: r.date_end ? new Date(r.date_end).toISOString() : undefined,
    pages: r.page_count || 0,
    cost_usd: 0,
    success_count: r.page_count || 0,
    failed_count: 0,
  }));
}

/**
 * Batch API jobs — from batch_jobs collection (lightweight).
 */
async function getBatchJobRows(db: any, searchBookIds: string[] | null): Promise<ProcessingRow[]> {
  const match: any = {
    // Only top-level jobs (exclude children that are part of a parent)
    parent_job_id: { $exists: false },
  };

  if (searchBookIds) {
    match.book_id = { $in: searchBookIds };
  }

  const jobs = await db.collection('batch_jobs')
    .find(match, {
      projection: {
        book_id: 1, book_title: 1, type: 1, model: 1, status: 1,
        page_count: 1, total_pages: 1,
        'progress.completed': 1, 'progress.failed': 1,
        created_at: 1, completed_at: 1, updated_at: 1,
      },
    })
    .sort({ created_at: -1 })
    .toArray();

  // Look up missing book titles
  const missingIds = [...new Set(jobs.filter((j: any) => !j.book_title).map((j: any) => j.book_id))];
  let titleMap: Record<string, string> = {};
  if (missingIds.length > 0) {
    const books = await db.collection('books')
      .find({ id: { $in: missingIds } }, { projection: { id: 1, title: 1, display_title: 1 } })
      .toArray();
    for (const b of books) {
      titleMap[b.id] = b.display_title || b.title || 'Untitled';
    }
  }

  const isFailed = (s: string) => ['failed', 'expired', 'cancelled'].includes(s);
  const isDone = (s: string) => ['completed', 'saved', 'completed_with_errors', 'JOB_STATE_SUCCEEDED'].includes(s);

  return jobs.map((j: any) => ({
    book_id: j.book_id,
    book_title: j.book_title || titleMap[j.book_id] || 'Unknown',
    step: 'batch_job' as ProcessingRow['step'],
    model: j.model,
    mode: `${j.type} · ${j.status}`,
    date_start: j.created_at ? new Date(j.created_at).toISOString() : new Date().toISOString(),
    date_end: j.completed_at ? new Date(j.completed_at).toISOString() : (j.updated_at ? new Date(j.updated_at).toISOString() : undefined),
    pages: j.total_pages || j.page_count || 0,
    cost_usd: 0,
    success_count: j.progress?.completed || (isDone(j.status) ? 1 : 0),
    failed_count: j.progress?.failed || (isFailed(j.status) ? 1 : 0),
  }));
}

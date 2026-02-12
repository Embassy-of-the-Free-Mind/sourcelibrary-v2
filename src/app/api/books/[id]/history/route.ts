import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

interface HistoryEvent {
  type: 'imported' | 'archived' | 'ocr' | 'translation' | 'summary' | 'index' | 'image_extraction' | 'edition_published' | 'admin_action';
  timestamp: string;
  description: string;
  pages?: number;
  cost_usd?: number;
  model?: string;
  status?: string;
  provider?: string;
  source_url?: string;
  version?: string;
  doi?: string;
  action?: string;
}

/**
 * GET /api/books/[id]/history
 * Returns a complete provenance timeline for a book, assembled from:
 * - Book document (import, archival, summary, index, editions, split_check)
 * - gemini_usage collection (AI processing grouped by type+hour+job)
 * - jobs collection (processing jobs with progress)
 * - pages collection (archive/edit/image stats)
 * - audit_log collection (admin actions)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();

    // Find the book (try custom id first, then _id)
    let bookQuery: Record<string, unknown> = { id: bookId };
    let book = await db.collection('books').findOne(bookQuery, {
      projection: {
        id: 1, title: 1, display_title: 1, author: 1,
        created_at: 1, updated_at: 1,
        image_source: 1, dublin_core: 1,
        'index.generatedAt': 1,
        'reading_summary.generated_at': 1, 'reading_summary.model': 1,
        editions: 1, split_check: 1, summary: 1,
      }
    });

    if (!book) {
      try {
        const { ObjectId } = await import('mongodb');
        if (ObjectId.isValid(bookId)) {
          book = await db.collection('books').findOne(
            { _id: new ObjectId(bookId) },
            { projection: { id: 1, title: 1, display_title: 1, author: 1, created_at: 1, updated_at: 1, image_source: 1, dublin_core: 1, 'index.generatedAt': 1, 'reading_summary.generated_at': 1, 'reading_summary.model': 1, editions: 1, split_check: 1, summary: 1 } }
          );
        }
      } catch {
        // Invalid ObjectId
      }
    }

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const resolvedBookId = book.id || book._id?.toString();

    // Run 5 queries in parallel
    const [usageRecords, jobRecords, pageStats, auditRecords] = await Promise.all([
      // 1. gemini_usage — all AI calls for this book
      db.collection('gemini_usage').find(
        { book_id: resolvedBookId },
        { projection: { type: 1, timestamp: 1, model: 1, page_count: 1, cost_usd: 1, status: 1, job_id: 1, mode: 1 } }
      ).sort({ timestamp: 1 }).toArray(),

      // 2. jobs — processing jobs
      db.collection('jobs').find(
        { book_id: resolvedBookId },
        { projection: { id: 1, type: 1, status: 1, progress: 1, config: 1, created_at: 1, completed_at: 1 } }
      ).sort({ created_at: 1 }).toArray(),

      // 3. pages — aggregate stats (archive count, detected images)
      db.collection('pages').aggregate([
        { $match: { book_id: resolvedBookId } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            archived_count: {
              $sum: { $cond: [{ $ifNull: ['$archived_photo', false] }, 1, 0] }
            },
            archived_earliest: {
              $min: '$archive_metadata.archived_at'
            },
            archived_latest: {
              $max: '$archive_metadata.archived_at'
            },
            detected_images_total: {
              $sum: { $size: { $ifNull: ['$detected_images', []] } }
            },
          }
        }
      ]).toArray(),

      // 4. audit_log — admin actions
      db.collection('audit_log').find(
        { book_id: resolvedBookId },
        { projection: { timestamp: 1, action: 1, pages_affected: 1, cleared_ocr: 1, cleared_translation: 1 } }
      ).sort({ timestamp: 1 }).toArray(),
    ]);

    // Build a set of job_ids that exist in the jobs collection for deduplication
    const jobIdSet = new Set(jobRecords.map(j => j.id));

    // Group gemini_usage records by (type, hourBucket, job_id) for deduplication
    const usageGroups = new Map<string, {
      type: string;
      timestamp: Date;
      latestTimestamp: Date;
      model: string;
      totalPages: number;
      totalCost: number;
      count: number;
      status: string;
      job_id?: string;
    }>();

    for (const rec of usageRecords) {
      // Skip records linked to a job in the jobs collection — they'll appear as job events
      if (rec.job_id && jobIdSet.has(rec.job_id)) continue;

      const ts = new Date(rec.timestamp);
      const hourKey = `${ts.getFullYear()}-${ts.getMonth()}-${ts.getDate()}-${ts.getHours()}`;
      const groupKey = `${rec.type}:${rec.job_id || hourKey}`;

      const existing = usageGroups.get(groupKey);
      if (existing) {
        existing.totalPages += rec.page_count || 0;
        existing.totalCost += rec.cost_usd || 0;
        existing.count += 1;
        if (ts > existing.latestTimestamp) {
          existing.latestTimestamp = ts;
          existing.status = rec.status;
        }
      } else {
        usageGroups.set(groupKey, {
          type: rec.type,
          timestamp: ts,
          latestTimestamp: ts,
          model: rec.model,
          totalPages: rec.page_count || 0,
          totalCost: rec.cost_usd || 0,
          count: 1,
          status: rec.status,
          job_id: rec.job_id,
        });
      }
    }

    // Assemble events
    const events: HistoryEvent[] = [];

    // --- Import event ---
    if (book.created_at) {
      const provider = book.image_source?.provider_name || book.image_source?.provider;
      const sourceUrl = book.image_source?.source_url || book.dublin_core?.dc_source;
      events.push({
        type: 'imported',
        timestamp: new Date(book.created_at).toISOString(),
        description: provider ? `Imported from ${provider}` : 'Book created',
        provider: provider || undefined,
        source_url: sourceUrl || undefined,
      });
    }

    // --- Archive event ---
    const stats = pageStats[0];
    if (stats?.archived_count > 0 && stats.archived_latest) {
      events.push({
        type: 'archived',
        timestamp: new Date(stats.archived_latest).toISOString(),
        description: `${stats.archived_count} pages archived to Vercel Blob`,
        pages: stats.archived_count,
      });
    }

    // --- AI usage events (grouped) ---
    const typeToEventType: Record<string, HistoryEvent['type']> = {
      ocr: 'ocr',
      translate: 'translation',
      summarize: 'summary',
      index: 'index',
      extract_images: 'image_extraction',
    };
    const typeLabels: Record<string, string> = {
      ocr: 'OCR',
      translate: 'Translation',
      summarize: 'Summary',
      index: 'Index',
      extract_images: 'Image extraction',
    };

    for (const group of usageGroups.values()) {
      const eventType = typeToEventType[group.type] || 'ocr';
      const label = typeLabels[group.type] || group.type;
      const statusLabel = group.status === 'success' ? 'completed' : group.status === 'failed' ? 'failed' : group.status;
      const pageStr = group.totalPages > 0 ? `: ${group.totalPages} pages` : '';

      events.push({
        type: eventType,
        timestamp: group.timestamp.toISOString(),
        description: `${label} ${statusLabel}${pageStr}`,
        pages: group.totalPages || undefined,
        cost_usd: group.totalCost > 0 ? Math.round(group.totalCost * 1_000_000) / 1_000_000 : undefined,
        model: group.model,
        status: group.status,
      });
    }

    // --- Job events (newer books with job tracking) ---
    const jobTypeLabels: Record<string, string> = {
      ocr: 'OCR',
      translation: 'Translation',
      summary: 'Summary',
      image_extraction: 'Image extraction',
      batch_ocr: 'OCR',
      batch_translate: 'Translation',
      batch_summary: 'Summary',
      batch_split: 'Split detection',
    };
    const jobTypeToEventType: Record<string, HistoryEvent['type']> = {
      ocr: 'ocr',
      translation: 'translation',
      summary: 'summary',
      image_extraction: 'image_extraction',
      batch_ocr: 'ocr',
      batch_translate: 'translation',
      batch_summary: 'summary',
      batch_split: 'ocr',
    };

    // Compute total cost per job from gemini_usage
    const jobCosts = new Map<string, number>();
    for (const rec of usageRecords) {
      if (rec.job_id) {
        jobCosts.set(rec.job_id, (jobCosts.get(rec.job_id) || 0) + (rec.cost_usd || 0));
      }
    }

    for (const job of jobRecords) {
      const label = jobTypeLabels[job.type] || job.type;
      const eventType = jobTypeToEventType[job.type] || 'ocr';
      const completed = job.progress?.completed || 0;
      const total = job.progress?.total || 0;
      const failed = job.progress?.failed || 0;
      const statusLabel = job.status === 'completed' ? 'completed' :
        job.status === 'completed_with_errors' ? 'completed with errors' : job.status;
      const failStr = failed > 0 ? ` (${failed} failed)` : '';
      const cost = jobCosts.get(job.id);

      events.push({
        type: eventType,
        timestamp: new Date(job.completed_at || job.created_at).toISOString(),
        description: `${label} ${statusLabel}: ${completed}/${total} pages${failStr}`,
        pages: total,
        cost_usd: cost && cost > 0 ? Math.round(cost * 1_000_000) / 1_000_000 : undefined,
        model: job.config?.model,
        status: job.status,
      });
    }

    // --- Summary event (from book fields) ---
    const summaryGenAt = book.reading_summary?.generated_at;
    if (summaryGenAt) {
      // Only add if not already covered by gemini_usage
      const hasSummaryUsage = [...usageGroups.values()].some(g => g.type === 'summarize');
      const hasSummaryJob = jobRecords.some(j => j.type === 'summary' || j.type === 'batch_summary');
      if (!hasSummaryUsage && !hasSummaryJob) {
        events.push({
          type: 'summary',
          timestamp: new Date(summaryGenAt).toISOString(),
          description: 'Reading summary generated',
          model: book.reading_summary.model,
        });
      }
    }

    // --- Index event (from book fields) ---
    const indexGenAt = book.index?.generatedAt;
    if (indexGenAt) {
      const hasIndexUsage = [...usageGroups.values()].some(g => g.type === 'index');
      const hasIndexJob = jobRecords.some(j => j.type === 'index');
      if (!hasIndexUsage && !hasIndexJob) {
        events.push({
          type: 'index',
          timestamp: new Date(indexGenAt).toISOString(),
          description: 'Book index generated',
        });
      }
    }

    // --- Edition events ---
    if (book.editions && Array.isArray(book.editions)) {
      for (const edition of book.editions) {
        if (edition.published_at) {
          events.push({
            type: 'edition_published',
            timestamp: new Date(edition.published_at).toISOString(),
            description: `Edition published: v${edition.version || '1.0'}`,
            version: edition.version,
            doi: edition.doi,
          });
        }
      }
    }

    // --- Audit log events ---
    for (const entry of auditRecords) {
      const actionLabels: Record<string, string> = {
        reset_book_ocr: 'OCR reset',
        reset_book: 'Book reset',
        book_imported: 'Imported',
        book_deleted: 'Archived (soft delete)',
        book_deleted_permanent: 'Permanently deleted',
        book_restored: 'Restored from archive',
        book_reimported: 'Re-imported',
        book_metadata_updated: 'Metadata updated',
        edition_published: 'Edition published',
        doi_minted: 'DOI minted',
        page_edited: 'Page manually edited',
      };
      const label = actionLabels[entry.action] || entry.action;
      const pagesStr = entry.pages_affected ? ` (${entry.pages_affected} pages)` : '';

      events.push({
        type: 'admin_action',
        timestamp: new Date(entry.timestamp).toISOString(),
        description: `${label}${pagesStr}`,
        pages: entry.pages_affected,
        action: entry.action,
      });
    }

    // Sort all events chronologically
    events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Compute summary
    const allCosts = usageRecords.reduce((sum, r) => sum + (r.cost_usd || 0), 0 as number);

    const response = {
      book_id: resolvedBookId,
      book_title: book.display_title || book.title,
      events,
      summary: {
        total_ai_cost_usd: Math.round(allCosts * 1_000_000) / 1_000_000,
        first_event: events[0]?.timestamp || null,
        last_event: events[events.length - 1]?.timestamp || null,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching book history:', error);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}

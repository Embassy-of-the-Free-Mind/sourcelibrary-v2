/**
 * Book provenance / processing history assembly.
 *
 * Single source of truth for the timeline shown by `GET /api/books/[id]/history`
 * and `GET /api/[tenant]/books/[id]/history`. Both routes call `assembleBookHistory`.
 *
 * Data sources (read-side):
 *   - Supabase  `gemini_usage`           — primary AI usage log (since 2026-04-10, issue #567 Phase 3)
 *   - MongoDB   `gemini_usage`           — legacy AI usage log (pre-2026-04-10) and Supabase fallback
 *   - MongoDB   `jobs`                   — processing jobs with progress
 *   - MongoDB   `pages`                  — archive/edit/image stats (aggregate)
 *   - MongoDB   `audit_log`              — admin actions
 *   - MongoDB   `book_metadata_changelog`— field-level metadata diffs
 *   - Book document fields               — fallbacks for summary/index/chapters/editions when not in usage log
 *
 * Records are queried by `book_id` only. Neither Supabase `gemini_usage` nor the
 * MongoDB audit/jobs/changelog collections track `tenantId` today (writers do not
 * populate it), so adding a tenant filter would zero out events. `book_id` is
 * globally unique; the tenant parameter is used only for the book lookup itself.
 *
 * Known provenance gaps (file follow-up issues to close these):
 *   - Archive workers (archive-ocr/eap/uva/erara/gallica/artwork/bulk) do not log
 *     to `gemini_usage` — page archival to R2 is invisible to this timeline.
 *   - `audit_log` and `book_metadata_changelog` writers do not stamp `tenantId`.
 */
import type { Db } from 'mongodb';
import { supabaseAdmin } from './supabase';

export interface HistoryEvent {
  type:
    | 'imported'
    | 'archived'
    | 'ocr'
    | 'translation'
    | 'summary'
    | 'index'
    | 'image_extraction'
    | 'extract_chapters'
    | 'metadata_enriched'
    | 'metadata_change'
    | 'edition_published'
    | 'admin_action';
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
  triggered_by?: string;
  changes?: Array<{ field: string; previous: unknown; new_value: unknown }>;
}

export interface HistoryResponse {
  book_id: string;
  book_title: string;
  events: HistoryEvent[];
  summary: {
    total_ai_cost_usd: number;
    first_event: string | null;
    last_event: string | null;
    sources: {
      supabase_usage_rows: number;
      mongo_usage_rows: number;
      job_rows: number;
      audit_rows: number;
      changelog_rows: number;
    };
  };
}

/**
 * Subset of the book document that `assembleBookHistory` reads.
 * Callers should project these fields when fetching the book.
 */
export interface BookHistoryInput {
  id?: string;
  _id?: { toString(): string } | string;
  title?: string;
  display_title?: string;
  created_at?: Date | string;
  image_source?: { provider_name?: string; provider?: string; source_url?: string };
  dublin_core?: { dc_source?: string };
  index?: { generatedAt?: Date | string };
  reading_summary?: { generated_at?: Date | string; model?: string };
  editions?: Array<{ published_at?: Date | string; version?: string; doi?: string }>;
  chapters_extracted_at?: Date | string;
  chapters?: unknown[];
}

interface UsageRow {
  type?: string;
  timestamp: Date | string;
  model?: string | null;
  page_count?: number | null;
  cost_usd?: number | null;
  status?: string | null;
  job_id?: string | null;
  mode?: string | null;
  triggered_by?: string | null;
  id?: string;
}

interface JobRow {
  id: string;
  type: string;
  status: string;
  progress?: { completed?: number; total?: number; failed?: number };
  config?: { model?: string };
  created_at: Date | string;
  completed_at?: Date | string;
}

interface AuditRow {
  timestamp: Date | string;
  action: string;
  pages_affected?: number;
  cleared_ocr?: boolean;
  cleared_translation?: boolean;
  triggered_by?: string;
  actor?: string;
}

interface ChangelogRow {
  timestamp: Date | string;
  source?: string;
  model?: string;
  changes: Array<{ field: string; previous: unknown; new_value: unknown }>;
  note?: string;
}

interface PageStatsRow {
  total: number;
  archived_count: number;
  archived_earliest?: Date | string;
  archived_latest?: Date | string;
  detected_images_total: number;
}

const TYPE_TO_EVENT: Record<string, HistoryEvent['type']> = {
  ocr: 'ocr',
  translate: 'translation',
  translation: 'translation',
  summarize: 'summary',
  summary: 'summary',
  index: 'index',
  extract_images: 'image_extraction',
  extract_chapters: 'extract_chapters',
};

const TYPE_LABELS: Record<string, string> = {
  ocr: 'OCR',
  translate: 'Translation',
  translation: 'Translation',
  summarize: 'Summary',
  summary: 'Summary',
  index: 'Index',
  extract_images: 'Image extraction',
  extract_chapters: 'Chapter extraction',
};

const JOB_TYPE_LABELS: Record<string, string> = {
  ocr: 'OCR',
  translation: 'Translation',
  summary: 'Summary',
  image_extraction: 'Image extraction',
  batch_ocr: 'OCR',
  batch_translate: 'Translation',
  batch_summary: 'Summary',
  batch_split: 'Split detection',
};

const JOB_TYPE_TO_EVENT: Record<string, HistoryEvent['type']> = {
  ocr: 'ocr',
  translation: 'translation',
  summary: 'summary',
  image_extraction: 'image_extraction',
  batch_ocr: 'ocr',
  batch_translate: 'translation',
  batch_summary: 'summary',
  batch_split: 'ocr',
};

const ACTION_LABELS: Record<string, string> = {
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
  images_brightness_adjusted: 'Image brightness adjusted',
};

const SOURCE_LABELS: Record<string, string> = {
  ai_enrichment: 'AI enrichment',
  catalog_verification: 'Catalog verification',
  admin_edit: 'Admin edit',
  import: 'Import',
  script: 'Script',
};

async function fetchSupabaseUsage(bookId: string): Promise<UsageRow[]> {
  // gemini_usage is RLS-locked to service_role (see #1981); no anon fallback.
  if (!supabaseAdmin) {
    throw new Error('supabaseAdmin not configured — SUPABASE_SERVICE_ROLE_KEY missing');
  }
  const client = supabaseAdmin;
  // Read selected columns; `triggered_by` is optional in case the column hasn't shipped yet.
  const { data, error } = await client
    .from('gemini_usage')
    .select('id, type, timestamp, model, page_count, cost_usd, status, job_id, mode, triggered_by')
    .eq('book_id', bookId)
    .order('timestamp', { ascending: true })
    .limit(5000);
  if (error) {
    // If `triggered_by` doesn't exist yet (column added in this PR + schema migration),
    // fall back to the original projection.
    if (error.message?.includes('triggered_by')) {
      const retry = await client
        .from('gemini_usage')
        .select('id, type, timestamp, model, page_count, cost_usd, status, job_id, mode')
        .eq('book_id', bookId)
        .order('timestamp', { ascending: true })
        .limit(5000);
      return (retry.data || []) as UsageRow[];
    }
    console.warn('[book-history] Supabase usage query failed:', error.message);
    return [];
  }
  return (data || []) as UsageRow[];
}

async function fetchMongoUsage(db: Db, bookId: string): Promise<UsageRow[]> {
  const docs = await db
    .collection('gemini_usage')
    .find(
      { book_id: bookId },
      {
        projection: {
          id: 1,
          type: 1,
          timestamp: 1,
          model: 1,
          page_count: 1,
          cost_usd: 1,
          status: 1,
          job_id: 1,
          mode: 1,
          triggered_by: 1,
        },
      },
    )
    .sort({ timestamp: 1 })
    .limit(5000)
    .toArray();
  return docs as unknown as UsageRow[];
}

/**
 * Merge Supabase + MongoDB usage rows, deduplicating by `id`. Supabase wins
 * on conflict (it's the authoritative store).
 */
function mergeUsageRows(supa: UsageRow[], mongo: UsageRow[]): UsageRow[] {
  if (mongo.length === 0) return supa;
  if (supa.length === 0) return mongo;
  const seen = new Set<string>();
  const merged: UsageRow[] = [];
  for (const r of supa) {
    if (r.id) seen.add(r.id);
    merged.push(r);
  }
  for (const r of mongo) {
    if (r.id && seen.has(r.id)) continue;
    merged.push(r);
  }
  merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return merged;
}

export async function assembleBookHistory(
  db: Db,
  book: BookHistoryInput,
): Promise<HistoryResponse> {
  const resolvedBookId = book.id || (typeof book._id === 'string' ? book._id : book._id?.toString()) || '';

  const [supaUsage, mongoUsage, jobRecords, pageStatsArr, auditRecords, changelogRecords] =
    await Promise.all([
      fetchSupabaseUsage(resolvedBookId),
      fetchMongoUsage(db, resolvedBookId),
      db
        .collection('jobs')
        .find(
          { book_id: resolvedBookId },
          { projection: { id: 1, type: 1, status: 1, progress: 1, config: 1, created_at: 1, completed_at: 1 } },
        )
        .sort({ created_at: 1 })
        .toArray()
        .then((arr) => arr as unknown as JobRow[]),
      db
        .collection('pages')
        .aggregate([
          { $match: { book_id: resolvedBookId } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              archived_count: { $sum: { $cond: [{ $ifNull: ['$archived_photo', false] }, 1, 0] } },
              archived_earliest: { $min: '$archive_metadata.archived_at' },
              archived_latest: { $max: '$archive_metadata.archived_at' },
              detected_images_total: { $sum: { $size: { $ifNull: ['$detected_images', []] } } },
            },
          },
        ])
        .toArray()
        .then((arr) => arr as unknown as PageStatsRow[]),
      db
        .collection('audit_log')
        .find(
          { book_id: resolvedBookId },
          {
            projection: {
              timestamp: 1,
              action: 1,
              pages_affected: 1,
              cleared_ocr: 1,
              cleared_translation: 1,
              triggered_by: 1,
              actor: 1,
            },
          },
        )
        .sort({ timestamp: 1 })
        .toArray()
        .then((arr) => arr as unknown as AuditRow[]),
      db
        .collection('book_metadata_changelog')
        .find(
          { book_id: resolvedBookId },
          { projection: { timestamp: 1, source: 1, model: 1, changes: 1, note: 1 } },
        )
        .sort({ timestamp: -1 })
        .limit(100)
        .toArray()
        .then((arr) => arr as unknown as ChangelogRow[]),
    ]);

  const usageRecords = mergeUsageRows(supaUsage, mongoUsage);

  const jobIdSet = new Set(jobRecords.map((j) => j.id));

  // Group usage rows by (type, hour-bucket | job_id) so we don't show a row per page.
  const usageGroups = new Map<
    string,
    {
      type: string;
      timestamp: Date;
      latestTimestamp: Date;
      model: string;
      totalPages: number;
      totalCost: number;
      count: number;
      status: string;
      job_id?: string;
      triggered_by?: string;
    }
  >();

  for (const rec of usageRecords) {
    if (rec.job_id && jobIdSet.has(rec.job_id)) continue; // Surfaced as a job event instead.
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
        existing.status = rec.status || existing.status;
      }
    } else {
      usageGroups.set(groupKey, {
        type: rec.type || 'other',
        timestamp: ts,
        latestTimestamp: ts,
        model: rec.model || '',
        totalPages: rec.page_count || 0,
        totalCost: rec.cost_usd || 0,
        count: 1,
        status: rec.status || 'success',
        job_id: rec.job_id || undefined,
        triggered_by: rec.triggered_by || undefined,
      });
    }
  }

  const events: HistoryEvent[] = [];

  // Import event
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

  // Archive event (aggregate)
  const stats = pageStatsArr[0];
  if (stats && stats.archived_count > 0 && stats.archived_latest) {
    events.push({
      type: 'archived',
      timestamp: new Date(stats.archived_latest).toISOString(),
      description: `${stats.archived_count} pages archived`,
      pages: stats.archived_count,
    });
  }

  // Grouped AI usage events (excluding job-linked rows)
  for (const group of usageGroups.values()) {
    const eventType = TYPE_TO_EVENT[group.type] || 'ocr';
    const label = TYPE_LABELS[group.type] || group.type;
    const statusLabel =
      group.status === 'success' ? 'completed' : group.status === 'failed' ? 'failed' : group.status;
    const pageStr = group.totalPages > 0 ? `: ${group.totalPages} pages` : '';
    events.push({
      type: eventType,
      timestamp: group.timestamp.toISOString(),
      description: `${label} ${statusLabel}${pageStr}`,
      pages: group.totalPages || undefined,
      cost_usd: group.totalCost > 0 ? Math.round(group.totalCost * 1_000_000) / 1_000_000 : undefined,
      model: group.model || undefined,
      status: group.status,
      triggered_by: group.triggered_by,
    });
  }

  // Job events (cost summed from usage rows linked by job_id)
  const jobCosts = new Map<string, number>();
  for (const rec of usageRecords) {
    if (rec.job_id) jobCosts.set(rec.job_id, (jobCosts.get(rec.job_id) || 0) + (rec.cost_usd || 0));
  }
  for (const job of jobRecords) {
    const label = JOB_TYPE_LABELS[job.type] || job.type;
    const eventType = JOB_TYPE_TO_EVENT[job.type] || 'ocr';
    const completed = job.progress?.completed || 0;
    const total = job.progress?.total || 0;
    const failed = job.progress?.failed || 0;
    const statusLabel =
      job.status === 'completed'
        ? 'completed'
        : job.status === 'completed_with_errors'
          ? 'completed with errors'
          : job.status;
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

  // Book-doc fallback events (only if no usage row covers them)
  const summaryGenAt = book.reading_summary?.generated_at;
  if (summaryGenAt) {
    const hasSummaryUsage = [...usageGroups.values()].some(
      (g) => g.type === 'summary' || g.type === 'summarize',
    );
    const hasSummaryJob = jobRecords.some((j) => j.type === 'summary' || j.type === 'batch_summary');
    if (!hasSummaryUsage && !hasSummaryJob) {
      events.push({
        type: 'summary',
        timestamp: new Date(summaryGenAt).toISOString(),
        description: 'Reading summary generated',
        model: book.reading_summary?.model,
      });
    }
  }
  const indexGenAt = book.index?.generatedAt;
  if (indexGenAt) {
    const hasIndexUsage = [...usageGroups.values()].some((g) => g.type === 'index');
    const hasIndexJob = jobRecords.some((j) => j.type === 'index');
    if (!hasIndexUsage && !hasIndexJob) {
      events.push({
        type: 'index',
        timestamp: new Date(indexGenAt).toISOString(),
        description: 'Book index generated',
      });
    }
  }
  const chaptersExtractedAt = book.chapters_extracted_at;
  if (chaptersExtractedAt) {
    const hasChapterUsage = [...usageGroups.values()].some((g) => g.type === 'extract_chapters');
    if (!hasChapterUsage) {
      events.push({
        type: 'extract_chapters',
        timestamp: new Date(chaptersExtractedAt).toISOString(),
        description: `Chapters extracted: ${book.chapters?.length || 0} chapters`,
      });
    }
  }

  // Edition events
  if (Array.isArray(book.editions)) {
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

  // Audit log events
  for (const entry of auditRecords) {
    const label = ACTION_LABELS[entry.action] || entry.action;
    const pagesStr = entry.pages_affected ? ` (${entry.pages_affected} pages)` : '';
    const actorStr = entry.actor ? ` — ${entry.actor}` : '';
    events.push({
      type: 'admin_action',
      timestamp: new Date(entry.timestamp).toISOString(),
      description: `${label}${pagesStr}${actorStr}`,
      pages: entry.pages_affected,
      action: entry.action,
      triggered_by: entry.triggered_by || undefined,
    });
  }

  // Metadata changelog
  for (const entry of changelogRecords) {
    const label = SOURCE_LABELS[entry.source || ''] || entry.source || 'Metadata';
    const fieldNames = entry.changes.map((c) => c.field).join(', ');
    events.push({
      type: 'metadata_change',
      timestamp: new Date(entry.timestamp).toISOString(),
      description: `${label}: ${fieldNames}`,
      model: entry.model,
      changes: entry.changes,
    });
  }

  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const totalCost = usageRecords.reduce((sum, r) => sum + (r.cost_usd || 0), 0);

  return {
    book_id: resolvedBookId,
    book_title: book.display_title || book.title || '',
    events,
    summary: {
      total_ai_cost_usd: Math.round(totalCost * 1_000_000) / 1_000_000,
      first_event: events[0]?.timestamp || null,
      last_event: events[events.length - 1]?.timestamp || null,
      sources: {
        supabase_usage_rows: supaUsage.length,
        mongo_usage_rows: mongoUsage.length,
        job_rows: jobRecords.length,
        audit_rows: auditRecords.length,
        changelog_rows: changelogRecords.length,
      },
    },
  };
}

export const BOOK_HISTORY_PROJECTION = {
  id: 1,
  title: 1,
  display_title: 1,
  author: 1,
  created_at: 1,
  updated_at: 1,
  image_source: 1,
  dublin_core: 1,
  'index.generatedAt': 1,
  'reading_summary.generated_at': 1,
  'reading_summary.model': 1,
  editions: 1,
  split_check: 1,
  summary: 1,
  chapters_extracted_at: 1,
  chapters: 1,
} as const;

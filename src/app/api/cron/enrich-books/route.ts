import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyCronAuth } from '@/lib/cron-auth';
import { extractChaptersForBook } from '@/lib/chapter-extraction';
import { scoreBookQuality } from '@/lib/quality-scoring';
import { createCronLogger } from '@/lib/cron-logger';

export const maxDuration = 300;

const TIME_BUDGET_MS = 270_000;
const ENRICH_LIMIT = 30;
const CHAPTER_LIMIT = 20;
const MAX_RETRIES = 3;

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_URL || 'https://sourcelibrary.org';
}

/**
 * GET /api/cron/enrich-books
 *
 * Dedicated cron for summary/index generation and chapter extraction.
 * Split out from post-import-pipeline so enrichment doesn't starve translation.
 *
 * Phase 1: translate_complete → enriching → enriched (summary + index via /api/books/{id}/index)
 * Phase 2: enriched → chapters_complete (chapter extraction)
 */
export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const db = await getDb();
  const logger = createCronLogger('enrich-books');
  const startTime = Date.now();

  const hasTimeBudget = () => Date.now() - startTime < TIME_BUDGET_MS;
  const baseUrl = getBaseUrl();

  const log = {
    enriched: 0,
    enriched_failed: 0,
    chapters_extracted: 0,
    chapters_skipped: 0,
    errors: [] as string[],
  };

  try {
    // Check pause flags
    const control = await db.collection('system_config').findOne({ _id: 'processing_control' } as any);
    if (control?.paused) {
      logger.decision('skip', 'Pipeline paused globally');
      await logger.flush();
      return NextResponse.json({ status: 'paused' });
    }

    const enrichPaused = control?.paused_phases?.includes('enrichment');
    const chaptersPaused = control?.paused_phases?.includes('chapters');

    // ── Phase 1: Enrich — generate summary + index ──
    if (enrichPaused) {
      logger.decision('skip', 'Enrichment paused via processing_control.paused_phases');
    }
    if (hasTimeBudget() && !enrichPaused) {
      const readyForEnrich = await db.collection('books')
        .find({
          $or: [
            { 'pipeline_auto.status': 'translate_complete' },
            { 'pipeline_auto.status': 'enriching' },
            { enrichment_stale: true, 'index.generatedAt': { $exists: true } },
          ]
        })
        .sort({ hidden: 1 }) // Visible books first
        .project({ id: 1, title: 1, 'pipeline_auto.status': 1, 'pipeline_auto.retry_count': 1, enrichment_stale: 1 })
        .limit(ENRICH_LIMIT)
        .toArray();

      // Mark all as enriching up front
      for (const book of readyForEnrich) {
        if (book.pipeline_auto?.status === 'translate_complete') {
          await db.collection('books').updateOne(
            { id: book.id },
            { $set: { 'pipeline_auto.status': 'enriching', 'pipeline_auto.last_updated': new Date(), updated_at: new Date() } }
          );
        }
      }

      // Process all books concurrently with per-book timeout
      const enrichResults = await Promise.allSettled(
        readyForEnrich.map(async (book) => {
          const res = await fetch(`${baseUrl}/api/books/${book.id}/index`, {
            method: 'GET',
            signal: AbortSignal.timeout(120_000), // 120s — this cron has its own time budget
          });

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }

          // Quality scoring — non-blocking, fast (~2s)
          try { await scoreBookQuality(db, book.id); } catch { /* non-critical */ }

          return book;
        })
      );

      // Process results
      for (let i = 0; i < enrichResults.length; i++) {
        const result = enrichResults[i];
        const book = readyForEnrich[i];
        const isStaleReenrich = book.enrichment_stale && book.pipeline_auto?.status !== 'translate_complete';

        if (result.status === 'fulfilled') {
          if (isStaleReenrich) {
            await db.collection('books').updateOne(
              { id: book.id },
              { $unset: { enrichment_stale: '' } }
            );
          } else {
            await db.collection('books').updateOne(
              { id: book.id },
              { $set: { 'pipeline_auto.status': 'enriched', 'pipeline_auto.retry_count': 0, 'pipeline_auto.last_updated': new Date(), updated_at: new Date() } }
            );
          }
          log.enriched++;
        } else {
          const retries = book.pipeline_auto?.retry_count || 0;
          if (isStaleReenrich) {
            await db.collection('books').updateOne(
              { id: book.id },
              { $unset: { enrichment_stale: '' } }
            );
          } else if (retries >= MAX_RETRIES) {
            // Enrichment is non-critical — skip on persistent failure
            await db.collection('books').updateOne(
              { id: book.id },
              { $set: { 'pipeline_auto.status': 'enriched', 'pipeline_auto.retry_count': 0, 'pipeline_auto.last_updated': new Date(), updated_at: new Date() } }
            );
            log.enriched++;
          } else {
            await db.collection('books').updateOne(
              { id: book.id },
              { $set: { 'pipeline_auto.status': 'translate_complete', 'pipeline_auto.retry_count': retries + 1, 'pipeline_auto.last_updated': new Date(), updated_at: new Date() } }
            );
          }
          log.enriched_failed++;
          log.errors.push(`Enrich ${book.id}: ${result.reason instanceof Error ? result.reason.message : 'unknown'}`);
        }
      }
    }

    // ── Phase 2: Chapter extraction (enriched → chapters_complete) ──
    if (chaptersPaused) {
      logger.decision('skip', 'Chapter extraction paused via processing_control.paused_phases');
    }
    if (hasTimeBudget() && !chaptersPaused) {
      const readyForChapters = await db.collection('books')
        .find({ 'pipeline_auto.status': 'enriched' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, pages_count: 1, 'pipeline_auto.retry_count': 1 })
        .limit(CHAPTER_LIMIT)
        .toArray();

      for (const book of readyForChapters) {
        if (!hasTimeBudget()) break;
        try {
          if ((book.pages_count || 0) < 10) {
            await db.collection('books').updateOne(
              { id: book.id },
              { $set: { 'pipeline_auto.status': 'chapters_complete', 'pipeline_auto.retry_count': 0, 'pipeline_auto.last_updated': new Date(), updated_at: new Date() } }
            );
            log.chapters_skipped++;
            continue;
          }

          await db.collection('books').updateOne(
            { id: book.id },
            { $set: { 'pipeline_auto.status': 'chapters', 'pipeline_auto.last_updated': new Date(), updated_at: new Date() } }
          );

          await extractChaptersForBook(db, book.id);

          await db.collection('books').updateOne(
            { id: book.id },
            { $set: { 'pipeline_auto.status': 'chapters_complete', 'pipeline_auto.retry_count': 0, 'pipeline_auto.last_updated': new Date(), updated_at: new Date() } }
          );
          log.chapters_extracted++;
        } catch (err) {
          const retries = book.pipeline_auto?.retry_count || 0;
          if (retries >= MAX_RETRIES) {
            await db.collection('books').updateOne(
              { id: book.id },
              { $set: { 'pipeline_auto.status': 'chapters_complete', 'pipeline_auto.retry_count': 0, 'pipeline_auto.last_updated': new Date(), updated_at: new Date() } }
            );
            log.chapters_skipped++;
          } else {
            await db.collection('books').updateOne(
              { id: book.id },
              { $set: { 'pipeline_auto.status': 'enriched', 'pipeline_auto.retry_count': retries + 1, 'pipeline_auto.last_updated': new Date(), updated_at: new Date() } }
            );
          }
          log.errors.push(`Chapters ${book.id}: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }
    }

    logger.setActions({
      enriched: log.enriched,
      enriched_failed: log.enriched_failed,
      chapters_extracted: log.chapters_extracted,
      chapters_skipped: log.chapters_skipped,
    });
    logger.addErrors(log.errors);
    await logger.flush();

    return NextResponse.json({
      status: 'ok',
      duration_ms: Date.now() - startTime,
      ...log,
    });
  } catch (err) {
    logger.error(err instanceof Error ? err.message : 'Unknown error');
    logger.addErrors(log.errors);
    try { await logger.flush(); } catch { /* best effort */ }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error', ...log },
      { status: 500 }
    );
  }
}

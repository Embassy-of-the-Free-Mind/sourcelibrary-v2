import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyCronAuth } from '@/lib/cron-auth';
import { extractChaptersForBook } from '@/lib/chapter-extraction';
import { scoreBookQuality } from '@/lib/quality-scoring';
import { scoreBookAlignment } from '@/lib/semantic-alignment';
import { scoreCollectionRelevance } from '@/lib/collection-relevance';
import { createCronLogger } from '@/lib/cron-logger';
import { performTransliteration } from '@/lib/ai';
import { logGeminiCall } from '@/lib/gemini-logger';

export const maxDuration = 300;

const TIME_BUDGET_MS = 270_000;
const ENRICH_LIMIT = 30;
const CHAPTER_LIMIT = 20;
const MAX_RETRIES = 3;
const CLASSIFY_LIMIT = 10;           // Books per run for collection scoring
const TRANSLIT_LIMIT = 10;           // Books per run
const TRANSLIT_PAGES_PER_RUN = 200;  // Max pages total per run
const TRANSLIT_CONCURRENCY = 10;     // Concurrent Gemini calls
const TRANSLIT_MODEL = 'gemini-3-flash-preview';

const NON_LATIN_LANGUAGES = new Set([
  'greek', 'hebrew', 'arabic', 'persian', 'ottoman turkish',
  'syriac', 'chinese', 'japanese', 'korean', 'sanskrit',
  'armenian', 'georgian', 'ethiopic', 'coptic', 'tibetan',
  'russian', 'church slavonic',
]);

const SKIP_TRANSLIT_PAGE_TYPES = ['blank'];

function languageToScript(language?: string): string {
  if (!language) return 'Unknown';
  const map: Record<string, string> = {
    'greek': 'Greek', 'hebrew': 'Hebrew', 'arabic': 'Arabic',
    'persian': 'Arabic (Persian)', 'ottoman turkish': 'Arabic (Ottoman Turkish)',
    'syriac': 'Syriac', 'chinese': 'Chinese', 'japanese': 'Japanese',
    'korean': 'Korean', 'sanskrit': 'Sanskrit/Devanagari', 'armenian': 'Armenian',
    'georgian': 'Georgian', 'ethiopic': 'Ethiopic', 'coptic': 'Coptic',
    'tibetan': 'Tibetan', 'russian': 'Cyrillic', 'church slavonic': 'Cyrillic',
  };
  return map[language.toLowerCase()] || language;
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

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
 * Phase 3: Transliteration for non-Latin books (Greek, Hebrew, Arabic, etc.) — runs on any book with OCR
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
    classified: 0,
    classified_failed: 0,
    translit_books: 0,
    translit_pages: 0,
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

          // Semantic alignment — non-blocking, measures OCR↔translation faithfulness
          try { await scoreBookAlignment(db, book.id); } catch { /* non-critical */ }

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

    // ── Phase 3: Collection classification ──
    // Score newly enriched books into thematic collections using Gemini.
    // Runs on books that have chapters_complete but no collection_scores yet.
    const classifyPaused = control?.paused_phases?.includes('classification');
    if (classifyPaused) {
      logger.decision('skip', 'Classification paused via processing_control.paused_phases');
    }
    if (hasTimeBudget() && !classifyPaused) {
      const unclassified = await db.collection('books')
        .find({
          pages_ocr: { $gt: 0 },
          collection_scores: { $exists: false },
          status: { $ne: 'deleted' },
        })
        .sort({ created_at: -1 }) // Newest first
        .project({ id: 1, title: 1 })
        .limit(CLASSIFY_LIMIT)
        .toArray();

      for (const book of unclassified) {
        if (!hasTimeBudget()) break;
        try {
          const result = await scoreCollectionRelevance(db, book.id);
          if (result.success) {
            log.classified++;
          } else {
            log.classified_failed++;
            log.errors.push(`Classify ${book.id}: ${result.error}`);
          }
        } catch (err) {
          log.classified_failed++;
          log.errors.push(`Classify ${book.id}: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }
    }

    // ── Phase 4: Transliteration for non-Latin books ──
    // Not tied to pipeline state — runs on any book with OCR'd pages missing transliteration.
    // Non-critical: failures don't block anything.
    const translitPaused = control?.paused_phases?.includes('transliteration');
    if (translitPaused) {
      logger.decision('skip', 'Transliteration paused via processing_control.paused_phases');
    }
    if (hasTimeBudget() && !translitPaused) {
      // Build regex for non-Latin languages
      const langPattern = [...NON_LATIN_LANGUAGES].join('|');

      // Find books with non-Latin languages that have pages needing transliteration
      const nonLatinBooks = await db.collection('books').aggregate([
        {
          $match: {
            language: { $regex: new RegExp(`^(${langPattern})$`, 'i') },
            pages_count: { $gt: 0 },
          }
        },
        // Lookup pages needing transliteration (just check if any exist)
        {
          $lookup: {
            from: 'pages',
            let: { bookId: '$id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$book_id', '$$bookId'] },
                  'ocr.data': { $exists: true, $nin: [null, ''] },
                  page_type: { $nin: SKIP_TRANSLIT_PAGE_TYPES },
                  $or: [
                    { 'transliteration.data': { $exists: false } },
                    { 'transliteration.data': null },
                    { 'transliteration.data': '' },
                  ],
                }
              },
              { $limit: 1 },
              { $project: { _id: 1 } },
            ],
            as: 'needsTranslit',
          }
        },
        { $match: { needsTranslit: { $ne: [] } } },
        { $sort: { hidden: 1 } },
        { $limit: TRANSLIT_LIMIT },
        { $project: { id: 1, title: 1, language: 1 } },
      ]).toArray();

      let totalTranslitPages = 0;

      for (const book of nonLatinBooks) {
        if (!hasTimeBudget() || totalTranslitPages >= TRANSLIT_PAGES_PER_RUN) break;

        const sourceScript = languageToScript(book.language);
        const remaining = TRANSLIT_PAGES_PER_RUN - totalTranslitPages;

        // Fetch pages needing transliteration
        const pages = await db.collection('pages')
          .find({
            book_id: book.id,
            'ocr.data': { $exists: true, $nin: [null, ''] },
            page_type: { $nin: SKIP_TRANSLIT_PAGE_TYPES },
            $or: [
              { 'transliteration.data': { $exists: false } },
              { 'transliteration.data': null },
              { 'transliteration.data': '' },
            ],
          })
          .sort({ page_number: 1 })
          .project({ id: 1, book_id: 1, 'ocr.data': 1 })
          .limit(remaining)
          .toArray();

        if (pages.length === 0) continue;

        let bookDone = 0;
        // Process in concurrent chunks
        for (let i = 0; i < pages.length; i += TRANSLIT_CONCURRENCY) {
          if (!hasTimeBudget()) break;
          const chunk = pages.slice(i, i + TRANSLIT_CONCURRENCY);

          const results = await Promise.allSettled(
            chunk.map(async (page) => {
              const ocrHash = hashString(page.ocr.data);
              const startMs = Date.now();
              const result = await performTransliteration(page.ocr.data, sourceScript, TRANSLIT_MODEL);
              const duration = Date.now() - startMs;

              if (!result.text) return null;

              await db.collection('pages').updateOne(
                { id: page.id },
                {
                  $set: {
                    'transliteration.data': result.text,
                    'transliteration.model': TRANSLIT_MODEL,
                    'transliteration.updated_at': new Date(),
                    'transliteration.source_ocr_hash': ocrHash,
                    'transliteration.script': sourceScript,
                    updated_at: new Date(),
                  }
                }
              );

              logGeminiCall({
                type: 'transliterate',
                mode: 'realtime',
                model: TRANSLIT_MODEL,
                book_id: page.book_id,
                page_ids: [page.id],
                input_tokens: result.usage.inputTokens,
                output_tokens: result.usage.outputTokens,
                status: 'success',
                duration_ms: duration,
                endpoint: 'cron/enrich-books',
              });

              return true;
            })
          );

          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) bookDone++;
          }
        }

        if (bookDone > 0) {
          log.translit_books++;
          log.translit_pages += bookDone;
          totalTranslitPages += bookDone;
        }
      }
    }

    logger.setActions({
      enriched: log.enriched,
      enriched_failed: log.enriched_failed,
      chapters_extracted: log.chapters_extracted,
      chapters_skipped: log.chapters_skipped,
      classified: log.classified,
      classified_failed: log.classified_failed,
      translit_books: log.translit_books,
      translit_pages: log.translit_pages,
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

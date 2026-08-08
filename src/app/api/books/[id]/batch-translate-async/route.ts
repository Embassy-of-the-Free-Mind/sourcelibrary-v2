import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { getDb } from '@/lib/mongodb';
import { logGeminiCall } from '@/lib/gemini-logger';
import { getTriggerSource } from '@/lib/cron-auth';
import { getTranslationPrompt } from '@/lib/prompts';
import { PROMPT_VERSION, SKIP_TRANSLATION_PAGE_TYPES } from '@/lib/types/prompts/defaults';
import { createRevision } from '@/lib/page-revisions';
import { findHumanEditedPageIds, findPendingBatchJob } from '@/lib/translate-write';
import { withAuth } from '@/lib/auth-helpers';
import { buildVisiblePageCountPipeline } from '@/lib/page-counts';

/**
 * Async Batch Translation using Gemini Batch API
 *
 * Benefits:
 * - 50% cheaper than real-time API
 * - Auto-retries built in
 * - No rate limit issues
 * - 24h turnaround (usually faster)
 *
 * POST /api/books/[id]/batch-translate-async - Submit batch job
 * GET /api/books/[id]/batch-translate-async?jobName=xxx - Check job status
 */

// All available batch API keys for rotation (try each on quota exhaustion)
const BATCH_API_KEYS = [
  process.env.GEMINI_API_KEY_TIER3,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY,
].filter((k): k is string => !!k);
const UNIQUE_BATCH_KEYS = [...new Set(BATCH_API_KEYS)];

function getAiClient(keyIndex: number): GoogleGenAI {
  return new GoogleGenAI({ apiKey: UNIQUE_BATCH_KEYS[keyIndex] || UNIQUE_BATCH_KEYS[0] });
}

/**
 * POST - Submit a batch translation job
 */
export const POST = withAuth(async (request, session, context) => {
  try {
    const { id: bookId } = await context.params;
    const triggeredBy = getTriggerSource(request);
    const body = await request.json().catch(() => ({}));
    const {
      limit = 500,
      targetLanguage = 'English',
      model = process.env.GEMINI_BATCH_MODEL || 'gemini-3-flash-preview',
      force = false, // When true, include pages that already have translation (for re-processing)
      staleOnly = false, // When true, only retranslate pages where translation model differs from OCR model
      resubmit = false, // When true, bypass the pending-job double-submit guard
    } = body;

    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Double-submit guard (#3749, archaeology I68): a pending translation
    // batch for this book means submitting again pays Gemini twice for the
    // same pages. 409 with the existing job; pass resubmit: true to bypass
    // (e.g. a job Gemini lost track of).
    if (!resubmit) {
      const pending = await findPendingBatchJob(db, { bookId, type: 'translation' });
      if (pending) {
        return NextResponse.json({
          error: 'batch_job_already_pending',
          message: `A translation batch job for this book is already pending (submitted ${pending.createdAt?.toISOString?.() || pending.createdAt}). Collect it or pass resubmit: true to force a new submission.`,
          existingJob: pending,
        }, { status: 409 });
      }
    }

    // Find pages to translate (or modernize for English books)
    // staleOnly: retranslate pages where OCR was redone with a newer model but translation is stale
    // force: retranslate ALL pages regardless of existing translation
    // default: only translate pages without any translation
    let translationFilter: Record<string, unknown>;
    if (staleOnly) {
      translationFilter = {
        book_id: bookId,
        'ocr.data': { $exists: true, $nin: [null, ''] },
        'ocr.model': model, // Has current OCR
        'translation.data': { $exists: true, $nin: [null, ''] },
        'translation.model': { $ne: model }, // But translation is from a different model
        page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES },
      };
    } else if (force) {
      // force=true bypasses BOTH the translation-exists check AND the page-type filter
      // (illustration/diagram pages in manuscripts like Kitab al-Bulhan have translatable text)
      translationFilter = {
        book_id: bookId,
        'ocr.data': { $exists: true, $nin: [null, ''] },
      };
    } else {
      translationFilter = {
        book_id: bookId,
        'ocr.data': { $exists: true, $nin: [null, ''] },
        page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES },
        $or: [
          { 'translation.data': { $exists: false } },
          { 'translation.data': null },
          { 'translation.data': '' }
        ]
      };
    }

    const pagesToProcess = await db.collection('pages')
      .find(translationFilter)
      .sort({ page_number: 1 })
      .limit(limit)
      .toArray();

    if (pagesToProcess.length === 0) {
      return NextResponse.json({
        message: 'No pages need translation',
        processed: 0
      });
    }

    // Build batch requests - each page is a separate request
    const batchRequests = [];

    // Use the canonical prompt — modernization for English, translation for others
    const sourceLanguage = book.language || 'Latin';
    const isEnglish = sourceLanguage.toLowerCase() === 'english';
    const promptResult = await getTranslationPrompt(sourceLanguage, targetLanguage);
    const basePrompt = promptResult.text;
    const promptRef = promptResult.reference;
    const promptProvenance = {
      prompt_id: promptRef.id,
      prompt_name: promptRef.name,
      prompt_version: String(promptRef.version),
      prompt_hash: promptRef.content_hash,
    };

    for (const page of pagesToProcess) {
      const ocrText = page.ocr?.data;
      if (!ocrText) {
        console.warn(`Page ${page.page_number} has no OCR text, skipping`);
        continue;
      }

      // Same format as performTranslation in ai.ts
      const prompt = basePrompt + (isEnglish
        ? `\n\n**Text to modernize:**\n${ocrText}`
        : `\n\n**Text to translate:**\n${ocrText}`);

      batchRequests.push({
        key: page.id,
        request: {
          contents: [{
            parts: [{ text: prompt }],
            role: 'user'
          }],
          config: {
            temperature: 0.1,
            maxOutputTokens: 16384,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }
      });
    }

    if (batchRequests.length === 0) {
      return NextResponse.json({
        error: 'No pages with OCR text to translate',
        attempted: pagesToProcess.length
      }, { status: 400 });
    }

    // Submit batch job with key rotation — try each key until one succeeds
    let batchJob;
    let lastError: Error | null = null;
    for (let ki = 0; ki < UNIQUE_BATCH_KEYS.length; ki++) {
      try {
        const client = getAiClient(ki);
        batchJob = await client.batches.create({
          model,
          src: batchRequests.map(r => ({
            ...r.request,
            metadata: { key: r.key },
          })),
          config: {
            displayName: `translate-${bookId}-${Date.now()}`,
          }
        });
        break; // Success — stop trying keys
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const msg = lastError.message || '';
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
          console.warn(`[batch-translate] Key ${ki} quota exhausted, trying next...`);
          continue;
        }
        throw lastError; // Non-quota error — don't retry
      }
    }
    if (!batchJob) {
      return NextResponse.json({ error: lastError?.message || 'All API keys exhausted' }, { status: 429 });
    }

    // Store job info in database for tracking
    await db.collection('batch_jobs').insertOne({
      job_name: batchJob.name,
      book_id: bookId,
      type: 'translation',
      model,
      source_language: sourceLanguage,
      target_language: targetLanguage,
      force,
      stale_only: staleOnly,
      ...promptProvenance,
      page_ids: batchRequests.map(r => r.key),
      page_count: batchRequests.length,
      status: batchJob.state,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Log batch job submission
    await logGeminiCall({
      type: 'translation',
      mode: 'batch',
      model,
      book_id: bookId,
      book_title: book?.title,
      page_ids: batchRequests.map(r => r.key),
      page_count: batchRequests.length,
      batch_job_id: batchJob.name,
      gemini_job_name: batchJob.name,
      input_tokens: 0, // Not available until job completes
      output_tokens: 0,
      status: 'submitted',
      prompt_version: PROMPT_VERSION,
      endpoint: '/api/books/[id]/batch-translate-async',
      triggered_by: triggeredBy,
    });

    return NextResponse.json({
      success: true,
      jobName: batchJob.name,
      state: batchJob.state,
      pagesSubmitted: batchRequests.length,
      message: `Batch job submitted. Check status with GET /api/books/${bookId}/batch-translate-async?jobName=${batchJob.name}`
    });

  } catch (error) {
    console.error('Batch translation submit error:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    const isQuotaError = errMsg.includes('429') || errMsg.includes('quota') ||
      errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('exhausted');
    return NextResponse.json(
      { error: errMsg },
      { status: isQuotaError ? 429 : 500 }
    );
  }
});

/**
 * GET - Check batch job status and collect results
 */
export const GET = withAuth(async (request, session, context) => {
  try {
    const { id: bookId } = await context.params;
    const triggeredBy = getTriggerSource(request);
    const { searchParams } = new URL(request.url);
    const jobName = searchParams.get('jobName');

    const db = await getDb();

    // If no jobName, list recent jobs for this book
    if (!jobName) {
      const jobs = await db.collection('batch_jobs')
        .find({ book_id: bookId, type: 'translation' })
        .sort({ created_at: -1 })
        .limit(10)
        .toArray();

      return NextResponse.json({
        bookId,
        jobs: jobs.map(j => ({
          jobName: j.job_name,
          type: j.type,
          pageCount: j.page_count,
          status: j.status,
          resultsCollected: j.results_collected || false,
          successCount: j.success_count,
          failCount: j.fail_count,
          createdAt: j.created_at
        }))
      });
    }

    // Get job status from Gemini
    const batchJob = await getAiClient(0).batches.get({ name: jobName });

    // Update status in database
    await db.collection('batch_jobs').updateOne(
      { job_name: jobName },
      { $set: { status: batchJob.state, updated_at: new Date() } }
    );

    // If job succeeded, collect results
    if (batchJob.state === 'JOB_STATE_SUCCEEDED') {
      const jobDoc = await db.collection('batch_jobs').findOne({ job_name: jobName });

      if (jobDoc && !jobDoc.results_collected && batchJob.dest?.inlinedResponses) {
        const pageIds = jobDoc.page_ids || [];
        const validPageIdSet = new Set(pageIds as string[]);
        const responses = batchJob.dest.inlinedResponses;

        // Human-edit guard (#3749): pages whose translation was written or
        // corrected by a person (source 'manual' or edited_by) are protected —
        // batch results submitted before the edit must not clobber it.
        const protectedPageIds = await findHumanEditedPageIds(db, pageIds as string[], 'translation');

        let successCount = 0;
        let failCount = 0;
        let protectedCount = 0;
        const now = new Date().toISOString();

        for (let i = 0; i < responses.length; i++) {
          const response = responses[i];

          // Use metadata.key for page matching (NEVER positional —
          // Gemini Batch API returns results in arbitrary order.
          // See Feb 18 2026 scrambling incident.)
          const pageId = (response as unknown as { metadata?: { key?: string } }).metadata?.key || (pageIds[i]);
          if (!pageId || !validPageIdSet.has(pageId)) {
            console.warn(`[batch-translate] Result idx ${i} has invalid pageId: ${pageId}`);
            failCount++;
            continue;
          }

          if (protectedPageIds.has(pageId)) {
            console.log(`[batch-translate] Skipping page ${pageId} — translation is human-edited; refusing to overwrite (#3749)`);
            protectedCount++;
            continue;
          }

          // Extract text from nested response structure
          const text = response.response?.candidates?.[0]?.content?.parts?.[0]?.text;

          if (text) {
            // Snapshot manual edits before overwriting
            await createRevision(pageId, 'translation', jobName);

            // Set the full translation object (not nested fields) to handle cases where translation is null
            await db.collection('pages').updateOne(
              { id: pageId },
              {
                $set: {
                  translation: {
                    data: text,
                    updated_at: now,
                    model: jobDoc.model,
                    source_language: jobDoc.source_language,
                    target_language: jobDoc.target_language,
                    source: 'batch_api',
                    prompt_version: jobDoc.prompt_version || PROMPT_VERSION,
                    ...(jobDoc.prompt_id && { prompt_id: jobDoc.prompt_id }),
                    ...(jobDoc.prompt_hash && { prompt_hash: jobDoc.prompt_hash }),
                    ...(jobDoc.prompt_name && { prompt_name: jobDoc.prompt_name }),
                  },
                  updated_at: new Date()
                }
              }
            );
            successCount++;
          } else {
            failCount++;
          }
        }

        // Mark results as collected
        await db.collection('batch_jobs').updateOne(
          { job_name: jobName },
          {
            $set: {
              results_collected: true,
              success_count: successCount,
              fail_count: failCount,
              ...(protectedCount > 0 && { protected_count: protectedCount }),
              completed_at: new Date()
            }
          }
        );

        // Update book counters with the canonical visible-pages convention
        // (#3293) — the old count here included soft-hidden pages
        // (page_number <= 0), drifting from every other writer.
        const [counts] = await db.collection('pages')
          .aggregate(buildVisiblePageCountPipeline(bookId)).toArray();
        await db.collection('books').updateOne(
          { id: bookId },
          {
            $set: {
              ...(counts ? {
                pages_count: counts.total,
                pages_ocr: counts.with_ocr,
                pages_translated: counts.with_translation,
              } : {}),
              last_translation_at: new Date(),
              updated_at: new Date()
            }
          }
        );

        // Calculate total tokens from responses
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        for (const response of responses) {
          const usage = response.response?.usageMetadata;
          if (usage) {
            totalInputTokens += usage.promptTokenCount || 0;
            totalOutputTokens += usage.candidatesTokenCount || 0;
          }
        }

        // Log batch job completion
        await logGeminiCall({
          type: 'translation',
          mode: 'batch',
          model: jobDoc.model,
          book_id: bookId,
          book_title: undefined,
          page_ids: pageIds.slice(0, successCount),
          page_count: successCount,
          batch_job_id: jobName,
          gemini_job_name: jobName,
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          status: successCount > 0 ? 'success' : 'failed',
          prompt_version: jobDoc.prompt_version || PROMPT_VERSION,
          endpoint: '/api/books/[id]/batch-translate-async',
          triggered_by: triggeredBy,
        });

        return NextResponse.json({
          jobName,
          state: batchJob.state,
          resultsCollected: true,
          successCount,
          failCount,
          ...(protectedCount > 0 && { protectedCount }),
          message: `Collected ${successCount} translations${protectedCount > 0 ? ` (${protectedCount} skipped: human-edited)` : ''}`
        });
      }
    }

    const state = batchJob.state || 'JOB_STATE_PENDING';
    return NextResponse.json({
      jobName,
      state,
      resultsCollected: false,
      message: state === 'JOB_STATE_SUCCEEDED'
        ? 'Results already collected'
        : `Job is ${state.replace('JOB_STATE_', '').toLowerCase()}`
    });

  } catch (error) {
    console.error('Batch translation status error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Status check failed' },
      { status: 500 }
    );
  }
});

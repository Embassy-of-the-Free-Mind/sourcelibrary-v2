import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { getDb } from '@/lib/mongodb';
import { logGeminiCall } from '@/lib/gemini-logger';
import { getTranslationPrompt } from '@/lib/prompts';
import { PROMPT_VERSION, SKIP_TRANSLATION_PAGE_TYPES } from '@/lib/types/prompts/defaults';
import { createRevision } from '@/lib/page-revisions';
import { withAuth } from '@/lib/auth-helpers';

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

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY || '' });

/**
 * POST - Submit a batch translation job
 */
export const POST = withAuth(async (request, session, context) => {
  try {
    const { id: bookId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const {
      limit = 500,
      targetLanguage = 'English',
      model = 'gemini-3-flash-preview',
      force = false, // When true, include pages that already have translation (for re-processing)
    } = body;

    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Find pages to translate (or modernize for English books)
    // When force=true, include pages that already have translation (for re-processing with new prompts)
    const translationFilter = force
      ? {
          book_id: bookId,
          'ocr.data': { $exists: true, $nin: [null, ''] },
          page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES },
        }
      : {
          book_id: bookId,
          'ocr.data': { $exists: true, $nin: [null, ''] },
          page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES },
          $or: [
            { 'translation.data': { $exists: false } },
            { 'translation.data': null },
            { 'translation.data': '' }
          ]
        };

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

    // Submit batch job — each request includes metadata.key for result matching
    const batchJob = await ai.batches.create({
      model,
      src: batchRequests.map(r => ({
        ...r.request,
        metadata: { key: r.key },
      })),
      config: {
        displayName: `translate-${bookId}-${Date.now()}`,
      }
    });

    // Store job info in database for tracking
    await db.collection('batch_jobs').insertOne({
      job_name: batchJob.name,
      book_id: bookId,
      type: 'translation',
      model,
      source_language: sourceLanguage,
      target_language: targetLanguage,
      force,
      prompt_version: PROMPT_VERSION,
      page_ids: batchRequests.map(r => r.key),
      page_count: batchRequests.length,
      status: batchJob.state,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Log batch job submission
    await logGeminiCall({
      type: 'translate',
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
      endpoint: '/api/books/[id]/batch-translate-async',
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Submit failed' },
      { status: 500 }
    );
  }
});

/**
 * GET - Check batch job status and collect results
 */
export const GET = withAuth(async (request, session, context) => {
  try {
    const { id: bookId } = await context.params;
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
    const batchJob = await ai.batches.get({ name: jobName });

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
        const responses = batchJob.dest.inlinedResponses;

        let successCount = 0;
        let failCount = 0;
        const now = new Date().toISOString();

        for (let i = 0; i < responses.length && i < pageIds.length; i++) {
          const pageId = pageIds[i];
          const response = responses[i];

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
              completed_at: new Date()
            }
          }
        );

        // Update book's translation count
        const translatedCount = await db.collection('pages').countDocuments({
          book_id: bookId,
          'translation.data': { $exists: true, $nin: [null, ''] }
        });

        await db.collection('books').updateOne(
          { id: bookId },
          {
            $set: {
              pages_translated: translatedCount,
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
          type: 'translate',
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
          endpoint: '/api/books/[id]/batch-translate-async',
        });

        return NextResponse.json({
          jobName,
          state: batchJob.state,
          resultsCollected: true,
          successCount,
          failCount,
          message: `Collected ${successCount} translations`
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

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { getDb } from '@/lib/mongodb';

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

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

/**
 * POST - Submit a batch translation job
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const body = await request.json().catch(() => ({}));
    const {
      limit = 500,
      language = 'Latin',
      targetLanguage = 'English',
      model = 'gemini-2.5-flash',
    } = body;

    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Find pages needing translation (have OCR but no translation)
    const pagesToProcess = await db.collection('pages')
      .find({
        book_id: bookId,
        'ocr.data': { $exists: true, $nin: [null, ''] },
        $or: [
          { 'translation.data': { $exists: false } },
          { 'translation.data': null },
          { 'translation.data': '' }
        ]
      })
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

    for (const page of pagesToProcess) {
      const ocrText = page.ocr?.data;
      if (!ocrText) {
        console.warn(`Page ${page.page_number} has no OCR text, skipping`);
        continue;
      }

      const prompt = `You are an expert scholarly translator specializing in historical ${language} texts.

Translate the following ${language} text to ${targetLanguage}:
- Preserve the author's meaning and style
- Use clear, modern ${targetLanguage}
- Keep technical terms with brief explanations if needed
- Maintain paragraph structure
- Note any unclear passages with [unclear]

Text to translate:
${ocrText}

Output only the translation, no commentary.`;

      batchRequests.push({
        key: page.id,
        request: {
          contents: [{
            parts: [{ text: prompt }],
            role: 'user'
          }]
        }
      });
    }

    if (batchRequests.length === 0) {
      return NextResponse.json({
        error: 'No pages with OCR text to translate',
        attempted: pagesToProcess.length
      }, { status: 400 });
    }

    // Submit batch job
    const batchJob = await ai.batches.create({
      model,
      src: batchRequests.map(r => r.request),
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
      source_language: language,
      target_language: targetLanguage,
      page_ids: batchRequests.map(r => r.key),
      page_count: batchRequests.length,
      status: batchJob.state,
      created_at: new Date(),
      updated_at: new Date(),
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
}

/**
 * GET - Check batch job status and collect results
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
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
}

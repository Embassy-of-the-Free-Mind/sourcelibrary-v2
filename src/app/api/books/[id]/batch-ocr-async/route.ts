import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { getDb } from '@/lib/mongodb';
import { getOcrPrompt } from '@/lib/prompts';
import { logGeminiCall } from '@/lib/gemini-logger';

/**
 * Async Batch OCR using Gemini Batch API
 *
 * Benefits:
 * - 50% cheaper than real-time API
 * - Auto-retries built in
 * - No rate limit issues
 * - 24h turnaround (usually faster)
 *
 * POST /api/books/[id]/batch-ocr-async - Submit batch job
 * GET /api/books/[id]/batch-ocr-async?jobName=xxx - Check job status
 */

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// Build image URL for a page
function getPageImageUrl(page: {
  cropped_photo?: string;
  archived_photo?: string;
  photo_original?: string;
  photo: string;
  crop?: { xStart: number; xEnd: number };
}): string {
  // Prefer archived/cropped over live IA
  if (page.crop && page.cropped_photo) {
    return page.cropped_photo;
  }
  if (page.archived_photo) {
    return page.archived_photo;
  }

  const baseUrl = page.photo_original || page.photo;

  // If has crop, use image proxy
  if (page.crop) {
    const apiBase = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXTAUTH_URL || 'http://localhost:3000';
    return `${apiBase}/api/image?url=${encodeURIComponent(baseUrl)}&w=2000&q=95&cx=${page.crop.xStart}&cw=${page.crop.xEnd}`;
  }

  return baseUrl;
}

// Fetch image as base64
async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    let mimeType = response.headers.get('content-type') || 'image/jpeg';
    mimeType = mimeType.split(';')[0].trim();

    if (mimeType === 'application/octet-stream') {
      mimeType = 'image/jpeg';
    }

    return { data: base64, mimeType };
  } catch (error) {
    console.error('Failed to fetch image:', url, error);
    return null;
  }
}

/**
 * POST - Submit a batch OCR job
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const body = await request.json().catch(() => ({}));
    const {
      limit = 10, // Default to 10 pages per batch (research shows >10 causes quality degradation)
      language = 'Latin',
      model = 'gemini-3-flash-preview',
    } = body;

    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Find pages needing OCR (no ocr.data or empty ocr.data)
    const pagesToProcess = await db.collection('pages')
      .find({
        book_id: bookId,
        $and: [
          {
            $or: [
              { photo: { $exists: true, $ne: null } },
              { photo_original: { $exists: true, $ne: null } }
            ]
          },
          {
            $or: [
              { 'ocr.data': { $exists: false } },
              { 'ocr.data': null },
              { 'ocr.data': '' }
            ]
          }
        ]
      })
      .sort({ page_number: 1 })
      .limit(limit)
      .toArray();

    if (pagesToProcess.length === 0) {
      return NextResponse.json({
        message: 'No pages need OCR',
        processed: 0
      });
    }

    // Build batch requests - each page is a separate request
    const batchRequests = [];

    // Get the main OCR prompt with language substituted
    const ocrPromptResult = await getOcrPrompt(language);
    const prompt = ocrPromptResult.text;

    for (const page of pagesToProcess) {
      const typedPage = page as unknown as {
        cropped_photo?: string;
        archived_photo?: string;
        photo_original?: string;
        photo: string;
        crop?: { xStart: number; xEnd: number };
      };
      const imageUrl = getPageImageUrl(typedPage);
      const image = await fetchImageAsBase64(imageUrl);

      if (!image) {
        console.warn(`Failed to fetch image for page ${page.page_number}`);
        continue;
      }

      batchRequests.push({
        key: page.id, // Use page ID as key for matching results
        request: {
          contents: [{
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: image.mimeType,
                  data: image.data
                }
              }
            ],
            role: 'user'
          }]
        }
      });
    }

    if (batchRequests.length === 0) {
      return NextResponse.json({
        error: 'Failed to prepare any images for batch',
        attempted: pagesToProcess.length
      }, { status: 400 });
    }

    // Submit batch job
    const batchJob = await ai.batches.create({
      model,
      src: batchRequests.map(r => r.request),
      config: {
        displayName: `ocr-${bookId}-${Date.now()}`,
      }
    });

    // Store job info in database for tracking
    await db.collection('batch_jobs').insertOne({
      job_name: batchJob.name,
      book_id: bookId,
      type: 'ocr',
      model,
      language,
      page_ids: batchRequests.map(r => r.key),
      page_count: batchRequests.length,
      status: batchJob.state,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Log batch job submission
    await logGeminiCall({
      type: 'ocr',
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
      endpoint: '/api/books/[id]/batch-ocr-async',
    });

    return NextResponse.json({
      success: true,
      jobName: batchJob.name,
      state: batchJob.state,
      pagesSubmitted: batchRequests.length,
      message: `Batch job submitted. Check status with GET /api/books/${bookId}/batch-ocr-async?jobName=${batchJob.name}`
    });

  } catch (error) {
    console.error('Batch OCR submit error:', error);
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
        .find({ book_id: bookId })
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
            await db.collection('pages').updateOne(
              { id: pageId },
              {
                $set: {
                  'ocr.data': text,
                  'ocr.updated_at': now,
                  'ocr.model': jobDoc.model,
                  'ocr.language': jobDoc.language,
                  'ocr.source': 'batch_api',
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
          type: 'ocr',
          mode: 'batch',
          model: jobDoc.model,
          book_id: bookId,
          book_title: undefined, // Could fetch from book if needed
          page_ids: pageIds.slice(0, successCount),
          page_count: successCount,
          batch_job_id: jobName,
          gemini_job_name: jobName,
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          status: successCount > 0 ? 'success' : 'failed',
          endpoint: '/api/books/[id]/batch-ocr-async',
        });

        return NextResponse.json({
          jobName,
          state: batchJob.state,
          resultsCollected: true,
          successCount,
          failCount,
          message: `Collected ${successCount} OCR results`
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
    console.error('Batch OCR status error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Status check failed' },
      { status: 500 }
    );
  }
}

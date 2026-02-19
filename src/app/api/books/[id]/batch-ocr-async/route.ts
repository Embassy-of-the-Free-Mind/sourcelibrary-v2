import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { getDb } from '@/lib/mongodb';
import { getOcrPrompt } from '@/lib/prompts';
import { logGeminiCall } from '@/lib/gemini-logger';
import { images } from '@/lib/api-client';
import { PROMPT_VERSION, extractPageType, extractColumns, parseDetectedImages, parseMultiPageOcr } from '@/lib/types/prompts/defaults';
import { withAuth } from '@/lib/auth-helpers';
import { createSnapshotIfNeeded } from '@/lib/snapshots';

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

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY || '' });

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
  if (page.archived_photo && !page.archived_photo.startsWith('failed:')) {
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
    const result = await images.fetchBase64(url, { includeMimeType: true });
    if (typeof result === 'string') {
      return { data: result, mimeType: 'image/jpeg' };
    }
    return { data: result.base64, mimeType: result.mimeType };
  } catch (error) {
    console.error('Failed to fetch image:', url, error);
    return null;
  }
}

/**
 * POST - Submit a batch OCR job
 */
export const POST = withAuth(async (request, session, context) => {
  try {
    const { id: bookId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const {
      limit = 10,
      model = 'gemini-3-flash-preview',
      force = false, // When true, include pages that already have OCR (for re-processing)
      pagesPerRequest = 1, // >1 enables multi-page mode: N images per Gemini request (saves quota)
    } = body;

    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Find pages to OCR
    // When force=true, include pages that already have OCR (for re-processing with new prompts)
    const hasImageFilter = {
      $or: [
        { photo: { $exists: true, $ne: null } },
        { photo_original: { $exists: true, $ne: null } }
      ]
    };
    const ocrFilter = force
      ? hasImageFilter
      : {
          $and: [
            hasImageFilter,
            {
              $or: [
                { 'ocr.data': { $exists: false } },
                { 'ocr.data': null },
                { 'ocr.data': '' }
              ]
            }
          ]
        };

    const pagesToProcess = await db.collection('pages')
      .find({ book_id: bookId, ...ocrFilter })
      .sort({ page_number: 1 })
      .limit(limit)
      .toArray();

    if (pagesToProcess.length === 0) {
      return NextResponse.json({
        message: 'No pages need OCR',
        processed: 0
      });
    }

    // Build batch requests
    const batchRequests: Array<{ key: string; pageIds: string[]; request: Record<string, unknown> }> = [];

    // Use book's original_language if set, otherwise auto-detect
    const language = book.original_language || '';

    // Get the main OCR prompt with language substituted
    const ocrPromptResult = await getOcrPrompt();
    const prompt = ocrPromptResult.text;

    // Step 1: Fetch all images
    const preparedPages: Array<{ id: string; pageNumber: number; image: { data: string; mimeType: string } }> = [];
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
      preparedPages.push({ id: page.id, pageNumber: page.page_number, image });
    }

    // Step 2: Build batch requests
    const effectivePPR = Math.max(1, Math.min(pagesPerRequest, 10)); // Clamp 1-10

    if (effectivePPR > 1) {
      // Multi-page mode: group images into single requests
      for (let i = 0; i < preparedPages.length; i += effectivePPR) {
        const chunk = preparedPages.slice(i, i + effectivePPR);
        const parts: Array<Record<string, unknown>> = [];
        const chunkPageIds: string[] = [];

        parts.push({ text: `You will OCR ${chunk.length} page images. For each page, produce your complete OCR transcription wrapped in a <page id="PAGE_ID"> tag, where PAGE_ID matches the ID shown before each image.\n\nWithin each <page> block, follow these OCR instructions:\n\n${prompt}\n\nProduce one <page> block per image, in order:\n` });

        for (const p of chunk) {
          chunkPageIds.push(p.id);
          parts.push({ text: `\nPage ID: ${p.id}` });
          parts.push({ inlineData: { mimeType: p.image.mimeType, data: p.image.data } });
        }

        batchRequests.push({
          key: chunkPageIds[0], // First page ID as batch key
          pageIds: chunkPageIds,
          request: {
            contents: [{ parts, role: 'user' }],
            config: {
              temperature: 0.1,
              maxOutputTokens: Math.min(65536, 4096 * chunk.length),
              thinkingConfig: { thinkingBudget: 0 },
            },
          },
        });
      }
    } else {
      // Single-page mode (original behavior)
      for (const p of preparedPages) {
        batchRequests.push({
          key: p.id,
          pageIds: [p.id],
          request: {
            contents: [{
              parts: [
                { text: prompt },
                { inlineData: { mimeType: p.image.mimeType, data: p.image.data } },
              ],
              role: 'user',
            }],
            config: {
              temperature: 0.1,
              maxOutputTokens: 16384,
              thinkingConfig: { thinkingBudget: 0 },
            },
          },
        });
      }
    }

    if (batchRequests.length === 0) {
      return NextResponse.json({
        error: 'Failed to prepare any images for batch',
        attempted: pagesToProcess.length
      }, { status: 400 });
    }

    // Submit batch job — each request includes metadata.key for result matching
    // and generationConfig to cap output tokens and disable thinking
    const batchJob = await ai.batches.create({
      model,
      src: batchRequests.map(r => ({
        ...r.request,
        metadata: { key: r.key },
      })),
      config: {
        displayName: `ocr-${bookId}-${Date.now()}`,
      }
    });

    // Flat list of all page IDs across all requests
    const allPageIds = batchRequests.flatMap(r => r.pageIds);

    // Store job info in database for tracking
    await db.collection('batch_jobs').insertOne({
      job_name: batchJob.name,
      book_id: bookId,
      type: 'ocr',
      model,
      language,
      force,
      prompt_version: PROMPT_VERSION,
      page_ids: allPageIds,
      page_count: allPageIds.length,
      pages_per_request: effectivePPR,
      request_count: batchRequests.length,
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
      page_ids: allPageIds,
      page_count: allPageIds.length,
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
      pagesSubmitted: allPageIds.length,
      requestCount: batchRequests.length,
      pagesPerRequest: effectivePPR,
      message: `Batch job submitted: ${allPageIds.length} pages in ${batchRequests.length} requests. Check status with GET /api/books/${bookId}/batch-ocr-async?jobName=${batchJob.name}`
    });

  } catch (error) {
    console.error('Batch OCR submit error:', error);
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
        const isMultiPage = (jobDoc.pages_per_request || 1) > 1;

        // Safety check for single-page mode: response count must match page count
        if (!isMultiPage && responses.length !== pageIds.length) {
          console.warn(`[batch-ocr] Response count (${responses.length}) != page count (${pageIds.length}) for job ${jobName}. Skipping to avoid mismatched data.`);
          return NextResponse.json({
            jobName,
            state: batchJob.state,
            error: `Response count mismatch: ${responses.length} responses for ${pageIds.length} pages. Results NOT saved to prevent data corruption.`,
            resultsCollected: false,
          }, { status: 409 });
        }

        let successCount = 0;
        let failCount = 0;
        const now = new Date().toISOString();

        // Build flat list of { pageId, ocrText } from responses
        const pageResults: Array<{ pageId: string; text: string }> = [];

        if (isMultiPage) {
          // Multi-page mode: parse <page id="...">...</page> blocks
          console.log(`[batch-ocr] Collecting multi-page results: ${responses.length} responses for ${pageIds.length} pages (${jobDoc.pages_per_request} pages/request)`);
          for (let ri = 0; ri < responses.length; ri++) {
            const response = responses[ri];
            const responseText = response.response?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!responseText) {
              console.warn(`[batch-ocr] Response ${ri}: empty (no text in candidate)`);
              failCount++;
              continue;
            }
            const parsed = parseMultiPageOcr(responseText);
            console.log(`[batch-ocr] Response ${ri}: parsed ${parsed.size} pages from ${responseText.length} chars`);
            if (parsed.size === 0) {
              console.warn(`[batch-ocr] Response ${ri}: no <page> tags found. First 500 chars: ${responseText.slice(0, 500)}`);
              failCount++;
            }
            for (const [pageId, ocrText] of parsed) {
              pageResults.push({ pageId, text: ocrText });
            }
          }
        } else {
          // Single-page mode: positional matching
          for (let i = 0; i < responses.length; i++) {
            const text = responses[i].response?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              pageResults.push({ pageId: pageIds[i], text });
            } else {
              failCount++;
            }
          }
        }

        // Log collection summary
        if (isMultiPage) {
          const foundIds = new Set(pageResults.map(r => r.pageId));
          const missingIds = pageIds.filter((id: string) => !foundIds.has(id));
          console.log(`[batch-ocr] Collection summary: ${pageResults.length}/${pageIds.length} pages parsed, ${missingIds.length} missing${missingIds.length > 0 ? ': ' + missingIds.join(', ') : ''}`);
        }

        // Save each page result
        for (const { pageId, text } of pageResults) {
            const pageType = extractPageType(text);
            const columns = extractColumns(text);
            const detectedImages = parseDetectedImages(text);

            // Snapshot manual edits before overwriting
            await createSnapshotIfNeeded(pageId, 'pre_ocr', jobName || undefined);

            const updateResult = await db.collection('pages').updateOne(
              { id: pageId },
              {
                $set: {
                  'ocr.data': text,
                  'ocr.updated_at': now,
                  'ocr.model': jobDoc.model,
                  'ocr.language': jobDoc.language,
                  'ocr.source': 'batch_api',
                  'ocr.prompt_version': jobDoc.prompt_version || PROMPT_VERSION,
                  'ocr.prompt_name': jobDoc.prompt_name || 'Standard OCR',
                  'ocr.batch_job_id': jobDoc.job_name,
                  ...(pageType && { page_type: pageType }),
                  ...(columns && { columns }),
                  ...(detectedImages.length > 0 && { detected_images: detectedImages }),
                  updated_at: new Date()
                }
              }
            );
            if (updateResult.matchedCount === 0) {
              console.warn(`[batch-ocr] Page ${pageId} not found in database`);
              failCount++;
              continue;
            }
            successCount++;
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
});

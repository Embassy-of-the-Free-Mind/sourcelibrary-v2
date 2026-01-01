import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getOcrPrompt } from '@/lib/prompts';
import {
  createBatchJobInline,
  uploadBatchFile,
  createBatchJobFromFile,
  listBatchJobs,
  type BatchRequest,
} from '@/lib/gemini-batch';
import sharp from 'sharp';

export const maxDuration = 300;

// Maximum inline requests (Gemini Batch API handles inline batches well)
// File-based uploads require GCS, so we use inline for all reasonable sizes
const MAX_INLINE_REQUESTS = 1000;

// Image optimization: 800px width provides identical OCR quality with 78% smaller files
const MAX_IMAGE_WIDTH = 800;

async function resizeImage(buffer: ArrayBuffer): Promise<Buffer> {
  return sharp(Buffer.from(buffer))
    .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

interface PageForBatch {
  pageId: string;
  imageUrl: string;
  pageNumber: number;
}

/**
 * POST /api/batch-jobs
 *
 * Create a new Gemini Batch API job for OCR or translation
 * Jobs process asynchronously at 50% cost savings
 */
export async function POST(request: NextRequest) {
  try {
    const {
      type,  // 'ocr' or 'translate'
      bookId,
      bookTitle,
      model = 'gemini-2.5-flash',
      language = 'Latin',
      pageIds,
    }: {
      type: 'ocr' | 'translate';
      bookId: string;
      bookTitle?: string;
      model?: string;
      language?: string;
      pageIds?: string[];
    } = await request.json();

    if (!type || !bookId) {
      return NextResponse.json(
        { error: 'type and bookId are required' },
        { status: 400 }
      );
    }

    if (type !== 'ocr' && type !== 'translate') {
      return NextResponse.json(
        { error: 'type must be "ocr" or "translate"' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Get book and pages
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json(
        { error: 'Book not found' },
        { status: 404 }
      );
    }

    // Get pages that need processing
    let query: Record<string, unknown> = { book_id: bookId };

    if (pageIds && pageIds.length > 0) {
      query.id = { $in: pageIds };
    }

    if (type === 'ocr') {
      // Pages without OCR
      query.$or = [
        { 'ocr.data': { $exists: false } },
        { 'ocr.data': null },
        { 'ocr.data': '' },
      ];
    } else {
      // Pages with OCR but without translation
      query['ocr.data'] = { $exists: true, $nin: ['', null] };
      query.$or = [
        { 'translation.data': { $exists: false } },
        { 'translation.data': null },
        { 'translation.data': '' },
      ];
    }

    const pages = await db
      .collection('pages')
      .find(query)
      .sort({ page_number: 1 })
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json({
        message: `No pages need ${type}`,
        pagesFound: 0,
      });
    }

    console.log(`[batch-jobs] Creating ${type} batch for ${pages.length} pages`);

    // Get OCR prompt
    const ocrPrompt = await getOcrPrompt(language);

    // For translation, fetch ALL pages to get previous page context for continuity
    // This ensures continuity even when only some pages need translation
    const allPagesMap: Map<number, { ocr?: { data?: string }; translation?: { data?: string } }> = new Map();
    if (type === 'translate') {
      const allPages = await db
        .collection('pages')
        .find({ book_id: bookId })
        .project({ page_number: 1, 'ocr.data': 1, 'translation.data': 1 })
        .sort({ page_number: 1 })
        .toArray();
      allPages.forEach(p => allPagesMap.set(p.page_number, p));
    }

    // Build batch requests
    const batchRequests: BatchRequest[] = [];
    const failedImages: string[] = [];

    for (const page of pages) {
      // Get image URL (prefer cropped for split pages)
      const imageUrl = page.cropped_photo || page.photo;

      if (!imageUrl) {
        failedImages.push(page.id);
        continue;
      }

      if (type === 'ocr') {
        // For OCR, we need to fetch, resize, and embed images
        try {
          const imageResponse = await fetch(imageUrl);
          if (!imageResponse.ok) {
            failedImages.push(page.id);
            continue;
          }

          const imageBuffer = await imageResponse.arrayBuffer();
          // Resize to 800px width - identical OCR quality, 78% smaller files
          const resizedBuffer = await resizeImage(imageBuffer);
          const base64 = resizedBuffer.toString('base64');

          batchRequests.push({
            key: page.id,
            request: {
              contents: [
                {
                  parts: [
                    { text: ocrPrompt.text },
                    {
                      inlineData: {
                        mimeType: 'image/jpeg',
                        data: base64,
                      },
                    },
                  ],
                },
              ],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 8192,
              },
            },
          });
        } catch (e) {
          console.error(`[batch-jobs] Failed to fetch/resize image for page ${page.id}:`, e);
          failedImages.push(page.id);
        }
      } else {
        // Translation - use OCR text
        const ocrText = page.ocr?.data;
        if (!ocrText) {
          failedImages.push(page.id);
          continue;
        }

        // Get previous page context for continuity
        let previousContext = '';
        const prevPageData = allPagesMap.get(page.page_number - 1);
        if (prevPageData?.translation?.data) {
          // Use last 2000 chars of previous translation
          const prevTranslation = prevPageData.translation.data;
          previousContext = `\n\n**Previous page translation for continuity:**\n${prevTranslation.slice(-2000)}${prevTranslation.length > 2000 ? '...' : ''}`;
        } else if (prevPageData?.ocr?.data) {
          // Fall back to previous OCR if no translation yet
          const prevOcr = prevPageData.ocr.data;
          previousContext = `\n\n**Previous page text for continuity:**\n${prevOcr.slice(-1500)}${prevOcr.length > 1500 ? '...' : ''}`;
        }

        batchRequests.push({
          key: page.id,
          request: {
            contents: [
              {
                parts: [
                  {
                    text: `Translate the following ${language} text to English. Preserve formatting and paragraph breaks. Maintain continuity with the previous page if provided.\n\n${ocrText}${previousContext}`,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 8192,
            },
          },
        });
      }
    }

    if (batchRequests.length === 0) {
      return NextResponse.json({
        error: 'No valid pages to process',
        failedImages,
      }, { status: 400 });
    }

    console.log(`[batch-jobs] Submitting ${batchRequests.length} requests to Gemini Batch API`);

    // Create the batch job
    const displayName = `${type}-${bookId.slice(0, 8)}-${Date.now()}`;
    let geminiJob: { name: string; state: string };

    if (batchRequests.length <= MAX_INLINE_REQUESTS) {
      // Use inline requests for smaller batches
      geminiJob = await createBatchJobInline(model, batchRequests, displayName);
    } else {
      // Use file upload for larger batches
      const jsonlContent = batchRequests
        .map((req) => JSON.stringify({ key: req.key, request: req.request }))
        .join('\n');

      const file = await uploadBatchFile(jsonlContent, `${displayName}.jsonl`);
      geminiJob = await createBatchJobFromFile(model, file.name, displayName);
    }

    // Store job in our database
    const batchJob = {
      id: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      gemini_job_name: geminiJob.name,
      type,
      book_id: bookId,
      book_title: bookTitle || book.title,
      model,
      language,
      prompt_reference: ocrPrompt.reference, // Track which prompt version was used
      status: 'pending',
      gemini_state: geminiJob.state,
      page_ids: batchRequests.map((r) => r.key),
      total_pages: batchRequests.length,
      completed_pages: 0,
      failed_pages: 0,
      failed_image_ids: failedImages,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await db.collection('batch_jobs').insertOne(batchJob);

    console.log(`[batch-jobs] Created job ${batchJob.id} -> Gemini ${geminiJob.name}`);

    return NextResponse.json({
      success: true,
      job: {
        id: batchJob.id,
        gemini_job_name: geminiJob.name,
        type,
        status: 'pending',
        total_pages: batchRequests.length,
        failed_images: failedImages.length,
      },
      message: `Batch job created for ${batchRequests.length} pages. Results typically ready within 2-24 hours.`,
    });
  } catch (error) {
    console.error('[batch-jobs] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to create batch job',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/batch-jobs
 *
 * List all batch jobs (from our database)
 */
export async function GET() {
  try {
    const db = await getDb();

    const jobs = await db
      .collection('batch_jobs')
      .find()
      .sort({ created_at: -1 })
      .limit(100)
      .toArray();

    // Also get Gemini batch jobs for cross-reference
    let geminiJobs: Awaited<ReturnType<typeof listBatchJobs>> = [];
    try {
      geminiJobs = await listBatchJobs();
    } catch (e) {
      console.warn('[batch-jobs] Could not fetch Gemini jobs:', e);
    }

    return NextResponse.json({
      jobs: jobs.map((job) => ({
        id: job.id,
        gemini_job_name: job.gemini_job_name,
        type: job.type,
        book_id: job.book_id,
        book_title: job.book_title,
        model: job.model,
        status: job.status,
        gemini_state: job.gemini_state,
        total_pages: job.total_pages,
        completed_pages: job.completed_pages,
        failed_pages: job.failed_pages,
        created_at: job.created_at,
        updated_at: job.updated_at,
      })),
      gemini_jobs_count: geminiJobs.length,
    });
  } catch (error) {
    console.error('[batch-jobs] List error:', error);
    return NextResponse.json(
      { error: 'Failed to list batch jobs' },
      { status: 500 }
    );
  }
}

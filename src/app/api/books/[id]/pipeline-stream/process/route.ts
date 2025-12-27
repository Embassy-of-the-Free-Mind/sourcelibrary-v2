import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { performOCR, performOCRWithBuffer, performTranslation } from '@/lib/ai';
import { getOcrPrompt, getTranslationPrompt, type PromptLookupResult } from '@/lib/prompts';
import { createSnapshotIfNeeded } from '@/lib/snapshots';
import { put } from '@vercel/blob';
import sharp from 'sharp';
import type { Job, JobResult, PromptReference } from '@/lib/types';

// Extend timeout for processing
export const maxDuration = 300;

// Process a single page through the full pipeline: crop → OCR → translate
// Key: If page has crop data, we MUST use the cropped image for OCR (not full spread)
async function processPageFully(
  page: {
    id: string;
    book_id: string;
    page_number: number;
    photo: string;
    photo_original?: string;
    crop?: { xStart: number; xEnd: number };
    cropped_photo?: string;
    ocr?: { data?: string };
    translation?: { data?: string };
  },
  config: { model: string; language: string; overwrite?: boolean },
  prompts: { ocr: PromptLookupResult; translation: PromptLookupResult },
  db: Awaited<ReturnType<typeof getDb>>,
  previousOcr?: string,
  previousTranslation?: string
): Promise<{
  success: boolean;
  error?: string;
  duration: number;
  steps: { crop?: boolean; ocr?: boolean; translate?: boolean };
  ocrText?: string;
  translationText?: string;
}> {
  const startTime = performance.now();
  const steps: { crop?: boolean; ocr?: boolean; translate?: boolean } = {};

  try {
    let ocrText = page.ocr?.data;
    let translationText = page.translation?.data;

    // Determine if we need to crop and/or do OCR
    // With overwrite=true, always re-do OCR and translation
    const needsCrop = page.crop && !page.cropped_photo;
    const needsOcr = config.overwrite || !ocrText;
    const needsTranslate = config.overwrite || !translationText;

    // Create snapshots of any manually-edited content before overwriting
    if (needsOcr) {
      await createSnapshotIfNeeded(page.id, 'pre_ocr');
    }
    if (needsTranslate) {
      await createSnapshotIfNeeded(page.id, 'pre_translate');
    }

    // If page was split but needs OCR, we MUST have or create a cropped image
    // This ensures OCR only sees the single page, not the full two-page spread
    let croppedBuffer: Buffer | null = null;
    let imageUrlForOcr = page.cropped_photo || page.photo;

    // Step 1: Handle cropping (if needed)
    if (needsCrop) {
      const originalUrl = page.photo_original || page.photo;

      // Fetch the original image
      const imageResponse = await fetch(originalUrl);
      if (!imageResponse.ok) {
        return {
          success: false,
          error: 'Failed to fetch image for cropping',
          duration: performance.now() - startTime,
          steps,
        };
      }

      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      const metadata = await sharp(imageBuffer).metadata();
      const imgWidth = metadata.width || 1000;
      const imgHeight = metadata.height || 1000;

      const left = Math.round((page.crop!.xStart / 1000) * imgWidth);
      const cropWidth = Math.round(((page.crop!.xEnd - page.crop!.xStart) / 1000) * imgWidth);

      croppedBuffer = await sharp(imageBuffer)
        .extract({
          left,
          top: 0,
          width: Math.min(cropWidth, imgWidth - left),
          height: imgHeight,
        })
        .resize(1200, null, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80, progressive: true })
        .toBuffer();

      steps.crop = true;

      // If we also need OCR, use the buffer directly (faster - skip upload round-trip)
      // Upload happens in parallel/after OCR
      if (needsOcr) {
        // Do OCR with buffer directly - much faster!
        const ocrStart = performance.now();
        const ocrResult = await performOCRWithBuffer(
          croppedBuffer,
          'image/jpeg',
          config.language,
          previousOcr,
          prompts.ocr.text,
          config.model
        );
        const ocrDuration = performance.now() - ocrStart;

        ocrText = ocrResult.text;

        await db.collection('pages').updateOne(
          { id: page.id },
          {
            $set: {
              ocr: {
                data: ocrText,
                language: config.language,
                model: config.model,
                prompt: prompts.ocr.reference,
                updated_at: new Date(),
                source: 'ai',  // Mark as AI-generated
                // Processing metadata
                input_tokens: ocrResult.usage.inputTokens,
                output_tokens: ocrResult.usage.outputTokens,
                cost_usd: ocrResult.usage.costUsd,
                processing_ms: Math.round(ocrDuration),
                image_url: `[cropped inline from ${originalUrl}]`,
              },
              updated_at: new Date(),
            },
          }
        );

        steps.ocr = true;
      }

      // Upload cropped image to Vercel Blob (can happen after OCR)
      const filename = `cropped/${page.book_id}/${page.id}.jpg`;
      const blob = await put(filename, croppedBuffer, {
        access: 'public',
        contentType: 'image/jpeg',
        allowOverwrite: true,
      });

      // Update page with cropped_photo URL
      await db.collection('pages').updateOne(
        { id: page.id },
        { $set: { cropped_photo: blob.url, updated_at: new Date() } }
      );

      imageUrlForOcr = blob.url;
    }

    // Step 2: OCR if needed and not already done above
    if (needsOcr && !steps.ocr) {
      // Page either has no crop data (full image is fine) or already has cropped_photo
      const ocrStart = performance.now();
      const ocrResult = await performOCR(
        imageUrlForOcr,
        config.language,
        previousOcr,
        prompts.ocr.text,
        config.model
      );
      const ocrDuration = performance.now() - ocrStart;

      ocrText = ocrResult.text;

      await db.collection('pages').updateOne(
        { id: page.id },
        {
          $set: {
            ocr: {
              data: ocrText,
              language: config.language,
              model: config.model,
              prompt: prompts.ocr.reference,
              updated_at: new Date(),
              source: 'ai',  // Mark as AI-generated
              // Processing metadata
              input_tokens: ocrResult.usage.inputTokens,
              output_tokens: ocrResult.usage.outputTokens,
              cost_usd: ocrResult.usage.costUsd,
              processing_ms: Math.round(ocrDuration),
              image_url: imageUrlForOcr,
            },
            updated_at: new Date(),
          },
        }
      );

      steps.ocr = true;
    }

    // Step 3: Translate if needed
    if (ocrText && needsTranslate) {
      const translateStart = performance.now();
      const translateResult = await performTranslation(
        ocrText,
        config.language,
        'English',
        previousTranslation,
        prompts.translation.text,
        config.model
      );
      const translateDuration = performance.now() - translateStart;

      translationText = translateResult.text;

      await db.collection('pages').updateOne(
        { id: page.id },
        {
          $set: {
            translation: {
              data: translationText,
              language: 'English',
              source_language: config.language,
              model: config.model,
              prompt: prompts.translation.reference,
              updated_at: new Date(),
              source: 'ai',  // Mark as AI-generated
              // Processing metadata
              input_tokens: translateResult.usage.inputTokens,
              output_tokens: translateResult.usage.outputTokens,
              cost_usd: translateResult.usage.costUsd,
              processing_ms: Math.round(translateDuration),
            },
            updated_at: new Date(),
          },
        }
      );

      steps.translate = true;
    }

    return {
      success: true,
      duration: performance.now() - startTime,
      steps,
      ocrText,
      translationText,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: performance.now() - startTime,
      steps,
    };
  }
}

// POST: Process next chunk of pages
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = performance.now();
  const { id: bookId } = await params;

  try {
    const db = await getDb();
    const body = await request.json();
    const { jobId } = body;

    if (!jobId) {
      return NextResponse.json({ error: 'jobId required' }, { status: 400 });
    }

    // Get job
    const job = await db.collection('jobs').findOne({ id: jobId }) as Job | null;
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (job.status === 'completed' || job.status === 'cancelled') {
      return NextResponse.json({ job, done: true, message: 'Job already finished' });
    }

    if (job.status === 'paused') {
      return NextResponse.json({ job, done: false, paused: true });
    }

    // Update to processing
    if (job.status === 'pending') {
      await db.collection('jobs').updateOne(
        { id: jobId },
        { $set: { status: 'processing', started_at: new Date(), updated_at: new Date() } }
      );
    }

    // Get pages that haven't been processed
    const processedPageIds = new Set(job.results.map(r => r.pageId));
    const allPageIds: string[] = job.config.page_ids || [];
    const remainingPageIds = allPageIds.filter(id => !processedPageIds.has(id));

    if (remainingPageIds.length === 0) {
      await db.collection('jobs').updateOne(
        { id: jobId },
        { $set: { status: 'completed', completed_at: new Date(), updated_at: new Date() } }
      );
      const updatedJob = await db.collection('jobs').findOne({ id: jobId });
      return NextResponse.json({ job: updatedJob, done: true, message: 'Job completed' });
    }

    // Get parallel count from config (default 3)
    const parallelPages = (job.config.parallelPages as number) || 3;

    // Process pages in parallel, but in order for context
    // We'll process in small batches to maintain some ordering for context
    const batchSize = Math.min(parallelPages, remainingPageIds.length);
    const batchPageIds = remainingPageIds.slice(0, batchSize);

    // Get full page data
    const pages = await db.collection('pages')
      .find({ id: { $in: batchPageIds } })
      .sort({ page_number: 1 })
      .toArray();

    // Look up prompts for this job (with versioning)
    const jobLanguage = (job.config.language as string) || 'Latin';
    const ocrPrompt = await getOcrPrompt(jobLanguage, {
      name: job.config.prompt_name as string | undefined,
    });
    const translationPrompt = await getTranslationPrompt(jobLanguage, 'English', {
      name: job.config.prompt_name as string | undefined,
    });
    const prompts = { ocr: ocrPrompt, translation: translationPrompt };

    // Get previous page's OCR/translation for context (from the last processed page)
    let previousOcr: string | undefined;
    let previousTranslation: string | undefined;

    if (job.results.length > 0) {
      // Find the last successfully processed page
      const lastResult = [...job.results].reverse().find(r => r.success);
      if (lastResult) {
        const lastPage = await db.collection('pages').findOne({ id: lastResult.pageId });
        previousOcr = lastPage?.ocr?.data;
        previousTranslation = lastPage?.translation?.data;
      }
    }

    // Process pages - for best context, process sequentially within batch
    // but allow multiple batches to overlap via the chunked approach
    const results: JobResult[] = [];

    for (const page of pages) {
      // Check if job was cancelled mid-processing
      const currentJob = await db.collection('jobs').findOne({ id: jobId });
      if (currentJob?.status === 'cancelled' || currentJob?.status === 'paused') {
        break;
      }

      // Update current item
      await db.collection('jobs').updateOne(
        { id: jobId },
        {
          $set: {
            'progress.currentItem': `Page ${page.page_number}`,
            updated_at: new Date(),
          },
        }
      );

      const result = await processPageFully(
        page as unknown as Parameters<typeof processPageFully>[0],
        {
          model: (job.config.model as string) || 'gemini-2.5-flash',
          language: jobLanguage,
          overwrite: Boolean(job.config.overwrite),
        },
        prompts,
        db,
        previousOcr,
        previousTranslation
      );

      results.push({
        pageId: page.id,
        success: result.success,
        error: result.error,
        duration: result.duration,
      });

      // Update context for next page
      if (result.success) {
        previousOcr = result.ocrText;
        previousTranslation = result.translationText;
      }

      // Log progress
      const stepsStr = Object.entries(result.steps)
        .filter(([, done]) => done)
        .map(([step]) => step)
        .join('+') || 'skip';
      console.log(
        `[StreamPipeline ${jobId}] Page ${page.page_number}: ${result.success ? '✓' : '✗'} (${stepsStr}) ${Math.round(result.duration)}ms`
      );
    }

    // Update job with results
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.collection('jobs').updateOne(
      { id: jobId },
      {
        $push: { results: { $each: results } },
        $set: {
          'progress.completed': job.progress.completed + successCount,
          'progress.failed': job.progress.failed + failCount,
          'progress.currentItem': null,
          updated_at: new Date(),
        },
      } as any
    );

    // Check if complete
    const updatedJob = await db.collection('jobs').findOne({ id: jobId }) as Job | null;
    const allProcessed = updatedJob &&
      (updatedJob.progress.completed + updatedJob.progress.failed) >= updatedJob.progress.total;

    if (allProcessed && updatedJob) {
      const finalStatus = updatedJob.progress.failed > 0 && updatedJob.progress.completed === 0
        ? 'failed'
        : 'completed';

      await db.collection('jobs').updateOne(
        { id: jobId },
        { $set: { status: finalStatus, completed_at: new Date(), updated_at: new Date() } }
      );
    }

    const finalJob = await db.collection('jobs').findOne({ id: jobId });

    // Auto-continue if more work
    if (!allProcessed && remainingPageIds.length > results.length) {
      const baseUrl = process.env.NEXT_PUBLIC_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

      fetch(`${baseUrl}/api/books/${bookId}/pipeline-stream/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      }).catch(() => {
        // Will be picked up by polling
      });
    }

    return NextResponse.json({
      job: finalJob,
      processed: results.length,
      remaining: remainingPageIds.length - results.length,
      done: allProcessed,
      duration: performance.now() - startTime,
    });
  } catch (error) {
    console.error('Error processing streaming pipeline:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Processing failed' },
      { status: 500 }
    );
  }
}
// Force rebuild Fri Dec 26 10:32:29 CET 2025

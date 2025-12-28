import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { performOCR, performOCRWithBuffer, performTranslation } from '@/lib/ai';
import { detectSplitFromBuffer } from '@/lib/splitDetection';
import { getOcrPrompt, getTranslationPrompt, type PromptLookupResult } from '@/lib/prompts';
import { createSnapshotIfNeeded } from '@/lib/snapshots';
import { put } from '@vercel/blob';
import sharp from 'sharp';
import type { Job, JobResult } from '@/lib/types';
import {
  createBatchJobInline,
  getBatchJobStatus,
  getBatchJobResults,
  type BatchRequest,
} from '@/lib/gemini-batch';

// Extend timeout for job processing (Vercel Pro allows up to 300s)
export const maxDuration = 300;

const CHUNK_SIZE = 5; // Process 5 pages per request for AI jobs
const CROP_CHUNK_SIZE = 40; // Sweet spot: ~55s per request (just under 60s timeout)
const CROP_PARALLEL = 10; // 10 parallel operations balances speed vs memory

// Helper function to process a single cropped image
async function processCroppedImage(
  page: { id: string; book_id: string; crop: { xStart: number; xEnd: number }; photo_original?: string; photo?: string },
  db: Awaited<ReturnType<typeof getDb>>
): Promise<JobResult> {
  const startTime = performance.now();
  const pageId = page.id;

  try {
    if (!page.crop || page.crop.xStart === undefined || page.crop.xEnd === undefined) {
      return { pageId, success: false, error: 'No crop data' };
    }

    const imageUrl = page.photo_original || page.photo;
    if (!imageUrl) {
      return { pageId, success: false, error: 'No image URL' };
    }

    // Fetch the original image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return { pageId, success: false, error: 'Failed to fetch image' };
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

    // Get image dimensions and calculate crop
    const metadata = await sharp(imageBuffer).metadata();
    const imgWidth = metadata.width || 1000;
    const imgHeight = metadata.height || 1000;

    const left = Math.round((page.crop.xStart / 1000) * imgWidth);
    const cropWidth = Math.round(((page.crop.xEnd - page.crop.xStart) / 1000) * imgWidth);

    // Crop and compress the image
    const croppedBuffer = await sharp(imageBuffer)
      .extract({
        left,
        top: 0,
        width: Math.min(cropWidth, imgWidth - left),
        height: imgHeight,
      })
      .resize(1200, null, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true })
      .toBuffer();

    // Upload to Vercel Blob
    const filename = `cropped/${page.book_id}/${page.id}.jpg`;
    const blob = await put(filename, croppedBuffer, {
      access: 'public',
      contentType: 'image/jpeg',
      allowOverwrite: true,
    });

    // Update page with new cropped photo URL
    await db.collection('pages').updateOne(
      { id: pageId },
      {
        $set: {
          cropped_photo: blob.url,
          updated_at: new Date(),
        },
      }
    );

    return {
      pageId,
      success: true,
      duration: performance.now() - startTime,
    };
  } catch (error) {
    console.error(`Error processing cropped image ${pageId}:`, error);
    return {
      pageId,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: performance.now() - startTime,
    };
  }
}

// ========== GEMINI BATCH API HANDLER ==========
// Phases: prepare -> submit -> poll
// - prepare: Fetch images in chunks, store in batch_preparations collection
// - submit: When all prepared, submit to Gemini Batch API
// - poll: Check status and download results

const BATCH_PREPARE_CHUNK_SIZE = 50; // Prepare 50 images per request
const BATCH_PREPARE_PARALLEL = 10; // Fetch 10 images in parallel
const BATCH_SUBMIT_CHUNK_SIZE = 50; // Submit 50 pages per Gemini batch job

async function handleBatchApiJob(
  job: Job,
  db: Awaited<ReturnType<typeof getDb>>,
  jobId: string
) {
  // Phase 3: Already submitted - poll for results
  // Support both single batch (legacy) and multiple batches (new)
  const batchJobs = job.gemini_batch_jobs || (job.gemini_batch_job ? [{ name: job.gemini_batch_job, page_ids: job.config.page_ids }] : []);

  if (batchJobs.length > 0 && job.batch_phase === 'submitted') {
    console.log(`[BatchJob ${jobId}] Checking ${batchJobs.length} Gemini batch(es)...`);

    try {
      let totalSuccess = 0;
      let totalFail = 0;
      let allCompleted = true;
      let anyFailed = false;
      const now = new Date();
      const allResults: JobResult[] = job.results || [];
      const processedPageIds = new Set(allResults.map(r => r.pageId));
      const batchStatuses: string[] = [];

      for (const batch of batchJobs) {
        if (!batch.name) continue;

        // Skip if already processed
        if (batch.results_collected) {
          totalSuccess += batch.success_count || 0;
          totalFail += batch.fail_count || 0;
          batchStatuses.push(`${batch.name.split('/').pop()}: completed`);
          continue;
        }

        const status = await getBatchJobStatus(batch.name);
        batchStatuses.push(`${batch.name.split('/').pop()}: ${status.state}`);
        console.log(`[BatchJob ${jobId}] Batch ${batch.name}: ${status.state}`);

        if (status.state === 'JOB_STATE_SUCCEEDED') {
          // Download and save results for this batch
          console.log(`[BatchJob ${jobId}] Downloading results from ${batch.name}...`);
          const results = await getBatchJobResults(batch.name);

          let batchSuccess = 0;
          let batchFail = 0;

          for (const result of results) {
            const pageId = result.key;
            if (processedPageIds.has(pageId)) continue; // Skip duplicates
            processedPageIds.add(pageId);

            if (result.error) {
              console.error(`[BatchJob ${jobId}] Page ${pageId} error:`, result.error.message);
              allResults.push({ pageId, success: false, error: result.error.message });
              batchFail++;
              continue;
            }

            if (!result.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
              console.error(`[BatchJob ${jobId}] Page ${pageId} no response`);
              allResults.push({ pageId, success: false, error: 'No response text' });
              batchFail++;
              continue;
            }

            const text = result.response.candidates[0].content.parts[0].text;
            const usage = result.response.usageMetadata;

            if (job.type === 'batch_ocr') {
              await db.collection('pages').updateOne(
                { id: pageId },
                {
                  $set: {
                    ocr: {
                      data: text,
                      updated_at: now,
                      model: job.config.model,
                      language: job.config.language,
                      source: 'batch_api',
                      input_tokens: usage?.promptTokenCount || 0,
                      output_tokens: usage?.candidatesTokenCount || 0,
                    },
                    updated_at: now,
                  },
                }
              );
            } else {
              await db.collection('pages').updateOne(
                { id: pageId },
                {
                  $set: {
                    translation: {
                      data: text,
                      updated_at: now,
                      model: job.config.model,
                      source_language: job.config.language,
                      target_language: 'English',
                      source: 'batch_api',
                      input_tokens: usage?.promptTokenCount || 0,
                      output_tokens: usage?.candidatesTokenCount || 0,
                    },
                    updated_at: now,
                  },
                }
              );
            }

            allResults.push({ pageId, success: true });
            batchSuccess++;
          }

          // Mark batch as collected
          batch.results_collected = true;
          batch.success_count = batchSuccess;
          batch.fail_count = batchFail;
          totalSuccess += batchSuccess;
          totalFail += batchFail;

        } else if (status.state === 'JOB_STATE_FAILED' || status.state === 'JOB_STATE_CANCELLED' || status.state === 'JOB_STATE_EXPIRED') {
          anyFailed = true;
          batch.results_collected = true;
          batch.error = status.state;
        } else {
          // Still processing
          allCompleted = false;
        }
      }

      // Update job
      const jobStatus = allCompleted ? (anyFailed && totalSuccess === 0 ? 'failed' : 'completed') : 'processing';
      await db.collection('jobs').updateOne(
        { id: jobId },
        {
          $set: {
            status: jobStatus,
            gemini_batch_jobs: batchJobs,
            results: allResults,
            'progress.completed': totalSuccess,
            'progress.failed': totalFail,
            ...(allCompleted ? { completed_at: now } : {}),
            updated_at: now,
          },
        }
      );

      if (allCompleted) {
        return NextResponse.json({
          job: { ...job, status: jobStatus },
          message: `All ${batchJobs.length} batch(es) completed: ${totalSuccess} succeeded, ${totalFail} failed`,
          done: true,
          batches: batchStatuses,
        });
      } else {
        return NextResponse.json({
          job: { ...job, status: 'processing' },
          message: `Waiting for Gemini batches. ${totalSuccess} results collected so far.`,
          done: false,
          batches: batchStatuses,
          collected: totalSuccess,
        });
      }
    } catch (error) {
      console.error(`[BatchJob ${jobId}] Error checking batch status:`, error);
      return NextResponse.json({
        error: 'Failed to check batch job status',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, { status: 500 });
    }
  }

  // Phase 1 & 2: Prepare images incrementally, then submit
  console.log(`[BatchJob ${jobId}] Preparing batch...`);

  try {
    const pageIds = job.config.page_ids || [];
    const prepCollection = db.collection('batch_preparations');

    // Check what's already prepared
    const prepared = await prepCollection.find({ job_id: jobId }).toArray();
    const preparedIds = new Set(prepared.map(p => p.page_id));
    const failedIds = new Set(prepared.filter(p => p.failed).map(p => p.page_id));

    // Find pages that still need preparation
    const unpreparedIds = pageIds.filter((id: string) => !preparedIds.has(id) && !failedIds.has(id));

    console.log(`[BatchJob ${jobId}] Total: ${pageIds.length}, Prepared: ${preparedIds.size - failedIds.size}, Failed: ${failedIds.size}, Remaining: ${unpreparedIds.length}`);

    // Phase 1: If there are unprepared pages, prepare a chunk
    if (unpreparedIds.length > 0) {
      const chunkIds = unpreparedIds.slice(0, BATCH_PREPARE_CHUNK_SIZE);
      const pages = await db.collection('pages')
        .find({ id: { $in: chunkIds } })
        .toArray();

      const ocrPrompt = job.type === 'batch_ocr'
        ? await getOcrPrompt(job.config.language || 'Latin')
        : null;

      let preparedCount = 0;
      let failedCount = 0;

      // Prepare a single page (for parallel processing)
      const preparePage = async (page: typeof pages[0]): Promise<{ success: boolean }> => {
        try {
          let requestData: BatchRequest['request'] | null = null;

          if (job.type === 'batch_ocr') {
            const imageUrl = page.cropped_photo || page.photo;
            if (!imageUrl) {
              await prepCollection.insertOne({
                job_id: jobId,
                page_id: page.id,
                failed: true,
                error: 'No image URL',
                created_at: new Date(),
              });
              return { success: false };
            }

            const imageResponse = await fetch(imageUrl);
            if (!imageResponse.ok) {
              await prepCollection.insertOne({
                job_id: jobId,
                page_id: page.id,
                failed: true,
                error: `Image fetch failed: ${imageResponse.status}`,
                created_at: new Date(),
              });
              return { success: false };
            }

            const imageBuffer = await imageResponse.arrayBuffer();
            const base64 = Buffer.from(imageBuffer).toString('base64');
            let mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
            mimeType = mimeType.split(';')[0].trim();

            requestData = {
              contents: [
                {
                  parts: [
                    { text: ocrPrompt?.text || 'Transcribe this image.' },
                    { inlineData: { mimeType, data: base64 } },
                  ],
                },
              ],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 8192,
              },
            };
          } else {
            // Translation
            const ocrText = page.ocr?.data;
            if (!ocrText) {
              await prepCollection.insertOne({
                job_id: jobId,
                page_id: page.id,
                failed: true,
                error: 'No OCR text',
                created_at: new Date(),
              });
              return { success: false };
            }

            requestData = {
              contents: [
                {
                  parts: [
                    {
                      text: `Translate the following ${job.config.language || 'Latin'} text to English. Preserve formatting.\n\n${ocrText}`,
                    },
                  ],
                },
              ],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 8192,
              },
            };
          }

          // Store prepared request
          await prepCollection.insertOne({
            job_id: jobId,
            page_id: page.id,
            request: requestData,
            failed: false,
            created_at: new Date(),
          });
          return { success: true };

        } catch (e) {
          console.error(`[BatchJob ${jobId}] Failed to prepare ${page.id}:`, e);
          await prepCollection.insertOne({
            job_id: jobId,
            page_id: page.id,
            failed: true,
            error: e instanceof Error ? e.message : 'Unknown error',
            created_at: new Date(),
          });
          return { success: false };
        }
      };

      // Process pages in parallel batches
      for (let i = 0; i < pages.length; i += BATCH_PREPARE_PARALLEL) {
        const batch = pages.slice(i, i + BATCH_PREPARE_PARALLEL);
        const results = await Promise.all(batch.map(preparePage));
        for (const r of results) {
          if (r.success) preparedCount++;
          else failedCount++;
        }
      }

      // Update progress
      const totalPrepared = preparedIds.size - failedIds.size + preparedCount;
      const totalFailed = failedIds.size + failedCount;
      const remaining = pageIds.length - totalPrepared - totalFailed;

      await db.collection('jobs').updateOne(
        { id: jobId },
        {
          $set: {
            'progress.completed': totalPrepared,
            'progress.failed': totalFailed,
            batch_phase: 'preparing',
            updated_at: new Date(),
          },
        }
      );

      return NextResponse.json({
        job: { ...job, batch_phase: 'preparing' },
        message: `Prepared ${preparedCount} pages this request. ${remaining} remaining.`,
        done: false,
        phase: 'preparing',
        prepared: totalPrepared,
        failed: totalFailed,
        remaining,
        continue: remaining > 0,
      });
    }

    // Phase 2: All prepared - submit to Gemini Batch API in chunks
    console.log(`[BatchJob ${jobId}] All pages prepared. Submitting to Gemini...`);

    const successfulPreps = prepared.filter(p => !p.failed);
    if (successfulPreps.length === 0) {
      await db.collection('jobs').updateOne(
        { id: jobId },
        {
          $set: {
            status: 'failed',
            error: 'No pages prepared successfully',
            updated_at: new Date(),
          },
        }
      );
      return NextResponse.json({
        error: 'No pages prepared successfully',
        failed: prepared.filter(p => p.failed).length,
      }, { status: 400 });
    }

    // Get already submitted page IDs
    const existingBatchJobs = job.gemini_batch_jobs || [];
    const submittedPageIds = new Set(
      existingBatchJobs.flatMap(bj => bj.page_ids || [])
    );

    // Find pages that need to be submitted
    const unsubmittedPreps = successfulPreps.filter(p => !submittedPageIds.has(p.page_id));

    if (unsubmittedPreps.length === 0) {
      // All submitted - update phase
      await db.collection('jobs').updateOne(
        { id: jobId },
        {
          $set: {
            batch_phase: 'submitted',
            updated_at: new Date(),
          },
        }
      );
      return NextResponse.json({
        job: { ...job, batch_phase: 'submitted' },
        message: `All ${successfulPreps.length} pages already submitted in ${existingBatchJobs.length} batch(es).`,
        done: false,
        phase: 'submitted',
        batches: existingBatchJobs.length,
      });
    }

    // Submit next chunk
    const chunkToSubmit = unsubmittedPreps.slice(0, BATCH_SUBMIT_CHUNK_SIZE);
    const batchRequests: BatchRequest[] = chunkToSubmit.map(p => ({
      key: p.page_id,
      request: p.request,
    }));

    console.log(`[BatchJob ${jobId}] Submitting chunk of ${batchRequests.length} requests to Gemini (${unsubmittedPreps.length - batchRequests.length} remaining)...`);

    // Submit to Gemini Batch API
    const chunkIndex = existingBatchJobs.length;
    const displayName = `${job.type}-${jobId}-chunk${chunkIndex}`;
    const geminiJob = await createBatchJobInline(
      job.config.model || 'gemini-2.5-flash',
      batchRequests,
      displayName
    );

    console.log(`[BatchJob ${jobId}] Gemini job created: ${geminiJob.name}`);

    // Add to batch jobs array
    const newBatchJob = {
      name: geminiJob.name,
      state: geminiJob.state,
      page_ids: chunkToSubmit.map(p => p.page_id),
      submitted_at: new Date(),
    };

    const allBatchJobs = [...existingBatchJobs, newBatchJob];
    const totalSubmitted = allBatchJobs.reduce((sum, bj) => sum + (bj.page_ids?.length || 0), 0);
    const remaining = successfulPreps.length - totalSubmitted;

    // Update job with new batch job
    await db.collection('jobs').updateOne(
      { id: jobId },
      {
        $set: {
          gemini_batch_jobs: allBatchJobs,
          gemini_batch_job: geminiJob.name, // Keep for backwards compat
          gemini_state: geminiJob.state,
          batch_phase: remaining > 0 ? 'submitting' : 'submitted',
          'progress.total': successfulPreps.length,
          updated_at: new Date(),
        },
      }
    );

    return NextResponse.json({
      job: { ...job, gemini_batch_jobs: allBatchJobs },
      message: `Submitted ${batchRequests.length} pages to Gemini (batch ${chunkIndex + 1}). ${remaining > 0 ? `${remaining} pages remaining to submit.` : 'All pages submitted!'}`,
      done: false,
      phase: remaining > 0 ? 'submitting' : 'submitted',
      gemini_job: geminiJob.name,
      gemini_state: geminiJob.state,
      pages_submitted: batchRequests.length,
      total_submitted: totalSubmitted,
      remaining_to_submit: remaining,
      batches: allBatchJobs.length,
    });
  } catch (error) {
    console.error(`[BatchJob ${jobId}] Error in batch processing:`, error);
    return NextResponse.json({
      error: 'Failed to process batch job',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

// POST - Process next chunk of the job
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = performance.now();
  const { id } = await params;

  try {
    const db = await getDb();
    const job = await db.collection('jobs').findOne({ id }) as Job | null;

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Check if job can be processed
    if (job.status === 'completed' || job.status === 'cancelled') {
      return NextResponse.json({
        job,
        message: 'Job already finished',
        done: true,
      });
    }

    if (job.status === 'paused') {
      return NextResponse.json({
        job,
        message: 'Job is paused',
        done: false,
        paused: true,
      });
    }

    // Update status to processing
    if (job.status === 'pending') {
      await db.collection('jobs').updateOne(
        { id },
        {
          $set: {
            status: 'processing',
            started_at: new Date(),
            updated_at: new Date(),
          },
        }
      );
    }

    // ========== GEMINI BATCH API HANDLING ==========
    // For batch_ocr and batch_translate jobs, use Gemini Batch API (50% cheaper)
    if (job.config.use_batch_api && (job.type === 'batch_ocr' || job.type === 'batch_translate')) {
      return await handleBatchApiJob(job, db, id);
    }

    // Get pages that haven't been processed yet
    const processedPageIds = new Set(job.results.map(r => r.pageId));
    const remainingPageIds = (job.config.page_ids || []).filter(
      (pageId: string) => !processedPageIds.has(pageId)
    );

    if (remainingPageIds.length === 0) {
      // Job is complete
      await db.collection('jobs').updateOne(
        { id },
        {
          $set: {
            status: 'completed',
            completed_at: new Date(),
            updated_at: new Date(),
          },
        }
      );

      const updatedJob = await db.collection('jobs').findOne({ id });
      return NextResponse.json({
        job: updatedJob,
        message: 'Job completed',
        done: true,
      });
    }

    // Process a chunk - use larger chunk size for cropping jobs
    const chunkSize = job.type === 'generate_cropped_images' ? CROP_CHUNK_SIZE : CHUNK_SIZE;
    const chunkPageIds = remainingPageIds.slice(0, chunkSize);
    const results: JobResult[] = [];

    // Get page data
    const pages = await db.collection('pages')
      .find({ id: { $in: chunkPageIds } })
      .toArray();

    const pageMap = new Map(pages.map(p => [p.id, p]));

    // Look up prompts for this job (with versioning)
    let ocrPrompt: PromptLookupResult | undefined;
    let translationPrompt: PromptLookupResult | undefined;

    if (job.type === 'batch_ocr') {
      ocrPrompt = await getOcrPrompt(job.config.language || 'Latin', {
        name: job.config.prompt_name,
      });
    } else if (job.type === 'batch_translate') {
      translationPrompt = await getTranslationPrompt(
        job.config.language || 'Latin',
        'English',
        { name: job.config.prompt_name }
      );
    }

    // Handle cropped image generation with parallel processing
    if (job.type === 'generate_cropped_images') {
      console.log(`[CropJob ${id}] Processing ${pages.length} pages in parallel (${CROP_PARALLEL} at a time)`);

      // Update job status
      await db.collection('jobs').updateOne(
        { id },
        {
          $set: {
            'progress.currentItem': `Processing ${pages.length} cropped images...`,
            updated_at: new Date(),
          },
        }
      );

      // Process in batches of CROP_PARALLEL
      for (let i = 0; i < pages.length; i += CROP_PARALLEL) {
        const batch = pages.slice(i, i + CROP_PARALLEL);
        const batchResults = await Promise.all(
          batch.map(page => processCroppedImage(page as unknown as { id: string; book_id: string; crop: { xStart: number; xEnd: number }; photo_original?: string; photo?: string }, db))
        );
        results.push(...batchResults);

        // Log progress
        const completed = results.filter(r => r.success).length;
        console.log(`[CropJob ${id}] Batch ${Math.floor(i / CROP_PARALLEL) + 1}: ${batchResults.filter(r => r.success).length}/${batch.length} succeeded (total: ${completed}/${pages.length})`);
      }

      // Skip the main for loop for cropped images
    } else {
      // Get previous page for context (if processing sequentially)
      let previousOcr: string | undefined;
      let previousTranslation: string | undefined;

      for (const pageId of chunkPageIds) {
      const page = pageMap.get(pageId);
      if (!page) {
        results.push({ pageId, success: false, error: 'Page not found' });
        continue;
      }

      const itemStart = performance.now();

      try {
        // Update current item
        await db.collection('jobs').updateOne(
          { id },
          {
            $set: {
              'progress.currentItem': `Page ${page.page_number || pageId}`,
              updated_at: new Date(),
            },
          }
        );

        if (job.type === 'batch_ocr') {
          // Create snapshot of any manually-edited OCR before overwriting
          await createSnapshotIfNeeded(pageId, 'pre_ocr', id);

          // Get the correct image for OCR (respecting crop if present)
          let ocrResult;
          let imageUrlUsed: string;
          const ocrStart = performance.now();

          if (page.crop?.xStart !== undefined && page.crop?.xEnd !== undefined) {
            // Page was split - need cropped image
            if (page.cropped_photo) {
              // Use pre-generated cropped image
              imageUrlUsed = page.cropped_photo;
              ocrResult = await performOCR(
                page.cropped_photo,
                job.config.language || 'Latin',
                previousOcr,
                ocrPrompt?.text,
                job.config.model || 'gemini-2.0-flash'
              );
            } else {
              // No cropped_photo yet - crop inline and use buffer directly (faster!)
              const originalUrl = page.photo_original || page.photo;
              imageUrlUsed = `[cropped inline from ${originalUrl}]`;
              const imageResponse = await fetch(originalUrl);
              if (!imageResponse.ok) {
                results.push({
                  pageId,
                  success: false,
                  error: 'Failed to fetch image for cropping',
                  duration: performance.now() - itemStart,
                });
                continue;
              }

              const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
              const metadata = await sharp(imageBuffer).metadata();
              const imgWidth = metadata.width || 1000;
              const imgHeight = metadata.height || 1000;

              const left = Math.round((page.crop.xStart / 1000) * imgWidth);
              const cropWidth = Math.round(((page.crop.xEnd - page.crop.xStart) / 1000) * imgWidth);

              const croppedBuffer = await sharp(imageBuffer)
                .extract({
                  left,
                  top: 0,
                  width: Math.min(cropWidth, imgWidth - left),
                  height: imgHeight,
                })
                .resize(1200, null, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 80, progressive: true })
                .toBuffer();

              // Do OCR with buffer directly
              ocrResult = await performOCRWithBuffer(
                croppedBuffer,
                'image/jpeg',
                job.config.language || 'Latin',
                previousOcr,
                ocrPrompt?.text,
                job.config.model || 'gemini-2.0-flash'
              );

              // Upload cropped image in background for future use/viewing
              const filename = `cropped/${page.book_id}/${pageId}.jpg`;
              put(filename, croppedBuffer, {
                access: 'public',
                contentType: 'image/jpeg',
                allowOverwrite: true,
              }).then(blob => {
                db.collection('pages').updateOne(
                  { id: pageId },
                  { $set: { cropped_photo: blob.url, updated_at: new Date() } }
                );
              }).catch(() => {
                // Non-blocking - cropped image will be generated later if needed
              });
            }
          } else {
            // No crop data - use full image
            imageUrlUsed = page.photo;
            ocrResult = await performOCR(
              page.photo,
              job.config.language || 'Latin',
              previousOcr,
              ocrPrompt?.text,
              job.config.model || 'gemini-2.0-flash'
            );
          }

          const ocrDuration = performance.now() - ocrStart;

          // Save OCR result to page with full metadata
          await db.collection('pages').updateOne(
            { id: pageId },
            {
              $set: {
                ocr: {
                  data: ocrResult.text,
                  language: job.config.language || 'Latin',
                  model: job.config.model || 'gemini-2.0-flash',
                  prompt: ocrPrompt?.reference,
                  updated_at: new Date(),
                  source: 'ai',  // Mark as AI-generated
                  // Processing metadata for reproducibility
                  input_tokens: ocrResult.usage.inputTokens,
                  output_tokens: ocrResult.usage.outputTokens,
                  cost_usd: ocrResult.usage.costUsd,
                  processing_ms: Math.round(ocrDuration),
                  image_url: imageUrlUsed,
                },
                updated_at: new Date(),
              },
            }
          );

          previousOcr = ocrResult.text;
          results.push({
            pageId,
            success: true,
            duration: performance.now() - itemStart,
          });

        } else if (job.type === 'batch_translate') {
          if (!page.ocr?.data) {
            results.push({ pageId, success: false, error: 'No OCR data to translate' });
            continue;
          }

          // Create snapshot of any manually-edited translation before overwriting
          await createSnapshotIfNeeded(pageId, 'pre_translate', id);

          const translateStart = performance.now();
          const translationResult = await performTranslation(
            page.ocr.data,
            job.config.language || 'Latin',
            'English',
            previousTranslation,
            translationPrompt?.text,
            job.config.model || 'gemini-2.0-flash'
          );
          const translateDuration = performance.now() - translateStart;

          // Save to page with full metadata
          await db.collection('pages').updateOne(
            { id: pageId },
            {
              $set: {
                translation: {
                  data: translationResult.text,
                  language: 'English',
                  source_language: job.config.language || 'Latin',
                  model: job.config.model || 'gemini-2.0-flash',
                  prompt: translationPrompt?.reference,
                  updated_at: new Date(),
                  source: 'ai',  // Mark as AI-generated
                  // Processing metadata
                  input_tokens: translationResult.usage.inputTokens,
                  output_tokens: translationResult.usage.outputTokens,
                  cost_usd: translationResult.usage.costUsd,
                  processing_ms: Math.round(translateDuration),
                },
                updated_at: new Date(),
              },
            }
          );

          previousTranslation = translationResult.text;
          results.push({
            pageId,
            success: true,
            duration: performance.now() - itemStart,
          });

        } else if (job.type === 'batch_split') {
          // Fetch the image and run split detection
          const imageUrl = page.photo;
          if (!imageUrl) {
            results.push({ pageId, success: false, error: 'No image URL' });
            continue;
          }

          // Fetch image
          const imageResponse = await fetch(imageUrl);
          if (!imageResponse.ok) {
            results.push({ pageId, success: false, error: 'Failed to fetch image' });
            continue;
          }

          const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
          const splitResult = await detectSplitFromBuffer(imageBuffer);

          // Save split detection result to page
          await db.collection('pages').updateOne(
            { id: pageId },
            {
              $set: {
                split_detection: {
                  ...splitResult,
                  detected_at: new Date(),
                },
                updated_at: new Date(),
              },
            }
          );

          results.push({
            pageId,
            success: true,
            duration: performance.now() - itemStart,
          });

        }
        // Note: generate_cropped_images is handled separately above with parallel processing
      } catch (error) {
        console.error(`Error processing page ${pageId}:`, error);
        results.push({
          pageId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          duration: performance.now() - itemStart,
        });
      }
      }
    } // Close else block for non-crop jobs

    // Update job with results
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    // Update job with new results
    const existingResults = (await db.collection('jobs').findOne({ id }))?.results || [];
    await db.collection('jobs').updateOne(
      { id },
      {
        $set: {
          results: [...existingResults, ...results],
          'progress.completed': job.progress.completed + successCount,
          'progress.failed': job.progress.failed + failCount,
          'progress.currentItem': null,
          updated_at: new Date(),
        },
      }
    );

    // Check if job is now complete or failed
    const updatedJob = await db.collection('jobs').findOne({ id }) as Job | null;
    const allProcessed = updatedJob &&
      (updatedJob.progress.completed + updatedJob.progress.failed) >= updatedJob.progress.total;

    if (allProcessed && updatedJob) {
      const finalStatus = updatedJob.progress.failed > 0 && updatedJob.progress.completed === 0
        ? 'failed'
        : 'completed';

      await db.collection('jobs').updateOne(
        { id },
        {
          $set: {
            status: finalStatus,
            completed_at: new Date(),
            updated_at: new Date(),
          },
        }
      );
    }

    const finalJob = await db.collection('jobs').findOne({ id });

    // Auto-continue if there's more work (non-blocking)
    if (!allProcessed && remainingPageIds.length > results.length) {
      const baseUrl = process.env.NEXT_PUBLIC_URL || (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000');

      fetch(`${baseUrl}/api/jobs/${id}/process`, {
        method: 'POST',
      }).catch(() => {
        // Ignore - will be picked up by next poll
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
    console.error('Error processing job chunk:', error);

    // Update job status to failed
    const db = await getDb();
    await db.collection('jobs').updateOne(
      { id },
      {
        $set: {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          updated_at: new Date(),
        },
      }
    );

    return NextResponse.json(
      { error: 'Failed to process job chunk' },
      { status: 500 }
    );
  }
}

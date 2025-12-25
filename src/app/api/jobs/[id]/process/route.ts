import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { performOCR, performTranslation } from '@/lib/ai';
import { detectSplitFromBuffer } from '@/lib/splitDetection';
import { put } from '@vercel/blob';
import sharp from 'sharp';
import type { Job, JobResult } from '@/lib/types';

const CHUNK_SIZE = 5; // Process 5 pages per request for AI jobs
const CROP_CHUNK_SIZE = 100; // Process more for cropping (no AI, just image manipulation)
const CROP_PARALLEL = 25; // Number of crops to run in parallel (I/O bound, can go high)

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
          // Get the correct image URL for OCR (respecting crop if present)
          let imageUrl = page.photo;

          if (page.crop?.xStart !== undefined && page.crop?.xEnd !== undefined) {
            // Use pre-generated cropped image if available
            if (page.cropped_photo) {
              imageUrl = page.cropped_photo;
            } else {
              // Skip - cropped image needs to be generated first
              results.push({
                pageId,
                success: false,
                error: 'Page was split but cropped image not generated. Run "Generate Cropped Images" first.',
                duration: performance.now() - itemStart,
              });
              continue;
            }
          }

          const ocrResult = await performOCR(
            imageUrl,
            job.config.language || 'Latin',
            previousOcr,
            undefined, // customPrompt - could add prompt lookup here
            job.config.model || 'gemini-2.0-flash'
          );

          // Save to page
          await db.collection('pages').updateOne(
            { id: pageId },
            {
              $set: {
                ocr: {
                  data: ocrResult.text,
                  language: job.config.language || 'Latin',
                  model: job.config.model || 'gemini-2.0-flash',
                  prompt_name: job.config.prompt_name || 'Default',
                  updated_at: new Date(),
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

          const translationResult = await performTranslation(
            page.ocr.data,
            job.config.language || 'Latin',
            'English',
            previousTranslation,
            undefined,
            job.config.model || 'gemini-2.0-flash'
          );

          // Save to page
          await db.collection('pages').updateOne(
            { id: pageId },
            {
              $set: {
                translation: {
                  data: translationResult.text,
                  language: 'English',
                  model: job.config.model || 'gemini-2.0-flash',
                  prompt_name: job.config.prompt_name || 'Default',
                  updated_at: new Date(),
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

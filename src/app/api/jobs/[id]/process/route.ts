import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { performOCR, performTranslation } from '@/lib/ai';
import { detectSplitFromBuffer } from '@/lib/splitDetection';
import { put } from '@vercel/blob';
import sharp from 'sharp';
import type { Job, JobResult } from '@/lib/types';

const CHUNK_SIZE = 5; // Process 5 pages per request to stay within timeout

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

    // Process a chunk
    const chunkPageIds = remainingPageIds.slice(0, CHUNK_SIZE);
    const results: JobResult[] = [];

    // Get page data
    const pages = await db.collection('pages')
      .find({ id: { $in: chunkPageIds } })
      .toArray();

    const pageMap = new Map(pages.map(p => [p.id, p]));

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
          const ocrResult = await performOCR(
            page.photo,
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

        } else if (job.type === 'generate_cropped_images') {
          // Generate and upload cropped images for split pages
          if (!page.crop || page.crop.xStart === undefined || page.crop.xEnd === undefined) {
            results.push({ pageId, success: false, error: 'No crop data' });
            continue;
          }

          const imageUrl = page.photo_original || page.photo;
          if (!imageUrl) {
            results.push({ pageId, success: false, error: 'No image URL' });
            continue;
          }

          // Fetch the original image
          const imageResponse = await fetch(imageUrl);
          if (!imageResponse.ok) {
            results.push({ pageId, success: false, error: 'Failed to fetch image' });
            continue;
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

          results.push({
            pageId,
            success: true,
            duration: performance.now() - itemStart,
          });
        }
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

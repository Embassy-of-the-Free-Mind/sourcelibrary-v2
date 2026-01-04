import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { MODEL_PRICING } from '@/lib/ai';
import { DEFAULT_MODEL } from '@/lib/types';
import { extractWithGemini, type DetectedImage } from '@/lib/image-extraction';

// Increase timeout for batch image extraction
export const maxDuration = 300;

type PageStatus = 'processed' | 'skipped_has_detections' | 'failed_image_fetch' | 'failed_extraction';

interface PageResult {
  pageId: string;
  status: PageStatus;
  message: string;
}

interface PageInput {
  pageId: string;
  imageUrl: string;
  pageNumber: number;
}

function calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    let mimeType = response.headers.get('content-type') || 'image/jpeg';
    mimeType = mimeType.split(';')[0].trim();

    // Ensure supported mime type
    const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!supportedTypes.includes(mimeType)) {
      if (url.toLowerCase().includes('.png')) mimeType = 'image/png';
      else if (url.toLowerCase().includes('.webp')) mimeType = 'image/webp';
      else mimeType = 'image/jpeg';
    }

    return { data: base64, mimeType };
  } catch (error) {
    console.error('Failed to fetch image:', url, error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const {
      pages,
      model: modelId = DEFAULT_MODEL,
      overwrite = false,
    }: {
      pages: PageInput[];
      model?: string;
      overwrite?: boolean;
    } = await request.json();

    if (!pages || pages.length === 0) {
      return NextResponse.json({ error: 'No pages provided' }, { status: 400 });
    }

    if (pages.length > 5) {
      return NextResponse.json({ error: 'Maximum 5 pages per batch for image extraction' }, { status: 400 });
    }

    // Look up pages from database to check existing detections
    const db = await getDb();
    const pageIds = pages.map(p => p.pageId);
    const dbPages = await db.collection('pages').find({ id: { $in: pageIds } }).toArray();
    const dbPageMap = new Map(dbPages.map(p => [p.id, p]));

    // Track results for each page
    const pageResults: PageResult[] = [];
    const skippedPageIds: string[] = [];
    const failedPageIds: string[] = [];

    // Filter out pages that already have detections
    const pagesToProcess: PageInput[] = [];

    for (const page of pages) {
      const dbPage = dbPageMap.get(page.pageId);

      // Check if page already has detections (skip unless overwrite mode)
      if (!overwrite && dbPage?.detected_images && dbPage.detected_images.length > 0) {
        skippedPageIds.push(page.pageId);
        pageResults.push({
          pageId: page.pageId,
          status: 'skipped_has_detections',
          message: `Page ${page.pageNumber} already has ${dbPage.detected_images.length} detection(s)`,
        });
        console.log(`[batch-image-extraction] Skipping page ${page.pageNumber} - already has detections`);
        continue;
      }

      pagesToProcess.push(page);
    }

    // If no pages to process, return early
    if (pagesToProcess.length === 0) {
      console.log(`[batch-image-extraction] Nothing to process: ${skippedPageIds.length} have detections`);

      return NextResponse.json({
        detectionResults: {},
        processedCount: 0,
        skippedCount: skippedPageIds.length,
        requestedCount: pages.length,
        skippedPageIds,
        failedPageIds,
        pageResults,
        message: 'All pages already have detections',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
      });
    }

    // Fetch all images in parallel
    console.log(`[batch-image-extraction] Fetching ${pagesToProcess.length} images...`);

    const imagePromises = pagesToProcess.map(async (page) => {
      const dbPage = dbPageMap.get(page.pageId);
      // Prefer cropped photo (from split detection), then use main photo
      const imageUrl = dbPage?.cropped_photo || dbPage?.photo || page.imageUrl;
      const result = await fetchImageAsBase64(imageUrl);
      return { image: result, imageUrl };
    });

    const imageResults = await Promise.all(imagePromises);

    // Filter out failed fetches
    const validPages: { page: PageInput; image: { data: string; mimeType: string }; imageUrl: string }[] = [];

    pagesToProcess.forEach((page, i) => {
      const { image, imageUrl } = imageResults[i];
      if (image) {
        validPages.push({ page, image, imageUrl });
      } else {
        failedPageIds.push(page.pageId);
        pageResults.push({
          pageId: page.pageId,
          status: 'failed_image_fetch',
          message: `Page ${page.pageNumber} - failed to fetch image`,
        });
      }
    });

    if (validPages.length === 0) {
      console.log(`[batch-image-extraction] All pages failed to fetch`);
      return NextResponse.json({
        detectionResults: {},
        processedCount: 0,
        skippedCount: skippedPageIds.length,
        requestedCount: pages.length,
        skippedPageIds,
        failedPageIds,
        pageResults,
        message: 'Failed to fetch any images',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
      });
    }

    // Call Gemini vision API for all pages
    console.log(`[batch-image-extraction] Processing ${validPages.length} images with Gemini...`);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const detectionResults: Record<string, DetectedImage[]> = {};
    let processedCount = 0;

    try {
      // Process pages one at a time through Gemini (could be optimized to batch multiple)
      for (const { page, image, imageUrl } of validPages) {
        try {
          // Create a data URL for the image to pass to extractWithGemini
          const dataUrl = `data:${image.mimeType};base64,${image.data}`;

          // Extract images using Gemini
          const detections = await extractWithGemini(dataUrl, modelId);

          if (detections && detections.length > 0) {
            detectionResults[page.pageId] = detections;

            // Update page in database with detections
            await db.collection('pages').updateOne(
              { id: page.pageId },
              {
                $push: {
                  detected_images: { $each: detections } as any
                },
                $set: { updated_at: new Date() }
              }
            );

            pageResults.push({
              pageId: page.pageId,
              status: 'processed',
              message: `Page ${page.pageNumber} - found ${detections.length} image(s)`,
            });

            processedCount++;
            console.log(`[batch-image-extraction] Page ${page.pageNumber}: ${detections.length} detection(s)`);
          } else {
            pageResults.push({
              pageId: page.pageId,
              status: 'processed',
              message: `Page ${page.pageNumber} - no images found`,
            });
            processedCount++;
          }

          // Estimate tokens (1500 input per image, 500 output per image)
          totalInputTokens += 1500;
          totalOutputTokens += 500;

        } catch (error) {
          failedPageIds.push(page.pageId);
          pageResults.push({
            pageId: page.pageId,
            status: 'failed_extraction',
            message: `Page ${page.pageNumber} - ${error instanceof Error ? error.message : 'Unknown error'}`,
          });
          console.error(`[batch-image-extraction] Error processing page ${page.pageNumber}:`, error);
        }
      }
    } catch (error) {
      console.error(`[batch-image-extraction] Gemini API error:`, error);
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : 'Failed to call Gemini API',
          details: String(error),
        },
        { status: 500 }
      );
    }

    const totalCost = calculateCost(totalInputTokens, totalOutputTokens, modelId);

    console.log(`[batch-image-extraction] Complete: ${processedCount}/${validPages.length} processed, ${failedPageIds.length} failed`);

    return NextResponse.json({
      detectionResults,
      processedCount,
      skippedCount: skippedPageIds.length,
      requestedCount: pages.length,
      skippedPageIds,
      failedPageIds,
      pageResults,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        costUsd: totalCost,
      },
    });
  } catch (error) {
    console.error('[batch-image-extraction] Unexpected error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
        details: String(error),
      },
      { status: 500 }
    );
  }
}

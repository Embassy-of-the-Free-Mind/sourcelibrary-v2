import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { MODEL_PRICING } from '@/lib/ai';
import { DEFAULT_MODEL } from '@/lib/types';
import { getGeminiClient, reportRateLimitError, getNextApiKey } from '@/lib/gemini';
import sharp from 'sharp';
import { put } from '@vercel/blob';

// Increase timeout for batch OCR (5 images)
export const maxDuration = 300;

// Page result status for detailed logging
type PageStatus = 'processed' | 'skipped_has_ocr' | 'cropped_inline' | 'failed_image_fetch' | 'failed_crop' | 'failed_parse';

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

// Fetch image, crop it inline, and return as base64
// Also uploads to Vercel Blob in background for future use
async function fetchAndCropImage(
  url: string,
  crop: { xStart: number; xEnd: number },
  pageId: string,
  bookId: string,
  db: Awaited<ReturnType<typeof getDb>>
): Promise<{ data: string; mimeType: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(imageBuffer).metadata();
    const imgWidth = metadata.width || 1000;
    const imgHeight = metadata.height || 1000;

    const left = Math.round((crop.xStart / 1000) * imgWidth);
    const cropWidth = Math.round(((crop.xEnd - crop.xStart) / 1000) * imgWidth);

    const croppedBuffer = await sharp(imageBuffer)
      .extract({
        left,
        top: 0,
        width: Math.min(cropWidth, imgWidth - left),
        height: imgHeight,
      })
      .resize(1200, null, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, progressive: true })
      .toBuffer();

    // Upload cropped image to Vercel Blob in background for future use
    const filename = `cropped/${bookId}/${pageId}.jpg`;
    put(filename, croppedBuffer, {
      access: 'public',
      contentType: 'image/jpeg',
      allowOverwrite: true,
    }).then(blob => {
      db.collection('pages').updateOne(
        { id: pageId },
        { $set: { cropped_photo: blob.url, updated_at: new Date() } }
      );
      console.log(`[batch-ocr] Saved cropped image for page ${pageId}`);
    }).catch(err => {
      console.warn(`[batch-ocr] Failed to save cropped image for ${pageId}:`, err);
    });

    const base64 = croppedBuffer.toString('base64');
    return { data: base64, mimeType: 'image/jpeg' };
  } catch (error) {
    console.error('Failed to crop image:', url, error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const {
      pages,
      language = 'Latin',
      customPrompt,
      model: modelId = DEFAULT_MODEL,
      previousContext,
      overwrite = false,
    }: {
      pages: PageInput[];
      language?: string;
      customPrompt?: string;
      model?: string;
      previousContext?: string;
      overwrite?: boolean;
    } = await request.json();

    if (!pages || pages.length === 0) {
      return NextResponse.json({ error: 'No pages provided' }, { status: 400 });
    }

    if (pages.length > 5) {
      return NextResponse.json({ error: 'Maximum 5 pages per batch for OCR' }, { status: 400 });
    }

    // Look up pages from database to check existing OCR and get image URLs
    const db = await getDb();
    const pageIds = pages.map(p => p.pageId);
    const dbPages = await db.collection('pages').find({ id: { $in: pageIds } }).toArray();
    const dbPageMap = new Map(dbPages.map(p => [p.id, p]));

    // Track results for each page
    const pageResults: PageResult[] = [];
    const skippedPageIds: string[] = [];
    const failedPageIds: string[] = [];

    // Filter out pages that already have OCR
    const pagesToProcess: PageInput[] = [];

    for (const page of pages) {
      const dbPage = dbPageMap.get(page.pageId);

      // Check if page already has OCR (skip unless overwrite mode)
      if (!overwrite && dbPage?.ocr?.data && dbPage.ocr.data.length > 0) {
        skippedPageIds.push(page.pageId);
        pageResults.push({
          pageId: page.pageId,
          status: 'skipped_has_ocr',
          message: `Page ${page.pageNumber} already has OCR (${dbPage.ocr.data.length} chars)`,
        });
        console.log(`[batch-ocr] Skipping page ${page.pageNumber} - already has OCR`);
        continue;
      }

      // Note: Pages with crop settings but no cropped_photo will be cropped inline during image fetch
      pagesToProcess.push(page);
    }

    // If no pages to process, return early
    if (pagesToProcess.length === 0) {
      console.log(`[batch-ocr] Nothing to process: ${skippedPageIds.length} have OCR`);

      return NextResponse.json({
        ocrResults: {},
        processedCount: 0,
        skippedCount: skippedPageIds.length,
        requestedCount: pages.length,
        skippedPageIds,
        failedPageIds,
        pageResults,
        message: 'All pages already have OCR',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
      });
    }

    // Fetch all images in parallel - with inline cropping for split pages
    console.log(`[batch-ocr] Fetching ${pagesToProcess.length} images...`);

    const imagePromises = pagesToProcess.map(async (page) => {
      const dbPage = dbPageMap.get(page.pageId);

      // Check if page needs inline cropping (has crop settings but no pre-generated cropped_photo)
      const needsInlineCrop = dbPage?.crop?.xStart !== undefined &&
                               dbPage?.crop?.xEnd !== undefined &&
                               !dbPage?.cropped_photo;

      if (needsInlineCrop) {
        // Crop inline and save to blob in background
        const originalUrl = dbPage?.photo_original || dbPage?.photo || page.imageUrl;
        console.log(`[batch-ocr] Cropping page ${page.pageNumber} inline...`);
        const result = await fetchAndCropImage(
          originalUrl,
          { xStart: dbPage!.crop!.xStart, xEnd: dbPage!.crop!.xEnd },
          page.pageId,
          dbPage?.book_id || '',
          db
        );
        return { image: result, croppedInline: true };
      }

      // Use pre-generated cropped image or original
      const imageUrl = dbPage?.cropped_photo || dbPage?.photo || page.imageUrl;
      const result = await fetchImageAsBase64(imageUrl);
      return { image: result, croppedInline: false };
    });

    const imageResults = await Promise.all(imagePromises);

    // Filter out failed fetches
    const validPages: { page: PageInput; image: { data: string; mimeType: string } }[] = [];

    pagesToProcess.forEach((page, i) => {
      const { image, croppedInline } = imageResults[i];
      if (image) {
        validPages.push({ page, image });
        if (croppedInline) {
          pageResults.push({
            pageId: page.pageId,
            status: 'cropped_inline',
            message: `Page ${page.pageNumber} - cropped inline (will save for future use)`,
          });
        }
      } else {
        failedPageIds.push(page.pageId);
        const dbPage = dbPageMap.get(page.pageId);
        const wasCropAttempt = dbPage?.crop?.xStart !== undefined && !dbPage?.cropped_photo;
        pageResults.push({
          pageId: page.pageId,
          status: wasCropAttempt ? 'failed_crop' : 'failed_image_fetch',
          message: `Page ${page.pageNumber} - failed to ${wasCropAttempt ? 'crop' : 'fetch'} image`,
        });
        console.error(`[batch-ocr] Failed to ${wasCropAttempt ? 'crop' : 'fetch'} image for page ${page.pageNumber}`);
      }
    });

    if (validPages.length === 0) {
      console.error(`[batch-ocr] All image fetches failed`);
      return NextResponse.json({
        error: 'All image fetches failed',
        details: `Could not fetch images for pages: ${failedPageIds.map(id => {
          const p = pages.find(pg => pg.pageId === id);
          return p ? `#${p.pageNumber}` : id;
        }).join(', ')}`,
        skippedPageIds,
        failedPageIds,
        pageResults,
      }, { status: 500 });
    }

    // Get API key with rotation
    let apiKey: string;
    try {
      apiKey = getNextApiKey();
    } catch (e) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
    }

    const genAI = getGeminiClient();
    let model;
    try {
      model = genAI.getGenerativeModel({ model: modelId });
    } catch (e) {
      console.error('[batch-ocr] Failed to initialize Gemini model:', e);
      return NextResponse.json({
        error: `Invalid model "${modelId}" or API configuration error`,
        details: e instanceof Error ? e.message : 'Unknown error'
      }, { status: 500 });
    }

    console.log(`[batch-ocr] Processing ${validPages.length} pages with ${modelId}...`);

    // Build the batch OCR prompt
    const basePrompt = customPrompt?.replace('{language}', language) ||
      `You are an expert OCR system specializing in historical ${language} manuscripts and printed books.

Transcribe the text from each page image accurately:
- Preserve original spelling, punctuation, and formatting
- Maintain paragraph structure
- Note any unclear or damaged text with [unclear] or [damaged]
- Keep line breaks where they appear significant
- Transcribe in reading order (left to right, top to bottom)

IMPORTANT: Return transcriptions in the exact format specified below.`;

    let fullPrompt = basePrompt + '\n\n';

    if (previousContext) {
      fullPrompt += `**Previous page transcription for context (text may continue from here):**\n${previousContext.slice(0, 1500)}...\n\n`;
    }

    fullPrompt += `**You will receive ${validPages.length} page image(s). Transcribe each one.**\n\n`;
    fullPrompt += `**Output format:**
Return each transcription clearly separated with the exact format:

=== PAGE 1 ===
[transcription for first image]

=== PAGE 2 ===
[transcription for second image]

... and so on for each page image provided.`;

    // Build content array with prompt and images
    const content: (string | { inlineData: { mimeType: string; data: string } })[] = [fullPrompt];

    validPages.forEach(({ image }) => {
      content.push({
        inlineData: {
          mimeType: image.mimeType,
          data: image.data,
        },
      });
    });

    let result;
    try {
      result = await model.generateContent(content);
    } catch (e) {
      console.error('[batch-ocr] Gemini API call failed:', e);
      const errMsg = e instanceof Error ? e.message : 'Unknown error';

      // Parse common Gemini errors
      if (errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('429')) {
        // Report rate limit for key rotation
        reportRateLimitError(apiKey);
        return NextResponse.json({
          error: 'Rate limit exceeded - too many requests',
          details: 'Wait a moment and try again, or reduce batch size',
          retryable: true,
          skippedPageIds,
          failedPageIds: validPages.map(vp => vp.page.pageId),
          pageResults,
        }, { status: 429 });
      }
      if (errMsg.includes('INVALID_ARGUMENT')) {
        return NextResponse.json({
          error: 'Invalid request to Gemini API',
          details: errMsg
        }, { status: 400 });
      }
      if (errMsg.includes('PERMISSION_DENIED') || errMsg.includes('API_KEY')) {
        return NextResponse.json({
          error: 'Gemini API key invalid or expired',
          details: 'Check GEMINI_API_KEY configuration'
        }, { status: 401 });
      }
      if (errMsg.includes('SAFETY') || errMsg.includes('blocked')) {
        return NextResponse.json({
          error: 'Content blocked by safety filters',
          details: 'The image content was flagged - try a different page'
        }, { status: 400 });
      }

      return NextResponse.json({
        error: 'Gemini API error',
        details: errMsg
      }, { status: 500 });
    }

    const responseText = result.response.text();
    console.log(`[batch-ocr] Received response (${responseText.length} chars), parsing...`);

    // Parse the OCR results from the response
    const ocrResults: Record<string, string> = {};

    // Split by the page markers
    const parts = responseText.split(/===\s*PAGE\s*(\d+)\s*===/i);

    for (let i = 1; i < parts.length; i += 2) {
      const index = parseInt(parts[i], 10) - 1;
      const ocr = parts[i + 1]?.trim();

      if (index >= 0 && index < validPages.length && ocr) {
        const pageId = validPages[index].page.pageId;
        const pageNum = validPages[index].page.pageNumber;
        ocrResults[pageId] = ocr;
        pageResults.push({
          pageId,
          status: 'processed',
          message: `Page ${pageNum} - OCR complete (${ocr.length} chars)`,
        });
        console.log(`[batch-ocr] Page ${pageNum} - extracted ${ocr.length} chars`);
      }
    }

    // If parsing failed and only one page, use full response
    if (Object.keys(ocrResults).length === 0 && validPages.length === 1) {
      const pageId = validPages[0].page.pageId;
      const pageNum = validPages[0].page.pageNumber;
      ocrResults[pageId] = responseText.trim();
      pageResults.push({
        pageId,
        status: 'processed',
        message: `Page ${pageNum} - OCR complete (${responseText.trim().length} chars)`,
      });
      console.log(`[batch-ocr] Page ${pageNum} - extracted ${responseText.trim().length} chars (single page)`);
    }

    // Track pages that weren't parsed from response
    for (const { page } of validPages) {
      if (!ocrResults[page.pageId]) {
        failedPageIds.push(page.pageId);
        pageResults.push({
          pageId: page.pageId,
          status: 'failed_parse',
          message: `Page ${page.pageNumber} - failed to parse OCR from response`,
        });
        console.error(`[batch-ocr] Page ${page.pageNumber} - failed to parse from response`);
      }
    }

    // Get token usage
    const usageMetadata = result.response.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;
    const costUsd = calculateCost(inputTokens, outputTokens, modelId);

    // Save OCR results to database (db already defined above)
    // Set the entire ocr object to handle cases where ocr is null
    const now = new Date();

    const updatePromises = Object.entries(ocrResults).map(([pageId, ocrText]) =>
      db.collection('pages').updateOne(
        { id: pageId },
        {
          $set: {
            ocr: {
              data: ocrText,
              updated_at: now,
              model: modelId,
              language: language,
            },
            updated_at: now,
          },
        }
      )
    );

    await Promise.all(updatePromises);

    // Track cost
    try {
      await db.collection('cost_tracking').insertOne({
        timestamp: new Date(),
        action: 'batch_ocr',
        model: modelId,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUsd,
        pagesProcessed: Object.keys(ocrResults).length,
        metadata: {
          pageIds: pages.map(p => p.pageId),
          batchSize: pages.length,
          failedFetches: failedPageIds.length,
        },
      });
    } catch (e) {
      console.error('Failed to track cost:', e);
    }

    console.log(`[batch-ocr] Complete: ${Object.keys(ocrResults).length} processed, ${skippedPageIds.length} skipped (OCR exists), ${failedPageIds.length} failed`);

    return NextResponse.json({
      ocrResults,
      processedCount: Object.keys(ocrResults).length,
      skippedCount: skippedPageIds.length,
      requestedCount: pages.length,
      skippedPageIds,
      failedPageIds,
      pageResults,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUsd,
      },
    });
  } catch (error) {
    console.error('Batch OCR error:', error);
    const errMsg = error instanceof Error ? error.message : 'Unknown error';

    // Check for common issues
    if (errMsg.includes('JSON')) {
      return NextResponse.json({
        error: 'Invalid request format',
        details: 'Request body must be valid JSON with pages array'
      }, { status: 400 });
    }
    if (errMsg.includes('ECONNREFUSED') || errMsg.includes('fetch')) {
      return NextResponse.json({
        error: 'Network error',
        details: 'Could not connect to image server or Gemini API'
      }, { status: 503 });
    }
    if (errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT')) {
      return NextResponse.json({
        error: 'Request timeout',
        details: 'Processing took too long - try fewer pages per batch',
        retryable: true
      }, { status: 504 });
    }

    return NextResponse.json({
      error: 'Batch OCR failed',
      details: errMsg
    }, { status: 500 });
  }
}

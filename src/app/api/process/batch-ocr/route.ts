import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/mongodb';
import { MODEL_PRICING } from '@/lib/ai';
import { DEFAULT_MODEL } from '@/lib/types';

// Increase timeout for batch OCR (5 images)
export const maxDuration = 300;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

interface PageInput {
  pageId: string;
  imageUrl: string;
  pageNumber: number;
}

// Build image URL with crop parameters if page has crop data
function buildImageUrl(baseUrl: string, crop?: { xStart: number; xEnd: number }): string {
  if (!crop) return baseUrl;

  // Use /api/image endpoint for cropping
  const params = new URLSearchParams({
    url: baseUrl,
    w: '2000', // High quality for OCR
    q: '95',
    cx: crop.xStart.toString(),
    cw: crop.xEnd.toString(),
  });

  // Return absolute URL for the image API
  return `/api/image?${params.toString()}`;
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
      language = 'Latin',
      customPrompt,
      model: modelId = DEFAULT_MODEL,
      previousContext,
    }: {
      pages: PageInput[];
      language?: string;
      customPrompt?: string;
      model?: string;
      previousContext?: string;
    } = await request.json();

    if (!pages || pages.length === 0) {
      return NextResponse.json({ error: 'No pages provided' }, { status: 400 });
    }

    if (pages.length > 5) {
      return NextResponse.json({ error: 'Maximum 5 pages per batch for OCR' }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
    }

    // Look up pages from database to get crop data
    const db = await getDb();
    const pageIds = pages.map(p => p.pageId);
    const dbPages = await db.collection('pages').find({ id: { $in: pageIds } }).toArray();
    const dbPageMap = new Map(dbPages.map(p => [p.id, p]));

    // Build image URLs with crop parameters if needed
    const getImageUrl = (page: PageInput): string => {
      const dbPage = dbPageMap.get(page.pageId);
      if (dbPage?.crop) {
        // Page has crop data - use /api/image for cropping
        // Need to use photo_original if available, otherwise photo
        const baseUrl = dbPage.photo_original || dbPage.photo || page.imageUrl;
        const cropUrl = buildImageUrl(baseUrl, dbPage.crop);
        // Make it absolute for server-side fetch
        const baseApiUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : process.env.NEXTAUTH_URL || 'http://localhost:3000';
        return `${baseApiUrl}${cropUrl}`;
      }
      return page.imageUrl;
    };

    // Fetch all images in parallel (with cropping applied)
    const imagePromises = pages.map(p => fetchImageAsBase64(getImageUrl(p)));
    const images = await Promise.all(imagePromises);

    // Filter out failed fetches
    const validPages: { page: PageInput; image: { data: string; mimeType: string } }[] = [];
    const failedPageIds: string[] = [];

    pages.forEach((page, i) => {
      if (images[i]) {
        validPages.push({ page, image: images[i]! });
      } else {
        failedPageIds.push(page.pageId);
      }
    });

    if (validPages.length === 0) {
      return NextResponse.json({
        error: 'All image fetches failed',
        details: `Could not fetch images for pages: ${failedPageIds.join(', ')}. Check that image URLs are accessible.`,
        failedPageIds
      }, { status: 500 });
    }

    let model;
    try {
      model = genAI.getGenerativeModel({ model: modelId });
    } catch (e) {
      console.error('Failed to initialize Gemini model:', e);
      return NextResponse.json({
        error: `Invalid model "${modelId}" or API configuration error`,
        details: e instanceof Error ? e.message : 'Unknown error'
      }, { status: 500 });
    }

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
      console.error('Gemini API call failed:', e);
      const errMsg = e instanceof Error ? e.message : 'Unknown error';

      // Parse common Gemini errors
      if (errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('429')) {
        return NextResponse.json({
          error: 'Rate limit exceeded - too many requests',
          details: 'Wait a moment and try again, or reduce batch size',
          retryable: true
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

    // Parse the OCR results from the response
    const ocrResults: Record<string, string> = {};

    // Split by the page markers
    const parts = responseText.split(/===\s*PAGE\s*(\d+)\s*===/i);

    for (let i = 1; i < parts.length; i += 2) {
      const index = parseInt(parts[i], 10) - 1;
      const ocr = parts[i + 1]?.trim();

      if (index >= 0 && index < validPages.length && ocr) {
        ocrResults[validPages[index].page.pageId] = ocr;
      }
    }

    // If parsing failed and only one page, use full response
    if (Object.keys(ocrResults).length === 0 && validPages.length === 1) {
      ocrResults[validPages[0].page.pageId] = responseText.trim();
    }

    // Get token usage
    const usageMetadata = result.response.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;
    const costUsd = calculateCost(inputTokens, outputTokens, modelId);

    // Save OCR results to database (db already defined above)
    const now = new Date().toISOString();

    const updatePromises = Object.entries(ocrResults).map(([pageId, ocr]) =>
      db.collection('pages').updateOne(
        { id: pageId },
        {
          $set: {
            'ocr.data': ocr,
            'ocr.updated_at': now,
            'ocr.model': modelId,
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

    return NextResponse.json({
      ocrResults,
      processedCount: Object.keys(ocrResults).length,
      requestedCount: pages.length,
      failedPageIds,
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

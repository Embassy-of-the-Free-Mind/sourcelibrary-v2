import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/mongodb';
import { MODEL_PRICING } from '@/lib/ai';
import { DEFAULT_MODEL } from '@/lib/types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

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

    // Fetch all images in parallel
    const imagePromises = pages.map(p => fetchImageAsBase64(p.imageUrl));
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
      return NextResponse.json({ error: 'All image fetches failed' }, { status: 500 });
    }

    const model = genAI.getGenerativeModel({ model: modelId });

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

    const result = await model.generateContent(content);
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

    // Save OCR results to database
    const db = await getDb();
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
    return NextResponse.json(
      { error: 'Batch OCR failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

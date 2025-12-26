import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/mongodb';
import { MODEL_PRICING } from '@/lib/ai';
import { DEFAULT_MODEL } from '@/lib/types';

// Increase timeout for batch translation
export const maxDuration = 180;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

interface PageInput {
  pageId: string;
  ocrText: string;
  pageNumber: number;
}

function calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

export async function POST(request: NextRequest) {
  try {
    const {
      pages,
      sourceLanguage = 'Latin',
      targetLanguage = 'English',
      customPrompt,
      model: modelId = DEFAULT_MODEL,
      previousContext,
      overwrite = false,
    }: {
      pages: PageInput[];
      sourceLanguage?: string;
      targetLanguage?: string;
      customPrompt?: string;
      model?: string;
      previousContext?: string;
      overwrite?: boolean;
    } = await request.json();

    // Look up pages to check for existing translations
    const db = await getDb();
    const pageIds = pages.map(p => p.pageId);
    const dbPages = await db.collection('pages').find({ id: { $in: pageIds } }).toArray();
    const dbPageMap = new Map(dbPages.map(p => [p.id, p]));

    // Filter out pages that already have translations (unless overwrite mode)
    const pagesToTranslate = overwrite
      ? pages
      : pages.filter(page => {
          const dbPage = dbPageMap.get(page.pageId);
          if (dbPage?.translation?.data && dbPage.translation.data.length > 0) {
            console.log(`[batch-translate] Skipping page ${page.pageNumber} - already has translation`);
            return false;
          }
          return true;
        });

    if (pagesToTranslate.length === 0) {
      return NextResponse.json({
        translations: {},
        processedCount: 0,
        skippedCount: pages.length,
        message: 'All pages already have translations',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
      });
    }

    // Validate original input
    if (!pages || pages.length === 0) {
      return NextResponse.json({ error: 'No pages provided' }, { status: 400 });
    }

    if (pages.length > 10) {
      return NextResponse.json({ error: 'Maximum 10 pages per batch' }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
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

    // Build the batch translation prompt
    const basePrompt = customPrompt || `You are a scholarly translator specializing in ${sourceLanguage} to ${targetLanguage} translation.

Translate the following text pages accurately while:
- Preserving the author's meaning and style
- Using clear, modern ${targetLanguage}
- Maintaining continuity between pages
- Keeping technical terms with brief explanations if needed

IMPORTANT: Return your translations in the exact format specified below.`;

    // Format pages for the prompt (use filtered pages)
    const pagesText = pagesToTranslate
      .map((p, i) => `=== PAGE ${i + 1} (ID: ${p.pageId}) ===\n${p.ocrText}`)
      .join('\n\n');

    let fullPrompt = basePrompt + '\n\n';

    if (previousContext) {
      fullPrompt += `**Previous page translation for continuity:**\n${previousContext.slice(0, 2000)}...\n\n`;
    }

    fullPrompt += `**Pages to translate:**\n\n${pagesText}\n\n`;
    fullPrompt += `**Output format:**
Return each translation clearly separated with the exact format:

=== TRANSLATION 1 ===
[translation for page 1]

=== TRANSLATION 2 ===
[translation for page 2]

... and so on for each page.`;

    let result;
    try {
      result = await model.generateContent(fullPrompt);
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
          details: 'The text content was flagged - try a different page'
        }, { status: 400 });
      }

      return NextResponse.json({
        error: 'Gemini API error',
        details: errMsg
      }, { status: 500 });
    }

    const responseText = result.response.text();

    // Parse the translations from the response
    const translations: Record<string, string> = {};

    // Split by the translation markers
    const parts = responseText.split(/===\s*TRANSLATION\s*(\d+)\s*===/i);

    for (let i = 1; i < parts.length; i += 2) {
      const index = parseInt(parts[i], 10) - 1;
      const translation = parts[i + 1]?.trim();

      if (index >= 0 && index < pagesToTranslate.length && translation) {
        translations[pagesToTranslate[index].pageId] = translation;
      }
    }

    // If parsing failed, try alternative approach (numbered sections)
    if (Object.keys(translations).length === 0) {
      // Try to split by page markers in the original format
      const altParts = responseText.split(/(?:^|\n)(?:PAGE|Page)\s*(\d+)/m);
      for (let i = 1; i < altParts.length; i += 2) {
        const index = parseInt(altParts[i], 10) - 1;
        const translation = altParts[i + 1]?.trim();
        if (index >= 0 && index < pagesToTranslate.length && translation) {
          translations[pagesToTranslate[index].pageId] = translation;
        }
      }
    }

    // Last resort: if still no translations parsed, split evenly
    if (Object.keys(translations).length === 0 && pagesToTranslate.length === 1) {
      translations[pagesToTranslate[0].pageId] = responseText.trim();
    }

    // Get token usage
    const usageMetadata = result.response.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;
    const costUsd = calculateCost(inputTokens, outputTokens, modelId);

    // Save translations to database (db already initialized above)
    const now = new Date().toISOString();

    const updatePromises = Object.entries(translations).map(([pageId, translationText]) =>
      db.collection('pages').updateOne(
        { id: pageId },
        {
          $set: {
            translation: {
              data: translationText,
              updated_at: now,
              model: modelId,
              source_language: sourceLanguage,
              target_language: targetLanguage,
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
        action: 'batch_translation',
        model: modelId,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUsd,
        pagesProcessed: Object.keys(translations).length,
        metadata: {
          pageIds: pages.map(p => p.pageId),
          batchSize: pages.length,
        },
      });
    } catch (e) {
      console.error('Failed to track cost:', e);
    }

    return NextResponse.json({
      translations,
      translatedCount: Object.keys(translations).length,
      requestedCount: pages.length,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUsd,
      },
    });
  } catch (error) {
    console.error('Batch translation error:', error);
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
        details: 'Could not connect to Gemini API'
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
      error: 'Batch translation failed',
      details: errMsg
    }, { status: 500 });
  }
}

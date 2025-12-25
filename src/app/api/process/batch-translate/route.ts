import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/mongodb';
import { MODEL_PRICING } from '@/lib/ai';
import { DEFAULT_MODEL } from '@/lib/types';

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
    }: {
      pages: PageInput[];
      sourceLanguage?: string;
      targetLanguage?: string;
      customPrompt?: string;
      model?: string;
      previousContext?: string;
    } = await request.json();

    if (!pages || pages.length === 0) {
      return NextResponse.json({ error: 'No pages provided' }, { status: 400 });
    }

    if (pages.length > 10) {
      return NextResponse.json({ error: 'Maximum 10 pages per batch' }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
    }

    const model = genAI.getGenerativeModel({ model: modelId });

    // Build the batch translation prompt
    const basePrompt = customPrompt || `You are a scholarly translator specializing in ${sourceLanguage} to ${targetLanguage} translation.

Translate the following text pages accurately while:
- Preserving the author's meaning and style
- Using clear, modern ${targetLanguage}
- Maintaining continuity between pages
- Keeping technical terms with brief explanations if needed

IMPORTANT: Return your translations in the exact format specified below.`;

    // Format pages for the prompt
    const pagesText = pages
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

    const result = await model.generateContent(fullPrompt);
    const responseText = result.response.text();

    // Parse the translations from the response
    const translations: Record<string, string> = {};

    // Split by the translation markers
    const parts = responseText.split(/===\s*TRANSLATION\s*(\d+)\s*===/i);

    for (let i = 1; i < parts.length; i += 2) {
      const index = parseInt(parts[i], 10) - 1;
      const translation = parts[i + 1]?.trim();

      if (index >= 0 && index < pages.length && translation) {
        translations[pages[index].pageId] = translation;
      }
    }

    // If parsing failed, try alternative approach (numbered sections)
    if (Object.keys(translations).length === 0) {
      // Try to split by page markers in the original format
      const altParts = responseText.split(/(?:^|\n)(?:PAGE|Page)\s*(\d+)/m);
      for (let i = 1; i < altParts.length; i += 2) {
        const index = parseInt(altParts[i], 10) - 1;
        const translation = altParts[i + 1]?.trim();
        if (index >= 0 && index < pages.length && translation) {
          translations[pages[index].pageId] = translation;
        }
      }
    }

    // Last resort: if still no translations parsed, split evenly
    if (Object.keys(translations).length === 0 && pages.length === 1) {
      translations[pages[0].pageId] = responseText.trim();
    }

    // Get token usage
    const usageMetadata = result.response.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;
    const costUsd = calculateCost(inputTokens, outputTokens, modelId);

    // Save translations to database
    const db = await getDb();
    const now = new Date().toISOString();

    const updatePromises = Object.entries(translations).map(([pageId, translation]) =>
      db.collection('pages').updateOne(
        { id: pageId },
        {
          $set: {
            'translation.data': translation,
            'translation.updated_at': now,
            'translation.model': modelId,
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
    return NextResponse.json(
      { error: 'Batch translation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

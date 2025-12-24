import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { performModernization } from '@/lib/ai';
import { DEFAULT_MODEL } from '@/lib/types';

// Simple hash function to detect translation changes
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();

  try {
    const { id } = await params;
    const db = await getDb();
    const body = await request.json().catch(() => ({}));

    const { regenerate = false, model = DEFAULT_MODEL } = body;

    // Fetch the page
    const page = await db.collection('pages').findOne({ id });
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // Check if translation exists
    if (!page.translation?.data) {
      return NextResponse.json({
        error: 'Page has no translation. Translate first before modernizing.'
      }, { status: 400 });
    }

    const translationHash = hashString(page.translation.data);

    // Check if we can use cached version
    const hasValidCache = page.modernized?.data &&
                          page.modernized.source_translation_hash === translationHash;

    if (hasValidCache && !regenerate) {
      return NextResponse.json({
        modernized: page.modernized.data,
        cached: true,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 }
      });
    }

    // Get previous page for context
    let previousContext: { translation?: string; modernized?: string } | undefined;

    if (page.page_number > 1) {
      const prevPage = await db.collection('pages').findOne({
        book_id: page.book_id,
        page_number: page.page_number - 1
      });

      if (prevPage) {
        previousContext = {
          translation: prevPage.translation?.data,
          modernized: prevPage.modernized?.data
        };
      }
    }

    // Perform modernization
    const result = await performModernization(
      page.translation.data,
      previousContext,
      undefined, // customPrompt
      model
    );

    // Save to database
    await db.collection('pages').updateOne(
      { id },
      {
        $set: {
          'modernized.data': result.text,
          'modernized.model': model,
          'modernized.updated_at': new Date(),
          'modernized.source_translation_hash': translationHash,
          updated_at: new Date()
        }
      }
    );

    // Track cost
    const duration = Date.now() - startTime;
    await db.collection('cost_tracking').insertOne({
      page_id: id,
      book_id: page.book_id,
      action: 'modernize',
      model,
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      cost_usd: result.usage.costUsd,
      duration_ms: duration,
      created_at: new Date()
    });

    return NextResponse.json({
      modernized: result.text,
      cached: false,
      usage: result.usage
    });
  } catch (error) {
    console.error('Error modernizing page:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to modernize page' },
      { status: 500 }
    );
  }
}

// GET to retrieve existing modernized text without regenerating
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const page = await db.collection('pages').findOne({ id });
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    if (!page.modernized?.data) {
      return NextResponse.json({
        modernized: null,
        hasTranslation: !!page.translation?.data,
        message: 'No modernized text. Call POST to generate.'
      });
    }

    // Check if translation has changed since modernization
    const translationHash = page.translation?.data ? hashString(page.translation.data) : null;
    const isStale = translationHash &&
                    page.modernized.source_translation_hash !== translationHash;

    return NextResponse.json({
      modernized: page.modernized.data,
      model: page.modernized.model,
      updated_at: page.modernized.updated_at,
      isStale // True if translation changed since modernization
    });
  } catch (error) {
    console.error('Error fetching modernized text:', error);
    return NextResponse.json({ error: 'Failed to fetch modernized text' }, { status: 500 });
  }
}

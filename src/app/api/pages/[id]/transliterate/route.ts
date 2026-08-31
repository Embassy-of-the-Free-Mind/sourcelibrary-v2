import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { anonActionGate, SIGNIN_URL } from '@/lib/anon-gate';
import { performTransliteration } from '@/lib/ai';
const TRANSLITERATION_MODEL = 'gemini-3-flash-preview';
import { logGeminiCall } from '@/lib/gemini-logger';
import { getTriggerSource } from '@/lib/cron-auth';

// Simple hash function to detect OCR changes
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

// Map book language to script name for the prompt
function languageToScript(language?: string): string {
  if (!language) return 'Unknown';
  const map: Record<string, string> = {
    'greek': 'Greek',
    'hebrew': 'Hebrew',
    'arabic': 'Arabic',
    'persian': 'Arabic (Persian)',
    'ottoman turkish': 'Arabic (Ottoman Turkish)',
    'syriac': 'Syriac',
    'chinese': 'Chinese',
    'japanese': 'Japanese',
    'korean': 'Korean',
    'sanskrit': 'Sanskrit/Devanagari',
    'armenian': 'Armenian',
    'georgian': 'Georgian',
    'ethiopic': 'Ethiopic',
    'coptic': 'Coptic',
    'tibetan': 'Tibetan',
    'russian': 'Cyrillic',
    'church slavonic': 'Cyrillic',
  };
  return map[language.toLowerCase()] || language;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();

  try {
    const { id } = await params;
    const triggeredBy = getTriggerSource(request);
    const db = await getDb();
    const body = await request.json().catch(() => ({}));

    const { regenerate = false } = body;
    // The caller does not get to name the model. It used to, and the value went
    // straight to getGenerativeModel(), so anyone inside the anonymous budget
    // below could spend it on the most expensive model on offer instead of the
    // cheap one this job is costed for.
    const model = TRANSLITERATION_MODEL;

    // Fetch the page
    const page = await db.collection('pages').findOne({ id });
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // Check if OCR exists
    if (!page.ocr?.data) {
      return NextResponse.json({
        error: 'Page has no OCR text. Run OCR first before transliterating.'
      }, { status: 400 });
    }

    // Get book for language info
    const book = await db.collection('books').findOne({ id: page.book_id });
    const sourceScript = languageToScript(book?.language || book?.original_language);

    const ocrHash = hashString(page.ocr.data);

    // Check if we can use cached version
    const hasValidCache = page.transliteration?.data &&
                          page.transliteration.source_ocr_hash === ocrHash;

    if (hasValidCache && !regenerate) {
      return NextResponse.json({
        transliteration: page.transliteration.data,
        cached: true,
        script: page.transliteration.script,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 }
      });
    }

    // Generation is a paid Gemini call — measured at ~12s plus ~5.6s per 1000
    // OCR characters, up to nearly three minutes on a long page. Cached serves
    // above are free and stay ungated; generation is capped per IP for
    // anonymous callers, exactly as the alignment route caps trace mode.
    const gate = await anonActionGate(request, { name: 'transliterate', limit: 15, allowBotBypass: false });
    if (!gate.allowed) {
      return NextResponse.json(
        {
          error: 'Transliteration limit reached. Sign in (free) to keep going.',
          // Machine-readable so the reader UI can render a sign-in CTA instead
          // of an error toast. The panel auto-fires this route, so a wall that
          // only says something in prose shows readers a failure for something
          // they did nothing wrong to hit. Same shape as search/unified.
          code: 'SIGNIN_REQUIRED',
          sign_in: SIGNIN_URL,
          retry_after: gate.retryAfter,
        },
        { status: 429, headers: gate.retryAfter ? { 'Retry-After': String(gate.retryAfter) } : undefined },
      );
    }

    // Perform transliteration
    const result = await performTransliteration(
      page.ocr.data,
      sourceScript,
      model
    );

    // Save to database
    await db.collection('pages').updateOne(
      { id },
      {
        $set: {
          'transliteration.data': result.text,
          'transliteration.model': model,
          'transliteration.updated_at': new Date(),
          'transliteration.source_ocr_hash': ocrHash,
          'transliteration.script': sourceScript,
          updated_at: new Date()
        }
      }
    );

    // Log AI usage
    const duration = Date.now() - startTime;
    logGeminiCall({
      type: 'transliterate',
      mode: 'realtime',
      model,
      book_id: page.book_id,
      page_ids: [id],
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      status: 'success',
      duration_ms: duration,
      prompt_version: 'transliterate-inline-v1',
      endpoint: '/api/pages/transliterate',
      triggered_by: triggeredBy,
    });

    return NextResponse.json({
      transliteration: result.text,
      cached: false,
      script: sourceScript,
      usage: result.usage
    });
  } catch (error) {
    console.error('Error transliterating page:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to transliterate page' },
      { status: 500 }
    );
  }
}

// GET to retrieve existing transliteration without regenerating
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

    if (!page.transliteration?.data) {
      return NextResponse.json({
        transliteration: null,
        hasOcr: !!page.ocr?.data,
        message: 'No transliteration. Call POST to generate.'
      });
    }

    // Check if OCR has changed since transliteration
    const ocrHash = page.ocr?.data ? hashString(page.ocr.data) : null;
    const isStale = ocrHash &&
                    page.transliteration.source_ocr_hash !== ocrHash;

    return NextResponse.json({
      transliteration: page.transliteration.data,
      script: page.transliteration.script,
      model: page.transliteration.model,
      updated_at: page.transliteration.updated_at,
      isStale
    });
  } catch (error) {
    console.error('Error fetching transliteration:', error);
    return NextResponse.json({ error: 'Failed to fetch transliteration' }, { status: 500 });
  }
}

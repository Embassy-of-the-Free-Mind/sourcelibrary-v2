import { NextRequest, NextResponse } from 'next/server';
import { performTranslation } from '@/lib/ai';

export const dynamic = 'force-dynamic';

// Simple text translation endpoint for short texts like titles
export async function POST(request: NextRequest) {
  try {
    const { text, sourceLanguage = 'Latin', targetLanguage = 'English' } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    // Limit to short texts to prevent abuse
    if (text.length > 1000) {
      return NextResponse.json({ error: 'Text too long (max 1000 chars)' }, { status: 400 });
    }

    const result = await performTranslation(
      text,
      sourceLanguage,
      targetLanguage,
      undefined,
      'Translate the following title or short text. Provide only the translation, no explanations.',
      'gemini-3-flash-preview'
    );

    return NextResponse.json({
      translation: result.text.trim(),
      usage: result.usage,
    });
  } catch (error) {
    console.error('Translation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Translation failed' },
      { status: 500 }
    );
  }
}

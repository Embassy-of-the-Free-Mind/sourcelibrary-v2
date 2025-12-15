import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { performOCR, performTranslation, generateSummary } from '@/lib/ai';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      pageId,
      action, // 'ocr' | 'translation' | 'summary' | 'all'
      imageUrl,
      language,
      targetLanguage = 'English',
      ocrText,
      translatedText,
      previousPageId,
      customPrompts,
      autoSave = true
    } = body;

    const db = await getDb();

    // Get previous page context if provided
    let previousPage: { ocr?: string; translation?: string; summary?: string } | undefined;
    if (previousPageId) {
      const prevPageDoc = await db.collection('pages').findOne({ id: previousPageId });
      if (prevPageDoc) {
        previousPage = {
          ocr: prevPageDoc.ocr?.data,
          translation: prevPageDoc.translation?.data,
          summary: prevPageDoc.summary?.data
        };
      }
    }

    const results: { ocr?: string; translation?: string; summary?: string } = {};

    // Process based on action
    if (action === 'ocr' || action === 'all') {
      if (!imageUrl) {
        return NextResponse.json({ error: 'imageUrl required for OCR' }, { status: 400 });
      }
      results.ocr = await performOCR(
        imageUrl,
        language || 'Latin',
        previousPage?.ocr,
        customPrompts?.ocr
      );
    }

    if (action === 'translation' || action === 'all') {
      const textToTranslate = ocrText || results.ocr;
      if (!textToTranslate) {
        return NextResponse.json({ error: 'ocrText required for translation' }, { status: 400 });
      }
      results.translation = await performTranslation(
        textToTranslate,
        language || 'Latin',
        targetLanguage,
        previousPage?.translation,
        customPrompts?.translation
      );
    }

    if (action === 'summary' || action === 'all') {
      const textToSummarize = translatedText || results.translation;
      if (!textToSummarize) {
        return NextResponse.json({ error: 'translatedText required for summary' }, { status: 400 });
      }
      results.summary = await generateSummary(
        textToSummarize,
        previousPage?.summary,
        customPrompts?.summary
      );
    }

    // Auto-save to database if requested
    if (autoSave && pageId) {
      const updateData: Record<string, unknown> = { updated_at: new Date() };

      if (results.ocr) {
        updateData['ocr.data'] = results.ocr;
        updateData['ocr.language'] = language || 'Latin';
        updateData['ocr.model'] = 'gemini-2.0-flash';
        updateData['ocr.updated_at'] = new Date();
      }

      if (results.translation) {
        updateData['translation.data'] = results.translation;
        updateData['translation.language'] = targetLanguage;
        updateData['translation.model'] = 'gemini-2.0-flash';
        updateData['translation.updated_at'] = new Date();
      }

      if (results.summary) {
        updateData['summary.data'] = results.summary;
        updateData['summary.model'] = 'gemini-2.0-flash';
        updateData['summary.updated_at'] = new Date();
      }

      await db.collection('pages').updateOne(
        { id: pageId },
        { $set: updateData }
      );
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error('Error processing:', error);
    const errorMessage = error instanceof Error ? error.message : 'Processing failed';
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('Error details:', { message: errorMessage, stack: errorStack });
    return NextResponse.json(
      { error: errorMessage, details: errorStack },
      { status: 500 }
    );
  }
}

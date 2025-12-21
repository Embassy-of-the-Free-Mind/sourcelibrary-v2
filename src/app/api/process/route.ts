import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { performOCR, performTranslation, generateSummary } from '@/lib/ai';
import { DEFAULT_MODEL } from '@/lib/types';

// Helper to record processing metrics
async function recordProcessingMetric(
  db: Awaited<ReturnType<typeof getDb>>,
  name: string,
  duration: number,
  metadata?: Record<string, unknown>
) {
  try {
    await db.collection('loading_metrics').insertOne({
      name,
      duration,
      timestamp: Date.now(),
      metadata,
      received_at: Date.now(),
    });
  } catch (e) {
    console.error('Failed to record metric:', e);
  }
}

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
      autoSave = true,
      model = DEFAULT_MODEL,
      promptInfo // { ocr?: string, translation?: string, summary?: string } - prompt names
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

    // Process based on action (with timing)
    if (action === 'ocr' || action === 'all') {
      if (!imageUrl) {
        return NextResponse.json({ error: 'imageUrl required for OCR' }, { status: 400 });
      }
      const ocrStart = performance.now();
      results.ocr = await performOCR(
        imageUrl,
        language || 'Latin',
        previousPage?.ocr,
        customPrompts?.ocr,
        model
      );
      const ocrDuration = performance.now() - ocrStart;
      await recordProcessingMetric(db, 'ocr_processing', ocrDuration, {
        pageId,
        language: language || 'Latin',
        textLength: results.ocr?.length || 0,
      });
    }

    if (action === 'translation' || action === 'all') {
      const textToTranslate = ocrText || results.ocr;
      if (!textToTranslate) {
        return NextResponse.json({ error: 'ocrText required for translation' }, { status: 400 });
      }
      const translationStart = performance.now();
      results.translation = await performTranslation(
        textToTranslate,
        language || 'Latin',
        targetLanguage,
        previousPage?.translation,
        customPrompts?.translation,
        model
      );
      const translationDuration = performance.now() - translationStart;
      await recordProcessingMetric(db, 'translation_processing', translationDuration, {
        pageId,
        sourceLanguage: language || 'Latin',
        targetLanguage,
        inputLength: textToTranslate.length,
        outputLength: results.translation?.length || 0,
      });
    }

    if (action === 'summary' || action === 'all') {
      const textToSummarize = translatedText || results.translation;
      if (!textToSummarize) {
        return NextResponse.json({ error: 'translatedText required for summary' }, { status: 400 });
      }
      const summaryStart = performance.now();
      results.summary = await generateSummary(
        textToSummarize,
        previousPage?.summary,
        customPrompts?.summary,
        model
      );
      const summaryDuration = performance.now() - summaryStart;
      await recordProcessingMetric(db, 'summary_processing', summaryDuration, {
        pageId,
        inputLength: textToSummarize.length,
        outputLength: results.summary?.length || 0,
      });
    }

    // Auto-save to database if requested
    if (autoSave && pageId) {
      const updateData: Record<string, unknown> = { updated_at: new Date() };

      if (results.ocr) {
        updateData['ocr'] = {
          data: results.ocr,
          language: language || 'Latin',
          model,
          prompt_name: promptInfo?.ocr || 'Default',
          updated_at: new Date()
        };
      }

      if (results.translation) {
        updateData['translation'] = {
          data: results.translation,
          language: targetLanguage,
          model,
          prompt_name: promptInfo?.translation || 'Default',
          updated_at: new Date()
        };
      }

      if (results.summary) {
        updateData['summary'] = {
          data: results.summary,
          model,
          prompt_name: promptInfo?.summary || 'Default',
          updated_at: new Date()
        };
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

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { performOCR, performOCRWithBuffer, performTranslation, generateSummary, TokenUsage } from '@/lib/ai';
import { DEFAULT_MODEL } from '@/lib/types';
import sharp from 'sharp';
import { put } from '@vercel/blob';

// Increase timeout for AI processing (max 60s for Pro, 10s for Hobby)
export const maxDuration = 60;

// Get GitHub URL to exact commit of prompts file for reproducibility
function getPromptsUrl(): string {
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA || 'main';
  return `https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/${commitSha}/src/lib/types.ts`;
}

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
    const metadata: {
      ocr?: { inputTokens: number; outputTokens: number; costUsd: number; durationMs: number; imageUrl?: string };
      translation?: { inputTokens: number; outputTokens: number; costUsd: number; durationMs: number };
      summary?: { inputTokens: number; outputTokens: number; costUsd: number; durationMs: number };
    } = {};
    let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };

    // Process based on action (with timing)
    if (action === 'ocr' || action === 'all') {
      if (!imageUrl) {
        return NextResponse.json({ error: 'imageUrl required for OCR' }, { status: 400 });
      }

      // Use pre-generated cropped image if available
      // CRITICAL: For split pages (pages with crop data), we MUST use cropped image
      // to avoid OCRing the full 2-page spread
      let finalImageUrl = imageUrl;
      let ocrResult;
      const ocrStart = performance.now();

      if (pageId) {
        const currentPage = await db.collection('pages').findOne({ id: pageId });

        if (currentPage?.cropped_photo) {
          // Use pre-generated cropped image (Vercel Blob URL)
          finalImageUrl = currentPage.cropped_photo;
          console.log(`[process] Page ${pageId}: Using cropped_photo`);
          ocrResult = await performOCR(
            finalImageUrl,
            language || 'Latin',
            previousPage?.ocr,
            customPrompts?.ocr,
            model
          );
        } else if (currentPage?.crop?.xStart !== undefined && currentPage?.crop?.xEnd !== undefined) {
          // SPLIT PAGE without cropped_photo - crop inline to avoid using full spread!
          console.log(`[process] Page ${pageId}: Split page without cropped_photo - cropping inline`);
          const originalUrl = currentPage.photo_original || currentPage.photo;

          const imageResponse = await fetch(originalUrl);
          if (!imageResponse.ok) {
            return NextResponse.json({ error: 'Failed to fetch image for cropping' }, { status: 500 });
          }

          const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
          const imgMetadata = await sharp(imageBuffer).metadata();
          const imgWidth = imgMetadata.width || 1000;
          const imgHeight = imgMetadata.height || 1000;

          const left = Math.round((currentPage.crop.xStart / 1000) * imgWidth);
          const cropWidth = Math.round(((currentPage.crop.xEnd - currentPage.crop.xStart) / 1000) * imgWidth);

          const croppedBuffer = await sharp(imageBuffer)
            .extract({
              left,
              top: 0,
              width: Math.min(cropWidth, imgWidth - left),
              height: imgHeight,
            })
            .resize(1200, null, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80, progressive: true })
            .toBuffer();

          // Do OCR with buffer directly
          ocrResult = await performOCRWithBuffer(
            croppedBuffer,
            'image/jpeg',
            language || 'Latin',
            previousPage?.ocr,
            customPrompts?.ocr,
            model
          );

          // Upload cropped image in background for future use
          const filename = `cropped/${currentPage.book_id}/${pageId}.jpg`;
          put(filename, croppedBuffer, {
            access: 'public',
            contentType: 'image/jpeg',
            allowOverwrite: true,
          }).then(blob => {
            db.collection('pages').updateOne(
              { id: pageId },
              { $set: { cropped_photo: blob.url, updated_at: new Date() } }
            );
            console.log(`[process] Page ${pageId}: Saved cropped_photo for future use`);
          }).catch(err => {
            console.warn(`[process] Page ${pageId}: Failed to save cropped_photo:`, err);
          });

          finalImageUrl = `[cropped inline from ${originalUrl}]`;
        } else if (currentPage?.photo) {
          // Not a split page - safe to use full photo
          finalImageUrl = currentPage.photo;
          console.log(`[process] Page ${pageId}: Using full photo (not a split page)`);
          ocrResult = await performOCR(
            finalImageUrl,
            language || 'Latin',
            previousPage?.ocr,
            customPrompts?.ocr,
            model
          );
        } else {
          // Fallback to provided imageUrl
          console.log(`[process] Page ${pageId}: Using provided imageUrl`);
          ocrResult = await performOCR(
            finalImageUrl,
            language || 'Latin',
            previousPage?.ocr,
            customPrompts?.ocr,
            model
          );
        }
      } else {
        // No pageId - use provided imageUrl directly
        ocrResult = await performOCR(
          finalImageUrl,
          language || 'Latin',
          previousPage?.ocr,
          customPrompts?.ocr,
          model
        );
      }

      results.ocr = ocrResult.text;
      totalUsage.inputTokens += ocrResult.usage.inputTokens;
      totalUsage.outputTokens += ocrResult.usage.outputTokens;
      totalUsage.totalTokens += ocrResult.usage.totalTokens;
      totalUsage.costUsd += ocrResult.usage.costUsd;

      const ocrDuration = performance.now() - ocrStart;
      metadata.ocr = {
        inputTokens: ocrResult.usage.inputTokens,
        outputTokens: ocrResult.usage.outputTokens,
        costUsd: ocrResult.usage.costUsd,
        durationMs: Math.round(ocrDuration),
        imageUrl: finalImageUrl,
      };
      await recordProcessingMetric(db, 'ocr_processing', ocrDuration, {
        pageId,
        language: language || 'Latin',
        textLength: results.ocr?.length || 0,
        inputTokens: ocrResult.usage.inputTokens,
        outputTokens: ocrResult.usage.outputTokens,
        costUsd: ocrResult.usage.costUsd,
      });
    }

    if (action === 'translation' || action === 'all') {
      const textToTranslate = ocrText || results.ocr;
      if (!textToTranslate) {
        return NextResponse.json({ error: 'ocrText required for translation' }, { status: 400 });
      }
      const translationStart = performance.now();
      const translationResult = await performTranslation(
        textToTranslate,
        language || 'Latin',
        targetLanguage,
        previousPage?.translation,
        customPrompts?.translation,
        model
      );
      results.translation = translationResult.text;
      totalUsage.inputTokens += translationResult.usage.inputTokens;
      totalUsage.outputTokens += translationResult.usage.outputTokens;
      totalUsage.totalTokens += translationResult.usage.totalTokens;
      totalUsage.costUsd += translationResult.usage.costUsd;

      const translationDuration = performance.now() - translationStart;
      metadata.translation = {
        inputTokens: translationResult.usage.inputTokens,
        outputTokens: translationResult.usage.outputTokens,
        costUsd: translationResult.usage.costUsd,
        durationMs: Math.round(translationDuration),
      };
      await recordProcessingMetric(db, 'translation_processing', translationDuration, {
        pageId,
        sourceLanguage: language || 'Latin',
        targetLanguage,
        inputLength: textToTranslate.length,
        outputLength: results.translation?.length || 0,
        inputTokens: translationResult.usage.inputTokens,
        outputTokens: translationResult.usage.outputTokens,
        costUsd: translationResult.usage.costUsd,
      });
    }

    if (action === 'summary' || action === 'all') {
      const textToSummarize = translatedText || results.translation;
      if (!textToSummarize) {
        return NextResponse.json({ error: 'translatedText required for summary' }, { status: 400 });
      }
      const summaryStart = performance.now();
      const summaryResult = await generateSummary(
        textToSummarize,
        previousPage?.summary,
        customPrompts?.summary,
        model
      );
      results.summary = summaryResult.text;
      totalUsage.inputTokens += summaryResult.usage.inputTokens;
      totalUsage.outputTokens += summaryResult.usage.outputTokens;
      totalUsage.totalTokens += summaryResult.usage.totalTokens;
      totalUsage.costUsd += summaryResult.usage.costUsd;

      const summaryDuration = performance.now() - summaryStart;
      metadata.summary = {
        inputTokens: summaryResult.usage.inputTokens,
        outputTokens: summaryResult.usage.outputTokens,
        costUsd: summaryResult.usage.costUsd,
        durationMs: Math.round(summaryDuration),
      };
      await recordProcessingMetric(db, 'summary_processing', summaryDuration, {
        pageId,
        inputLength: textToSummarize.length,
        outputLength: results.summary?.length || 0,
        inputTokens: summaryResult.usage.inputTokens,
        outputTokens: summaryResult.usage.outputTokens,
        costUsd: summaryResult.usage.costUsd,
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
          prompt_url: getPromptsUrl(),
          updated_at: new Date(),
          // Processing metadata for reproducibility
          input_tokens: metadata.ocr?.inputTokens,
          output_tokens: metadata.ocr?.outputTokens,
          cost_usd: metadata.ocr?.costUsd,
          processing_ms: metadata.ocr?.durationMs,
          // Track which image was used for debugging split page issues
          image_url: metadata.ocr?.imageUrl,
        };
      }

      if (results.translation) {
        updateData['translation'] = {
          data: results.translation,
          language: targetLanguage,
          model,
          prompt_name: promptInfo?.translation || 'Default',
          prompt_url: getPromptsUrl(),
          updated_at: new Date(),
          // Processing metadata
          input_tokens: metadata.translation?.inputTokens,
          output_tokens: metadata.translation?.outputTokens,
          cost_usd: metadata.translation?.costUsd,
          processing_ms: metadata.translation?.durationMs,
        };
      }

      if (results.summary) {
        updateData['summary'] = {
          data: results.summary,
          model,
          prompt_name: promptInfo?.summary || 'Default',
          prompt_url: getPromptsUrl(),
          updated_at: new Date(),
          // Processing metadata
          input_tokens: metadata.summary?.inputTokens,
          output_tokens: metadata.summary?.outputTokens,
          cost_usd: metadata.summary?.costUsd,
          processing_ms: metadata.summary?.durationMs,
        };
      }

      await db.collection('pages').updateOne(
        { id: pageId },
        { $set: updateData }
      );
    }

    // Track total cost in a separate collection for analytics
    if (totalUsage.costUsd > 0) {
      try {
        await db.collection('cost_tracking').insertOne({
          pageId,
          bookId: pageId ? (await db.collection('pages').findOne({ id: pageId }))?.book_id : null,
          action,
          model,
          ...totalUsage,
          timestamp: Date.now(),
          created_at: new Date(),
        });
      } catch (e) {
        console.error('Failed to track cost:', e);
      }
    }

    return NextResponse.json({ ...results, usage: totalUsage });
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

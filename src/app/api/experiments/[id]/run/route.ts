import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { performOCR, performTranslation } from '@/lib/ai';
import crypto from 'crypto';

// POST /api/experiments/[id]/run - Run experiment on specified pages
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { page_ids }: { page_ids: string[] } = await request.json();

    if (!page_ids || page_ids.length === 0) {
      return NextResponse.json({ error: 'page_ids required' }, { status: 400 });
    }

    const db = await getDb();

    // Get experiment
    const experiment = await db.collection('experiments').findOne({ id });
    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    }

    // Get pages
    const pages = await db
      .collection('pages')
      .find({ id: { $in: page_ids } })
      .sort({ page_number: 1 })
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json({ error: 'No pages found' }, { status: 404 });
    }

    // Mark experiment as running
    await db.collection('experiments').updateOne(
      { id },
      { $set: { status: 'running' } }
    );

    const results: Array<{
      page_id: string;
      page_number: number;
      ocr?: string;
      translation?: string;
      success: boolean;
      error?: string;
    }> = [];

    let totalCost = 0;
    let totalTokens = 0;
    const model = experiment.settings.model;
    const useContext = experiment.settings.use_context !== false;

    // Process based on method
    if (experiment.method === 'single_ocr' || experiment.method === 'batch_ocr') {
      // OCR processing
      let previousOcr = '';

      for (const page of pages) {
        try {
          const result = await performOCR(
            page.photo,
            'Latin',
            useContext ? previousOcr : undefined,
            experiment.settings.prompt,
            model
          );

          previousOcr = result.text;
          totalCost += result.usage.costUsd;
          totalTokens += result.usage.totalTokens;

          results.push({
            page_id: page.id,
            page_number: page.page_number,
            ocr: result.text,
            success: true,
          });
        } catch (error) {
          results.push({
            page_id: page.id,
            page_number: page.page_number,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    } else if (experiment.method === 'single_translate' || experiment.method === 'batch_translate') {
      // Translation processing
      let previousTranslation = '';

      for (const page of pages) {
        if (!page.ocr?.data) {
          results.push({
            page_id: page.id,
            page_number: page.page_number,
            success: false,
            error: 'No OCR data available',
          });
          continue;
        }

        try {
          const result = await performTranslation(
            page.ocr.data,
            'Latin',
            'English',
            useContext ? previousTranslation : undefined,
            experiment.settings.prompt,
            model
          );

          previousTranslation = result.text;
          totalCost += result.usage.costUsd;
          totalTokens += result.usage.totalTokens;

          results.push({
            page_id: page.id,
            page_number: page.page_number,
            translation: result.text,
            success: true,
          });
        } catch (error) {
          results.push({
            page_id: page.id,
            page_number: page.page_number,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    } else if (experiment.method === 'combined') {
      // Combined OCR + Translation in one pass
      // For now, do them sequentially but in single experiment
      let previousOcr = '';
      let previousTranslation = '';

      for (const page of pages) {
        try {
          // OCR first
          const ocrResult = await performOCR(
            page.photo,
            'Latin',
            useContext ? previousOcr : undefined,
            experiment.settings.prompt,
            model
          );

          previousOcr = ocrResult.text;
          totalCost += ocrResult.usage.costUsd;
          totalTokens += ocrResult.usage.totalTokens;

          // Then translate
          const transResult = await performTranslation(
            ocrResult.text,
            'Latin',
            'English',
            useContext ? previousTranslation : undefined,
            undefined,
            model
          );

          previousTranslation = transResult.text;
          totalCost += transResult.usage.costUsd;
          totalTokens += transResult.usage.totalTokens;

          results.push({
            page_id: page.id,
            page_number: page.page_number,
            ocr: ocrResult.text,
            translation: transResult.text,
            success: true,
          });
        } catch (error) {
          results.push({
            page_id: page.id,
            page_number: page.page_number,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // Save results
    const now = new Date().toISOString();
    const resultDocs = results.map(r => ({
      id: crypto.randomUUID(),
      experiment_id: id,
      page_id: r.page_id,
      page_number: r.page_number,
      ocr: r.ocr || null,
      translation: r.translation || null,
      success: r.success,
      error: r.error || null,
      created_at: now,
    }));

    if (resultDocs.length > 0) {
      await db.collection('experiment_results').insertMany(resultDocs);
    }

    // Update experiment status
    const successCount = results.filter(r => r.success).length;
    await db.collection('experiments').updateOne(
      { id },
      {
        $set: {
          status: successCount === 0 ? 'failed' : 'completed',
          completed_at: now,
          results_count: successCount,
          total_cost: totalCost,
          total_tokens: totalTokens,
        },
      }
    );

    return NextResponse.json({
      success: true,
      results_count: successCount,
      failed_count: results.length - successCount,
      total_cost: totalCost,
      total_tokens: totalTokens,
    });
  } catch (error) {
    console.error('Error running experiment:', error);
    return NextResponse.json({ error: 'Failed to run experiment' }, { status: 500 });
  }
}

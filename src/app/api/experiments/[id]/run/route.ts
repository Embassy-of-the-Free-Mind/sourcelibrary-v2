import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { performOCR, performTranslation } from '@/lib/ai';
import crypto from 'crypto';

interface ExperimentVariant {
  method: string;
  model: string;
  use_context?: boolean;
}

interface ProcessResult {
  page_id: string;
  page_number: number;
  ocr?: string;
  translation?: string;
  success: boolean;
  error?: string;
  cost: number;
  tokens: number;
}

async function processVariant(
  variant: ExperimentVariant,
  pages: Array<{ id: string; page_number: number; photo: string; ocr?: { data?: string } }>,
): Promise<{ results: ProcessResult[]; totalCost: number; totalTokens: number }> {
  const results: ProcessResult[] = [];
  let totalCost = 0;
  let totalTokens = 0;
  const useContext = variant.use_context !== false;

  if (variant.method === 'single_ocr' || variant.method === 'batch_ocr') {
    let previousOcr = '';

    for (const page of pages) {
      try {
        const result = await performOCR(
          page.photo,
          'Latin',
          useContext ? previousOcr : undefined,
          undefined,
          variant.model
        );

        previousOcr = result.text;
        totalCost += result.usage.costUsd;
        totalTokens += result.usage.totalTokens;

        results.push({
          page_id: page.id,
          page_number: page.page_number,
          ocr: result.text,
          success: true,
          cost: result.usage.costUsd,
          tokens: result.usage.totalTokens,
        });
      } catch (error) {
        results.push({
          page_id: page.id,
          page_number: page.page_number,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          cost: 0,
          tokens: 0,
        });
      }
    }
  } else if (variant.method === 'single_translate' || variant.method === 'batch_translate') {
    let previousTranslation = '';

    for (const page of pages) {
      if (!page.ocr?.data) {
        results.push({
          page_id: page.id,
          page_number: page.page_number,
          success: false,
          error: 'No OCR data available',
          cost: 0,
          tokens: 0,
        });
        continue;
      }

      try {
        const result = await performTranslation(
          page.ocr.data,
          'Latin',
          'English',
          useContext ? previousTranslation : undefined,
          undefined,
          variant.model
        );

        previousTranslation = result.text;
        totalCost += result.usage.costUsd;
        totalTokens += result.usage.totalTokens;

        results.push({
          page_id: page.id,
          page_number: page.page_number,
          translation: result.text,
          success: true,
          cost: result.usage.costUsd,
          tokens: result.usage.totalTokens,
        });
      } catch (error) {
        results.push({
          page_id: page.id,
          page_number: page.page_number,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          cost: 0,
          tokens: 0,
        });
      }
    }
  }

  return { results, totalCost, totalTokens };
}

// POST /api/experiments/[id]/run - Run A/B experiment on pages
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { page_ids }: { page_ids?: string[] } = await request.json();

    const db = await getDb();

    // Get experiment
    const experiment = await db.collection('experiments').findOne({ id });
    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    }

    // Get book pages
    const bookPages = await db
      .collection('pages')
      .find({ book_id: experiment.book_id })
      .sort({ page_number: 1 })
      .toArray();

    if (bookPages.length === 0) {
      return NextResponse.json({ error: 'No pages found' }, { status: 404 });
    }

    // Select pages based on experiment settings or explicit page_ids
    let selectedPages = bookPages;
    if (page_ids && page_ids.length > 0) {
      selectedPages = bookPages.filter(p => page_ids.includes(p.id));
    } else if (experiment.page_selection === 'first_n') {
      selectedPages = bookPages.slice(0, experiment.page_count || 10);
    } else if (experiment.page_selection === 'sample') {
      const sampleRate = Math.max(1, Math.floor(100 / (experiment.page_count || 10)));
      selectedPages = bookPages.filter((_, i) => i % sampleRate === 0);
    }
    // 'all' uses all pages

    if (selectedPages.length === 0) {
      return NextResponse.json({ error: 'No pages selected' }, { status: 400 });
    }

    // Mark experiment as running
    await db.collection('experiments').updateOne(
      { id },
      { $set: { status: 'running' } }
    );

    const now = new Date().toISOString();
    let totalCost = 0;
    let totalTokens = 0;
    let resultsCount = 0;

    // Process variant A
    if (experiment.variant_a) {
      const variantA = experiment.variant_a as ExperimentVariant;
      const { results, totalCost: costA, totalTokens: tokensA } = await processVariant(variantA, selectedPages);

      totalCost += costA;
      totalTokens += tokensA;

      // Save results for variant A
      const resultDocs = results.map(r => ({
        id: crypto.randomUUID(),
        experiment_id: id,
        variant: 'a',
        page_id: r.page_id,
        page_number: r.page_number,
        ocr: r.ocr || null,
        translation: r.translation || null,
        success: r.success,
        error: r.error || null,
        cost: r.cost,
        tokens: r.tokens,
        method: variantA.method,
        model: variantA.model,
        use_context: variantA.use_context,
        created_at: now,
      }));

      if (resultDocs.length > 0) {
        await db.collection('experiment_results').insertMany(resultDocs);
        resultsCount += results.filter(r => r.success).length;
      }
    }

    // Process variant B
    if (experiment.variant_b) {
      const variantB = experiment.variant_b as ExperimentVariant;
      const { results, totalCost: costB, totalTokens: tokensB } = await processVariant(variantB, selectedPages);

      totalCost += costB;
      totalTokens += tokensB;

      // Save results for variant B
      const resultDocs = results.map(r => ({
        id: crypto.randomUUID(),
        experiment_id: id,
        variant: 'b',
        page_id: r.page_id,
        page_number: r.page_number,
        ocr: r.ocr || null,
        translation: r.translation || null,
        success: r.success,
        error: r.error || null,
        cost: r.cost,
        tokens: r.tokens,
        method: variantB.method,
        model: variantB.model,
        use_context: variantB.use_context,
        created_at: now,
      }));

      if (resultDocs.length > 0) {
        await db.collection('experiment_results').insertMany(resultDocs);
        resultsCount += results.filter(r => r.success).length;
      }
    }

    // Update experiment status
    await db.collection('experiments').updateOne(
      { id },
      {
        $set: {
          status: resultsCount === 0 ? 'failed' : 'completed',
          completed_at: now,
          results_count: resultsCount,
          pages_processed: selectedPages.length,
          total_cost: totalCost,
          total_tokens: totalTokens,
        },
      }
    );

    return NextResponse.json({
      success: true,
      pages_processed: selectedPages.length,
      results_count: resultsCount,
      total_cost: totalCost,
      total_tokens: totalTokens,
    });
  } catch (error) {
    console.error('Error running experiment:', error);
    return NextResponse.json({ error: 'Failed to run experiment' }, { status: 500 });
  }
}

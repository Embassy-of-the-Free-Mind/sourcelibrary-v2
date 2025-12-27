import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { validateTranslation } from '@/lib/validateTranslation';

interface SampleResult {
  pageId: string;
  bookId: string;
  bookTitle: string;
  pageNumber: number;
  ocrModel: string | null;
  translationModel: string | null;
  ocrPrompt: string | null;
  translationPrompt: string | null;
  hasOcr: boolean;
  hasTranslation: boolean;
  ocrLength: number;
  translationLength: number;
  ocrIssues: number;
  translationIssues: number;
  ocrPreview: string;
  translationPreview: string;
  photo: string;
}

interface ModelStats {
  model: string;
  count: number;
  withIssues: number;
  issueRate: number;
  avgLength: number;
  totalIssues: number;
}

/**
 * Calculate confidence interval for proportion
 * Uses Wilson score interval (better for small samples and extreme proportions)
 */
function wilsonCI(successes: number, n: number, z: number = 1.96): { lower: number; upper: number } {
  if (n === 0) return { lower: 0, upper: 0 };

  const p = successes / n;
  const denominator = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denominator;
  const margin = (z / denominator) * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));

  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin)
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sampleSize = Math.min(parseInt(searchParams.get('n') || '50'), 200);
    const bookId = searchParams.get('book_id');
    const modelFilter = searchParams.get('model');

    const db = await getDb();

    // Build query
    const query: Record<string, unknown> = {};
    if (bookId) query.book_id = bookId;

    // Get total count for population stats
    const totalPages = await db.collection('pages').countDocuments(query);
    const translatedPages = await db.collection('pages').countDocuments({
      ...query,
      'translation.data': { $exists: true, $ne: '' }
    });

    // Random sample using aggregation
    const pipeline: object[] = [
      { $match: { ...query, 'translation.data': { $exists: true, $ne: '' } } },
      { $sample: { size: sampleSize } },
      {
        $lookup: {
          from: 'books',
          localField: 'book_id',
          foreignField: 'id',
          as: 'book'
        }
      },
      { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } }
    ];

    const sampledPages = await db.collection('pages').aggregate(pipeline).toArray();

    // Analyze each sampled page
    const results: SampleResult[] = [];
    const ocrModelStats = new Map<string, { count: number; withIssues: number; totalIssues: number; lengths: number[] }>();
    const translationModelStats = new Map<string, { count: number; withIssues: number; totalIssues: number; lengths: number[] }>();

    for (const page of sampledPages) {
      const ocrText = page.ocr?.data || '';
      const translationText = page.translation?.data || '';

      const ocrValidation = validateTranslation(ocrText);
      const translationValidation = validateTranslation(translationText);

      const ocrModel = page.ocr?.model || 'unknown';
      const translationModel = page.translation?.model || 'unknown';

      // Update model stats
      if (ocrText) {
        const stats = ocrModelStats.get(ocrModel) || { count: 0, withIssues: 0, totalIssues: 0, lengths: [] };
        stats.count++;
        stats.lengths.push(ocrText.length);
        if (!ocrValidation.valid) {
          stats.withIssues++;
          stats.totalIssues += ocrValidation.issues.length;
        }
        ocrModelStats.set(ocrModel, stats);
      }

      if (translationText) {
        const stats = translationModelStats.get(translationModel) || { count: 0, withIssues: 0, totalIssues: 0, lengths: [] };
        stats.count++;
        stats.lengths.push(translationText.length);
        if (!translationValidation.valid) {
          stats.withIssues++;
          stats.totalIssues += translationValidation.issues.length;
        }
        translationModelStats.set(translationModel, stats);
      }

      // Apply model filter if specified
      if (modelFilter && translationModel !== modelFilter && ocrModel !== modelFilter) {
        continue;
      }

      results.push({
        pageId: page.id,
        bookId: page.book_id,
        bookTitle: page.book?.title || page.book?.display_title || 'Unknown',
        pageNumber: page.page_number,
        ocrModel: page.ocr?.model || null,
        translationModel: page.translation?.model || null,
        ocrPrompt: page.ocr?.prompt_name || null,
        translationPrompt: page.translation?.prompt_name || null,
        hasOcr: !!ocrText,
        hasTranslation: !!translationText,
        ocrLength: ocrText.length,
        translationLength: translationText.length,
        ocrIssues: ocrValidation.issues.length,
        translationIssues: translationValidation.issues.length,
        ocrPreview: ocrText.slice(0, 200) + (ocrText.length > 200 ? '...' : ''),
        translationPreview: translationText.slice(0, 200) + (translationText.length > 200 ? '...' : ''),
        photo: page.photo
      });
    }

    // Calculate model statistics
    const ocrStats: ModelStats[] = [];
    for (const [model, stats] of ocrModelStats) {
      const avgLength = stats.lengths.reduce((a, b) => a + b, 0) / stats.lengths.length;
      ocrStats.push({
        model,
        count: stats.count,
        withIssues: stats.withIssues,
        issueRate: stats.count > 0 ? stats.withIssues / stats.count : 0,
        avgLength: Math.round(avgLength),
        totalIssues: stats.totalIssues
      });
    }

    const translationStats: ModelStats[] = [];
    for (const [model, stats] of translationModelStats) {
      const avgLength = stats.lengths.reduce((a, b) => a + b, 0) / stats.lengths.length;
      translationStats.push({
        model,
        count: stats.count,
        withIssues: stats.withIssues,
        issueRate: stats.count > 0 ? stats.withIssues / stats.count : 0,
        avgLength: Math.round(avgLength),
        totalIssues: stats.totalIssues
      });
    }

    // Calculate population estimates with confidence intervals
    const sampledWithIssues = results.filter(r => r.translationIssues > 0 || r.ocrIssues > 0).length;
    const ci = wilsonCI(sampledWithIssues, results.length);

    return NextResponse.json({
      population: {
        totalPages,
        translatedPages,
        sampleSize: results.length,
        samplingRate: results.length / translatedPages
      },
      estimate: {
        issueRate: results.length > 0 ? sampledWithIssues / results.length : 0,
        confidenceInterval: ci,
        confidenceLevel: 0.95,
        estimatedPagesWithIssues: {
          lower: Math.round(ci.lower * translatedPages),
          upper: Math.round(ci.upper * translatedPages),
          point: Math.round((sampledWithIssues / results.length) * translatedPages)
        }
      },
      modelStats: {
        ocr: ocrStats.sort((a, b) => b.count - a.count),
        translation: translationStats.sort((a, b) => b.count - a.count)
      },
      samples: results
    });
  } catch (error) {
    console.error('Error sampling pages:', error);
    return NextResponse.json({ error: 'Failed to sample pages' }, { status: 500 });
  }
}

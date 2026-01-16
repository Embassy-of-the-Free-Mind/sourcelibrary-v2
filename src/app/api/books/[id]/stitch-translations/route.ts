import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getGeminiClient } from '@/lib/gemini-client';
import { MODEL_PRICING } from '@/lib/ai';
import { DEFAULT_MODEL } from '@/lib/types';

export const maxDuration = 300;

const STITCH_PROMPT = `You are reviewing a scholarly translation for continuity issues at page boundaries.

**Task:** Check if the current page's translation starts awkwardly due to a sentence or thought being split from the previous page. If so, provide a smoothed version of the opening. If not, respond with "NO_CHANGE_NEEDED".

**Rules:**
1. Only fix the opening 1-3 sentences if they're clearly broken mid-thought
2. Use context from the previous page to complete the thought naturally
3. Don't rewrite content that's already coherent
4. Preserve the author's meaning exactly
5. Keep the same scholarly tone and style

**Previous page (ending):**
{prev_translation}

**Current page (full translation):**
{curr_translation}

**Response format:**
If change needed: Return ONLY the smoothed opening paragraph (first 1-3 sentences), followed by "..." to indicate the rest continues unchanged.
If no change needed: Return exactly "NO_CHANGE_NEEDED"`;

function calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

interface StitchResult {
  pageId: string;
  pageNumber: number;
  status: 'fixed' | 'no_change' | 'skipped' | 'error';
  originalOpening?: string;
  fixedOpening?: string;
  error?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const {
      model: modelId = DEFAULT_MODEL,
      dryRun = false,
      startPage,
      endPage,
    }: {
      model?: string;
      dryRun?: boolean;
      startPage?: number;
      endPage?: number;
    } = await request.json();

    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get all pages with translations, sorted by page number
    const query: Record<string, unknown> = {
      book_id: bookId,
      'translation.data': { $exists: true, $nin: ['', null] },
    };

    if (startPage !== undefined) {
      query.page_number = { ...((query.page_number as object) || {}), $gte: startPage };
    }
    if (endPage !== undefined) {
      query.page_number = { ...((query.page_number as object) || {}), $lte: endPage };
    }

    const pages = await db
      .collection('pages')
      .find(query)
      .sort({ page_number: 1 })
      .toArray();

    if (pages.length < 2) {
      return NextResponse.json({
        message: 'Need at least 2 pages with translations to stitch',
        pagesFound: pages.length,
      });
    }

    console.log(`[stitch] Processing ${pages.length} pages for book ${bookId}`);

    const genAI = getGeminiClient();
    const model = genAI.getGenerativeModel({ model: modelId });

    const results: StitchResult[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let fixedCount = 0;

    // Process pages sequentially (skip first page - nothing to stitch to)
    for (let i = 1; i < pages.length; i++) {
      const prevPage = pages[i - 1];
      const currPage = pages[i];

      // Skip if pages aren't consecutive
      if (currPage.page_number !== prevPage.page_number + 1) {
        results.push({
          pageId: currPage.id,
          pageNumber: currPage.page_number,
          status: 'skipped',
          error: `Non-consecutive: prev=${prevPage.page_number}, curr=${currPage.page_number}`,
        });
        continue;
      }

      const prevTranslation = prevPage.translation?.data || '';
      const currTranslation = currPage.translation?.data || '';

      // Use last 1500 chars of previous page
      const prevEnding = prevTranslation.slice(-1500);

      const prompt = STITCH_PROMPT
        .replace('{prev_translation}', prevEnding)
        .replace('{curr_translation}', currTranslation.slice(0, 3000));

      try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text().trim();

        const usageMetadata = result.response.usageMetadata;
        const inputTokens = usageMetadata?.promptTokenCount || 0;
        const outputTokens = usageMetadata?.candidatesTokenCount || 0;
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;

        if (responseText === 'NO_CHANGE_NEEDED' || responseText.includes('NO_CHANGE_NEEDED')) {
          results.push({
            pageId: currPage.id,
            pageNumber: currPage.page_number,
            status: 'no_change',
          });
        } else {
          // Extract the fixed opening (before "...")
          const fixedOpening = responseText.replace(/\.\.\.$/m, '').trim();
          const originalOpening = currTranslation.split(/[.!?]\s+/).slice(0, 3).join('. ') + '.';

          results.push({
            pageId: currPage.id,
            pageNumber: currPage.page_number,
            status: 'fixed',
            originalOpening: originalOpening.slice(0, 200),
            fixedOpening: fixedOpening.slice(0, 200),
          });

          fixedCount++;

          // Apply the fix if not dry run
          if (!dryRun && fixedOpening.length > 10) {
            // Find where the fixed content ends in the original
            // Replace the opening sentences with the smoothed version
            const sentences = currTranslation.split(/(?<=[.!?])\s+/);
            const fixedSentences = fixedOpening.split(/(?<=[.!?])\s+/);

            // Replace first N sentences with fixed version
            const numToReplace = Math.min(fixedSentences.length, 3);
            const newTranslation = [
              ...fixedSentences,
              ...sentences.slice(numToReplace),
            ].join(' ');

            await db.collection('pages').updateOne(
              { id: currPage.id },
              {
                $set: {
                  'translation.data': newTranslation,
                  'translation.stitched': true,
                  'translation.stitch_model': modelId,
                  updated_at: new Date(),
                },
              }
            );
          }
        }
      } catch (e) {
        console.error(`[stitch] Error processing page ${currPage.page_number}:`, e);
        results.push({
          pageId: currPage.id,
          pageNumber: currPage.page_number,
          status: 'error',
          error: e instanceof Error ? e.message : 'Unknown error',
        });
      }

      // Small delay to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const costUsd = calculateCost(totalInputTokens, totalOutputTokens, modelId);

    // Track cost
    if (!dryRun) {
      try {
        await db.collection('cost_tracking').insertOne({
          timestamp: new Date(),
          action: 'stitch_translations',
          model: modelId,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          totalTokens: totalInputTokens + totalOutputTokens,
          costUsd,
          bookId,
          pagesProcessed: pages.length - 1,
          pagesFixed: fixedCount,
        });
      } catch (e) {
        console.error('Failed to track cost:', e);
      }
    }

    return NextResponse.json({
      success: true,
      dryRun,
      bookId,
      pagesProcessed: pages.length - 1,
      pagesFixed: fixedCount,
      pagesNoChange: results.filter((r) => r.status === 'no_change').length,
      pagesSkipped: results.filter((r) => r.status === 'skipped').length,
      pagesErrored: results.filter((r) => r.status === 'error').length,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd,
      },
      results: results.filter((r) => r.status === 'fixed' || r.status === 'error'),
    });
  } catch (error) {
    console.error('[stitch] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to stitch translations',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/books/[id]/stitch-translations
 *
 * Preview which pages might need stitching (dry run analysis)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();

    const pages = await db
      .collection('pages')
      .find({
        book_id: bookId,
        'translation.data': { $exists: true, $nin: ['', null] },
      })
      .sort({ page_number: 1 })
      .project({ id: 1, page_number: 1, 'translation.data': 1, 'translation.stitched': 1 })
      .toArray();

    // Analyze page boundaries for potential issues
    const analysis = [];
    for (let i = 1; i < pages.length; i++) {
      const prevPage = pages[i - 1];
      const currPage = pages[i];

      if (currPage.page_number !== prevPage.page_number + 1) continue;

      const prevEnding = (prevPage.translation?.data || '').slice(-200);
      const currOpening = (currPage.translation?.data || '').slice(0, 200);

      // Heuristics for likely broken continuity
      const startsLowercase = /^[a-z]/.test(currOpening.trim());
      const startsWithConjunction = /^(and|but|or|for|nor|yet|so|however|therefore|thus|hence|moreover)\b/i.test(currOpening.trim());
      const prevEndsIncomplete = /[,;:\-–—]$/.test(prevEnding.trim());
      const alreadyStitched = currPage.translation?.stitched;

      if ((startsLowercase || startsWithConjunction || prevEndsIncomplete) && !alreadyStitched) {
        analysis.push({
          pageNumber: currPage.page_number,
          pageId: currPage.id,
          reason: startsLowercase ? 'starts_lowercase' : startsWithConjunction ? 'starts_conjunction' : 'prev_incomplete',
          prevEnding: prevEnding.slice(-100),
          currOpening: currOpening.slice(0, 100),
        });
      }
    }

    return NextResponse.json({
      bookId,
      totalPages: pages.length,
      alreadyStitched: pages.filter((p) => p.translation?.stitched).length,
      likelyNeedStitching: analysis.length,
      candidates: analysis.slice(0, 20), // First 20 candidates
    });
  } catch (error) {
    console.error('[stitch] Analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze translations' },
      { status: 500 }
    );
  }
}

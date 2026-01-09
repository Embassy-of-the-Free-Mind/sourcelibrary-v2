import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import { images } from '@/lib/api-client';

export const maxDuration = 300;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const JUDGE_MODEL = 'claude-sonnet-4-20250514';

const CLAUDE_PRICING = {
  input: 3.00,
  output: 15.00,
};

const JUDGE_PROMPT = `You are an expert evaluator of OCR quality for historical manuscripts.

You will see:
1. An image of a manuscript page
2. Two OCR transcriptions (A and B)

Which transcription is MORE ACCURATE to the original image?

Criteria (in order):
1. Character accuracy
2. Word completeness
3. Historical spelling preserved
4. Formatting

Reply with ONLY: A, B, or TIE`;

function calculateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * CLAUDE_PRICING.input +
         (outputTokens / 1_000_000) * CLAUDE_PRICING.output;
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const result = await images.fetchBase64(url, { includeMimeType: true });
    if (typeof result === 'string') {
      return { data: result, mimeType: 'image/jpeg' };
    }
    return { data: result.base64, mimeType: result.mimeType };
  } catch {
    return null;
  }
}

// POST /api/experiments/ocr-quality/[id]/random-judge
// Run N random pairwise comparisons for proper ELO
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { count = 200 }: { count?: number } = await request.json();

    const db = await getDb();

    const experiment = await db.collection('ocr_experiments').findOne({ id });
    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    }

    // Get all OCR results
    const results = await db
      .collection('ocr_experiment_results')
      .find({ experiment_id: id, success: true })
      .toArray();

    if (results.length === 0) {
      return NextResponse.json({ error: 'No OCR results found' }, { status: 404 });
    }

    // Group by page
    const resultsByPage: Record<string, Record<string, string>> = {};
    results.forEach(r => {
      if (!resultsByPage[r.page_id]) resultsByPage[r.page_id] = {};
      resultsByPage[r.page_id][r.condition_id] = r.ocr;
    });

    // Get pages for images
    const pageIds = Object.keys(resultsByPage);
    const pages = await db.collection('pages').find({ id: { $in: pageIds } }).toArray();
    const pageMap = new Map(pages.map(p => [p.id, p]));

    // Get all conditions that have results
    const allConditions = [...new Set(results.map(r => r.condition_id))];

    if (allConditions.length < 2) {
      return NextResponse.json({ error: 'Need at least 2 conditions' }, { status: 400 });
    }

    // Generate random matchups
    const matchups: Array<{ pageId: string; condA: string; condB: string }> = [];

    for (let i = 0; i < count; i++) {
      // Random page
      const pageId = pageIds[Math.floor(Math.random() * pageIds.length)];
      const pageConditions = Object.keys(resultsByPage[pageId]);

      if (pageConditions.length < 2) continue;

      // Random pair of conditions available for this page
      const shuffled = [...pageConditions].sort(() => Math.random() - 0.5);
      matchups.push({
        pageId,
        condA: shuffled[0],
        condB: shuffled[1],
      });
    }

    // Initialize progress
    await db.collection('ocr_experiments').updateOne(
      { id },
      {
        $set: {
          random_judging_progress: {
            status: 'running',
            processed: 0,
            total: matchups.length,
            started_at: new Date().toISOString(),
          },
        },
      }
    );

    let totalCost = 0;
    let totalTokens = 0;
    let processed = 0;
    let errors = 0;

    for (const matchup of matchups) {
      try {
        const page = pageMap.get(matchup.pageId);
        if (!page) { errors++; continue; }

        const ocrA = resultsByPage[matchup.pageId][matchup.condA];
        const ocrB = resultsByPage[matchup.pageId][matchup.condB];
        if (!ocrA || !ocrB) { errors++; continue; }

        const image = await fetchImageAsBase64(page.photo);
        if (!image) { errors++; continue; }

        const prompt = `${JUDGE_PROMPT}

=== TRANSCRIPTION A ===
${ocrA.slice(0, 3000)}

=== TRANSCRIPTION B ===
${ocrB.slice(0, 3000)}

Which is more accurate? Reply: A, B, or TIE`;

        const result = await anthropic.messages.create({
          model: JUDGE_MODEL,
          max_tokens: 10,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: image.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                  data: image.data,
                },
              },
              { type: 'text', text: prompt },
            ],
          }],
        });

        const responseText = result.content[0].type === 'text' ? result.content[0].text : '';
        const response = responseText.trim().toUpperCase();

        let winner: 'a' | 'b' | 'tie' = 'tie';
        if (response.startsWith('A')) winner = 'a';
        else if (response.startsWith('B')) winner = 'b';

        const inputTokens = result.usage.input_tokens;
        const outputTokens = result.usage.output_tokens;
        totalCost += calculateCost(inputTokens, outputTokens);
        totalTokens += inputTokens + outputTokens;

        // Save judgment with "random" tag
        await db.collection('ocr_judgments').insertOne({
          id: crypto.randomUUID(),
          experiment_id: id,
          page_id: matchup.pageId,
          condition_a: matchup.condA,
          condition_b: matchup.condB,
          comparison_type: 'random',
          winner,
          judge_type: 'ai',
          judge_model: JUDGE_MODEL,
          ai_response: response,
          created_at: new Date().toISOString(),
        });

        processed++;

        if (processed % 10 === 0) {
          await db.collection('ocr_experiments').updateOne(
            { id },
            { $set: { 'random_judging_progress.processed': processed } }
          );
        }
      } catch (error) {
        console.error('Error in random judgment:', error);
        errors++;
      }
    }

    // Update final status
    await db.collection('ocr_experiments').updateOne(
      { id },
      {
        $set: {
          random_judging_progress: {
            status: 'complete',
            processed,
            total: matchups.length,
            completed_at: new Date().toISOString(),
          },
          random_judging_cost: totalCost,
          random_judging_tokens: totalTokens,
        },
      }
    );

    return NextResponse.json({
      success: true,
      processed,
      errors,
      cost: totalCost,
      tokens: totalTokens,
    });
  } catch (error) {
    console.error('Error in random-judge:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

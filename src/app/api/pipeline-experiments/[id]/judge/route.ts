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

const JUDGE_PROMPT = `You are an expert in Latin and historical manuscripts.

You will see:
1. An image of a Latin manuscript page
2. Two translations of this page (A and B)

Judge which translation is BETTER based on:
1. **Accuracy** - Faithfulness to the Latin meaning
2. **Completeness** - All content translated, nothing missing
3. **Readability** - Clear, natural English
4. **Scholarly quality** - Appropriate handling of technical terms

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

// POST /api/experiments/pipeline/[id]/judge - Run AI judging with random matchups
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { count = 100 }: { count?: number } = await request.json();

    const db = await getDb();

    const experiment = await db.collection('pipeline_experiments').findOne({ id });
    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    }

    // Get all results
    const results = await db
      .collection('pipeline_experiment_results')
      .find({ experiment_id: id, success: true })
      .toArray();

    if (results.length === 0) {
      return NextResponse.json({ error: 'No results found' }, { status: 404 });
    }

    // Group by page
    const resultsByPage: Record<string, Record<string, { ocr: string; translation: string }>> = {};
    results.forEach(r => {
      if (!resultsByPage[r.page_id]) resultsByPage[r.page_id] = {};
      resultsByPage[r.page_id][r.condition_id] = {
        ocr: r.ocr,
        translation: r.translation,
      };
    });

    // Get pages for images
    const pageIds = Object.keys(resultsByPage);
    const pages = await db.collection('pages').find({ id: { $in: pageIds } }).toArray();
    const pageMap = new Map(pages.map(p => [p.id, p]));

    // Get all conditions
    const allConditions = [...new Set(results.map(r => r.condition_id))];

    if (allConditions.length < 2) {
      return NextResponse.json({ error: 'Need at least 2 conditions' }, { status: 400 });
    }

    // Generate random matchups
    const matchups: Array<{ pageId: string; condA: string; condB: string }> = [];

    for (let i = 0; i < count; i++) {
      const pageId = pageIds[Math.floor(Math.random() * pageIds.length)];
      const pageConditions = Object.keys(resultsByPage[pageId]);

      if (pageConditions.length < 2) continue;

      const shuffled = [...pageConditions].sort(() => Math.random() - 0.5);
      matchups.push({
        pageId,
        condA: shuffled[0],
        condB: shuffled[1],
      });
    }

    // Initialize progress
    await db.collection('pipeline_experiments').updateOne(
      { id },
      {
        $set: {
          judging_progress: {
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

        const transA = resultsByPage[matchup.pageId][matchup.condA]?.translation;
        const transB = resultsByPage[matchup.pageId][matchup.condB]?.translation;
        if (!transA || !transB) { errors++; continue; }

        const image = await fetchImageAsBase64(page.photo);
        if (!image) { errors++; continue; }

        const prompt = `${JUDGE_PROMPT}

=== TRANSLATION A ===
${transA.slice(0, 3000)}

=== TRANSLATION B ===
${transB.slice(0, 3000)}

Which translation is better? Reply: A, B, or TIE`;

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

        await db.collection('pipeline_judgments').insertOne({
          id: crypto.randomUUID(),
          experiment_id: id,
          page_id: matchup.pageId,
          condition_a: matchup.condA,
          condition_b: matchup.condB,
          winner,
          judge_type: 'ai',
          judge_model: JUDGE_MODEL,
          ai_response: response,
          created_at: new Date().toISOString(),
        });

        processed++;

        if (processed % 10 === 0) {
          await db.collection('pipeline_experiments').updateOne(
            { id },
            { $set: { 'judging_progress.processed': processed } }
          );
        }
      } catch (error) {
        console.error('Error judging:', error);
        errors++;
      }
    }

    // Update final status
    await db.collection('pipeline_experiments').updateOne(
      { id },
      {
        $set: {
          judging_progress: {
            status: 'complete',
            processed,
            total: matchups.length,
            completed_at: new Date().toISOString(),
          },
          judging_cost: (experiment.judging_cost || 0) + totalCost,
          judging_tokens: (experiment.judging_tokens || 0) + totalTokens,
          status: 'judged',
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
    console.error('Error in pipeline judge:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';

export const maxDuration = 300; // 5 minutes

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const JUDGE_MODEL = 'claude-sonnet-4-20250514';

// Claude pricing per million tokens
const CLAUDE_PRICING = {
  input: 3.00,
  output: 15.00,
};

interface OCRComparison {
  a: string;
  b: string;
  question: string;
}

const JUDGE_PROMPT = `You are an expert evaluator of OCR (Optical Character Recognition) quality for historical manuscripts.

You will be shown:
1. An image of a manuscript page
2. Two OCR transcriptions of that page (labeled A and B)

Your task: Determine which transcription is MORE ACCURATE to the original manuscript image.

Evaluation criteria (in order of importance):
1. **Character accuracy** - Correct letters, numbers, punctuation
2. **Word accuracy** - Complete words without missing or extra characters
3. **Spelling preservation** - Historical spellings should be preserved, not modernized
4. **Formatting** - Line breaks, paragraph structure
5. **Special characters** - Abbreviations, diacritics, ligatures

Compare carefully and respond with ONLY one of:
- "A" if transcription A is clearly better
- "B" if transcription B is clearly better
- "TIE" if they are roughly equal in quality

Do not explain your reasoning. Just output A, B, or TIE.`;

function calculateCost(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * CLAUDE_PRICING.input;
  const outputCost = (outputTokens / 1_000_000) * CLAUDE_PRICING.output;
  return inputCost + outputCost;
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    let mimeType = response.headers.get('content-type') || 'image/jpeg';
    mimeType = mimeType.split(';')[0].trim();

    const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!supportedTypes.includes(mimeType)) {
      mimeType = 'image/jpeg';
    }

    return { data: base64, mimeType };
  } catch (error) {
    console.error('Failed to fetch image:', url, error);
    return null;
  }
}

// POST /api/experiments/ocr-quality/[id]/auto-judge - Run AI judging
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    // Get experiment
    const experiment = await db.collection('ocr_experiments').findOne({ id });
    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    }

    // Check all conditions are run
    if (experiment.conditions_run.length < experiment.conditions.length) {
      return NextResponse.json({
        error: 'Not all conditions have been run yet',
        conditions_run: experiment.conditions_run.length,
        conditions_total: experiment.conditions.length,
      }, { status: 400 });
    }

    // Get existing judgments
    const existingJudgments = await db
      .collection('ocr_judgments')
      .find({ experiment_id: id })
      .toArray();

    const judgedSet = new Set(
      existingJudgments.map(j => `${j.page_id}_${j.comparison_type}`)
    );

    // Get all results
    const results = await db
      .collection('ocr_experiment_results')
      .find({ experiment_id: id })
      .toArray();

    const resultsByPage: Record<string, Record<string, string>> = {};
    results.forEach(r => {
      if (!resultsByPage[r.page_id]) {
        resultsByPage[r.page_id] = {};
      }
      resultsByPage[r.page_id][r.condition_id] = r.ocr;
    });

    // Get pages for images
    const pages = await db
      .collection('pages')
      .find({ id: { $in: experiment.page_ids } })
      .toArray();

    const pageMap = new Map(pages.map(p => [p.id, p]));

    // Build list of pending judgments
    const comparisons: OCRComparison[] = experiment.comparisons;
    const pendingJudgments: Array<{
      page_id: string;
      page: typeof pages[0];
      condition_a: string;
      condition_b: string;
      ocr_a: string;
      ocr_b: string;
      comparison_type: string;
    }> = [];

    for (const pageId of experiment.page_ids) {
      for (const comp of comparisons) {
        const key = `${pageId}_${comp.question}`;
        if (!judgedSet.has(key)) {
          const page = pageMap.get(pageId);
          const pageResults = resultsByPage[pageId];

          if (page && pageResults && pageResults[comp.a] && pageResults[comp.b]) {
            pendingJudgments.push({
              page_id: pageId,
              page,
              condition_a: comp.a,
              condition_b: comp.b,
              ocr_a: pageResults[comp.a],
              ocr_b: pageResults[comp.b],
              comparison_type: comp.question,
            });
          }
        }
      }
    }

    if (pendingJudgments.length === 0) {
      return NextResponse.json({
        message: 'All judgments already complete',
        total: experiment.total_judgments,
        completed: existingJudgments.length,
      });
    }

    // Initialize progress
    await db.collection('ocr_experiments').updateOne(
      { id },
      {
        $set: {
          judging_progress: {
            status: 'running',
            processed: 0,
            total: pendingJudgments.length,
            started_at: new Date().toISOString(),
          },
        },
      }
    );

    let totalCost = 0;
    let totalTokens = 0;
    let processed = 0;
    let errors = 0;

    // Process judgments one at a time
    for (const judgment of pendingJudgments) {
      try {
        // Fetch the page image
        const image = await fetchImageAsBase64(judgment.page.photo);
        if (!image) {
          console.error('Failed to fetch image for page:', judgment.page_id);
          errors++;
          continue;
        }

        // Build the prompt with both transcriptions
        const textPrompt = `${JUDGE_PROMPT}

=== TRANSCRIPTION A ===
${judgment.ocr_a.slice(0, 3000)}

=== TRANSCRIPTION B ===
${judgment.ocr_b.slice(0, 3000)}

Which transcription is more accurate? Reply with only A, B, or TIE.`;

        // Call Claude with vision
        const result = await anthropic.messages.create({
          model: JUDGE_MODEL,
          max_tokens: 10,
          messages: [
            {
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
                {
                  type: 'text',
                  text: textPrompt,
                },
              ],
            },
          ],
        });

        const responseText = result.content[0].type === 'text' ? result.content[0].text : '';
        const response = responseText.trim().toUpperCase();
        const inputTokens = result.usage.input_tokens;
        const outputTokens = result.usage.output_tokens;
        const cost = calculateCost(inputTokens, outputTokens);

        totalCost += cost;
        totalTokens += inputTokens + outputTokens;

        // Parse the winner
        let winner: 'a' | 'b' | 'tie' = 'tie';
        if (response.startsWith('A')) {
          winner = 'a';
        } else if (response.startsWith('B')) {
          winner = 'b';
        } else if (response.includes('TIE')) {
          winner = 'tie';
        }

        // Save the judgment
        await db.collection('ocr_judgments').insertOne({
          id: crypto.randomUUID(),
          experiment_id: id,
          page_id: judgment.page_id,
          condition_a: judgment.condition_a,
          condition_b: judgment.condition_b,
          comparison_type: judgment.comparison_type,
          winner,
          judge_type: 'ai',
          judge_model: JUDGE_MODEL,
          ai_response: response,
          created_at: new Date().toISOString(),
        });

        processed++;

        // Update progress every 5 judgments
        if (processed % 5 === 0) {
          await db.collection('ocr_experiments').updateOne(
            { id },
            {
              $set: {
                'judging_progress.processed': processed,
                'judging_progress.last_update': new Date().toISOString(),
              },
            }
          );
        }
      } catch (error) {
        console.error('Error judging comparison:', error);
        errors++;
      }
    }

    // Update experiment status
    const totalJudgments = await db.collection('ocr_judgments').countDocuments({ experiment_id: id });
    const isComplete = totalJudgments >= experiment.total_judgments;

    await db.collection('ocr_experiments').updateOne(
      { id },
      {
        $set: {
          status: isComplete ? 'completed' : 'judging',
          judgments_complete: totalJudgments,
          judging_progress: {
            status: 'complete',
            processed,
            total: pendingJudgments.length,
            completed_at: new Date().toISOString(),
          },
          judging_cost: (experiment.judging_cost || 0) + totalCost,
          judging_tokens: (experiment.judging_tokens || 0) + totalTokens,
          ...(isComplete ? { completed_at: new Date().toISOString() } : {}),
        },
      }
    );

    return NextResponse.json({
      success: true,
      processed,
      errors,
      total_judgments: totalJudgments,
      is_complete: isComplete,
      cost: totalCost,
      tokens: totalTokens,
    });
  } catch (error) {
    console.error('Error in auto-judge:', error);
    return NextResponse.json({ error: 'Failed to run auto-judge' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { LATIN_PROMPTS, DEFAULT_PROMPTS, DEFAULT_MODEL } from '@/lib/types';
import { MODEL_PRICING } from '@/lib/ai';
import crypto from 'crypto';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Simple prompt for comparison
const SIMPLE_OCR_PROMPT = `Transcribe the text from this historical manuscript page accurately.
Preserve the original spelling and formatting. Output in plain text.`;

function calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
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
      if (url.toLowerCase().includes('.png')) mimeType = 'image/png';
      else if (url.toLowerCase().includes('.webp')) mimeType = 'image/webp';
      else mimeType = 'image/jpeg';
    }

    return { data: base64, mimeType };
  } catch (error) {
    console.error('Failed to fetch image:', url, error);
    return null;
  }
}

// POST /api/experiments/ocr-quality/[id]/run - Run a specific condition
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { condition_id }: { condition_id: string } = await request.json();

    if (!condition_id) {
      return NextResponse.json({ error: 'condition_id required' }, { status: 400 });
    }

    const db = await getDb();

    // Get experiment
    const experiment = await db.collection('ocr_experiments').findOne({ id });
    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    }

    // Find the condition
    const condition = experiment.conditions.find((c: { id: string }) => c.id === condition_id);
    if (!condition) {
      return NextResponse.json({ error: 'Condition not found' }, { status: 404 });
    }

    // Check if already run
    if (experiment.conditions_run.includes(condition_id)) {
      return NextResponse.json({ error: 'Condition already run' }, { status: 400 });
    }

    // Get pages
    const pages = await db
      .collection('pages')
      .find({ id: { $in: experiment.page_ids } })
      .sort({ page_number: 1 })
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json({ error: 'No pages found' }, { status: 404 });
    }

    const model = genAI.getGenerativeModel({ model: DEFAULT_MODEL });
    const batchSize = condition.batchSize;
    const promptType = condition.promptType;

    // Select prompt
    const basePrompt = promptType === 'elaborate'
      ? LATIN_PROMPTS.ocr
      : SIMPLE_OCR_PROMPT;

    const results: Array<{
      page_id: string;
      page_number: number;
      ocr: string;
      success: boolean;
      error?: string;
    }> = [];

    let totalCost = 0;
    let totalTokens = 0;

    // Process in batches
    for (let i = 0; i < pages.length; i += batchSize) {
      const batch = pages.slice(i, i + batchSize);

      // Get previous context (last OCR from previous batch)
      const previousOcr = i > 0 && results.length > 0
        ? results[results.length - 1].ocr?.slice(0, 1500)
        : '';

      if (batchSize === 1) {
        // Single page processing
        const page = batch[0];
        try {
          const image = await fetchImageAsBase64(page.photo);
          if (!image) {
            results.push({
              page_id: page.id,
              page_number: page.page_number,
              ocr: '',
              success: false,
              error: 'Failed to fetch image',
            });
            continue;
          }

          let prompt = basePrompt;
          if (previousOcr) {
            prompt += `\n\n**Previous page for context:**\n${previousOcr}...`;
          }

          const result = await model.generateContent([
            prompt,
            { inlineData: { mimeType: image.mimeType, data: image.data } },
          ]);

          const text = result.response.text();
          const usage = result.response.usageMetadata;
          const inputTokens = usage?.promptTokenCount || 0;
          const outputTokens = usage?.candidatesTokenCount || 0;
          const cost = calculateCost(inputTokens, outputTokens, DEFAULT_MODEL);

          totalCost += cost;
          totalTokens += inputTokens + outputTokens;

          results.push({
            page_id: page.id,
            page_number: page.page_number,
            ocr: text,
            success: true,
          });
        } catch (error) {
          results.push({
            page_id: page.id,
            page_number: page.page_number,
            ocr: '',
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      } else {
        // Batch processing - multiple images in one request
        try {
          const images = await Promise.all(batch.map(p => fetchImageAsBase64(p.photo)));
          const validBatch: { page: typeof batch[0]; image: { data: string; mimeType: string } }[] = [];

          batch.forEach((page, idx) => {
            if (images[idx]) {
              validBatch.push({ page, image: images[idx]! });
            } else {
              results.push({
                page_id: page.id,
                page_number: page.page_number,
                ocr: '',
                success: false,
                error: 'Failed to fetch image',
              });
            }
          });

          if (validBatch.length === 0) continue;

          let prompt = basePrompt;
          if (previousOcr) {
            prompt += `\n\n**Previous page for context:**\n${previousOcr}...`;
          }
          prompt += `\n\n**You will receive ${validBatch.length} page images. Transcribe each one.**`;
          prompt += `\n\n**Output format:**
Return each transcription clearly separated:

=== PAGE 1 ===
[transcription for first image]

=== PAGE 2 ===
[transcription for second image]

... and so on.`;

          // Build content array
          const content: (string | { inlineData: { mimeType: string; data: string } })[] = [prompt];
          validBatch.forEach(({ image }) => {
            content.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
          });

          const result = await model.generateContent(content);
          const responseText = result.response.text();
          const usage = result.response.usageMetadata;
          const inputTokens = usage?.promptTokenCount || 0;
          const outputTokens = usage?.candidatesTokenCount || 0;
          const cost = calculateCost(inputTokens, outputTokens, DEFAULT_MODEL);

          totalCost += cost;
          totalTokens += inputTokens + outputTokens;

          // Parse results
          const parts = responseText.split(/===\s*PAGE\s*(\d+)\s*===/i);

          for (let j = 1; j < parts.length; j += 2) {
            const index = parseInt(parts[j], 10) - 1;
            const ocr = parts[j + 1]?.trim();

            if (index >= 0 && index < validBatch.length && ocr) {
              results.push({
                page_id: validBatch[index].page.id,
                page_number: validBatch[index].page.page_number,
                ocr,
                success: true,
              });
            }
          }

          // Handle unparsed pages
          validBatch.forEach(({ page }) => {
            if (!results.find(r => r.page_id === page.id)) {
              // If only one page in batch and parsing failed, use full response
              if (validBatch.length === 1) {
                results.push({
                  page_id: page.id,
                  page_number: page.page_number,
                  ocr: responseText.trim(),
                  success: true,
                });
              } else {
                results.push({
                  page_id: page.id,
                  page_number: page.page_number,
                  ocr: '',
                  success: false,
                  error: 'Failed to parse batch response',
                });
              }
            }
          });
        } catch (error) {
          batch.forEach(page => {
            if (!results.find(r => r.page_id === page.id)) {
              results.push({
                page_id: page.id,
                page_number: page.page_number,
                ocr: '',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          });
        }
      }
    }

    // Save results
    const now = new Date().toISOString();
    const resultDocs = results.map(r => ({
      id: crypto.randomUUID(),
      experiment_id: id,
      condition_id,
      page_id: r.page_id,
      page_number: r.page_number,
      ocr: r.ocr,
      success: r.success,
      error: r.error || null,
      created_at: now,
    }));

    if (resultDocs.length > 0) {
      await db.collection('ocr_experiment_results').insertMany(resultDocs);
    }

    // Update experiment - get current and update
    const currentExp = await db.collection('ocr_experiments').findOne({ id });
    const updatedConditionsRun = [...(currentExp?.conditions_run || []), condition_id];

    await db.collection('ocr_experiments').updateOne(
      { id },
      {
        $set: {
          conditions_run: updatedConditionsRun,
          status: 'running',
          updated_at: now,
          total_cost: (currentExp?.total_cost || 0) + totalCost,
          total_tokens: (currentExp?.total_tokens || 0) + totalTokens,
        },
      }
    );

    const successCount = results.filter(r => r.success).length;

    return NextResponse.json({
      success: true,
      condition_id,
      pages_processed: results.length,
      success_count: successCount,
      failed_count: results.length - successCount,
      cost: totalCost,
      tokens: totalTokens,
    });
  } catch (error) {
    console.error('Error running OCR condition:', error);
    return NextResponse.json({ error: 'Failed to run condition' }, { status: 500 });
  }
}

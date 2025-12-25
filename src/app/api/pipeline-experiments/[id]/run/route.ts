import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { MODEL_PRICING } from '@/lib/ai';
import crypto from 'crypto';

export const maxDuration = 300;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

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
    return { data: base64, mimeType };
  } catch {
    return null;
  }
}

const SINGLE_PASS_PROMPT = `You are an expert in historical Latin manuscripts.

Look at this manuscript page image and provide:
1. An accurate OCR transcription of the Latin text
2. An English translation of the text

Preserve original spelling in the OCR. Provide a scholarly but readable translation.

Format your response as:

=== LATIN OCR ===
[transcription here]

=== ENGLISH TRANSLATION ===
[translation here]`;

const TWO_PASS_OCR_PROMPT = `Transcribe the text from this historical Latin manuscript page accurately.
Preserve the original spelling and formatting. Output in plain text.`;

const TWO_PASS_TRANSLATE_PROMPT = `Translate this Latin text to English. Provide a scholarly but readable translation.

Latin text:
{ocr_text}

English translation:`;

// POST /api/experiments/pipeline/[id]/run - Run a condition
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

    const experiment = await db.collection('pipeline_experiments').findOne({ id });
    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    }

    const condition = experiment.conditions.find((c: { id: string }) => c.id === condition_id);
    if (!condition) {
      return NextResponse.json({ error: 'Condition not found' }, { status: 404 });
    }

    if (experiment.conditions_run.includes(condition_id)) {
      return NextResponse.json({ error: 'Condition already run' }, { status: 400 });
    }

    const pages = await db
      .collection('pages')
      .find({ id: { $in: experiment.page_ids } })
      .sort({ page_number: 1 })
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json({ error: 'No pages found' }, { status: 404 });
    }

    // Initialize progress
    await db.collection('pipeline_experiments').updateOne(
      { id },
      {
        $set: {
          [`progress.${condition_id}`]: {
            status: 'running',
            processed: 0,
            total: pages.length,
            started_at: new Date().toISOString(),
          },
        },
      }
    );

    const model = genAI.getGenerativeModel({ model: condition.ocrModel });
    const results: Array<{
      page_id: string;
      page_number: number;
      ocr: string;
      translation: string;
      success: boolean;
      error?: string;
    }> = [];

    let totalCost = 0;
    let totalTokens = 0;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      try {
        const image = await fetchImageAsBase64(page.photo);
        if (!image) {
          results.push({
            page_id: page.id,
            page_number: page.page_number,
            ocr: '',
            translation: '',
            success: false,
            error: 'Failed to fetch image',
          });
          continue;
        }

        if (condition.type === 'single_pass') {
          // Single pass: OCR + Translate in one call
          const result = await model.generateContent([
            SINGLE_PASS_PROMPT,
            { inlineData: { mimeType: image.mimeType, data: image.data } },
          ]);

          const text = result.response.text();
          const usage = result.response.usageMetadata;
          const inputTokens = usage?.promptTokenCount || 0;
          const outputTokens = usage?.candidatesTokenCount || 0;
          totalCost += calculateCost(inputTokens, outputTokens, condition.ocrModel);
          totalTokens += inputTokens + outputTokens;

          // Parse response
          const ocrMatch = text.match(/===\s*LATIN OCR\s*===\s*([\s\S]*?)(?:===\s*ENGLISH|$)/i);
          const transMatch = text.match(/===\s*ENGLISH TRANSLATION\s*===\s*([\s\S]*?)$/i);

          results.push({
            page_id: page.id,
            page_number: page.page_number,
            ocr: ocrMatch ? ocrMatch[1].trim() : text,
            translation: transMatch ? transMatch[1].trim() : '',
            success: true,
          });
        } else {
          // Two pass: OCR first, then translate
          // Step 1: OCR
          const ocrResult = await model.generateContent([
            TWO_PASS_OCR_PROMPT,
            { inlineData: { mimeType: image.mimeType, data: image.data } },
          ]);

          const ocrText = ocrResult.response.text();
          const ocrUsage = ocrResult.response.usageMetadata;
          const ocrInputTokens = ocrUsage?.promptTokenCount || 0;
          const ocrOutputTokens = ocrUsage?.candidatesTokenCount || 0;
          totalCost += calculateCost(ocrInputTokens, ocrOutputTokens, condition.ocrModel);
          totalTokens += ocrInputTokens + ocrOutputTokens;

          // Step 2: Translate
          const translateModel = genAI.getGenerativeModel({ model: condition.translateModel });
          const translatePrompt = TWO_PASS_TRANSLATE_PROMPT.replace('{ocr_text}', ocrText);

          const translateResult = await translateModel.generateContent(translatePrompt);
          const translation = translateResult.response.text();
          const transUsage = translateResult.response.usageMetadata;
          const transInputTokens = transUsage?.promptTokenCount || 0;
          const transOutputTokens = transUsage?.candidatesTokenCount || 0;
          totalCost += calculateCost(transInputTokens, transOutputTokens, condition.translateModel);
          totalTokens += transInputTokens + transOutputTokens;

          results.push({
            page_id: page.id,
            page_number: page.page_number,
            ocr: ocrText.trim(),
            translation: translation.trim(),
            success: true,
          });
        }
      } catch (error) {
        results.push({
          page_id: page.id,
          page_number: page.page_number,
          ocr: '',
          translation: '',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      // Update progress
      if ((i + 1) % 3 === 0 || i === pages.length - 1) {
        await db.collection('pipeline_experiments').updateOne(
          { id },
          {
            $set: {
              [`progress.${condition_id}.processed`]: i + 1,
              [`progress.${condition_id}.last_update`]: new Date().toISOString(),
            },
          }
        );
      }
    }

    // Save results
    const now = new Date().toISOString();
    const resultDocs = results.map(r => ({
      id: crypto.randomUUID(),
      experiment_id: id,
      condition_id,
      condition_type: condition.type,
      page_id: r.page_id,
      page_number: r.page_number,
      ocr: r.ocr,
      translation: r.translation,
      success: r.success,
      error: r.error || null,
      created_at: now,
    }));

    if (resultDocs.length > 0) {
      await db.collection('pipeline_experiment_results').insertMany(resultDocs);
    }

    // Update experiment
    const currentExp = await db.collection('pipeline_experiments').findOne({ id });
    const updatedConditionsRun = [...(currentExp?.conditions_run || []), condition_id];

    await db.collection('pipeline_experiments').updateOne(
      { id },
      {
        $set: {
          conditions_run: updatedConditionsRun,
          status: 'running',
          [`progress.${condition_id}.status`]: 'complete',
          [`progress.${condition_id}.completed_at`]: now,
          total_cost: (currentExp?.total_cost || 0) + totalCost,
          total_tokens: (currentExp?.total_tokens || 0) + totalTokens,
          updated_at: now,
        },
      }
    );

    const successCount = results.filter(r => r.success).length;

    return NextResponse.json({
      success: true,
      condition_id,
      condition_type: condition.type,
      pages_processed: results.length,
      success_count: successCount,
      failed_count: results.length - successCount,
      cost: totalCost,
      tokens: totalTokens,
    });
  } catch (error) {
    console.error('Error running pipeline condition:', error);
    return NextResponse.json({ error: 'Failed to run condition' }, { status: 500 });
  }
}

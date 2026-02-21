/**
 * AI-powered book quality scoring.
 *
 * Scores each book on 4 dimensions (0-25 each) using Gemini, then applies
 * deterministic mechanical adjustments for completeness, engagement, and images.
 * Final quality_score (0-100) stored on the book document.
 *
 * Used by:
 * - post-import-pipeline cron (Phase 6, after summary+index)
 * - scripts/enrichment/backfill-quality-scores.mjs (manual batch)
 * - /api/books/[id]/quality-score (manual trigger)
 */

import { Db } from 'mongodb';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { logGeminiCall } from './gemini-logger';

const MODEL = 'gemini-3-flash-preview';

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

interface DimensionScore {
  score: number;
  reasoning: string;
}

interface AiAssessment {
  historical_significance: DimensionScore;
  visual_appeal: DimensionScore;
  accessibility: DimensionScore;
  scholarly_value: DimensionScore;
}

export interface QualityAssessment {
  ai_scores: AiAssessment;
  ai_total: number;
  mechanical_adjustments: Record<string, number>;
  mechanical_total: number;
  final_score: number;
  model: string;
  scored_at: Date;
}

export interface QualityScoreResult {
  success: boolean;
  score?: number;
  assessment?: QualityAssessment;
  error?: string;
}

function buildPrompt(book: Record<string, unknown>, galleryImageCount: number): string {
  const title = (book.display_title || book.title || 'Unknown') as string;
  const author = (book.author || 'Unknown') as string;
  const language = (book.language || 'Unknown') as string;
  const year = book.year || 'Unknown';
  const categories = ((book.categories as string[]) || []).join(', ') || 'none';
  const pagesCount = book.pages_count || 0;
  const hasDoi = book.doi ? 'yes' : 'no';

  // Extract summary overview (truncate to 500 chars)
  const summary = book.reading_summary as Record<string, unknown> | undefined;
  const overview = ((summary?.overview as string) || '').substring(0, 500);
  const themes = ((summary?.themes as string[]) || []).join(', ');

  // Description (truncate to 200 chars)
  const description = ((book.description as string) || '').substring(0, 200);

  return `You are a rare books curator rating books for Source Library, a digital library of Western esotericism, alchemy, Hermeticism, and related traditions.

Rate this book on four dimensions (0-25 each). Be discriminating — 15 is average. Reserve 20+ for genuinely outstanding books.

Book: "${title}" by ${author}
Language: ${language}, Year: ${year}
Categories: ${categories}
Pages: ${pagesCount}
Summary: ${overview || '(none)'}
Themes: ${themes || '(none)'}
Description: ${description || '(none)'}
Illustrations: ${galleryImageCount} detected
Has DOI: ${hasDoi}

Respond with JSON only — no markdown fences, no explanation.

{
  "historical_significance": { "score": <0-25>, "reasoning": "<1 sentence>" },
  "visual_appeal": { "score": <0-25>, "reasoning": "<1 sentence>" },
  "accessibility": { "score": <0-25>, "reasoning": "<1 sentence>" },
  "scholarly_value": { "score": <0-25>, "reasoning": "<1 sentence>" }
}

Guidelines:
- Historical significance: author fame, text's role in intellectual history, rarity
- Visual appeal: LOW (0-5) for pure text. Higher for illustrations, emblems, diagrams, frontispieces
- Accessibility: broad appeal (alchemy, magic, Hermetica) > narrow (obscure theology, legal texts)
- Scholarly value: primary sources > derivative compilations, major authors > anonymous fragments`;
}

function computeMechanicalAdjustments(book: Record<string, unknown>, galleryImageCount: number): Record<string, number> {
  const adjustments: Record<string, number> = {};
  const pagesCount = (book.pages_count as number) || 0;
  const pagesOcr = (book.pages_ocr as number) || 0;
  const pagesTranslated = (book.pages_translated as number) || 0;

  // Completeness bonus (0 to +8)
  let completeness = 0;
  if (pagesCount > 0 && pagesOcr / pagesCount >= 0.9) completeness += 2;
  if (pagesCount > 0 && pagesTranslated / pagesCount >= 0.9) completeness += 3;
  if (book.reading_summary) completeness += 1;
  if ((book.index as Record<string, unknown>)?.generatedAt) completeness += 1;
  if (book.chapters) completeness += 1;
  adjustments.completeness = completeness;

  // Incomplete penalty (-5 to 0)
  if (pagesCount > 0) {
    const translatedPct = pagesTranslated / pagesCount;
    if (translatedPct < 0.1) {
      adjustments.incomplete_penalty = -5;
    } else if (translatedPct < 0.5) {
      adjustments.incomplete_penalty = -2;
    }
  }

  // Engagement bonus (0 to +5)
  const readCount = (book.read_count as number) || 0;
  adjustments.engagement = Math.min(5, Math.round(Math.log10(readCount + 1) * 2.5 * 10) / 10);

  // Gallery bonus (0 to +5)
  if (galleryImageCount >= 10) {
    adjustments.gallery = 5;
  } else if (galleryImageCount >= 5) {
    adjustments.gallery = 3;
  } else if (galleryImageCount >= 1) {
    adjustments.gallery = 1;
  }

  // Edition bonus (0 to +2)
  if (book.doi) {
    adjustments.edition = 2;
  }

  return adjustments;
}

/**
 * Score a book's quality using AI assessment + mechanical adjustments.
 * Saves quality_score and quality_assessment on the book document.
 */
export async function scoreBookQuality(
  db: Db,
  bookId: string,
): Promise<QualityScoreResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'No GEMINI_API_KEY configured' };
  }

  // Fetch book
  const book = await db.collection('books').findOne({ id: bookId });
  if (!book) {
    return { success: false, error: 'Book not found' };
  }

  // Need at least one of: summary, index, or description
  const hasSummary = !!book.reading_summary?.overview;
  const hasIndex = !!book.index?.generatedAt;
  const hasDescription = !!book.description;
  if (!hasSummary && !hasIndex && !hasDescription) {
    return { success: false, error: 'Need summary, index, or description to score' };
  }

  // Count gallery images
  const galleryImageCount = await db.collection('gallery_images')
    .countDocuments({ book_id: bookId });

  // Call Gemini
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({
    model: MODEL,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  });

  const prompt = buildPrompt(book, galleryImageCount);
  const startTime = Date.now();
  let usage = { input_tokens: 0, output_tokens: 0 };

  let aiScores: AiAssessment;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const candidates = response.candidates || [];
    const allParts = candidates[0]?.content?.parts || [];
    const fullText = allParts.map(p => p.text || '').join('');
    const text = fullText.trim() || response.text().trim();
    const usageMeta = response.usageMetadata;
    usage = {
      input_tokens: usageMeta?.promptTokenCount || 0,
      output_tokens: usageMeta?.candidatesTokenCount || 0,
    };

    try {
      aiScores = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiScores = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse JSON response');
      }
    }

    // Validate scores are in range
    for (const dim of ['historical_significance', 'visual_appeal', 'accessibility', 'scholarly_value'] as const) {
      const s = aiScores[dim]?.score;
      if (typeof s !== 'number' || s < 0 || s > 25) {
        throw new Error(`Invalid score for ${dim}: ${s}`);
      }
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    await logGeminiCall({
      type: 'other',
      mode: 'realtime',
      model: MODEL,
      book_id: bookId,
      book_title: (book.display_title || book.title) as string,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      status: 'failed',
      error_message: err instanceof Error ? err.message : 'unknown',
      duration_ms: durationMs,
      endpoint: 'quality-scoring',
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : 'AI call failed',
    };
  }

  const durationMs = Date.now() - startTime;

  // Compute AI total
  const aiTotal = aiScores.historical_significance.score
    + aiScores.visual_appeal.score
    + aiScores.accessibility.score
    + aiScores.scholarly_value.score;

  // Compute mechanical adjustments
  const mechanical = computeMechanicalAdjustments(book, galleryImageCount);
  const mechanicalTotal = Object.values(mechanical).reduce((a, b) => a + b, 0);

  // Final score, clamped 0-100
  const finalScore = Math.max(0, Math.min(100, Math.round(aiTotal + mechanicalTotal)));

  const assessment: QualityAssessment = {
    ai_scores: aiScores,
    ai_total: aiTotal,
    mechanical_adjustments: mechanical,
    mechanical_total: mechanicalTotal,
    final_score: finalScore,
    model: MODEL,
    scored_at: new Date(),
  };

  // Save to book
  await db.collection('books').updateOne(
    { id: bookId },
    {
      $set: {
        quality_score: finalScore,
        quality_assessment: assessment,
        updated_at: new Date(),
      },
    },
  );

  // Log to gemini_usage
  await logGeminiCall({
    type: 'other',
    mode: 'realtime',
    model: MODEL,
    book_id: bookId,
    book_title: (book.display_title || book.title) as string,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    status: 'success',
    duration_ms: durationMs,
    endpoint: 'quality-scoring',
  });

  return {
    success: true,
    score: finalScore,
    assessment,
  };
}

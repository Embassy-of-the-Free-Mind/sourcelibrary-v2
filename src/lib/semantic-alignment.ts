/**
 * Semantic Alignment Scoring
 *
 * Measures OCR↔translation quality using Gemini embeddings.
 * Based on the SEU (Semantic Embedding Uncertainty) approach:
 * - Cross-lingual alignment: cosine(source_embed, translation_embed)
 *   High score = translation is faithful to source
 *   Low score = garbled OCR, dropped content, or mistranslation
 *
 * Used by:
 * - enrich-books cron (after translation completes)
 * - /api/books/[id]/semantic-alignment (manual trigger)
 * - scripts/semantic-consistency/probe.mjs (batch analysis)
 */

import { Db } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logGeminiCall } from './gemini-logger';

const EMBEDDING_MODEL = 'gemini-embedding-001';
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 200;

// ── Types ───────────────────────────────────────────────────────────────────

export interface SemanticAlignmentResult {
  score: number;          // 0-1 cosine similarity
  embedding_model: string;
  scored_at: Date;
}

export interface BookAlignmentSummary {
  mean_alignment: number;
  min_alignment: number;
  max_alignment: number;
  stddev: number;
  pages_scored: number;
  pages_flagged: number;  // below threshold
  scored_at: Date;
}

export interface ScoreResult {
  success: boolean;
  pagesScored?: number;
  pagesFlagged?: number;
  meanAlignment?: number;
  error?: string;
}

// ── Math ────────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Text preprocessing ──────────────────────────────────────────────────────

/**
 * Strip XML/annotation tags from OCR and translation text before embedding.
 * Tags like <meta>...</meta>, <language>Latin</language>, <header>...</header>
 * are structural annotations that pollute the semantic signal.
 * On the flagged Theatrum Chemicum page, 64% of text was tags — stripping
 * them turned a false positive (0.68) into correct alignment.
 */
function stripAnnotations(text: string): string {
  return text
    // Remove full XML tag pairs and their content for meta/structural tags
    .replace(/<(?:meta|language|page-type|page-num|header|sig|folio|warning)>[^]*?<\/(?:meta|language|page-type|page-num|header|sig|folio|warning)>/g, '')
    // Remove self-closing and opening-only structural tags
    .replace(/<\/?(?:meta|language|page-type|page-num|header|sig|folio|warning)>/g, '')
    // Keep content-bearing tags (note, margin, gloss, term, etc.) but strip the tags themselves
    .replace(/<\/?[a-z-]+>/g, '')
    // Clean up whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Embedding ───────────────────────────────────────────────────────────────

async function getEmbeddings(
  genai: GoogleGenerativeAI,
  texts: string[]
): Promise<(number[] | null)[]> {
  const model = genai.getGenerativeModel({ model: EMBEDDING_MODEL });
  const results: (number[] | null)[] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const requests = batch.map(text => ({
      content: { role: 'user' as const, parts: [{ text: text.slice(0, 8000) }] },
    }));

    try {
      const response = await model.batchEmbedContents({ requests });
      for (const emb of response.embeddings) {
        results.push(emb.values);
      }
    } catch {
      // Fallback to individual requests
      for (const req of requests) {
        try {
          const single = await model.embedContent(req);
          results.push(single.embedding.values);
        } catch {
          results.push(null);
        }
      }
    }

    if (i + BATCH_SIZE < texts.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  return results;
}

// ── Flag thresholds (per-language) ──────────────────────────────────────────

// Based on language-specific probes (30 pages each, 2026-03-24):
//   Latin:    mean=0.889, std=0.028 → threshold ~2σ below mean
//   Greek:    mean=0.868, std=0.040
//   German:   mean=0.877 (from mixed probe)
//   French:   mean=0.882 (from mixed probe)
//   Chinese:  mean=0.837, std=0.033 → systematically lower (embedding model gap)
//   Armenian: mean=0.837, std=0.079 → very wide spread, bimodal
const LANGUAGE_THRESHOLDS: Record<string, number> = {
  'English': 0.90,
  'Latin': 0.83,
  'German': 0.83,
  'French': 0.83,
  'Dutch': 0.83,
  'Italian': 0.83,
  'Greek': 0.80,
  'Hebrew': 0.83,
  'Arabic': 0.83,
  'Chinese': 0.76,
  'Armenian': 0.75,
  'Sanskrit': 0.80,
  'Persian': 0.80,
};
const DEFAULT_THRESHOLD = 0.82;

function getFlagThreshold(language?: string): number {
  if (!language) return DEFAULT_THRESHOLD;
  return LANGUAGE_THRESHOLDS[language] ?? DEFAULT_THRESHOLD;
}

// ── Core scoring function ───────────────────────────────────────────────────

/**
 * Score semantic alignment for all translated pages in a book.
 * Stores per-page `semantic_alignment` and book-level summary.
 */
export async function scoreBookAlignment(
  db: Db,
  bookId: string,
): Promise<ScoreResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'No GEMINI_API_KEY configured' };
  }

  const genai = new GoogleGenerativeAI(apiKey);
  const startTime = Date.now();

  // Fetch pages with both OCR and translation
  const pages = await db.collection('pages').find(
    {
      book_id: bookId,
      'ocr.data': { $exists: true, $ne: '' },
      'translation.data': { $exists: true, $ne: '' },
    },
    { projection: { id: 1, 'ocr.data': 1, 'ocr.language': 1, 'translation.data': 1 } }
  ).toArray();

  if (pages.length === 0) {
    return { success: true, pagesScored: 0, pagesFlagged: 0 };
  }

  // Strip annotation tags before embedding — tags like <meta>, <language>, <header>
  // are structural markup that pollutes the semantic signal (up to 65% of text).
  const ocrTexts = pages.map(p => stripAnnotations(p.ocr.data));
  const ocrEmbeddings = await getEmbeddings(genai, ocrTexts);

  const translationTexts = pages.map(p => stripAnnotations(p.translation.data));
  const translationEmbeddings = await getEmbeddings(genai, translationTexts);

  // Compute per-page scores and write to DB
  const scores: number[] = [];
  const bulkOps = [];
  let flagged = 0;

  for (let i = 0; i < pages.length; i++) {
    const ocrEmb = ocrEmbeddings[i];
    const transEmb = translationEmbeddings[i];
    if (!ocrEmb || !transEmb) continue;

    const score = cosineSimilarity(ocrEmb, transEmb);
    scores.push(score);

    const threshold = getFlagThreshold(pages[i].ocr?.language);
    if (score < threshold) flagged++;

    const alignment: SemanticAlignmentResult = {
      score,
      embedding_model: EMBEDDING_MODEL,
      scored_at: new Date(),
    };

    bulkOps.push({
      updateOne: {
        filter: { id: pages[i].id },
        update: { $set: { semantic_alignment: alignment } },
      },
    });
  }

  // Bulk write page scores
  if (bulkOps.length > 0) {
    await db.collection('pages').bulkWrite(bulkOps);
  }

  // Compute book-level summary
  const meanScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const minScore = scores.length > 0 ? Math.min(...scores) : 0;
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
  const variance = scores.length > 0
    ? scores.reduce((sum, s) => sum + (s - meanScore) ** 2, 0) / scores.length
    : 0;

  const summary: BookAlignmentSummary = {
    mean_alignment: meanScore,
    min_alignment: minScore,
    max_alignment: maxScore,
    stddev: Math.sqrt(variance),
    pages_scored: scores.length,
    pages_flagged: flagged,
    scored_at: new Date(),
  };

  // Store summary on book
  await db.collection('books').updateOne(
    { id: bookId },
    { $set: { semantic_alignment: summary } }
  );

  const durationMs = Date.now() - startTime;

  // Log Gemini usage (embedding tokens are cheap but track them)
  const totalTokensEstimate = (ocrTexts.join('').length + translationTexts.join('').length) / 4;
  await logGeminiCall({
    type: 'other',
    mode: 'realtime',
    model: EMBEDDING_MODEL,
    book_id: bookId,
    input_tokens: Math.round(totalTokensEstimate),
    output_tokens: 0,
    status: 'success',
    duration_ms: durationMs,
    endpoint: 'semantic-alignment',
  });

  return {
    success: true,
    pagesScored: scores.length,
    pagesFlagged: flagged,
    meanAlignment: meanScore,
  };
}

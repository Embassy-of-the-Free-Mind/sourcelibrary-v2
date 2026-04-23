/**
 * QA-Eval Embedding-Space Evaluation
 *
 * Novel approach: evaluate OCR and translation quality by comparing
 * embedding distances between original text, AI translation, and
 * human translation. Detects hallucination via embedding divergence.
 *
 * Uses gemini-embedding-2-preview (768d) — same model as production
 * semantic search (src/lib/semantic-search.ts).
 */

import { cosineSimilarity, cosineDistance } from './metrics.mjs';

const EMBEDDING_MODEL = 'gemini-embedding-2-preview';
const EMBEDDING_DIMS = 768;

// ── Gemini Embedding API ───────────────────────────────────────────

async function getGeminiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');
  return key;
}

/**
 * Embed one or more texts using Gemini embedding-2-preview.
 * Returns array of 768d vectors.
 */
export async function embedTexts(texts) {
  const apiKey = await getGeminiKey();

  const requests = texts.map(text => ({
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text: text.slice(0, 8000) }] }, // truncate to ~2K tokens
    outputDimensionality: EMBEDDING_DIMS,
  }));

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(15000),
    },
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Embedding API ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.embeddings.map(e => e.values);
}

/**
 * Embed a single text.
 */
export async function embedText(text) {
  const [embedding] = await embedTexts([text]);
  return embedding;
}

// ── Page-level embedding evaluation ────────────────────────────────

/**
 * Evaluate a single page by embedding its OCR text, AI translation,
 * and optionally a human translation.
 *
 * @param {object} page - Page data with ocrText, translationText
 * @param {string} [humanTranslation] - Reference human translation
 * @returns {object} Distances and hallucination flag
 */
export async function evaluatePage(page, humanTranslation = null) {
  const texts = [];
  const labels = [];

  // OCR text (original language)
  if (page.ocrText) {
    texts.push(page.ocrText);
    labels.push('ocr');
  }

  // AI translation
  if (page.translationText) {
    texts.push(page.translationText);
    labels.push('aiTranslation');
  }

  // Human translation
  if (humanTranslation) {
    texts.push(humanTranslation);
    labels.push('humanTranslation');
  }

  if (texts.length < 2) {
    return { distances: {}, embeddings: {}, error: 'Need at least 2 texts to compare' };
  }

  const embeddings = await embedTexts(texts);

  // Build embedding map
  const embMap = {};
  labels.forEach((label, i) => { embMap[label] = embeddings[i]; });

  // Compute distances
  const distances = {};

  if (embMap.ocr && embMap.aiTranslation) {
    distances.ocrToAiTranslation = cosineDistance(embMap.ocr, embMap.aiTranslation);
  }

  if (embMap.ocr && embMap.humanTranslation) {
    distances.ocrToHuman = cosineDistance(embMap.ocr, embMap.humanTranslation);
  }

  if (embMap.aiTranslation && embMap.humanTranslation) {
    distances.aiToHuman = cosineDistance(embMap.aiTranslation, embMap.humanTranslation);
  }

  return {
    bookId: page.bookId,
    bookTitle: page.bookTitle,
    pageNumber: page.pageNumber,
    distances,
    embeddings: embMap,
  };
}

// ── Batch evaluation with hallucination detection ──────────────────

/**
 * Evaluate multiple pages and detect potential hallucinations.
 * Pages where OCR→Translation distance exceeds 2σ from mean are flagged.
 *
 * @param {Array} pages - Pages with ocrText and translationText
 * @param {Map} [humanTranslations] - Map of `${bookId}-${pageNumber}` → translation text
 * @param {object} [opts] - Options
 * @param {number} [opts.sigmaThreshold=2] - Standard deviations for flagging
 * @param {number} [opts.delayMs=500] - Delay between API calls
 */
export async function evaluateCorpus(pages, humanTranslations = new Map(), opts = {}) {
  const { sigmaThreshold = 2, delayMs = 500 } = opts;

  const results = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const key = `${page.bookId}-${page.pageNumber}`;
    const humanTrans = humanTranslations.get(key) || null;

    try {
      const result = await evaluatePage(page, humanTrans);
      results.push(result);
      if (i < pages.length - 1) {
        process.stdout.write(`  Embedded ${i + 1}/${pages.length}\r`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    } catch (err) {
      console.error(`  Error on ${key}: ${err.message}`);
      results.push({
        bookId: page.bookId,
        bookTitle: page.bookTitle,
        pageNumber: page.pageNumber,
        distances: {},
        error: err.message,
      });
    }
  }
  console.log(`  Embedded ${pages.length}/${pages.length}`);

  // Compute stats on OCR→Translation distances
  const ocrToTransDists = results
    .filter(r => r.distances?.ocrToAiTranslation != null)
    .map(r => r.distances.ocrToAiTranslation);

  const mean = ocrToTransDists.reduce((s, d) => s + d, 0) / (ocrToTransDists.length || 1);
  const variance = ocrToTransDists.reduce((s, d) => s + (d - mean) ** 2, 0) / (ocrToTransDists.length || 1);
  const stddev = Math.sqrt(variance);

  // Flag outliers
  const flagged = [];
  for (const r of results) {
    const d = r.distances?.ocrToAiTranslation;
    if (d != null && stddev > 0) {
      const sigmas = (d - mean) / stddev;
      r.flagged = sigmas > sigmaThreshold;
      r.sigmas = sigmas;
      if (r.flagged) {
        flagged.push({
          bookId: r.bookId,
          bookTitle: r.bookTitle,
          pageNumber: r.pageNumber,
          distance: d,
          sigmas,
        });
      }
    }
  }

  // Compute human translation stats if available
  const ocrToHumanDists = results.filter(r => r.distances?.ocrToHuman != null).map(r => r.distances.ocrToHuman);
  const aiToHumanDists = results.filter(r => r.distances?.aiToHuman != null).map(r => r.distances.aiToHuman);

  const summary = {
    pagesEvaluated: results.length,
    meanOcrToTranslation: mean,
    stdOcrToTranslation: stddev,
    flaggedCount: flagged.length,
    flagged,
  };

  if (ocrToHumanDists.length > 0) {
    summary.meanOcrToHuman = ocrToHumanDists.reduce((s, d) => s + d, 0) / ocrToHumanDists.length;
  }
  if (aiToHumanDists.length > 0) {
    summary.meanAiToHuman = aiToHumanDists.reduce((s, d) => s + d, 0) / aiToHumanDists.length;
  }

  return {
    pages: results.map(r => ({
      bookId: r.bookId,
      bookTitle: r.bookTitle,
      pageNumber: r.pageNumber,
      distances: r.distances,
      flagged: r.flagged || false,
      sigmas: r.sigmas,
      error: r.error,
    })),
    summary,
    meta: {
      embeddingModel: EMBEDDING_MODEL,
      embeddingDims: EMBEDDING_DIMS,
      sigmaThreshold,
      date: new Date().toISOString().slice(0, 10),
    },
  };
}

// ── OCR run embedding consistency ──────────────────────────────────

/**
 * Evaluate embedding consistency across multiple OCR runs of the same page.
 * If models produce semantically different outputs, embedding distances will be high.
 *
 * @param {Array<string>} ocrRuns - Array of OCR text outputs from multiple runs
 * @returns {object} Pairwise cosine distances between run embeddings
 */
export async function evaluateRunConsistency(ocrRuns) {
  if (ocrRuns.length < 2) return { pairs: [], meanDistance: 0 };

  const embeddings = await embedTexts(ocrRuns);

  const pairs = [];
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      pairs.push({
        i, j,
        distance: cosineDistance(embeddings[i], embeddings[j]),
        similarity: cosineSimilarity(embeddings[i], embeddings[j]),
      });
    }
  }

  const meanDistance = pairs.reduce((s, p) => s + p.distance, 0) / (pairs.length || 1);

  return { pairs, meanDistance };
}

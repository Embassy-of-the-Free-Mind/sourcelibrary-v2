import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import { getNextApiKey, reportRateLimitError } from './gemini-client';

export const SEMANTIC_MODEL = 'gemini-embedding-001';
export const SEMANTIC_DIMENSIONS = 3072;

// Max chars per text (~7500 tokens at 4 chars/token, model limit is 8192)
const MAX_TEXT_CHARS = 30000;

/**
 * Truncate text to fit within the model's token limit.
 */
function truncate(text: string): string {
  return text.length <= MAX_TEXT_CHARS ? text : text.slice(0, MAX_TEXT_CHARS);
}

/**
 * Embed a single text using gemini-embedding-001 (3072 dimensions).
 */
export async function embedText(
  text: string,
  taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT
): Promise<number[]> {
  const apiKey = getNextApiKey();
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({ model: SEMANTIC_MODEL });

  try {
    const result = await model.embedContent({
      content: { role: 'user', parts: [{ text: truncate(text) }] },
      taskType,
    });
    return result.embedding.values;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
      reportRateLimitError(apiKey);
    }
    throw err;
  }
}

/**
 * Batch embed texts using batchEmbedContents (up to 100 per call).
 * Returns vectors in same order as input.
 */
export async function embedTexts(
  texts: string[],
  taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const BATCH_SIZE = 100;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const apiKey = getNextApiKey();
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({ model: SEMANTIC_MODEL });

    try {
      const result = await model.batchEmbedContents({
        requests: batch.map(text => ({
          content: { role: 'user', parts: [{ text: truncate(text) }] },
          taskType,
        })),
      });
      results.push(...result.embeddings.map(e => e.values));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
        reportRateLimitError(apiKey);
      }
      throw err;
    }
  }

  return results;
}

/**
 * Embed a search query (uses RETRIEVAL_QUERY for better search relevance).
 */
export async function embedQuery(query: string): Promise<number[]> {
  return embedText(query, TaskType.RETRIEVAL_QUERY);
}

/**
 * Average multiple vectors into a unit-normalized fingerprint.
 */
export function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) throw new Error('No vectors to average');
  if (vectors.length === 1) return vectors[0];

  const dims = vectors[0].length;
  const avg = new Float64Array(dims);

  for (const vec of vectors) {
    for (let i = 0; i < dims; i++) {
      avg[i] += vec[i];
    }
  }

  // Normalize to unit vector for cosine similarity
  let norm = 0;
  for (let i = 0; i < dims; i++) {
    avg[i] /= vectors.length;
    norm += avg[i] * avg[i];
  }
  norm = Math.sqrt(norm);

  const result = new Array(dims);
  for (let i = 0; i < dims; i++) {
    result[i] = norm > 0 ? avg[i] / norm : 0;
  }

  return result;
}

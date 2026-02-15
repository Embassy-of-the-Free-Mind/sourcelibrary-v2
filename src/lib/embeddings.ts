import { Db } from 'mongodb';
import { getGeminiClient, reportRateLimitError } from './gemini-client';
import { TaskType } from '@google/generative-ai';

const EMBEDDING_MODEL = 'text-embedding-004';
const EMBEDDING_DIMENSIONS = 768;

export interface ImageEmbeddingInput {
  description: string;
  museum_description?: string;
  metadata?: {
    subjects?: string[];
    figures?: string[];
    symbols?: string[];
    style?: string;
    technique?: string;
  };
  type?: string;
}

export interface GalleryEmbedding {
  id: string; // {pageId}-{detectionIndex}
  page_id: string;
  book_id: string;
  detection_index: number;
  embedding: number[];
  text_source: string;
  model: string;
  generated_at: Date;
}

/**
 * Build the text string to embed from image detection metadata.
 * Concatenates all meaningful text fields for rich semantic representation.
 */
export function buildEmbeddingText(input: ImageEmbeddingInput): string {
  const parts: string[] = [];

  if (input.museum_description) {
    parts.push(input.museum_description);
  }

  if (input.description) {
    parts.push(input.description);
  }

  if (input.type) {
    parts.push(`Image type: ${input.type}`);
  }

  const meta = input.metadata;
  if (meta) {
    if (meta.subjects?.length) parts.push(`Subjects: ${meta.subjects.join(', ')}`);
    if (meta.figures?.length) parts.push(`Figures: ${meta.figures.join(', ')}`);
    if (meta.symbols?.length) parts.push(`Symbols: ${meta.symbols.join(', ')}`);
    if (meta.style) parts.push(`Style: ${meta.style}`);
    if (meta.technique) parts.push(`Technique: ${meta.technique}`);
  }

  return parts.join('. ').slice(0, 2000); // text-embedding-004 handles up to ~2048 tokens
}

/**
 * Generate a 768-dim embedding vector for gallery image text.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getGeminiClient();
  const model = client.getGenerativeModel({ model: EMBEDDING_MODEL });

  try {
    const result = await model.embedContent({
      content: { role: 'user', parts: [{ text }] },
      taskType: TaskType.RETRIEVAL_DOCUMENT,
    });

    return result.embedding.values;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('429') || message.toLowerCase().includes('rate limit')) {
      const apiKey = process.env.GEMINI_API_KEY || '';
      reportRateLimitError(apiKey);
    }
    throw err;
  }
}

/**
 * Generate embedding for a gallery image detection.
 */
export async function generateImageEmbedding(
  input: ImageEmbeddingInput
): Promise<{ embedding: number[]; textSource: string }> {
  const textSource = buildEmbeddingText(input);
  if (!textSource.trim()) {
    throw new Error('No text content to embed');
  }

  const embedding = await generateEmbedding(textSource);
  return { embedding, textSource };
}

/**
 * Batch embed multiple texts. Processes sequentially to respect rate limits.
 * Returns embeddings in same order as inputs.
 */
export async function generateEmbeddingBatch(
  texts: string[],
  options?: { delayMs?: number }
): Promise<number[][]> {
  const results: number[][] = [];
  const delay = options?.delayMs ?? 50; // Small delay between calls

  for (const text of texts) {
    const embedding = await generateEmbedding(text);
    results.push(embedding);
    if (delay > 0 && results.length < texts.length) {
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return results;
}

/**
 * Cosine similarity between two vectors. Both must be same length.
 * Returns value in [-1, 1] where 1 = identical direction.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export interface SimilarImageOptions {
  excludeBookId?: string;
  excludeId?: string;
  type?: string;
  minQuality?: number;
  candidateLimit?: number; // Max candidates to fetch (default 500)
  limit?: number; // Final results (default 12)
}

export interface SimilarImageResult {
  id: string;
  page_id: string;
  book_id: string;
  detection_index: number;
  similarity: number;
}

/**
 * Find images most similar to a target embedding.
 * Two-stage: fetch candidates from DB, then cosine rank in memory.
 *
 * With 500 candidates × 768 dims, the cosine computation takes <5ms.
 */
export async function findSimilarImages(
  db: Db,
  targetEmbedding: number[],
  options: SimilarImageOptions = {}
): Promise<SimilarImageResult[]> {
  const {
    excludeBookId,
    excludeId,
    candidateLimit = 500,
    limit = 12,
  } = options;

  // Fetch candidate embeddings
  const filter: Record<string, unknown> = {};
  if (excludeBookId) filter.book_id = { $ne: excludeBookId };
  if (excludeId) filter.id = { $ne: excludeId };

  const candidates = await db
    .collection('gallery_embeddings')
    .find(filter, { projection: { id: 1, page_id: 1, book_id: 1, detection_index: 1, embedding: 1 } })
    .limit(candidateLimit)
    .toArray();

  // Score all candidates
  const scored = candidates.map(c => ({
    id: c.id as string,
    page_id: c.page_id as string,
    book_id: c.book_id as string,
    detection_index: c.detection_index as number,
    similarity: cosineSimilarity(targetEmbedding, c.embedding as number[]),
  }));

  // Sort by similarity descending, take top N
  scored.sort((a, b) => b.similarity - a.similarity);

  // Deduplicate by book — max 2 per book for diversity
  const byBook = new Map<string, number>();
  const results: SimilarImageResult[] = [];

  for (const item of scored) {
    if (results.length >= limit) break;
    const bookCount = byBook.get(item.book_id) ?? 0;
    if (bookCount >= 2) continue;
    byBook.set(item.book_id, bookCount + 1);
    results.push(item);
  }

  return results;
}

/**
 * Embed a search query for semantic gallery search.
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const client = getGeminiClient();
  const model = client.getGenerativeModel({ model: EMBEDDING_MODEL });

  const result = await model.embedContent({
    content: { role: 'user', parts: [{ text: query }] },
    taskType: TaskType.RETRIEVAL_QUERY,
  });

  return result.embedding.values;
}

export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS };

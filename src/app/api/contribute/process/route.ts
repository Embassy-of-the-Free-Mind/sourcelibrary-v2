import { NextRequest } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { DEFAULT_MODEL, extractPageType, extractColumns } from '@/lib/types';
import type { PromptReference } from '@/lib/types';
import { extractTranslationMetadata } from '@/lib/translation-metadata';
import { getOcrPrompt, getTranslationPrompt } from '@/lib/prompts';
import { logGeminiCall } from '@/lib/gemini-logger';
import { images } from '@/lib/api-client';
import { createRevision } from '@/lib/page-revisions';
import { contentHash } from '@/lib/steganographia';
import { getSession } from '@/lib/auth-helpers';
import { getUnmeteredGeminiClient } from '@/lib/gemini-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max

// Helper to get image URL for a page
function getImageUrl(page: { archived_photo?: string; cropped_photo?: string; photo?: string; photo_original?: string }): string {
  return page.archived_photo || page.cropped_photo || page.photo || page.photo_original || '';
}

interface ContributorAiResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  promptRef: PromptReference;
}

// OCR with contributor's API key
async function performOCRWithKey(
  apiKey: string,
  imageUrl: string,
  language: string,
  previousPageOcr?: string
): Promise<ContributorAiResult> {
  const genAI = getUnmeteredGeminiClient(apiKey);
  const model = genAI.getGenerativeModel({ model: DEFAULT_MODEL });

  const promptResult = await getOcrPrompt({ language });
  let prompt = promptResult.text;
  if (previousPageOcr) {
    prompt += `\n\n**Previous page transcription for context:**\n${previousPageOcr.slice(0, 2000)}...`;
  }

  // Fetch the image and convert to base64
  const imageData = await images.fetchBase64(imageUrl, { includeMimeType: true });
  const { base64, mimeType } = typeof imageData === 'string'
    ? { base64: imageData, mimeType: 'image/jpeg' }
    : imageData;

  const startedAt = Date.now();
  const result = await model.generateContent([
    prompt,
    { inlineData: { mimeType, data: base64 } },
  ]);
  const durationMs = Date.now() - startedAt;

  const usageMetadata = result.response.usageMetadata;
  return {
    text: result.response.text(),
    inputTokens: usageMetadata?.promptTokenCount || 0,
    outputTokens: usageMetadata?.candidatesTokenCount || 0,
    durationMs,
    promptRef: promptResult.reference,
  };
}

// Translation with contributor's API key
async function performTranslationWithKey(
  apiKey: string,
  ocrText: string,
  sourceLanguage: string,
  previousPageTranslation?: string
): Promise<ContributorAiResult> {
  const genAI = getUnmeteredGeminiClient(apiKey);
  const model = genAI.getGenerativeModel({ model: DEFAULT_MODEL });

  const promptResult = await getTranslationPrompt(sourceLanguage);
  let prompt = promptResult.text;

  prompt += `\n\n**Text to translate:**\n${ocrText}`;

  if (previousPageTranslation) {
    prompt += `\n\n**Previous page translation for continuity:**\n${previousPageTranslation.slice(0, 2000)}...`;
  }

  const startedAt = Date.now();
  const result = await model.generateContent(prompt);
  const durationMs = Date.now() - startedAt;

  const usageMetadata = result.response.usageMetadata;
  return {
    text: result.response.text(),
    inputTokens: usageMetadata?.promptTokenCount || 0,
    outputTokens: usageMetadata?.candidatesTokenCount || 0,
    durationMs,
    promptRef: promptResult.reference,
  };
}

export async function POST(request: NextRequest) {
  // Manual auth check for streaming endpoint
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const { apiKey, bookId, processType, contributorName, costLimit = 1.0 } = await request.json();

        if (!apiKey || !bookId) {
          send({ error: 'Missing API key or book ID' });
          controller.close();
          return;
        }

        // Cost per token (rough estimate based on Gemini 2.0 Flash pricing)
        const COST_PER_1M_INPUT = 0.10;
        const COST_PER_1M_OUTPUT = 0.40;
        const estimateCost = (tokens: number) => (tokens / 1_000_000) * ((COST_PER_1M_INPUT + COST_PER_1M_OUTPUT) / 2);

        let totalCostSpent = 0;

        const db = await getDb();

        // Get book
        const book = await db.collection('books').findOne({ _id: new ObjectId(bookId) });
        if (!book) {
          send({ error: 'Book not found' });
          controller.close();
          return;
        }

        // Get pages that need processing
        let pagesQuery;
        if (processType === 'ocr') {
          pagesQuery = {
            book_id: new ObjectId(bookId),
            $or: [
              { 'ocr.data': { $exists: false } },
              { 'ocr.data': '' },
              { 'ocr.data': null },
            ],
          };
        } else {
          pagesQuery = {
            book_id: new ObjectId(bookId),
            'ocr.data': { $exists: true, $ne: '' },
            $or: [
              { 'translation.data': { $exists: false } },
              { 'translation.data': '' },
              { 'translation.data': null },
            ],
          };
        }

        const pages = await db.collection('pages')
          .find(pagesQuery)
          .sort({ page_number: 1 })
          .limit(100) // Process max 100 pages at a time
          .toArray();

        if (pages.length === 0) {
          send({ pagesCompleted: 0, complete: true, message: 'No pages need processing' });
          controller.close();
          return;
        }

        send({ totalPages: pages.length, pagesCompleted: 0, currentPage: 1, costSpent: 0 });

        let pagesCompleted = 0;
        let totalTokens = 0;
        let previousText = '';
        let limitReached = false;

        for (const page of pages as Array<{ _id: ObjectId; id?: string; page_number: number; archived_photo?: string; cropped_photo?: string; photo?: string; photo_original?: string; ocr?: { data?: string }; translation?: { data?: string } }>) {
          // Check cost limit before processing
          if (totalCostSpent >= costLimit) {
            limitReached = true;
            break;
          }

          try {
            if (processType === 'ocr') {
              const imageUrl = getImageUrl(page);
              if (!imageUrl) {
                send({ currentPage: pagesCompleted + 1, error: `No image for page ${page.page_number}` });
                continue;
              }

              const result = await performOCRWithKey(
                apiKey,
                imageUrl,
                book.original_language || 'Latin',
                previousText
              );

              // Snapshot manual edits before overwriting
              if (page.id) await createRevision(page.id, 'ocr', `contribute-${bookId}`);

              // Update page with OCR result
              const pageType = extractPageType(result.text);
              const columns = extractColumns(result.text);
              await db.collection('pages').updateOne(
                { _id: page._id },
                {
                  $set: {
                    'ocr.data': result.text,
                    'ocr.content_hash': contentHash(result.text),
                    'ocr.model': DEFAULT_MODEL,
                    'ocr.prompt_version': String(result.promptRef.version),
                    'ocr.prompt_id': result.promptRef.id,
                    'ocr.prompt_hash': result.promptRef.content_hash,
                    'ocr.prompt_name': result.promptRef.name,
                    'ocr.processed_at': new Date(),
                    'ocr.source': 'contributor',
                    'ocr.contributed_by': contributorName || 'Anonymous',
                    ...(pageType && { page_type: pageType }),
                    ...(columns && { columns }),
                  },
                }
              );

              // Log AI usage to gemini_usage so contributor work shows up in
              // analytics (cost is on the contributor's key, but the call still
              // produced data we should be able to trace).
              await logGeminiCall({
                type: 'ocr',
                mode: 'realtime',
                model: DEFAULT_MODEL,
                book_id: page.id ? bookId : undefined,
                book_title: book.title,
                page_ids: page.id ? [page.id] : undefined,
                page_count: 1,
                input_tokens: result.inputTokens,
                output_tokens: result.outputTokens,
                status: 'success',
                duration_ms: result.durationMs,
                prompt_version: String(result.promptRef.version),
                endpoint: '/api/contribute/process',
                triggered_by: 'manual',
              });

              previousText = result.text;
              const totalTokensThisCall = result.inputTokens + result.outputTokens;
              totalTokens += totalTokensThisCall;
              totalCostSpent += estimateCost(totalTokensThisCall);
            } else {
              // Translation
              const ocrText = page.ocr?.data;
              if (!ocrText) {
                continue;
              }

              const result = await performTranslationWithKey(
                apiKey,
                ocrText,
                book.original_language || 'Latin',
                previousText
              );

              // Snapshot manual edits before overwriting
              if (page.id) await createRevision(page.id, 'translation', `contribute-${bookId}`);

              // Update page with translation result + harvest metadata tags
              const translationMeta = extractTranslationMetadata(result.text);
              await db.collection('pages').updateOne(
                { _id: page._id },
                {
                  $set: {
                    translation: {
                      data: result.text,
                      content_hash: contentHash(result.text),
                      model: DEFAULT_MODEL,
                      prompt_version: String(result.promptRef.version),
                      prompt_id: result.promptRef.id,
                      prompt_hash: result.promptRef.content_hash,
                      prompt_name: result.promptRef.name,
                      processed_at: new Date(),
                      source: 'contributor',
                      contributed_by: contributorName || 'Anonymous',
                    },
                    ...translationMeta,
                  },
                }
              );

              await logGeminiCall({
                type: 'translation',
                mode: 'realtime',
                model: DEFAULT_MODEL,
                book_id: page.id ? bookId : undefined,
                book_title: book.title,
                page_ids: page.id ? [page.id] : undefined,
                page_count: 1,
                input_tokens: result.inputTokens,
                output_tokens: result.outputTokens,
                status: 'success',
                duration_ms: result.durationMs,
                prompt_version: String(result.promptRef.version),
                endpoint: '/api/contribute/process',
                triggered_by: 'manual',
              });

              previousText = result.text;
              const totalTokensThisCall = result.inputTokens + result.outputTokens;
              totalTokens += totalTokensThisCall;
              totalCostSpent += estimateCost(totalTokensThisCall);
            }

            pagesCompleted++;
            send({ currentPage: pagesCompleted, pagesCompleted, totalPages: pages.length, costSpent: totalCostSpent });

            // Small delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (pageError) {
            console.error(`Error processing page ${page.page_number}:`, pageError);
            send({ currentPage: pagesCompleted + 1, error: `Error on page ${page.page_number}` });
            // Continue with next page
          }
        }

        // Update book counts
        if (processType === 'ocr') {
          const ocrCount = await db.collection('pages').countDocuments({
            book_id: new ObjectId(bookId),
            'ocr.data': { $exists: true, $ne: '' },
          });
          await db.collection('books').updateOne(
            { _id: new ObjectId(bookId) },
            { $set: { pages_ocr: ocrCount } }
          );
        } else {
          const translateCount = await db.collection('pages').countDocuments({
            book_id: new ObjectId(bookId),
            'translation.data': { $exists: true, $ne: '' },
          });
          const pagesCount = book.pages_count || 0;
          await db.collection('books').updateOne(
            { _id: new ObjectId(bookId) },
            { $set: { pages_translated: translateCount } }
          );
        }

        // Record contribution
        await db.collection('contributions').insertOne({
          contributor_name: contributorName || 'Anonymous',
          book_id: new ObjectId(bookId),
          book_title: book.title,
          process_type: processType,
          pages_processed: pagesCompleted,
          total_tokens: totalTokens,
          cost_spent: totalCostSpent,
          cost_limit: costLimit,
          limit_reached: limitReached,
          created_at: new Date(),
        });

        // Send final response
        if (limitReached) {
          send({ pagesCompleted, limitReached: true, costSpent: totalCostSpent, totalTokens });
        } else {
          send({ pagesCompleted, complete: true, costSpent: totalCostSpent, totalTokens });
        }
        controller.close();
      } catch (error) {
        console.error('Contribution processing error:', error);
        send({ error: error instanceof Error ? error.message : 'Processing failed' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

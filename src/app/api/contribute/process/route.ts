import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { DEFAULT_PROMPTS, DEFAULT_MODEL } from '@/lib/types';
import { images } from '@/lib/api-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max

// Helper to get image URL for a page
function getImageUrl(page: { archived_photo?: string; cropped_photo?: string; photo?: string; photo_original?: string }): string {
  return page.archived_photo || page.cropped_photo || page.photo || page.photo_original || '';
}

// OCR with contributor's API key
async function performOCRWithKey(
  apiKey: string,
  imageUrl: string,
  language: string,
  previousPageOcr?: string
): Promise<{ text: string; tokens: number }> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: DEFAULT_MODEL });

  let prompt = DEFAULT_PROMPTS.ocr.replace('{language}', language);
  if (previousPageOcr) {
    prompt += `\n\n**Previous page transcription for context:**\n${previousPageOcr.slice(0, 2000)}...`;
  }

  // Fetch the image and convert to base64
  const imageData = await images.fetchBase64(imageUrl, { includeMimeType: true });
  const { base64, mimeType } = typeof imageData === 'string'
    ? { base64: imageData, mimeType: 'image/jpeg' }
    : imageData;

  const result = await model.generateContent([
    prompt,
    { inlineData: { mimeType, data: base64 } },
  ]);

  const usageMetadata = result.response.usageMetadata;
  const tokens = (usageMetadata?.promptTokenCount || 0) + (usageMetadata?.candidatesTokenCount || 0);

  return { text: result.response.text(), tokens };
}

// Translation with contributor's API key
async function performTranslationWithKey(
  apiKey: string,
  ocrText: string,
  sourceLanguage: string,
  previousPageTranslation?: string
): Promise<{ text: string; tokens: number }> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: DEFAULT_MODEL });

  let prompt = DEFAULT_PROMPTS.translation
    .replace('{source_language}', sourceLanguage)
    .replace('{target_language}', 'English');

  prompt += `\n\n**Text to translate:**\n${ocrText}`;

  if (previousPageTranslation) {
    prompt += `\n\n**Previous page translation for continuity:**\n${previousPageTranslation.slice(0, 2000)}...`;
  }

  const result = await model.generateContent(prompt);

  const usageMetadata = result.response.usageMetadata;
  const tokens = (usageMetadata?.promptTokenCount || 0) + (usageMetadata?.candidatesTokenCount || 0);

  return { text: result.response.text(), tokens };
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const { apiKey, bookId, processType, contributorName } = await request.json();

        if (!apiKey || !bookId) {
          send({ error: 'Missing API key or book ID' });
          controller.close();
          return;
        }

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

        send({ totalPages: pages.length, pagesCompleted: 0, currentPage: 1 });

        let pagesCompleted = 0;
        let totalTokens = 0;
        let previousText = '';

        for (const page of pages as Array<{ _id: ObjectId; page_number: number; archived_photo?: string; cropped_photo?: string; photo?: string; photo_original?: string; ocr?: { data?: string }; translation?: { data?: string } }>) {
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

              // Update page with OCR result
              await db.collection('pages').updateOne(
                { _id: page._id },
                {
                  $set: {
                    'ocr.data': result.text,
                    'ocr.model': DEFAULT_MODEL,
                    'ocr.processed_at': new Date(),
                    'ocr.contributed_by': contributorName || 'Anonymous',
                  },
                }
              );

              previousText = result.text;
              totalTokens += result.tokens;
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

              // Update page with translation result
              await db.collection('pages').updateOne(
                { _id: page._id },
                {
                  $set: {
                    'translation.data': result.text,
                    'translation.model': DEFAULT_MODEL,
                    'translation.processed_at': new Date(),
                    'translation.contributed_by': contributorName || 'Anonymous',
                  },
                }
              );

              previousText = result.text;
              totalTokens += result.tokens;
            }

            pagesCompleted++;
            send({ currentPage: pagesCompleted, pagesCompleted, totalPages: pages.length });

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
            {
              $set: {
                pages_translated: translateCount,
                translation_percent: pagesCount > 0 ? Math.round((translateCount / pagesCount) * 100) : 0,
              },
            }
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
          created_at: new Date(),
        });

        send({ pagesCompleted, complete: true, totalTokens });
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

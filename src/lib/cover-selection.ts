/**
 * AI-Powered Cover Selection
 *
 * Uses Gemini Vision to analyze the first N pages of a book
 * and select the best cover image (frontispiece, decorative title page, etc.)
 *
 * Cost: ~$0.005-0.010 per book (10 pages analyzed)
 * Model: gemini-3-flash-preview
 */

import type { Db } from 'mongodb';
import type { Book } from './types/book';
import { getGeminiClient } from './gemini-client';
import { images } from './api-client/images';
import { logGeminiCall } from './gemini-logger';
import { classifyError } from './errors';
import { HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { MODEL_PRICING } from './ai';

// Safety settings for Gemini Vision - disable filters for historical texts
const OCR_SAFETY_SETTINGS = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

/**
 * Result from AI-powered cover selection
 */
export interface CoverSelectionResult {
  selectedImageUrl: string;
  pageNumber: number;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
  tokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
}

/**
 * Expected JSON response from Gemini cover selection
 */
interface GeminiCoverResponse {
  selected_page_number: number;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Calculate cost for Gemini API usage
 */
function calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Select the best cover image from the first N pages using Gemini vision
 * Falls back to first page if AI selection fails
 *
 * @param db - Database instance
 * @param bookId - Book ID to analyze
 * @param maxPages - Maximum number of pages to analyze (default: 10)
 * @returns Cover selection result with URL, page number, and metadata
 */
export async function selectBestCover(
  db: Db,
  bookId: string,
  maxPages: number = 10
): Promise<CoverSelectionResult> {
  const startTime = Date.now();

  // Validate bookId
  if (!bookId) {
    throw new Error('selectBestCover: bookId is required');
  }

  // 1. Fetch book and first N pages
  const book = await db.collection<Book>('books').findOne({ id: bookId });
  if (!book) {
    throw new Error(`Book not found for cover selection. Book ID: ${bookId}`);
  }

  const pages = await db.collection('pages')
    .find({ book_id: bookId })
    .sort({ page_number: 1 })
    .limit(maxPages)
    .toArray();

  if (!pages || pages.length === 0) {
    throw new Error(`No pages found for cover selection. Book ID: ${bookId}, Pages found: ${pages?.length ?? 0}`);
  }

  // 2. Build image parts for Gemini (cropped_photo preferred, fallback to photo)
  const imageParts = [];
  const pageMap = new Map<number, { pageNumber: number; url: string }>();

  for (const page of pages) {
    const imageUrl = page.cropped_photo || page.photo;
    if (!imageUrl) continue;

    try {
      const { base64, mimeType } = await images.fetchBase64(imageUrl, {
        includeMimeType: true
      }) as { base64: string; mimeType: string };

      imageParts.push({
        inlineData: { mimeType, data: base64 }
      });

      pageMap.set(imageParts.length, {
        pageNumber: page.page_number,
        url: imageUrl
      });
    } catch (error) {
      console.warn(`Failed to fetch image for page ${page.page_number}:`, error);
      // Continue with remaining images
    }
  }

  // Fallback if no images could be fetched
  if (imageParts.length === 0) {
    const firstPage = pages[0];
    return {
      selectedImageUrl: firstPage.cropped_photo || firstPage.photo,
      pageNumber: firstPage.page_number,
      rationale: 'Fallback to first page (no images could be fetched)',
      confidence: 'low',
      tokenUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }
    };
  }

  // 3. Call Gemini with all images
  try {
    const model = getGeminiClient().getGenerativeModel({
      model: 'gemini-3-flash-preview'
    });

    const prompt = `You are a rare book librarian selecting the best cover image for a digitized historical book.
Analyze these page images (in order, starting from page 1) and select the BEST cover image.

CRITERIA (in priority order):
1. **Frontispiece/Title page** - Decorative title page with:
   - Centered text with title/author
   - Decorative borders, frames, or ornamental elements
   - Publisher information (Latin: "excudebat", "typis", "apud", "impensis")
   - Emblems, engravings, or allegorical imagery
   - Architectural frames or columns

2. **Visual quality** - The image should be:
   - Clear and legible (not blurry, faded, or damaged)
   - Well-composed with good symmetry
   - Visually appealing and representative of the book

3. **Avoid** - Do NOT select:
   - Blank pages or copyright pages
   - Plain text-only pages with no decoration
   - Tables of contents or indices
   - Pages with modern stamps/labels
   - Severely damaged or illegible pages

RESPONSE FORMAT:
Return ONLY a JSON object with this exact structure:
{
  "selected_page_number": 1,
  "rationale": "Brief 1-2 sentence explanation of why this page is best",
  "confidence": "high"
}

The selected_page_number should be the index (1-based) of which image you selected from those provided.
Confidence levels: "high" = clear frontispiece, "medium" = decent title page, "low" = all pages poor quality.

If all pages are poor quality or blank, select page 1 and mark confidence as "low".`;

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          ...imageParts
        ]
      }],
      safetySettings: OCR_SAFETY_SETTINGS,
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1000,
        responseMimeType: 'application/json',
      }
    });

    const response = result.response;
    const responseText = response.text();
    const usageMetadata = response.usageMetadata;

    // Parse JSON response
    const jsonText = responseText.trim();

    // Validate JSON format
    if (!jsonText.startsWith('{') || !jsonText.endsWith('}')) {
      throw new Error(`Invalid JSON format in Gemini response. Expected {...}, got: ${jsonText.substring(0, 200)}`);
    }

    const parsed = JSON.parse(jsonText) as GeminiCoverResponse;

    // Validate response structure
    if (!parsed.selected_page_number || !parsed.rationale || !parsed.confidence) {
      throw new Error(`Gemini response missing required fields. Got: ${JSON.stringify(parsed)}`);
    }

    const selectedPage = pageMap.get(parsed.selected_page_number);

    if (!selectedPage) {
      throw new Error(`Invalid page number from Gemini: ${parsed.selected_page_number}. Valid range: 1-${pageMap.size}`);
    }

    // Calculate cost
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;
    const costUsd = calculateCost(inputTokens, outputTokens, 'gemini-3-flash-preview');

    // Log success
    await logGeminiCall({
      type: 'other',
      mode: 'realtime',
      model: 'gemini-3-flash-preview',
      book_id: bookId,
      book_title: book?.title,
      page_ids: pages.map(p => p.id),
      page_count: pages.length,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      status: 'success',
      endpoint: 'cover-selection',
      duration_ms: Date.now() - startTime
    });

    return {
      selectedImageUrl: selectedPage.url,
      pageNumber: selectedPage.pageNumber,
      rationale: parsed.rationale,
      confidence: parsed.confidence,
      tokenUsage: { inputTokens, outputTokens, costUsd }
    };

  } catch (error) {
    // Log failure
    const { category, message } = classifyError(error);
    await logGeminiCall({
      type: 'other',
      mode: 'realtime',
      model: 'gemini-3-flash-preview',
      book_id: bookId,
      book_title: book?.title,
      page_count: pages.length,
      input_tokens: 0,
      output_tokens: 0,
      status: 'failed',
      error_message: message,
      error_category: category,
      endpoint: 'cover-selection',
      duration_ms: Date.now() - startTime
    });

    // Fallback to first page
    const firstPage = pages[0];
    return {
      selectedImageUrl: firstPage.cropped_photo || firstPage.photo,
      pageNumber: firstPage.page_number,
      rationale: `AI selection failed: ${message}`,
      confidence: 'low',
      tokenUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }
    };
  }
}
